/**
 * Checks that your Supabase project is ready for the payment link server. Prints results only, never credentials.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (or .env). Optionally set SUPABASE_ANON_KEY
 * to also prove the public key cannot read the tables.
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
console.log(`Project host: ${new URL(url).host}`)

let failures = 0
const report = (ok: boolean, name: string, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const call = (key: string, path: string, init: RequestInit = {}) =>
  fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers } })

for (const table of ['payment_links', 'link_payments', 'used_nonces']) {
  const res = await call(service, `${table}?select=*&limit=1`)
  report(res.ok, `table ${table} is readable with the service role key`, res.ok ? '' : `HTTP ${res.status}: run supabase/migrations/0001_payment_links.sql`)
}

// Uniqueness is what stops a replayed signature and a double-counted payment, so prove the database enforces it.
const probe = `probe-${crypto.randomUUID()}`
const first = await call(service, 'used_nonces', { method: 'POST', body: JSON.stringify({ nonce: probe, used_at: Date.now() }) })
const second = await call(service, 'used_nonces', { method: 'POST', body: JSON.stringify({ nonce: probe, used_at: Date.now() }) })
report(first.ok, 'can insert a row')
report(second.status === 409, 'a duplicate primary key is rejected (replay protection)', `HTTP ${second.status}`)
const cleanup = await call(service, `used_nonces?nonce=eq.${probe}`, { method: 'DELETE' })
report(cleanup.ok, 'probe row cleaned up')

if (anon) {
  for (const table of ['payment_links', 'link_payments', 'used_nonces']) {
    const res = await call(anon, `${table}?select=*&limit=1`)
    const body = res.ok ? ((await res.json().catch(() => [])) as unknown[]) : []
    report(!res.ok || body.length === 0, `anon key cannot read ${table}`, res.ok ? `returned ${body.length} rows` : `HTTP ${res.status}`)
    const write = await call(anon, table, { method: 'POST', body: JSON.stringify({}) })
    report(!write.ok, `anon key cannot write ${table}`, `HTTP ${write.status}`)
  }
} else {
  console.log('SKIP  anon key checks (set SUPABASE_ANON_KEY to run them)')
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nStorage is ready.')
process.exit(failures ? 1 : 0)
