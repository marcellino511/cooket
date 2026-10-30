import { TransactionReceiptNotFoundError, createPublicClient, getAddress, http, keccak256, parseEventLogs, toEventSelector, type Log } from 'viem'
import { arc } from 'viem/chains'
import { ARC_SYSTEM_EMITTER, type LinkPayment } from '../src/shared/links'
import { ROUTER_ABI, linkIdToBytes32 } from '../src/shared/router'
import type { DbLink } from './db'
import { CHAIN_ID, GAS_DECIMALS, RPC_URL, ROUTER_CODE_HASH, USDC_ADDRESS, USDC_DECIMALS } from './config'

export const client = createPublicClient({ chain: arc, transport: http(RPC_URL) })

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** Native logs carry 18 decimals; the ERC-20 view carries 6. */
const SCALE = 10n ** BigInt(GAS_DECIMALS - USDC_DECIMALS)

async function rpcIsArcMainnet(): Promise<boolean> {
  return client.getChainId().then((id) => id === CHAIN_ID).catch(() => false)
}

export type VerifyResult = { ok: true; payment: LinkPayment } | { ok: false; code: string; message: string }

const fail = (code: string, message: string): VerifyResult => ({ ok: false, code, message })

/** Getter checks alone do not establish identity: a fabricated router can return any token address. */
export async function routerIsValid(router: `0x${string}`): Promise<boolean> {
  if (!ROUTER_CODE_HASH) return false
  if (!(await rpcIsArcMainnet())) throw new Error('rpc')
  const code = await client.getCode({ address: router })
  if (!code || code === '0x' || keccak256(code) !== ROUTER_CODE_HASH) return false
  // With the pinned immutable runtime, a getter read failure is retryable provider trouble.
  const token = await client.readContract({ address: router, abi: ROUTER_ABI, functionName: 'USDC' })
  return typeof token === 'string' && token.toLowerCase() === USDC_ADDRESS.toLowerCase()
}

/** Only Arc's canonical 18-decimal system emitter establishes a movement; never count its ERC-20 mirror. */
function movement(log: Log): { from: `0x${string}`; to: string; value: bigint; logIndex: number } | null {
  if (log.address.toLowerCase() !== ARC_SYSTEM_EMITTER.toLowerCase() || log.removed ||
      !Number.isSafeInteger(log.logIndex) || log.logIndex === null || log.logIndex < 0) return null
  if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC ||
      !/^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[1] ?? '') ||
      !/^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[2] ?? '') ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data)) return null
  const from = getAddress(`0x${log.topics[1].slice(26)}`)
  const to = `0x${log.topics[2].slice(26)}`
  if (/^0x0{40}$/i.test(from) || /^0x0{40}$/i.test(to)) return null
  return { from, to, value: BigInt(log.data), logIndex: log.logIndex }
}

async function readReceipt(txHash: `0x${string}`) {
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch((error: unknown) => error instanceof TransactionReceiptNotFoundError ? null : undefined)
  if (receipt === undefined) return { error: fail('rpc_unavailable', 'Could not read the transaction receipt. Try again shortly.') } as const
  if (!receipt) return { error: fail('not_found', 'That transaction is not on Arc Mainnet yet. Wait for it to confirm and try again.') } as const
  if (receipt.status === 'reverted') return { error: fail('reverted', 'That transaction failed onchain, so no payment was made.') } as const
  if (receipt.status !== 'success' || typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n) {
    return { error: fail('invalid_receipt', 'The transaction receipt is malformed.') } as const
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
  if (!block) return { error: fail('rpc_unavailable', 'Could not read the transaction block. Try again shortly.') } as const
  // A mined canonical receipt provides the required one confirmation. Reject stale/reorged or mixed receipts.
  if (!Array.isArray(receipt.logs)) return { error: fail('invalid_receipt', 'The transaction receipt has no logs.') } as const
  if (receipt.logs.some((log) => !log || typeof log.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(log.address) ||
      !Array.isArray(log.topics) || !log.topics.every((topic) => typeof topic === 'string' && /^0x[0-9a-fA-F]{64}$/.test(topic)) ||
      typeof log.data !== 'string' || typeof log.transactionHash !== 'string')) {
    return { error: fail('invalid_receipt', 'The transaction receipt has malformed logs.') } as const
  }
  const indices = receipt.logs.map((log) => log.logIndex)
  if (typeof receipt.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash ?? '') ||
      typeof block.timestamp !== 'bigint' || !Number.isSafeInteger(Number(block.timestamp) * 1000) ||
      receipt.transactionHash.toLowerCase() !== txHash.toLowerCase() || block.hash !== receipt.blockHash ||
      block.number !== receipt.blockNumber || new Set(indices).size !== indices.length ||
      receipt.logs.some((log) => log.removed || log.blockHash !== receipt.blockHash ||
        log.blockNumber !== receipt.blockNumber || log.transactionHash?.toLowerCase() !== txHash.toLowerCase() ||
        log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0)) {
    return { error: fail('invalid_receipt', 'The transaction receipt is inconsistent. Try again shortly.') } as const
  }
  return { receipt, paidAt: Number(block.timestamp) * 1000 } as const
}

/**
 * Router links: credit a payment only from a PaymentReceived event emitted by THIS link's router,
 * carrying THIS link's id and recipient, backed by a real USDC movement in the same successful transaction.
 */
async function verifyRouterPayment(link: DbLink & { router: `0x${string}` }, txHash: `0x${string}`): Promise<VerifyResult> {
  if (!ROUTER_CODE_HASH) return fail('router_not_configured', 'The payment contract runtime hash is not configured on the server.')
  const valid = await routerIsValid(link.router).catch(() => null)
  if (valid === null) return fail('rpc_unavailable', 'The Arc Mainnet RPC could not be verified. Try again shortly.')
  if (!valid) return fail('router_invalid', 'The payment contract for this link could not be verified on Arc Mainnet.')

  const read = await readReceipt(txHash)
  if (read.error) return read.error
  const { receipt, paidAt } = read
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
    if (amount <= 0n || (expected !== undefined && amount !== expected)) {
      lastFailure = fail('wrong_amount', 'The amount paid does not match this link’s fixed amount.')
      continue
    }
    const previousEventIndex = events.filter((other) => other.logIndex !== null && event.logIndex !== null && other.logIndex < event.logIndex)
      .reduce((latest, other) => Math.max(latest, other.logIndex ?? -1), -1)
    const transfer = [...receipt.logs].sort((a, b) => (b.logIndex ?? -1) - (a.logIndex ?? -1)).map(movement).find((m) => m && event.logIndex !== null && m.logIndex > previousEventIndex && m.logIndex < event.logIndex &&
      m.from.toLowerCase() === payer.toLowerCase() && m.to.toLowerCase() === recipient.toLowerCase() && m.value === amount * SCALE)
    if (!transfer) {
      lastFailure = fail('no_transfer', 'No matching USDC transfer was found in that transaction.')
      continue
    }
    return {
      ok: true,
      payment: {
        txHash,
        logIndex: transfer.logIndex,
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
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return fail('bad_hash', 'Transaction hash is invalid.')
  if (link.router) return verifyRouterPayment({ ...link, router: link.router }, txHash)
  if (!(await rpcIsArcMainnet())) return fail('rpc_unavailable', 'The Arc Mainnet RPC could not be verified. Try again shortly.')

  const read = await readReceipt(txHash)
  if (read.error) return read.error
  const { receipt, paidAt } = read
  if (paidAt < link.createdAt) return fail('before_link', 'That payment was made before this link existed.')
  if (link.expiresAt && paidAt > link.expiresAt) return fail('after_expiry', 'That payment was made after this link expired.')

  // Router transactions cannot also settle legacy links, including records saved with old event indices.
  const paymentTopic = toEventSelector('PaymentReceived(bytes32,address,address,uint256,bytes32)')
  if (receipt.logs.some((log) => log.topics[0] === paymentTopic)) return fail('router_payment', 'A router payment cannot be claimed by a direct-transfer link.')
  const recipient = link.recipient.toLowerCase()
  const candidates = receipt.logs.map(movement).filter((m): m is NonNullable<typeof m> => m !== null && m.to.toLowerCase() === recipient && m.from.toLowerCase() !== recipient)
  if (candidates.length === 0) return fail('no_transfer', 'That transaction did not send USDC to this link’s recipient.')

  let match: (typeof candidates)[number] | undefined
  if (link.mode === 'fixed') {
    const expected = BigInt(link.amountRaw ?? '0') * SCALE
    match = candidates.find((c) => c.value > 0n && c.value === expected)
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
