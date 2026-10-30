/**
 * Read-only schema/access smoke check. No inserts, updates or deletes. Never prints credentials.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or .env). Optionally set SUPABASE_ANON_KEY
 * to also check public read access (an empty table cannot prove RLS).
 *
 * Run from the project root:  bun run check:storage
 */
const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const anon = process.env.SUPABASE_ANON_KEY ?? ''

if (!url || !service) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}
let project: URL
try {
  project = new URL(url)
  if (!['https:', 'http:'].includes(project.protocol) || project.username || project.password) throw new Error('invalid URL')
} catch {
  console.error('SUPABASE_URL must be an HTTP(S) URL without embedded credentials.')
  process.exit(2)
}
console.log(`Project host: ${project.host}`)

let failures = 0
const report = (ok: boolean, name: string, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// GET only. Catch failures here so runtime diagnostics never dump a credential-bearing request.
async function call(key: string, path: string): Promise<{ status: number; rows: unknown[] | null }> {
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method: 'GET', headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000), redirect: 'error',
    })
    const body: unknown = await response.json().catch(() => null)
    return { status: response.status, rows: Array.isArray(body) ? body : null }
  } catch {
    return { status: 0, rows: null }
  }
}

const columns = {
  payment_links: 'id,owner_did,recipient,description,merchant,mode,amount_raw,expires_at,created_at,inactive,router',
  link_payments: 'link_id,tx_hash,log_index,payer,amount_raw,block_number,paid_at,verified_at',
  used_nonces: 'nonce,used_at',
}
for (const [table, select] of Object.entries(columns)) {
  const res = await call(service, `${table}?select=${select}&limit=0`)
  const ok = res.status === 200 && res.rows !== null
  report(ok, `expected columns of ${table} are readable with the service role key`, ok ? '' : `HTTP ${res.status}: unavailable or malformed response; inspect schema and migration history`)
}

if (anon) {
  for (const table of ['payment_links', 'link_payments', 'used_nonces']) {
    const res = await call(anon, `${table}?select=*&limit=1`)
    const empty = res.status === 200 && res.rows?.length === 0
    report(res.status === 401 || res.status === 403 || empty, `anon read check for ${table}`, empty ? 'returned no rows; empty results alone do not prove RLS' : `HTTP ${res.status}`)
  }
} else {
  console.log('SKIP  anon key checks (set SUPABASE_ANON_KEY to run them)')
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nRead-only checks passed. Constraints, RLS and replay protection still require database-level verification.')
process.exit(failures ? 1 : 0)
