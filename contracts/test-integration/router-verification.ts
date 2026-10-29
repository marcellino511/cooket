/**
 * Integration test for the payment link server's router verification (server/verify.ts).
 *
 * It starts a LOCAL anvil chain with chain id 5042, installs a 6-decimal ERC-20 at the Arc USDC address, deploys
 * CooketPayRouter (plus an attacker's copy) from the compiled artifact, makes real router payments, and checks that
 * verifyPayment accepts the right ones and rejects forged, misdirected, replayed-link, self, expired and reverted ones.
 *
 * It never touches Arc Mainnet and uses throwaway keys generated on each run, funded only on the local chain.
 * Limits: plain anvil does not run Arc's native USDC, so this proves the verification logic, not how Arc's own USDC
 * logs transferFrom. Confirm that on the first mainnet payment.
 *
 * Run from the project root:  forge build && bun run test:router
 */
import { createPublicClient, createWalletClient, http, erc20Abi, toFunctionSelector, toEventSelector, getAbiItem, type Abi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arc } from 'viem/chains'
import { ROUTER_ABI, linkIdToBytes32 } from '../../src/shared/router'
import type { DbLink } from '../../server/db'

const ANVIL_PORT = 8599
const PROXY_PORT = 8600
const FORK = `http://127.0.0.1:${ANVIL_PORT}`

const anvil = Bun.spawn(['anvil', '--chain-id', '5042', '--port', String(ANVIL_PORT), '--silent'], { stdout: 'ignore', stderr: 'inherit' })
// server/config builds <RPC_PROXY_BASE_URL>/api/rpc/Arc?... so forward every path to anvil.
const proxy = Bun.serve({ port: PROXY_PORT, async fetch(req) { return fetch(FORK, { method: 'POST', body: await req.text(), headers: { 'content-type': 'application/json' } }) } })
process.env.RPC_PROXY_BASE_URL = `http://127.0.0.1:${PROXY_PORT}`
process.env.RPC_PROXY_CHAINS = 'Arc'
process.env.RPC_PROXY_TOKEN = 'local'
const stop = () => { proxy.stop(true); anvil.kill() }
for (let i = 0; i < 50; i++) { try { const r = await fetch(FORK, { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', headers: { 'content-type': 'application/json' } }); if (r.ok) break } catch { /* anvil still starting */ } await Bun.sleep(200) }
const { verifyPayment, routerIsValid } = await import('../../server/verify')
const USDC = '0x3600000000000000000000000000000000000000' as const
// Throwaway keys generated per run. They exist only on the local test chain, which funds them below.
const KEYS = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()]
const [payer, merchant, other] = KEYS.map((k) => privateKeyToAccount(k as `0x${string}`))
const pub = createPublicClient({ chain: arc, transport: http(FORK) })
for (const a of [payer, merchant, other]) await pub.request({ method: 'anvil_setBalance' as never, params: [a.address, '0x3635C9ADC5DEA00000'] as never })
const wallet = (account: typeof payer) => createWalletClient({ account, chain: arc, transport: http(FORK) })

const artifact = JSON.parse(await Bun.file('contracts/out/CooketPayRouter.sol/CooketPayRouter.json').text()) as { abi: Abi; bytecode: { object: `0x${string}` } }
let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`) }

// 0. The shared ABI must match the compiled contract exactly.
for (const [name, type] of [['pay', 'function'], ['USDC', 'function'], ['PaymentReceived', 'event']] as const) {
  const a = getAbiItem({ abi: artifact.abi, name } as never) as never
  const b = getAbiItem({ abi: ROUTER_ABI, name } as never) as never
  const sel = (x: never) => (type === 'event' ? toEventSelector(x) : toFunctionSelector(x))
  check(`ABI parity: ${name}`, sel(a) === sel(b))
}

async function deploy() {
  const hash = await wallet(merchant).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [USDC] })
  const r = await pub.waitForTransactionReceipt({ hash })
  return r.contractAddress as `0x${string}`
}
// Plain anvil has no Arc USDC, so install a 6-decimal ERC-20 at the real USDC address. This tests the server's
// verification logic only. It cannot prove how Arc's own USDC logs transferFrom.
const mock = JSON.parse(await Bun.file('contracts/out/Mocks.sol/MockUSDC.json').text()) as { deployedBytecode: { object: `0x${string}` }; abi: Abi }
await pub.request({ method: 'anvil_setCode' as never, params: [USDC, mock.deployedBytecode.object] as never })
for (const a of [payer, other]) {
  const h = await wallet(a).writeContract({ address: USDC, abi: mock.abi, functionName: 'mint', args: [a.address, 100_000_000n] })
  await pub.waitForTransactionReceipt({ hash: h })
}
const router = await deploy()
const fakeRouter = await deploy() // an attacker's identical copy
console.log('router', router, 'fake', fakeRouter)
check('router passes routerIsValid', await routerIsValid(router))
check('EOA fails routerIsValid', !(await routerIsValid(other.address)))

const now = Date.now()
const mk = (id: string, over: Partial<DbLink> = {}): DbLink & { router: `0x${string}` } => ({
  id, ownerDid: 'did:privy:test', recipient: merchant.address, description: 't', mode: 'fixed', amountRaw: '2500000', createdAt: now - 120_000, router, ...over,
})
async function pay(r: `0x${string}`, id: string, recipient: `0x${string}`, amount: bigint, from = payer, gas?: bigint) {
  const w = wallet(from)
  const a = await w.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [r, amount] })
  await pub.waitForTransactionReceipt({ hash: a })
  const hash = await w.writeContract({ address: r, abi: ROUTER_ABI, functionName: 'pay', args: [linkIdToBytes32(id), recipient, amount, '0x' + '00'.repeat(32) as `0x${string}`], ...(gas ? { gas } : {}) })
  await pub.waitForTransactionReceipt({ hash })
  return hash
}

const before = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [merchant.address] })
const hashA = await pay(router, 'linkAAAAAA1', merchant.address, 2_500_000n)
const after = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [merchant.address] })
check('merchant received exactly 2.5 USDC through the router', after - before === 2_500_000n, `${after - before}`)
check('router holds no USDC', (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [router] })) === 0n)
const rcpt = await pub.getTransactionReceipt({ hash: hashA })
console.log('logs emitters:', rcpt.logs.map((l) => `${l.address.slice(0, 8)}…#${l.logIndex}`).join(' '))

const A = await verifyPayment(mk('linkAAAAAA1'), hashA)
check('A fixed link, correct router payment verifies', A.ok && A.payment.amountRaw === '2500000' && A.payment.payer.toLowerCase() === payer.address.toLowerCase(), A.ok ? `logIndex ${A.payment.logIndex}` : A.message)
const B = await verifyPayment(mk('linkBBBBBB2'), hashA)
check('B same tx cannot claim a different link', !B.ok && B.code === 'wrong_link', B.ok ? 'ACCEPTED' : B.code)
const C = await verifyPayment(mk('linkAAAAAA1', { recipient: other.address }), hashA)
check('C same tx cannot claim a link with another recipient', !C.ok && C.code === 'wrong_link', C.ok ? 'ACCEPTED' : C.code)
const D = await verifyPayment(mk('linkAAAAAA1', { amountRaw: '3000000' }), hashA)
check('D wrong fixed amount rejected', !D.ok && D.code === 'wrong_amount', D.ok ? 'ACCEPTED' : D.code)
const E = await verifyPayment(mk('linkAAAAAA1', { mode: 'open', amountRaw: undefined }), hashA)
check('E open link accepts the actual amount', E.ok && E.payment.amountRaw === '2500000', E.ok ? '' : E.message)

const hashSelf = await pay(router, 'linkSelfSS1', payer.address, 1_000_000n)
const F = await verifyPayment(mk('linkSelfSS1', { mode: 'open', amountRaw: undefined, recipient: payer.address }), hashSelf)
check('F self payment rejected', !F.ok && F.code === 'self_payment', F.ok ? 'ACCEPTED' : F.code)

const hashDirect = await wallet(payer).writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [merchant.address, 2_500_000n] })
await pub.waitForTransactionReceipt({ hash: hashDirect })
const G = await verifyPayment(mk('linkAAAAAA1'), hashDirect)
check('G direct transfer does not satisfy a router link', !G.ok && G.code === 'no_event', G.ok ? 'ACCEPTED' : G.code)

const hashFake = await pay(fakeRouter, 'linkAAAAAA1', merchant.address, 2_500_000n)
const H = await verifyPayment(mk('linkAAAAAA1'), hashFake)
check('H event from a copycat router is ignored', !H.ok && H.code === 'no_event', H.ok ? 'ACCEPTED' : H.code)

const I = await verifyPayment(mk('linkAAAAAA1', { createdAt: Date.now() + 3_600_000 }), hashA)
check('I payment before the link existed rejected', !I.ok && I.code === 'before_link', I.ok ? 'ACCEPTED' : I.code)
const J = await verifyPayment(mk('linkAAAAAA1', { expiresAt: now - 60_000 }), hashA)
check('J payment after expiry rejected', !J.ok && J.code === 'after_expiry', J.ok ? 'ACCEPTED' : J.code)

const K = await verifyPayment(mk('linkAAAAAA1', { router: other.address }), hashA)
check('K link bound to a non-router address rejected', !K.ok && K.code === 'router_invalid', K.ok ? 'ACCEPTED' : K.code)

// Reverted payment: approve less than the amount, force-send with fixed gas so it mines as a failed tx.
const w = wallet(payer)
const ap = await w.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [router, 1n] })
await pub.waitForTransactionReceipt({ hash: ap })
const hashRev = await w.writeContract({ address: router, abi: ROUTER_ABI, functionName: 'pay', args: [linkIdToBytes32('linkRevvvv1'), merchant.address, 2_500_000n, '0x' + '00'.repeat(32) as `0x${string}`], gas: 300_000n })
const revR = await pub.waitForTransactionReceipt({ hash: hashRev })
const L = await verifyPayment(mk('linkRevvvv1'), hashRev)
check('L reverted tx rejected', revR.status === 'reverted' && !L.ok && L.code === 'reverted', L.ok ? 'ACCEPTED' : L.code)

const M = await verifyPayment(mk('linkAAAAAA1'), ('0x' + 'ab'.repeat(32)) as `0x${string}`)
check('M unknown tx rejected', !M.ok && M.code === 'not_found', M.ok ? 'ACCEPTED' : M.code)

console.log(`\n${pass} passed, ${fail} failed`)
stop()
process.exit(fail ? 1 : 0)
