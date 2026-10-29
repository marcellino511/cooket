import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getAddress, isAddress, isHex } from 'viem'
import { parseUnitsExact } from '../src/onchain-money'
import {
  MAX_DESCRIPTION,
  MAX_MERCHANT,
  SIGNATURE_MAX_AGE_MS,
  buildCreateMessage,
  deriveStatus,
  type CreateLinkInput,
  type LinkMode,
  type MerchantLink,
  type PublicLink,
} from '../src/shared/links'
import { authenticate } from './auth'
import { CHAIN_ID, PORT, PRIVY_APP_ID, USDC_ADDRESS, USDC_DECIMALS } from './config'
import { mutate, read, type DbLink } from './db'
import { client, verifyPayment } from './verify'

const MAX_BODY = 16_000
const FIVE_YEARS = 5 * 365 * 24 * 60 * 60_000
const MAX_AMOUNT_RAW = 10n ** 6n * 10n ** BigInt(USDC_DECIMALS) // 1,000,000 USDC per link

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'bad_request',
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new HttpError(413, 'Request body is too large.')
    chunks.push(buf)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }
}

// A small in-memory limiter for public and write routes.
const hits = new Map<string, number[]>()
function limit(req: IncomingMessage, bucket: string, max: number) {
  const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.socket.remoteAddress ?? 'unknown').trim()
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= max) throw new HttpError(429, 'Too many requests. Slow down and try again in a minute.', 'rate_limited')
  recent.push(now)
  hits.set(key, recent)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function toPublic(link: DbLink, paymentCount: number): PublicLink {
  return {
    id: link.id,
    recipient: link.recipient,
    chainId: CHAIN_ID,
    description: link.description,
    merchant: link.merchant,
    mode: link.mode,
    amountRaw: link.amountRaw,
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
    status: deriveStatus(link, paymentCount, Date.now()),
  }
}

async function createLink(req: IncomingMessage, did: string): Promise<PublicLink> {
  const body = await readJson(req)

  const recipientRaw = str(body.recipient)
  if (!isAddress(recipientRaw)) throw new HttpError(400, 'Recipient is not a valid wallet address.')
  const recipient = getAddress(recipientRaw)

  const description = str(body.description).trim()
  if (!description || description.length > MAX_DESCRIPTION) throw new HttpError(400, `Description must be 1 to ${MAX_DESCRIPTION} characters.`)
  const merchant = str(body.merchant).trim() || undefined
  if (merchant && merchant.length > MAX_MERCHANT) throw new HttpError(400, `Merchant name must be at most ${MAX_MERCHANT} characters.`)

  const mode = body.mode
  if (mode !== 'fixed' && mode !== 'open') throw new HttpError(400, 'Mode must be fixed or open.')

  let amount: string | undefined
  let amountRaw: bigint | undefined
  if (mode === 'fixed') {
    amount = str(body.amount).trim()
    try {
      amountRaw = parseUnitsExact(amount, USDC_DECIMALS)
    } catch {
      throw new HttpError(400, 'Amount is not a valid USDC amount.')
    }
    if (amountRaw <= 0n || amountRaw > MAX_AMOUNT_RAW) throw new HttpError(400, 'Amount must be greater than zero and at most 1,000,000 USDC.')
  }

  const now = Date.now()
  let expiresAt: number | undefined
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) throw new HttpError(400, 'Expiry is invalid.')
    expiresAt = Math.floor(body.expiresAt)
    if (expiresAt <= now || expiresAt > now + FIVE_YEARS) throw new HttpError(400, 'Expiry must be in the future and within five years.')
  }

  const issuedAt = body.issuedAt
  if (typeof issuedAt !== 'number' || Math.abs(now - issuedAt) > SIGNATURE_MAX_AGE_MS) throw new HttpError(400, 'The signature request is stale. Try again.', 'stale_signature')
  const nonce = str(body.nonce)
  if (!/^[0-9a-f]{16,64}$/.test(nonce)) throw new HttpError(400, 'Nonce is invalid.')
  const signature = str(body.signature)
  if (!isHex(signature)) throw new HttpError(400, 'Signature is invalid.')

  const input: CreateLinkInput = { recipient, description, merchant, mode: mode as LinkMode, amount, expiresAt, issuedAt, nonce }
  const message = buildCreateMessage(input, USDC_ADDRESS)
  const valid = await client.verifyMessage({ address: recipient, message, signature }).catch(() => false)
  if (!valid) throw new HttpError(401, 'The signature does not prove control of the recipient wallet.', 'bad_signature')

  return mutate((db) => {
    if (db.nonces[nonce]) throw new HttpError(409, 'That signature was already used.', 'replayed')
    for (const [n, t] of Object.entries(db.nonces)) if (now - t > 2 * SIGNATURE_MAX_AGE_MS) delete db.nonces[n]
    db.nonces[nonce] = now
    const id = randomBytes(8).toString('base64url')
    const link: DbLink = { id, ownerDid: did, recipient, description, merchant, mode: mode as LinkMode, amountRaw: amountRaw?.toString(), expiresAt, createdAt: now }
    db.links[id] = link
    db.payments[id] = []
    return toPublic(link, 0)
  })
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local')
  const parts = url.pathname.split('/').filter(Boolean)
  const method = req.method ?? 'GET'

  if (url.pathname === '/health') return send(res, 200, { ok: true, chainId: CHAIN_ID, auth: Boolean(PRIVY_APP_ID) })

  if (parts[0] !== 'links') throw new HttpError(404, 'Not found.', 'not_found')

  // POST /links  create (Privy session + wallet signature)
  if (parts.length === 1 && method === 'POST') {
    limit(req, 'create', 20)
    const did = await authenticate(req)
    if (!did) throw new HttpError(401, 'Sign in to create payment links.', 'unauthorized')
    return send(res, 201, await createLink(req, did))
  }

  // GET /links  the signed-in merchant's links with verified payments
  if (parts.length === 1 && method === 'GET') {
    const did = await authenticate(req)
    if (!did) throw new HttpError(401, 'Sign in to view your payment links.', 'unauthorized')
    const links = await read((db) =>
      Object.values(db.links)
        .filter((l) => l.ownerDid === did)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((l): MerchantLink => ({ ...toPublic(l, (db.payments[l.id] ?? []).length), payments: db.payments[l.id] ?? [] })),
    )
    return send(res, 200, { links })
  }

  const id = parts[1] ?? ''
  if (!/^[A-Za-z0-9_-]{6,24}$/.test(id)) throw new HttpError(404, 'Payment link not found.', 'not_found')

  // GET /links/:id  public checkout details
  if (parts.length === 2 && method === 'GET') {
    limit(req, 'read', 120)
    const link = await read((db) => {
      const l = db.links[id]
      return l ? toPublic(l, (db.payments[id] ?? []).length) : null
    })
    if (!link) throw new HttpError(404, 'Payment link not found.', 'not_found')
    return send(res, 200, link)
  }

  // POST /links/:id/deactivate  merchant turns a link off for real
  if (parts.length === 3 && parts[2] === 'deactivate' && method === 'POST') {
    const did = await authenticate(req)
    if (!did) throw new HttpError(401, 'Sign in first.', 'unauthorized')
    const result = await mutate((db) => {
      const l = db.links[id]
      if (!l || l.ownerDid !== did) return null
      l.inactive = true
      return toPublic(l, (db.payments[id] ?? []).length)
    })
    if (!result) throw new HttpError(404, 'Payment link not found.', 'not_found')
    return send(res, 200, result)
  }

  // POST /links/:id/payments  verify a transaction against the link, then record it
  if (parts.length === 3 && parts[2] === 'payments' && method === 'POST') {
    limit(req, 'verify', 30)
    const body = await readJson(req)
    const txHash = str(body.txHash)
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, 'Transaction hash is invalid.')
    const link = await read((db) => db.links[id] ?? null)
    if (!link) throw new HttpError(404, 'Payment link not found.', 'not_found')
    if (link.inactive) throw new HttpError(409, 'This payment link was turned off by the merchant.', 'inactive')

    const result = await verifyPayment(link, txHash as `0x${string}`)
    if (!result.ok) throw new HttpError(result.code === 'rpc_unavailable' ? 503 : 422, result.message, result.code)

    const key = `${result.payment.txHash.toLowerCase()}:${result.payment.logIndex}`
    const recorded = await mutate((db) => {
      const owner = db.claimed[key]
      if (owner && owner !== id) throw new HttpError(409, 'That transfer already counts toward another payment link.', 'already_claimed')
      if (!owner) {
        db.claimed[key] = id
        db.payments[id] = [...(db.payments[id] ?? []), result.payment]
      }
      return db.payments[id]?.find((p) => `${p.txHash.toLowerCase()}:${p.logIndex}` === key) ?? result.payment
    })
    return send(res, 200, { verified: true, payment: recorded })
  }

  throw new HttpError(404, 'Not found.', 'not_found')
}

createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message, code: error.code })
    console.error('[cooket-server]', error)
    return send(res, 500, { error: 'Something went wrong on the server.', code: 'internal' })
  })
}).listen(PORT, () => {
  console.log(`[cooket-server] listening on :${PORT} (Arc Mainnet ${CHAIN_ID}, auth ${PRIVY_APP_ID ? 'on' : 'OFF: VITE_PRIVY_APP_ID missing'})`)
})
