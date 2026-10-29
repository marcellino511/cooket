import { BaseError, HttpRequestError, TimeoutError, createPublicClient, getAddress, http, parseEventLogs, type Log } from 'viem'
import { arc } from 'viem/chains'
import { ARC_SYSTEM_EMITTER, type LinkPayment } from '../src/shared/links'
import { ROUTER_ABI, linkIdToBytes32 } from '../src/shared/router'
import type { DbLink } from './db'
import { CHAIN_ID, GAS_DECIMALS, RPC_URL, USDC_ADDRESS, USDC_DECIMALS } from './config'

export const client = createPublicClient({ chain: arc, transport: http(RPC_URL) })

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** Native logs carry 18 decimals; the ERC-20 view carries 6. */
const SCALE = 10n ** BigInt(GAS_DECIMALS - USDC_DECIMALS)

let chainChecked: Promise<boolean> | null = null
function rpcIsArcMainnet(): Promise<boolean> {
  chainChecked ??= client
    .getChainId()
    .then((id) => id === CHAIN_ID)
    .catch(() => {
      chainChecked = null
      return false
    })
  return chainChecked
}

export type VerifyResult = { ok: true; payment: LinkPayment } | { ok: false; code: string; message: string }

const fail = (code: string, message: string): VerifyResult => ({ ok: false, code, message })

const routerChecks = new Map<string, Promise<boolean>>()
/**
 * A router address only counts if it has code on Arc Mainnet and reports the canonical USDC as its token.
 * This catches a mistyped or wrong-chain address before any link is created or any payment is credited.
 */
export function routerIsValid(router: `0x${string}`): Promise<boolean> {
  const key = router.toLowerCase()
  let check = routerChecks.get(key)
  if (!check) {
    check = (async () => {
      if (!(await rpcIsArcMainnet())) throw new Error('rpc')
      const code = await client.getCode({ address: router })
      if (!code || code === '0x') return false
      try {
        const token = await client.readContract({ address: router, abi: ROUTER_ABI, functionName: 'USDC' })
        return token.toLowerCase() === USDC_ADDRESS.toLowerCase()
      } catch (error) {
        // Network trouble is retryable; a contract that has no USDC() getter (or reverts) is simply not a router.
        if (error instanceof BaseError && error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) throw error
        return false
      }
    })().catch((error: unknown) => {
      routerChecks.delete(key) // do not cache RPC failures
      throw error
    })
    routerChecks.set(key, check)
  }
  return check
}

/** True when `logs` hold a real USDC movement of exactly `amount` from payer to recipient, emitted before `beforeLogIndex`. */
function hasUsdcMovement(logs: readonly Log[], payer: string, recipient: string, amount: bigint, beforeLogIndex: number): boolean {
  return logs.some((log) => {
    if (log.logIndex === null || log.logIndex >= beforeLogIndex) return false
    const topics = log.topics
    if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC || !topics[1] || !topics[2]) return false
    if (`0x${topics[1].slice(26)}`.toLowerCase() !== payer.toLowerCase()) return false
    if (`0x${topics[2].slice(26)}`.toLowerCase() !== recipient.toLowerCase()) return false
    const value = BigInt(log.data)
    const emitter = log.address.toLowerCase()
    // The USDC ERC-20 reports 6 decimals; the Arc system emitter reports the same movement at 18.
    if (emitter === USDC_ADDRESS.toLowerCase()) return value === amount
    if (emitter === ARC_SYSTEM_EMITTER.toLowerCase()) return value === amount * SCALE
    return false
  })
}

/**
 * Router links: credit a payment only from a PaymentReceived event emitted by THIS link's router,
 * carrying THIS link's id and recipient, backed by a real USDC movement in the same successful transaction.
 */
async function verifyRouterPayment(link: DbLink & { router: `0x${string}` }, txHash: `0x${string}`): Promise<VerifyResult> {
  const valid = await routerIsValid(link.router).catch(() => null)
  if (valid === null) return fail('rpc_unavailable', 'The Arc Mainnet RPC could not be verified. Try again shortly.')
  if (!valid) return fail('router_invalid', 'The payment contract for this link could not be verified on Arc Mainnet.')

  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null)
  if (!receipt) return fail('not_found', 'That transaction is not on Arc Mainnet yet. Wait for it to confirm and try again.')
  if (receipt.status !== 'success') return fail('reverted', 'That transaction failed onchain, so no payment was made.')

  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
  if (!block) return fail('rpc_unavailable', 'Could not read the transaction block. Try again shortly.')
  const paidAt = Number(block.timestamp) * 1000
  if (paidAt < link.createdAt) return fail('before_link', 'That payment was made before this link existed.')
  if (link.expiresAt && paidAt > link.expiresAt) return fail('after_expiry', 'That payment was made after this link expired.')

  const expectedLinkId = linkIdToBytes32(link.id)
  const events = parseEventLogs({ abi: ROUTER_ABI, eventName: 'PaymentReceived', logs: receipt.logs, strict: true }).filter(
    (e) => e.address.toLowerCase() === link.router.toLowerCase(),
  )
  if (events.length === 0) return fail('no_event', 'That transaction has no payment from this link’s payment contract.')
  const forThisLink = events.filter((e) => e.args.linkId === expectedLinkId && e.args.recipient.toLowerCase() === link.recipient.toLowerCase())
  if (forThisLink.length === 0) return fail('wrong_link', 'That payment was made for a different link or recipient.')

  const expected = link.mode === 'fixed' ? BigInt(link.amountRaw ?? '0') : undefined
  let lastFailure: VerifyResult = fail('wrong_amount', 'The amount paid does not match this link.')
  for (const event of forThisLink) {
    const { payer, recipient, amount } = event.args
    if (payer.toLowerCase() === recipient.toLowerCase()) {
      lastFailure = fail('self_payment', 'A wallet cannot pay its own payment link.')
      continue
    }
    if (expected !== undefined ? amount !== expected : amount <= 0n) {
      lastFailure = fail('wrong_amount', 'The amount paid does not match this link’s fixed amount.')
      continue
    }
    if (event.logIndex === null || !hasUsdcMovement(receipt.logs, payer, recipient, amount, event.logIndex)) {
      lastFailure = fail('no_transfer', 'No matching USDC transfer was found in that transaction.')
      continue
    }
    return {
      ok: true,
      payment: {
        txHash,
        logIndex: event.logIndex,
        payer: getAddress(payer),
        amountRaw: amount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        paidAt,
        verifiedAt: Date.now(),
      },
    }
  }
  return lastFailure
}

/**
 * Verifies, from chain data only, that `txHash` paid this link: Arc Mainnet, a successful transaction,
 * a USDC Transfer to the link's recipient, the right amount, and inside the link's validity window.
 */
export async function verifyPayment(link: DbLink, txHash: `0x${string}`): Promise<VerifyResult> {
  if (link.router) return verifyRouterPayment({ ...link, router: link.router }, txHash)
  if (!(await rpcIsArcMainnet())) return fail('rpc_unavailable', 'The Arc Mainnet RPC could not be verified. Try again shortly.')

  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null)
  if (!receipt) return fail('not_found', 'That transaction is not on Arc Mainnet yet. Wait for it to confirm and try again.')
  if (receipt.status !== 'success') return fail('reverted', 'That transaction failed onchain, so no payment was made.')

  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
  if (!block) return fail('rpc_unavailable', 'Could not read the transaction block. Try again shortly.')
  const paidAt = Number(block.timestamp) * 1000
  if (paidAt < link.createdAt) return fail('before_link', 'That payment was made before this link existed.')
  if (link.expiresAt && paidAt > link.expiresAt) return fail('after_expiry', 'That payment was made after this link expired.')

  const recipient = link.recipient.toLowerCase()
  const candidates = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== ARC_SYSTEM_EMITTER.toLowerCase()) return []
    if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC || !log.topics[1] || !log.topics[2]) return []
    const to = `0x${log.topics[2].slice(26)}`
    if (to.toLowerCase() !== recipient) return []
    return [{ from: getAddress(`0x${log.topics[1].slice(26)}`), value: BigInt(log.data), logIndex: log.logIndex }]
  })
  if (candidates.length === 0) return fail('no_transfer', 'That transaction did not send USDC to this link’s recipient.')

  let match: (typeof candidates)[number] | undefined
  if (link.mode === 'fixed') {
    const expected = BigInt(link.amountRaw ?? '0') * SCALE
    match = candidates.find((c) => c.value === expected)
    if (!match) return fail('wrong_amount', 'The amount sent does not match this link’s fixed amount.')
  } else {
    match = candidates.filter((c) => c.value >= SCALE).sort((a, b) => (a.value > b.value ? -1 : 1))[0]
    if (!match) return fail('wrong_amount', 'The amount sent is below the smallest USDC unit.')
  }

  return {
    ok: true,
    payment: {
      txHash,
      logIndex: match.logIndex,
      payer: match.from,
      amountRaw: (match.value / SCALE).toString(),
      blockNumber: receipt.blockNumber.toString(),
      paidAt,
      verifiedAt: Date.now(),
    },
  }
}
