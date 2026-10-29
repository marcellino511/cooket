import { createPublicClient, getAddress, http } from 'viem'
import { arc } from 'viem/chains'
import { ARC_SYSTEM_EMITTER, type LinkPayment } from '../src/shared/links'
import type { DbLink } from './db'
import { CHAIN_ID, GAS_DECIMALS, RPC_URL, USDC_DECIMALS } from './config'

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

/**
 * Verifies, from chain data only, that `txHash` paid this link: Arc Mainnet, a successful transaction,
 * a USDC Transfer to the link's recipient, the right amount, and inside the link's validity window.
 */
export async function verifyPayment(link: DbLink, txHash: `0x${string}`): Promise<VerifyResult> {
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
