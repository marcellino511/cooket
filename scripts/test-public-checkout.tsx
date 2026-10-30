/** Offline HTTP + rendered checkout regression. Auth/signature boundaries and RPC are mocked. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, zeroHash, type Hex } from 'viem'
import { ARC_SYSTEM_EMITTER, type PublicLink } from '../src/shared/links'
import { ROUTER_ABI, linkIdToBytes32 } from '../src/shared/router'

const { mock } = createRequire(import.meta.url)('bun:test') as { mock: { module: (path: string, factory: () => Record<string, unknown>) => void } }
const mockPath = (path: string, factory: () => Record<string, unknown>) => mock.module(new URL(path, import.meta.url).pathname, factory)
const root = await mkdtemp(join(tmpdir(), 'cooket-public-checkout-'))
const merchant = '0x1111111111111111111111111111111111111111' as const
const payer = '0x2222222222222222222222222222222222222222' as const
const router = '0x3333333333333333333333333333333333333333' as const
const code = '0x60006000' as const // Synthetic runtime, never used outside this process.
const balances = new Map([[merchant.toLowerCase(), 0n], [payer.toLowerCase(), 10_000_000n]])
Object.assign(process.env, { COOKET_DATA_FILE: join(root, 'db.json'), VITE_COOKET_ROUTER_ADDRESS: router, COOKET_ROUTER_CODE_HASH: keccak256(code), VITE_PRIVY_APP_ID: 'offline-fixture' })
for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'RPC_PROXY_BASE_URL']) delete process.env[name]
// No real Privy token or wallet signature is made. Production auth code is unchanged.
mockPath('../server/auth.ts', () => ({ authenticate: (req: { headers: { authorization?: string } }) => Promise.resolve(req.headers.authorization === 'Bearer offline-fixture' ? 'did:privy:merchant-fixture' : null) }))
const { client } = await import('../server/verify')
let balanceReads = 0
Object.assign(client, {
  request: () => Promise.reject(new Error('Unexpected RPC access')),
  getChainId: () => Promise.resolve(5042),
  getCode: () => Promise.resolve(code),
  readContract: ({ functionName }: { functionName: string }) => {
    assert.equal(functionName, 'USDC', 'creation must not request ERC-20 balances')
    return Promise.resolve('0x3600000000000000000000000000000000000000')
  },
  getBalance: () => { balanceReads++; return Promise.resolve(0n) },
  verifyMessage: ({ address, message }: { address: string; message: string }) => {
    assert.equal(address.toLowerCase(), merchant.toLowerCase())
    assert.match(message, /Settlement: CooketPayRouter/)
    return Promise.resolve(true)
  },
})
const { default: handler } = await import('../server/handler')
const server = createServer((req, res) => void handler(req, res)).listen(0, '127.0.0.1')
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const base = `http://127.0.0.1:${address.port}`
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('/api/')) {
    // Model vercel.json's concrete function rewrite, including nested paths.
    return nativeFetch(`${base}/api/index?__cooket_path=${encodeURIComponent(url.slice(5))}`, init)
  }
  if (url.startsWith(`${base}/`)) return nativeFetch(input, init)
  return Promise.reject(new Error('External networking forbidden in offline test'))
}
let count = 0
async function check(name: string, run: () => void | Promise<void>) { await run(); count++; console.log(`PASS  ${name}`) }
try {
  const created = await fetch(`${base}/api/index?__cooket_path=links`, {
    method: 'POST', headers: { authorization: 'Bearer offline-fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: merchant, router, description: 'Zero-balance merchant fixture', mode: 'fixed', amount: '2.5', issuedAt: Date.now(), nonce: 'ab'.repeat(16), signature: '0x1234' }),
  })
  const link = await created.json() as PublicLink
  await check('zero-USDC merchant creates a new router link without a balance or gas requirement', () => {
    assert.equal(balances.get(merchant.toLowerCase()), 0n)
    assert.equal(created.status, 201)
    assert.equal(link.recipient.toLowerCase(), merchant.toLowerCase())
    assert.equal(link.router, router)
    assert.equal(link.status, 'open')
    assert.equal(balanceReads, 0)
  })

  let queryState: Record<string, unknown> = { data: link }
  mock.module('@tanstack/react-query', () => ({ useQuery: () => queryState }))
  mock.module('@privy-io/react-auth', () => ({ usePrivy: () => ({ ready: true }), useLogin: () => ({ login: () => undefined }) }))
  mock.module('wagmi', () => ({ useSwitchChain: () => ({ switchChainAsync: () => Promise.resolve(), isPending: false }) }))
  mockPath('../src/stores/index.ts', () => ({ txStore: { use: () => ({}), get: () => ({}) }, contactsStore: { use: () => [] }, settingsStore: { use: () => ({}) } }))
  mockPath('../src/chain/useSession.ts', () => ({
    useSession: () => ({ address: payer, isConnected: true, walletChainId: 5042 }),
    useUsdcBalance: () => ({ raw: balances.get(payer.toLowerCase()) }),
    useGasBalance: () => ({ raw: balances.get(payer.toLowerCase())! * 10n ** 12n }),
  }))
  mockPath('../src/chain/useTxReconciler.ts', () => ({ useTxReconciler: () => undefined, retryTransaction: () => Promise.resolve() }))
  mockPath('../src/chain/useSendUsdc.ts', () => ({ useSendUsdc: () => ({ state: { phase: 'idle' }, isBusy: false }) }))
  mockPath('../src/chain/useFee.ts', () => ({ useFeeEstimate: () => ({}) }))
  mockPath('../src/chain/useRecipientCheck.ts', () => ({ useRecipientCheck: () => ({}) }))
  mockPath('../src/chain/useRouterCheckout.ts', () => ({ useRouterCheckout: () => ({ pay: { phase: 'idle' }, approval: { phase: 'idle' }, needsApproval: false, busy: false }) }))
  mockPath('../src/components/common/Money.tsx', () => ({ FiatEstimate: () => null }))
  mockPath('../src/lib/router.tsx', () => ({ useLocation: () => ({ params: new URLSearchParams({ id: link.id }) }), navigate: () => undefined, Link: () => null }))
  const { linksApi, ApiError } = await import('../src/api/links')
  const publicLink = await linksApi.get(link.id)
  await check('frontend API client resolves the new active link through the nested rewrite without authentication', () => {
    assert.equal(publicLink.id, link.id)
    assert.equal(publicLink.status, 'open')
    assert.equal(publicLink.router, router)
    const text = JSON.stringify(publicLink)
    assert.doesNotMatch(text, /ownerDid|owner_did|did:privy|signature|payments/)
  })
  const { default: Pay } = await import('../src/pages/Pay')
  await check('funded payer can pay a zero-balance recipient in rendered checkout', () => {
    queryState = { data: publicLink }
    const html = renderToStaticMarkup(createElement(Pay))
    assert.match(html, /Zero-balance merchant fixture/)
    assert.doesNotMatch(html, /Insufficient USDC|This is your own link/)
    const button = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find((entry) => /Pay 2\.50? USDC/.test(entry[2]))
    assert.ok(button, 'payer sees the payment action')
    assert.doesNotMatch(button[1], /\sdisabled(?:=|\s|$)/)
  })
  await check('platform 404 does not falsely claim a database link is missing', () => {
    queryState = { isError: true, error: new ApiError(404, 'Request failed.', 'error') }
    const html = renderToStaticMarkup(createElement(Pay))
    assert.match(html, /Could not load this payment request/)
    assert.doesNotMatch(html, /This link does not exist or was removed/)
  })
  await check('application not_found still renders the real missing-link message', () => {
    queryState = { isError: true, error: new ApiError(404, 'Payment link not found.', 'not_found') }
    assert.match(renderToStaticMarkup(createElement(Pay)), /This link does not exist or was removed/)
  })

  const hash: Hex = `0x${'ab'.repeat(32)}`
  const blockHash: Hex = `0x${'cd'.repeat(32)}`
  const timestamp = BigInt(Math.ceil(Date.now() / 1000))
  const metadata = { transactionHash: hash, blockHash, blockNumber: 10n, removed: false }
  Object.assign(client, {
    getBlock: () => Promise.resolve({ hash: blockHash, number: 10n, timestamp }),
    getTransactionReceipt: () => Promise.resolve({ ...metadata, status: 'success', logs: [
      { ...metadata, address: ARC_SYSTEM_EMITTER, logIndex: 1,
        topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), eventName: 'Transfer', args: { from: payer, to: merchant } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [2_500_000n * 10n ** 12n]) },
      { ...metadata, address: router, logIndex: 2,
        topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: 'PaymentReceived', args: { linkId: linkIdToBytes32(link.id), payer, recipient: merchant } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [2_500_000n, zeroHash]) },
    ] }),
  })
  const register = () => fetch(`${base}/api/index?__cooket_path=links/${link.id}/payments`, { method: 'POST', body: JSON.stringify({ txHash: hash }) })
  const response = await register()
  const result = await response.json() as { verified: boolean; payment: { payer: string } }
  await check('real verifier accepts mocked payer-to-merchant movement, not a merchant-funded payment', () => {
    assert.equal(response.status, 200)
    assert.equal(result.verified, true)
    assert.equal(result.payment.payer.toLowerCase(), payer.toLowerCase())
    assert.equal(balanceReads, 0)
  })
  await check('rewritten duplicate payment registration stays idempotent', async () => {
    assert.equal((await register()).status, 200)
    const { getStore } = await import('../server/store')
    assert.equal((await getStore().getLink(link.id))?.payments.length, 1)
  })
  console.log(`\n${count} public checkout checks passed; disposable file storage and mocked auth/RPC only`)
} finally {
  globalThis.fetch = nativeFetch
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}
