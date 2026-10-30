/** Read-only recovery and checkout gating. No wallet or transaction-submission methods. */
import { TransactionReceiptNotFoundError, TransactionNotFoundError } from 'viem'
import type { Address, Hex, LocalTx } from '../domain/types'
import { LINK_CHAIN_ID, type LinkPayment } from '../shared/links'

export interface RecoveryClient {
  getChainId(): Promise<number>
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: string; transactionHash: Hex; blockHash: Hex; blockNumber: bigint }>
  getTransaction(args: { hash: Hex }): Promise<{ hash: Hex; from: Address; nonce: number; to: Address | null; value: bigint; input: Hex }>
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null; number: bigint | null }>
  getBlockNumber(): Promise<bigint>
  getCode(args: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
}
export interface Inspection {
  state: 'confirmed' | 'reverted' | 'cancelled' | 'pending' | 'unknown'
  hash: Hex
  nonce?: number
  blockNumber?: bigint
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function isUnresolvedPayment(tx: LocalTx): boolean {
  return tx.kind === 'payment-link' && Boolean(tx.linkId) && !tx.linkVerifiedAt &&
    !(tx.status === 'failed' && (tx.failureEvidence === 'reverted' || tx.failureEvidence === 'cancelled'))
}

/** A missing transaction, even on two successful lookups, does not prove it was dropped. */
export async function inspectTransaction(tx: LocalTx, client: RecoveryClient, confirmations: number): Promise<Inspection> {
  const unknown: Inspection = { state: 'unknown', hash: tx.hash, nonce: tx.nonce }
  if (tx.chainId !== LINK_CHAIN_ID || await client.getChainId().catch(() => null) !== tx.chainId) return unknown
  async function mined(hash: Hex) {
    const receipt = await client.getTransactionReceipt({ hash })
    if (!same(receipt.transactionHash, hash) || !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) || /^0x0{64}$/i.test(receipt.blockHash) || typeof receipt.blockNumber !== 'bigint' || receipt.blockNumber < 0n ||
        (receipt.status !== 'success' && receipt.status !== 'reverted')) return null
    const [block, head] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlockNumber()])
    if (!block.hash || block.hash !== receipt.blockHash || block.number !== receipt.blockNumber || head - receipt.blockNumber + 1n < BigInt(confirmations)) return null
    return receipt
  }
  let notFound = false
  try {
    const receipt = await mined(tx.hash)
    if (receipt) return { state: receipt.status === 'success' ? 'confirmed' : 'reverted', hash: tx.hash, blockNumber: receipt.blockNumber, nonce: tx.nonce }
  } catch (error) { notFound = error instanceof TransactionReceiptNotFoundError }

  let nonce = tx.nonce
  let visible = false
  try {
    const original = await client.getTransaction({ hash: tx.hash })
    if (same(original.hash, tx.hash) && same(original.from, tx.from) && Number.isSafeInteger(original.nonce) && original.nonce >= 0) {
      nonce = original.nonce
      visible = true
    }
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError)) notFound = false
  }

  // A canonical, mined replacement consuming the SAME sender nonce is positive evidence.
  // Successful arbitrary replacements must still be verified against the payment link.
  if (tx.replacementHash && !same(tx.replacementHash, tx.hash) && nonce !== undefined && Number.isSafeInteger(nonce) && nonce >= 0) {
    try {
      const [replacement, receipt] = await Promise.all([client.getTransaction({ hash: tx.replacementHash }), mined(tx.replacementHash)])
      if (receipt && same(replacement.hash, tx.replacementHash) && same(replacement.from, tx.from) && replacement.nonce === nonce) {
        const selfCancel = replacement.to !== null && same(replacement.to, tx.from) && replacement.value === 0n && replacement.input === '0x'
        // A delegated/smart account can execute code even on a zero-value self-call.
        let plainAccount = false
        if (selfCancel) {
          try {
            const code = await client.getCode({ address: tx.from, blockNumber: receipt.blockNumber })
            // viem represents a successful empty-code response as undefined.
            plainAccount = code === undefined || code === '0x'
          } catch { /* An unavailable code lookup is not proof of an ordinary account. */ }
        }
        const cancelled = receipt.status === 'reverted' || plainAccount
        return { state: cancelled ? 'cancelled' : 'confirmed', hash: tx.replacementHash, blockNumber: receipt.blockNumber, nonce }
      }
    } catch { /* No positive replacement proof: stay unresolved. */ }
  }
  return { ...unknown, nonce, state: visible && notFound ? 'pending' : 'unknown' }
}

export interface RecoveryDependencies {
  client: RecoveryClient
  confirmations: number
  verifyPayment: (linkId: string, hash: Hex) => Promise<{ verified: true; payment: LinkPayment }>
  now: () => number
}

/** Server acknowledgement is persisted only after checking the returned payment identity. */
export async function recoverTransaction(tx: LocalTx, deps: RecoveryDependencies): Promise<LocalTx> {
  if (tx.kind === 'payment-link' && tx.linkVerifiedAt) return tx
  const result = await inspectTransaction(tx, deps.client, deps.confirmations)
  const base = { ...tx, nonce: result.nonce }
  if (result.state === 'reverted' || result.state === 'cancelled') {
    return { ...base, status: 'failed', failureEvidence: result.state, recoveryMessage: undefined,
      failureReason: result.state === 'reverted' ? 'The transaction reverted onchain.' : 'A confirmed transaction consumed this wallet nonce without completing the payment.' }
  }
  if (tx.kind === 'payment-link' && tx.linkId) {
    try {
      const response = await deps.verifyPayment(tx.linkId, result.hash)
      const payment = response.payment
      if (response.verified !== true || !same(payment.txHash, result.hash) || !same(payment.payer, tx.from) || payment.amountRaw !== tx.amountRaw ||
          !/^[0-9]+$/.test(payment.blockNumber) || !Number.isSafeInteger(payment.logIndex) || payment.logIndex < 0 ||
          !Number.isSafeInteger(payment.verifiedAt) || !Number.isSafeInteger(payment.paidAt)) throw new Error('Invalid verification response')
      return { ...base, status: 'completed', blockNumber: payment.blockNumber, confirmedAt: payment.paidAt,
        linkVerifiedAt: deps.now(), verifiedPaymentHash: payment.txHash, failureEvidence: undefined, failureReason: undefined, recoveryMessage: undefined }
    } catch {
      return { ...base, status: result.state === 'confirmed' ? 'completed' : tx.status === 'completed' ? 'completed' : 'pending',
        blockNumber: result.blockNumber?.toString() ?? tx.blockNumber, failureEvidence: undefined, failureReason: undefined,
        recoveryMessage: 'The existing payment is not verified yet. Its status may be temporarily unavailable. Do not pay again.' }
    }
  }
  if (result.state === 'confirmed') return { ...base, status: 'completed', confirmedAt: deps.now(), blockNumber: result.blockNumber?.toString(), failureReason: undefined, recoveryMessage: undefined }
  return { ...base, status: 'pending', failureEvidence: undefined, failureReason: undefined, recoveryMessage: 'Transaction status is temporarily unavailable or pending. Do not send it again.' }
}

export function selectCheckoutTransaction(records: Record<string, LocalTx[]>, linkId: string, recipient: Address | undefined, fixed: boolean, currentHash?: Hex): LocalTx | undefined {
  const matches = Object.values(records).flat().filter((tx) => tx.chainId === LINK_CHAIN_ID && tx.kind === 'payment-link' && tx.linkId === linkId &&
    recipient !== undefined && same(tx.to, recipient)).sort((a, b) => b.submittedAt - a.submittedAt)
  // An older unresolved attempt must not be hidden by a more recent completed attempt.
  return matches.find(isUnresolvedPayment) ?? matches.find((tx) => (fixed && Boolean(tx.linkVerifiedAt)) || (currentHash !== undefined && same(tx.hash, currentHash)))
}

export function checkoutBlocked(records: Record<string, LocalTx[]>, linkId: string, recipient: Address | undefined, fixed: boolean): boolean {
  const tx = selectCheckoutTransaction(records, linkId, recipient, fixed)
  return Boolean(tx && (isUnresolvedPayment(tx) || (fixed && tx.linkVerifiedAt)))
}
