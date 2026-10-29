/**
 * Offline test of the payment link API: the Supabase store (against an in-process fake PostgREST), the
 * request handler as the Vercel Function runs it, and the "fail closed without storage" rule.
 *
 * It proves the code is internally consistent. It does NOT prove a real Supabase project is set up:
 * run `bun run check:storage` against your project for that.
 *
 * Run from the project root:  bun run test:api
 */
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { LinkPayment } from '../src/shared/links'

const SERVICE_KEY = 'test-service-role-key-not-real'
const REST_PORT = 8721
const API_PORT = 8722
const API_PORT_PREPARSED = 8723
const NO_STORAGE_PORT = 8724

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  -> ${extra}` : ''}`)
}

// ---- A minimal in-memory PostgREST: only what SupabaseStore uses ----
type Row = Record<string, unknown>
const PKS: Record<string, string[]> = { payment_links: ['id'], link_payments: ['tx_hash', 'log_index'], used_nonces: ['nonce'] }
const tables: Record<string, Row[]> = { payment_links: [], link_payments: [], used_nonces: [] }
const seenKeys: string[] = []

function matches(row: Row, query: URLSearchParams): boolean {
  for (const [col, cond] of query) {
    if (['select', 'order', 'limit'].includes(col)) continue
    const [op, ...rest] = cond.split('.')
    const val = rest.join('.')
    const cell = row[col]
    if (op === 'eq' && String(cell) !== val) return false
    if (op === 'lt' && !(Number(cell) < Number(val))) return false
  }
  return true
}

function readBody(req: IncomingMessage): Promise<Row> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Row) : {}))
  })
}

const fakeRest = createServer((req, res) => {
  void (async () => {
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body === undefined ? undefined : JSON.stringify(body))
    }
    const url = new URL(req.url ?? '/', 'http://local')
    const apikey = String(req.headers.apikey ?? '')
    seenKeys.push(apikey)
    if (apikey !== SERVICE_KEY || req.headers.authorization !== `Bearer ${SERVICE_KEY}`) return reply(401, { message: 'Invalid API key' })
    const table = url.pathname.replace('/rest/v1/', '')
    const rows = tables[table]
    if (!rows) return reply(404, { message: 'relation does not exist', code: '42P01' })
    const wantsBody = String(req.headers.prefer ?? '').includes('return=representation')
    if (req.method === 'GET') {
      let out = rows.filter((r) => matches(r, url.searchParams))
      const order = url.searchParams.get('order')
      if (order) {
        const [col = '', dir] = order.split('.')
        out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col])) * (dir === 'desc' ? -1 : 1))
      }
      const embed = (url.searchParams.get('select') ?? '').includes('link_payments(*)')
      return reply(200, embed ? out.map((r) => ({ ...r, link_payments: (tables.link_payments ?? []).filter((p) => p.link_id === r.id) })) : out)
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const pk = PKS[table] ?? []
      if (rows.some((r) => pk.every((c) => r[c] === body[c]))) return reply(409, { code: '23505', message: 'duplicate key value' })
      if (table === 'link_payments' && !(tables.payment_links ?? []).some((l) => l.id === body.link_id)) return reply(409, { code: '23503', message: 'fk' })
      rows.push(body)
      return wantsBody ? reply(201, [body]) : reply(201)
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const hit = rows.filter((r) => matches(r, url.searchParams))
      for (const r of hit) Object.assign(r, body)
      return wantsBody ? reply(200, hit) : reply(204)
    }
    if (req.method === 'DELETE') {
      tables[table] = rows.filter((r) => !matches(r, url.searchParams))
      return reply(204)
    }
    return reply(405)
  })()
}).listen(REST_PORT)

process.env.SUPABASE_URL = `http://127.0.0.1:${REST_PORT}`
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
process.env.VITE_PRIVY_APP_ID = 'test-app-id'
delete process.env.VERCEL

const { getStore, StoreConflict, storageStatus } = await import('../server/store')
const { handle } = await import('../server/app')
const store = getStore()

// ---- Store behaviour ----
check('Supabase store is selected when both variables are set', store.kind === 'supabase' && storageStatus() === 'supabase')
const now = Date.now()
const link = { id: 'linkTest0001', ownerDid: 'did:privy:owner', recipient: '0x1111111111111111111111111111111111111111' as const, description: 'Logo design', merchant: 'Acme', mode: 'fixed' as const, amountRaw: '2500000', expiresAt: now + 3_600_000, createdAt: now, router: '0x2222222222222222222222222222222222222222' as const }
await store.createLink(link, 'a'.repeat(32))
const got = await store.getLink(link.id)
check('created link round-trips every field', got?.link.recipient === link.recipient && got.link.amountRaw === '2500000' && got.link.router === link.router && got.link.merchant === 'Acme' && got.link.expiresAt === link.expiresAt && got.payments.length === 0)
let replayed = false
try { await store.createLink({ ...link, id: 'linkTest0002' }, 'a'.repeat(32)) } catch (e) { replayed = e instanceof StoreConflict && e.kind === 'replayed' }
check('a replayed creation signature is rejected', replayed)
check('the replayed attempt did not create a link', (await store.getLink('linkTest0002')) === null)

const pay = (txHash: string, logIndex = 1): LinkPayment => ({ txHash: txHash as `0x${string}`, logIndex, payer: '0x3333333333333333333333333333333333333333', amountRaw: '2500000', blockNumber: '10', paidAt: now + 1000, verifiedAt: now + 2000 })
const H1 = `0x${'ab'.repeat(32)}`
await store.recordPayment(link.id, pay(H1.toUpperCase().replace('0X', '0x')))
const again = await store.recordPayment(link.id, pay(H1))
check('recording the same payment twice is idempotent', again.txHash.toLowerCase() === H1 && (await store.getLink(link.id))?.payments.length === 1)
await store.createLink({ ...link, id: 'linkTest0003', createdAt: now + 5 }, 'b'.repeat(32))
let claimed = false
try { await store.recordPayment('linkTest0003', pay(H1)) } catch (e) { claimed = e instanceof StoreConflict && e.kind === 'already_claimed' }
check('a transfer already counted for one link cannot count for another', claimed)
check('the other link got no payment', ((await store.getLink('linkTest0003'))?.payments.length ?? -1) === 0)

const mine = await store.listByOwner('did:privy:owner')
check('owner list is newest first with payments embedded', mine.length === 2 && mine[0]?.link.id === 'linkTest0003' && mine[1]?.payments.length === 1)
check('another owner sees nothing', (await store.listByOwner('did:privy:someone-else')).length === 0)
check('deactivate by a non-owner changes nothing', (await store.deactivate(link.id, 'did:privy:intruder')) === null && !(await store.getLink(link.id))?.link.inactive)
check('deactivate by the owner turns the link off', (await store.deactivate(link.id, 'did:privy:owner'))?.link.inactive === true && (await store.getLink(link.id))?.link.inactive === true)
check('every storage call carried the service key', seenKeys.length > 0 && seenKeys.every((k) => k === SERVICE_KEY))

// ---- HTTP handler, as the Vercel Function runs it (paths carry the /api prefix) ----
const api = createServer((req, res) => void handle(req, res)).listen(API_PORT)
// Vercel parses the body before the handler runs and leaves the stream empty. Reproduce that.
const preparsed = createServer((req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    ;(req as unknown as { push: (c: null) => void }).push = () => undefined
    void handle(req, res)
  })
}).listen(API_PORT_PREPARSED)
const base = `http://127.0.0.1:${API_PORT}`

const health = await fetch(`${base}/api/health`)
const healthText = await health.text()
check('GET /api/health reports storage and router and leaks no secret', health.ok && healthText.includes('"storage":"supabase"') && !healthText.includes(SERVICE_KEY) && healthText.includes('"chainId":5042'))
const pub = await fetch(`${base}/api/links/${link.id}`)
const pubText = await pub.text()
check('GET /api/links/:id is public and hides the owner', pub.ok && pubText.includes(link.recipient) && !pubText.includes('did:privy') && !pubText.includes('ownerDid'))
check('public view of a turned-off link says inactive', pubText.includes('"status":"inactive"'))
check('unknown link is 404', (await fetch(`${base}/api/links/doesNotExist1`)).status === 404)
check('malformed link id is 404', (await fetch(`${base}/api/links/..%2F..%2Fetc`)).status === 404)
check('GET /api/links without a session is 401', (await fetch(`${base}/api/links`)).status === 401)
check('POST /api/links without a session is 401', (await fetch(`${base}/api/links`, { method: 'POST', body: '{}' })).status === 401)
check('deactivate without a session is 401', (await fetch(`${base}/api/links/${link.id}/deactivate`, { method: 'POST' })).status === 401)
check('a garbage bearer token is 401', (await fetch(`${base}/api/links`, { headers: { authorization: 'Bearer not-a-token' } })).status === 401)
check('the dev proxy path (no /api prefix) works too', (await fetch(`${base}/links/${link.id}`)).ok)
check('no CORS headers are sent (same-origin only)', pub.headers.get('access-control-allow-origin') === null)

const bad = await fetch(`${base}/api/links/linkTest0003/payments`, { method: 'POST', body: JSON.stringify({ txHash: '0x123' }) })
check('payment report with a malformed hash is 400', bad.status === 400)
const turnedOff = await fetch(`${base}/api/links/${link.id}/payments`, { method: 'POST', body: JSON.stringify({ txHash: `0x${'cd'.repeat(32)}` }) })
check('payment report on a turned-off link is 409 inactive', turnedOff.status === 409 && (await turnedOff.text()).includes('inactive'))
// An unknown (valid-shaped) hash reaches chain verification, which reads Arc Mainnet and finds nothing: 422 not_found. 400 would mean the body was dropped.
const viaPreparsed = await fetch(`http://127.0.0.1:${API_PORT_PREPARSED}/api/links/linkTest0003/payments`, { method: 'POST', body: JSON.stringify({ txHash: `0x${'ef'.repeat(32)}` }) })
const viaText = await viaPreparsed.text()
check('a platform-preparsed body is still read', viaPreparsed.status !== 400, `${viaPreparsed.status} ${viaText.slice(0, 80)}`)
const bigBody = await fetch(`${base}/api/links/linkTest0003/payments`, { method: 'POST', body: JSON.stringify({ txHash: 'x'.repeat(40_000) }) })
check('an oversized body is rejected', bigBody.status === 413, String(bigBody.status))

api.close()
preparsed.close()

// ---- Fail closed: on Vercel with no Supabase configured, never fall back to a disk ----
const child = spawn(
  'bun',
  ['-e', `import { createServer } from 'node:http'; import { handle } from './server/app'; createServer((q, s) => void handle(q, s)).listen(${NO_STORAGE_PORT})`],
  { env: { ...process.env, VERCEL: '1', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] },
)
for (let i = 0; i < 40; i++) {
  try { await fetch(`http://127.0.0.1:${NO_STORAGE_PORT}/api/health`); break } catch { await new Promise((resolve) => setTimeout(resolve, 150)) }
}
const closed = await fetch(`http://127.0.0.1:${NO_STORAGE_PORT}/api/links/someLinkId01`)
const closedText = await closed.text()
check('on Vercel without Supabase the API fails closed with 503', closed.status === 503 && closedText.includes('storage_not_configured'), `${closed.status}`)
const closedHealth = await (await fetch(`http://127.0.0.1:${NO_STORAGE_PORT}/api/health`)).text()
check('health reports storage not_configured', closedHealth.includes('"storage":"not_configured"'))
child.kill()
fakeRest.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
