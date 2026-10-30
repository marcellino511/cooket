/** Offline fixtures only: no wallets, signatures, deployed contracts, RPC or database requests. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, TransactionReceiptNotFoundError } from 'viem'
import type { DbLink } from '../server/db'
import { ARC_SYSTEM_EMITTER } from '../src/shared/links'
import { ROUTER_ABI, linkIdToBytes32 } from '../src/shared/router'

// Synthetic addresses/code/hashes exist only in these in-memory fixtures.
const router = '0x2222222222222222222222222222222222222222' as const
const payer = '0x3333333333333333333333333333333333333333' as const
const recipient = '0x4444444444444444444444444444444444444444' as const
const token = '0x3600000000000000000000000000000000000000' as const
const hash = `0x${'ab'.repeat(32)}` as const
const blockHash = `0x${'cd'.repeat(32)}` as const
const code = '0x60006000' as const
process.env.COOKET_ROUTER_CODE_HASH = keccak256(code)
process.env.VITE_COOKET_ROUTER_ADDRESS = router
const { client, verifyPayment, routerIsValid } = await import('../server/verify')
const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
const link: DbLink = { id: 'fixtureLink01', ownerDid: 'did:privy:fixture', recipient, description: 'Fixture', mode: 'fixed', amountRaw: '2500000', createdAt: 1_000_000, expiresAt: 3_000_000, router }
const amount = 2_500_000n
const metadata = { blockHash, blockNumber: 10n, transactionHash: hash, transactionIndex: 0, removed: false }
const transfer = (over: Record<string, unknown> = {}) => ({
  ...metadata, address: ARC_SYSTEM_EMITTER, logIndex: 1,
  topics: encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: payer, to: recipient } }),
  data: encodeAbiParameters([{ type: 'uint256' }], [amount * 10n ** 12n]), ...over,
})
const event = (args: { linkId?: `0x${string}`; payer?: `0x${string}`; recipient?: `0x${string}`; amount?: bigint } = {}, over: Record<string, unknown> = {}) => ({
  ...metadata, address: router, logIndex: 2,
  topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: 'PaymentReceived', args: { linkId: args.linkId ?? linkIdToBytes32(link.id), payer: args.payer ?? payer, recipient: args.recipient ?? recipient } }),
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [args.amount ?? amount, `0x${'00'.repeat(32)}`]), ...over,
})
let chainId = 5042
let runtime: `0x${string}` | undefined = code
let reportedToken: string = token
let receipt: Record<string, unknown> = {}
let block: Record<string, unknown> = {}
let rpcFailure = false
let receiptFailure: Error | null = null
let codeFailure = false
let getterFailure = false
// Replace every network-capable method used by the verifier. Unexpected network access fails immediately.
Object.assign(client, {
  getChainId: () => rpcFailure ? Promise.reject(new Error('fixture RPC failure')) : Promise.resolve(chainId),
  getCode: () => codeFailure ? Promise.reject(new Error('fixture code RPC outage')) : Promise.resolve(runtime),
  readContract: () => getterFailure ? Promise.reject(new Error('fixture getter failure')) : Promise.resolve(reportedToken),
  getTransactionReceipt: () => receiptFailure ? Promise.reject(receiptFailure) : Promise.resolve(receipt),
  getBlock: () => Promise.resolve(block),
  request: () => Promise.reject(new Error('Unexpected RPC request in offline test')),
})
function reset() {
  chainId = 5042; runtime = code; reportedToken = token; rpcFailure = false; receiptFailure = null; codeFailure = false; getterFailure = false
  receipt = { ...metadata, status: 'success', logs: [transfer(), event()] }
  block = { hash: blockHash, number: 10n, timestamp: 2000n }
}
let passed = 0
async function check(name: string, mutate: () => void = () => {}, expected = 'ok', target = link) {
  reset(); mutate()
  const result = await verifyPayment(target, hash)
  assert.equal(result.ok ? 'ok' : result.code, expected, name)
  if (result.ok) {
    assert.equal(result.payment.logIndex, 1, 'Claim key identifies the system Transfer, not the router event')
    assert.equal(result.payment.amountRaw, amount.toString())
    assert.equal(result.payment.payer.toLowerCase(), payer)
  }
  passed++; console.log(`PASS  ${name}`)
}
await check('canonical router payment and transfer claim key')
await check('open link amount comes from the movement', () => {}, 'ok', { ...link, mode: 'open', amountRaw: undefined })
await check('wrong chain rejected even after a valid request', () => { chainId = 1 }, 'rpc_unavailable')
await check('RPC failure rejected', () => { rpcFailure = true }, 'rpc_unavailable')
await check('code RPC outage fails closed', () => { codeFailure = true }, 'rpc_unavailable')
await check('getter RPC failure is retryable', () => { getterFailure = true }, 'rpc_unavailable')
await check('receipt RPC outage is retryable', () => { receiptFailure = new Error('fixture RPC outage') }, 'rpc_unavailable')
await check('receipt not found is distinguished from RPC outage', () => { receiptFailure = new TransactionReceiptNotFoundError({ hash }) }, 'not_found')
await check('invalid receipt status rejected', () => { receipt.status = 'unknown' }, 'invalid_receipt')
await check('missing mined block number rejected', () => { receipt.blockNumber = null }, 'invalid_receipt')
await check('null receipt log rejected safely', () => { receipt.logs = [null, event()] }, 'invalid_receipt')
await check('missing receipt log metadata rejected safely', () => { receipt.logs = [transfer({ address: undefined }), event()] }, 'invalid_receipt')
await check('empty code rejected', () => { runtime = '0x' }, 'router_invalid')
await check('fabricated router with canonical getter rejected', () => { runtime = '0x6001' }, 'router_invalid')
await check('wrong immutable token rejected', () => { reportedToken = payer }, 'router_invalid')
await check('reverted receipt rejected', () => { receipt.status = 'reverted' }, 'reverted')
await check('missing receipt rejected', () => { receipt = null as unknown as Record<string, unknown> }, 'not_found')
await check('missing block rejected', () => { block = null as unknown as Record<string, unknown> }, 'rpc_unavailable')
await check('reorged block rejected', () => { block.hash = hash }, 'invalid_receipt')
await check('wrong block number rejected', () => { block.number = 11n }, 'invalid_receipt')
await check('mismatched receipt hash rejected', () => { receipt.transactionHash = blockHash }, 'invalid_receipt')
await check('mixed transaction logs rejected', () => { receipt.logs = [transfer({ transactionHash: blockHash }), event()] }, 'invalid_receipt')
await check('removed logs rejected', () => { receipt.logs = [transfer({ removed: true }), event()] }, 'invalid_receipt')
await check('null log index rejected', () => { receipt.logs = [transfer({ logIndex: null }), event()] }, 'invalid_receipt')
await check('duplicate log indices rejected', () => { receipt.logs = [transfer(), event({}, { logIndex: 1 })] }, 'invalid_receipt')
await check('wrong event emitter rejected', () => { receipt.logs = [transfer(), event({}, { address: payer })] }, 'no_event')
await check('unrelated transfer without event rejected', () => { receipt.logs = [transfer()] }, 'no_event')
await check('wrong link rejected', () => { receipt.logs = [transfer(), event({ linkId: linkIdToBytes32('another') })] }, 'wrong_link')
await check('wrong recipient rejected', () => { receipt.logs = [transfer(), event({ recipient: payer })] }, 'wrong_link')
await check('wrong fixed amount rejected', () => { receipt.logs = [transfer(), event({ amount: 1n })] }, 'wrong_amount')
await check('self payment rejected', () => { receipt.logs = [transfer(), event({ payer: recipient })] }, 'self_payment')
await check('event without movement rejected', () => { receipt.logs = [event()] }, 'no_transfer')
await check('unrelated payer movement rejected', () => { receipt.logs = [transfer(), event({ payer: router })] }, 'no_transfer')
await check('fabricated movement emitter rejected', () => { receipt.logs = [transfer({ address: router }), event()] }, 'no_transfer')
await check('ERC20 mirror alone cannot establish Arc movement', () => { receipt.logs = [transfer({ address: token, data: encodeAbiParameters([{ type: 'uint256' }], [amount]) }), event()] }, 'no_transfer')
await check('movement after router event rejected', () => { receipt.logs = [transfer({ logIndex: 3 }), event()] }, 'no_transfer')
await check('wrong system decimals rejected', () => { receipt.logs = [transfer({ data: encodeAbiParameters([{ type: 'uint256' }], [amount]) }), event()] }, 'no_transfer')
await check('malformed movement data rejected safely', () => { receipt.logs = [transfer({ data: '0xzz' }), event()] }, 'no_transfer')
await check('noncanonical address topic rejected', () => { const t = transfer(); t.topics[1] = `0x${'ff'.repeat(32)}`; receipt.logs = [t, event()] }, 'no_transfer')
await check('malformed event rejected', () => { receipt.logs = [transfer(), event({}, { data: '0x' })] }, 'no_event')
await check('zero payment rejected', () => { receipt.logs = [transfer(), event({ amount: 0n })] }, 'wrong_amount')
await check('before creation rejected', () => { block.timestamp = 1n }, 'before_link')
await check('after expiry rejected', () => { block.timestamp = 4000n }, 'after_expiry')
const direct = { ...link, router: undefined }
await check('router tx cannot also credit a legacy link', () => {}, 'router_payment', direct)
await check('canonical legacy system transfer accepted', () => { receipt.logs = [transfer()] }, 'ok', direct)
await check('a mint cannot count as a payer transfer', () => { const t = transfer(); t.topics[1] = `0x${'00'.repeat(32)}`; receipt.logs = [t] }, 'no_transfer', direct)
await check('malformed legacy transfer rejected safely', () => { receipt.logs = [transfer({ data: '0x' })] }, 'no_transfer', direct)
reset()
assert.equal((await verifyPayment(link, '0x123')).ok, false); passed++
assert.equal(await routerIsValid(router), true); passed++
reset()
receipt.logs = [transfer(), event({ linkId: linkIdToBytes32('other-link') }), transfer({ logIndex: 3 }), event({}, { logIndex: 4 })]
const batch = await verifyPayment(link, hash)
assert.equal(batch.ok && batch.payment.logIndex, 3, 'Batched payment uses its nearest preceding movement'); passed++
console.log('PASS  batched payment selects its own movement')
await check('a previous payment movement cannot back a later event', () => {
  receipt.logs = [transfer(), event({ linkId: linkIdToBytes32('other-link') }), event({}, { logIndex: 4 })]
}, 'no_transfer')
const missingConfig = spawnSync('bun', ['-e', "const {verifyPayment}=await import('./server/verify');console.log(JSON.stringify(await verifyPayment(JSON.parse(process.env.COOKET_FIXTURE_LINK),process.env.COOKET_FIXTURE_HASH)))"], {
  env: { ...process.env, COOKET_ROUTER_CODE_HASH: '', ARC_RPC_URL: 'http://127.0.0.1:1', RPC_PROXY_BASE_URL: '', COOKET_FIXTURE_LINK: JSON.stringify(link), COOKET_FIXTURE_HASH: hash },
  encoding: 'utf8', timeout: 5000,
})
assert.equal(missingConfig.status, 0)
assert.equal((JSON.parse(missingConfig.stdout) as { code: string }).code, 'router_not_configured')
passed++; console.log('PASS  missing runtime hash fails closed before any RPC')
console.log(`\n${passed} offline verification checks passed`)
