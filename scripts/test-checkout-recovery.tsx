/** Offline checkout/reconciler regressions: synthetic receipts, a fake API, and disposable localStorage. */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'
import { checkoutBlocked, inspectTransaction, isUnresolvedPayment, recoverTransaction, selectCheckoutTransaction, type RecoveryClient } from '../src/chain/transaction-recovery'
import type { Hex, LocalTx } from '../src/domain/types'
import { RecoveryNotice } from '../src/features/checkout/RecoveryNotice'
import { buildActivity } from '../src/domain/activity'

const payer = '0x1111111111111111111111111111111111111111' as const
const recipient = '0x2222222222222222222222222222222222222222' as const
const blockHash: Hex = `0x${'cc'.repeat(32)}`
const replacementHash: Hex = `0x${'dd'.repeat(32)}`
const make = (mode: 'router' | 'legacy', over: Partial<LocalTx> = {}): LocalTx => ({ hash: `0x${(mode === 'router' ? 'ab' : 'bc').repeat(32)}`, chainId: 5042, from: payer, to: recipient, amountRaw: '2500000', kind: 'payment-link', linkId: `${mode}Fixture`, submittedAt: Date.now() - 60 * 60_000, status: 'pending', ...over })
type Failure = 'missing' | 'network'
function rpc(tx: LocalTx, options: { receipt?: Failure; transaction?: Failure; status?: string; chain?: number; reorg?: boolean; insufficient?: boolean; cancel?: boolean; replacementReverted?: boolean; replacementNonce?: number; code?: Hex; codeNetwork?: boolean; replacementNetwork?: boolean } = {}) {
  const calls = { receipt: 0, transaction: 0 }
  const client: RecoveryClient = {
    getChainId: () => Promise.resolve(options.chain ?? 5042),
    getTransactionReceipt: ({ hash }) => {
      calls.receipt++
      if (hash === tx.hash && options.receipt === 'missing') return Promise.reject(new TransactionReceiptNotFoundError({ hash }))
      if ((hash === tx.hash && options.receipt === 'network') || (hash === replacementHash && options.replacementNetwork)) return Promise.reject(new Error('fixture RPC outage'))
      return Promise.resolve({ transactionHash: hash, blockHash, blockNumber: 10n, status: hash === replacementHash && options.replacementReverted ? 'reverted' : options.status ?? 'success' })
    },
    getTransaction: ({ hash }) => {
      calls.transaction++
      if (hash === tx.hash && options.transaction === 'missing') return Promise.reject(new TransactionNotFoundError({ hash }))
      if (hash === tx.hash && options.transaction === 'network') return Promise.reject(new Error('fixture RPC outage'))
      return Promise.resolve({ hash, from: payer, nonce: hash === replacementHash ? options.replacementNonce ?? 7 : 7, to: options.cancel && hash === replacementHash ? payer : recipient, value: 0n, input: '0x' })
    },
    getBlock: () => Promise.resolve({ hash: options.reorg ? replacementHash : blockHash, number: 10n }),
    getBlockNumber: () => Promise.resolve(options.insufficient ? 9n : 10n),
    getCode: () => options.codeNetwork ? Promise.reject(new Error('fixture code RPC outage')) : Promise.resolve(options.code),
  }
  return { client, calls }
}
function api() {
  let unavailable = false
  let attempts = 0
  let writes = 0
  const payments = new Map<string, { verified: true; payment: { txHash: Hex; logIndex: number; payer: typeof payer; amountRaw: string; blockNumber: string; paidAt: number; verifiedAt: number } }>()
  return {
    fail: (value: boolean) => { unavailable = value },
    attempts: () => attempts,
    writes: () => writes,
    verifyPayment: (linkId: string, hash: Hex) => {
      attempts++
      if (unavailable) return Promise.reject(new Error('fixture API unavailable'))
      const key = `${linkId}:${hash.toLowerCase()}`
      let result = payments.get(key)
      if (!result) {
        writes++
        result = { verified: true, payment: { txHash: hash, logIndex: 1, payer, amountRaw: '2500000', blockNumber: '10', paidAt: 2000, verifiedAt: 3000 } }
        payments.set(key, result)
      }
      return Promise.resolve(result)
    },
  }
}
const ledger = (tx: LocalTx): Record<string, LocalTx[]> => JSON.parse(JSON.stringify({ [payer]: [tx] })) as Record<string, LocalTx[]>
let count = 0
async function test(name: string, run: () => void | Promise<void>) { await run(); count++; console.log(`PASS  ${name}`) }

for (const mode of ['router', 'legacy'] as const) {
  await test(`${mode}: reload restores pending and the action gate blocks payment`, () => {
    const tx = make(mode)
    const records = ledger(tx)
    assert.equal(selectCheckoutTransaction(records, tx.linkId!, recipient, true)?.hash, tx.hash)
    assert.equal(checkoutBlocked(records, tx.linkId!, recipient, true), true)
    assert.equal(checkoutBlocked(records, tx.linkId!, recipient, false), true)
    const html = renderToStaticMarkup(createElement(RecoveryNotice, { tx: records[payer][0], checking: false, onRetry: () => undefined }))
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''))
    assert.deepEqual(buttons, ['Check existing payment'])
    assert.match(html, /Do not pay again/)
    assert.doesNotMatch(html, /Payment verified/)
  })
  await test(`${mode}: reload after confirmation retries the original hash, never a new payment`, async () => {
    const tx = make(mode, { status: 'completed', blockNumber: '10' })
    const records = ledger(tx)
    assert.equal(checkoutBlocked(records, tx.linkId!, recipient, true), true)
    const server = api()
    const saved = await recoverTransaction(records[payer][0], { client: rpc(tx).client, confirmations: 1, verifyPayment: server.verifyPayment, now: () => 4000 })
    assert.equal(saved.linkVerifiedAt, 4000)
    assert.equal(saved.verifiedPaymentHash, tx.hash)
    assert.equal(saved.status, 'completed')
    assert.equal(server.writes(), 1)
    // A stale public 'open' response cannot expose a second fixed payment.
    assert.equal(checkoutBlocked(ledger(saved), tx.linkId!, recipient, true), true)
    // Registered reusable links can be intentionally paid again on a new visit.
    assert.equal(checkoutBlocked(ledger(saved), tx.linkId!, recipient, false), false)
  })
  await test(`${mode}: unavailable registration stays blocked, then retry succeeds`, async () => {
    const tx = make(mode)
    const server = api(); server.fail(true)
    const deps = { client: rpc(tx).client, confirmations: 1, verifyPayment: server.verifyPayment, now: () => 4000 }
    const unregistered = await recoverTransaction(tx, deps)
    assert.equal(unregistered.linkVerifiedAt, undefined)
    assert.equal(isUnresolvedPayment(unregistered), true)
    assert.equal(checkoutBlocked(ledger(unregistered), tx.linkId!, recipient, true), true)
    server.fail(false)
    const saved = await recoverTransaction(ledger(unregistered)[payer][0], deps)
    assert.equal(saved.linkVerifiedAt, 4000)
    assert.equal(server.writes(), 1)
  })
  await test(`${mode}: lost acknowledgement and duplicate registration stay idempotent`, async () => {
    const tx = make(mode, { status: 'completed' })
    const server = api()
    const deps = { client: rpc(tx).client, confirmations: 1, verifyPayment: server.verifyPayment, now: () => 4000 }
    await recoverTransaction(tx, deps) // simulate losing the persisted acknowledgement
    const repeated = await recoverTransaction(ledger(tx)[payer][0], deps)
    assert.equal(server.attempts(), 2)
    assert.equal(server.writes(), 1)
    await recoverTransaction(repeated, deps)
    assert.equal(server.attempts(), 2, 'a persisted verified marker does not re-register')
  })
  for (const [name, options] of [
    ['receipt lookup outage', { receipt: 'network' }],
    ['transaction lookup outage', { receipt: 'missing', transaction: 'network' }],
    ['both RPC lookups unavailable', { receipt: 'network', transaction: 'network' }],
    ['both hashes absent for an hour', { receipt: 'missing', transaction: 'missing' }],
  ] as const) {
    await test(`${mode}: ${name} never means dropped or safe to pay again`, async () => {
      const tx = make(mode); const provider = rpc(tx, options)
      const server = api(); server.fail(true)
      const result = await recoverTransaction(tx, { client: provider.client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
      assert.equal(result.status, 'pending')
      assert.equal(result.failureEvidence, undefined)
      assert.equal(result.failureReason, undefined)
      assert.equal(checkoutBlocked(ledger(result), tx.linkId!, recipient, true), true)
      assert.equal(provider.calls.transaction, 1)
    })
  }
  await test(`${mode}: old false dropped record is rechecked and remains blocked`, async () => {
    const tx = make(mode, { status: 'failed', failureReason: 'The transaction was dropped or replaced.' })
    const server = api(); server.fail(true)
    assert.equal(isUnresolvedPayment(tx), true)
    const result = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'network', transaction: 'network' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
    assert.equal(result.status, 'pending')
    assert.equal(result.failureReason, undefined)
  })
  await test(`${mode}: confirmed cancellation is positive evidence original cannot mine`, async () => {
    const tx = make(mode, { nonce: 7, replacementHash })
    const result = await inspectTransaction(tx, rpc(tx, { receipt: 'missing', transaction: 'missing', cancel: true }).client, 1)
    assert.equal(result.state, 'cancelled')
    const server = api()
    const saved = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'missing', cancel: true }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
    assert.equal(saved.status, 'failed')
    assert.equal(saved.failureEvidence, 'cancelled')
    assert.equal(server.attempts(), 0)
    assert.equal(checkoutBlocked(ledger(saved), tx.linkId!, recipient, true), false)
  })
  await test(`${mode}: unconfirmed, wrong-nonce or unavailable replacements are not dropped`, async () => {
    const tx = make(mode, { nonce: 7, replacementHash })
    for (const options of [{ insufficient: true, cancel: true }, { replacementNonce: 8, cancel: true }, { replacementNetwork: true, cancel: true }, { codeNetwork: true, cancel: true }, { reorg: true, cancel: true }]) {
      const result = await inspectTransaction(tx, rpc(tx, { receipt: 'missing', ...options }).client, 1)
      assert.notEqual(result.state, 'cancelled')
      assert.notEqual(result.state, 'reverted')
    }
  })
  await test(`${mode}: repriced payment is registered by its actual canonical hash`, async () => {
    const tx = make(mode, { nonce: 7, replacementHash })
    const server = api()
    const result = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'missing' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: () => 4000 })
    assert.equal(result.verifiedPaymentHash, replacementHash)
    assert.equal(result.hash, tx.hash)
    assert.equal(server.writes(), 1)
  })
  await test(`${mode}: a reverted original receipt is definitive failure evidence`, async () => {
    const tx = make(mode);const server = api()
    const result = await recoverTransaction(tx, { client: rpc(tx, { status: 'reverted' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
    assert.equal(result.failureEvidence, 'reverted')
    assert.equal(result.status, 'failed')
    assert.equal(server.attempts(), 0)
  })
}
await test('server proof can recover registration while the browser RPC is unavailable', async () => {
  const tx = make('router');const server = api()
  const result = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'network', transaction: 'network' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: () => 4000 })
  assert.equal(result.linkVerifiedAt, 4000)
})
await test('malformed or mismatched API acknowledgement cannot clear the recovery gate', async () => {
  const tx = make('legacy');const server = api()
  const result = await recoverTransaction(tx, { client: rpc(tx).client, confirmations: 1, now: Date.now, verifyPayment: async (linkId, hash) => {
    const value = await server.verifyPayment(linkId, hash)
    return { ...value, payment: { ...value.payment, payer: recipient } }
  } })
  assert.equal(result.linkVerifiedAt, undefined)
  assert.equal(isUnresolvedPayment(result), true)
})
await test('an older unresolved payment cannot be hidden by a newer registered attempt', () => {
  const tx = make('router')
  const newer = { ...tx, hash: replacementHash, submittedAt: Date.now(), status: 'completed' as const, linkVerifiedAt: 4000 }
  assert.equal(selectCheckoutTransaction({ [payer]: [newer, tx] }, tx.linkId!, recipient, true)?.hash, tx.hash)
})
await test('smart-account self-calls are not assumed to be cancellations', async () => {
  const tx = make('router', { nonce: 7, replacementHash })
  assert.equal((await inspectTransaction(tx, rpc(tx, { receipt: 'missing', cancel: true, code: '0x6000' }).client, 1)).state, 'confirmed')
})
await test('a replacement hash without the original nonce is not drop evidence', async () => {
  const tx = make('legacy', { replacementHash })
  assert.equal((await inspectTransaction(tx, rpc(tx, { receipt: 'missing', transaction: 'missing', cancel: true }).client, 1)).state, 'unknown')
})
await test('a mined replacement still needs merchant verification before another payment', async () => {
  const tx = make('router', { nonce: 7, replacementHash })
  const server = api(); server.fail(true)
  const result = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'missing' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
  assert.equal(result.linkVerifiedAt, undefined)
  assert.equal(checkoutBlocked(ledger(result), tx.linkId!, recipient, true), true)
})
await test('ordinary sends also stay pending on RPC outages', async () => {
  const tx = make('legacy', { kind: 'transfer', linkId: undefined })
  const server = api()
  const result = await recoverTransaction(tx, { client: rpc(tx, { receipt: 'network', transaction: 'network' }).client, confirmations: 1, verifyPayment: server.verifyPayment, now: Date.now })
  assert.equal(result.status, 'pending')
  assert.equal(server.attempts(), 0)
})
await test('verified replacements use the mined hash in history without double counting', () => {
  const tx = make('router', { status: 'completed', verifiedPaymentHash: replacementHash, linkVerifiedAt: 4000 })
  const items = buildActivity({ account: payer, local: [tx], contacts: [], linkByHash: new Map(), transfers: [
    { hash: replacementHash, logIndex: 1, chainId: 5042, from: payer, to: recipient, value: 2500000n, blockNumber: 10n, timestamp: 2000 },
  ] })
  assert.equal(items.length, 1)
  assert.equal(items[0].hash, replacementHash)
})
await test('the history cap retains unresolved checkout payments in persisted storage', async () => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }, addEventListener: () => undefined } })
  const { txStore, upsertLocalTx } = await import('../src/stores')
  const tx = make('legacy')
  upsertLocalTx(tx)
  for (let i = 0; i < 205; i++) upsertLocalTx({ ...tx, hash: `0x${i.toString(16).padStart(64, '0')}`, kind: 'transfer', linkId: undefined, status: 'completed' })
  const reloaded = JSON.parse(memory.get('cooket.v1.transactions')!) as Record<string, LocalTx[]>
  assert.equal(checkoutBlocked(reloaded, tx.linkId!, recipient, true), true)
  assert.equal(txStore.get()[payer].some((row) => row.hash === tx.hash), true)
  upsertLocalTx({ ...tx, status: 'completed', linkVerifiedAt: 4000, verifiedPaymentHash: tx.hash })
  upsertLocalTx({ ...tx, status: 'pending', nonce: 7 }) // delayed receipt/replacement waiter
  const verified = txStore.get()[payer].find((row) => row.hash === tx.hash)!
  assert.equal(verified.status, 'completed')
  assert.equal(verified.linkVerifiedAt, 4000)
  assert.equal(verified.verifiedPaymentHash, tx.hash)
})
console.log(`\n${count} checkout recovery checks passed; no wallet, signing, blockchain or production API calls`)
