import type { IncomingMessage, ServerResponse } from 'node:http'
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
  type MerchantLink,
  type PublicLink,
} from '../src/shared/links'
import { authenticate } from './auth'
import { CHAIN_ID, PRIVY_APP_ID, ROUTER_ADDRESS, ROUTER_CONFIG_VALID, USDC_ADDRESS, USDC_DECIMALS } from './config'
import type { DbLink } from './db'
import { getStore, storageStatus } from './store'
import { StorageNotConfigured, StoreConflict, StoreUnavailable } from './store-types'
import { client, routerIsValid, verifyPayment } from './verify'

const MAX_BODY = 16_000
const HARD_BODY_LIMIT = 1_000_000
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

async function readJson(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  let text: string
  if (req.body !== undefined && req.body !== null) {
    // Vercel's Node runtime parses the body before the handler runs and leaves the stream empty.
    text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (Buffer.byteLength(text) > MAX_BODY) throw new HttpError(413, 'Request body is too large.')
  } else {
    const chunks: Buffer[] = []
    let size = 0
    // Keep draining an oversized body (without storing it) so the 413 reaches the client instead of a reset connection.
    for await (const chunk of req) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > HARD_BODY_LIMIT) req.destroy()
      else if (size <= MAX_BODY) chunks.push(buf)
    }
    if (size > MAX_BODY) throw new HttpError(413, 'Request body is too large.')
    text = Buffer.concat(chunks).toString('utf8')
  }
  try {
    const parsed: unknown = JSON.parse(text || '{}')
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
    router: link.router,
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
  if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > SIGNATURE_MAX_AGE_MS) throw new HttpError(400, 'The signature request is stale. Try again.', 'stale_signature')
  const nonce = str(body.nonce)
  if (!/^[0-9a-f]{16,64}$/.test(nonce)) throw new HttpError(400, 'Nonce is invalid.')
  const signature = str(body.signature)
  if (!isHex(signature)) throw new HttpError(400, 'Signature is invalid.')

  // A configured router must be the real CooketPayRouter for Arc USDC before any link binds to it.
  if (!ROUTER_CONFIG_VALID) throw new HttpError(503, 'Payment contract configuration is invalid.', 'router_not_configured')
  if (ROUTER_ADDRESS) {
    const routerOk = await routerIsValid(ROUTER_ADDRESS).catch(() => null)
    if (routerOk === null) throw new HttpError(503, 'The Arc Mainnet RPC could not be verified. Try again shortly.', 'rpc_unavailable')
    if (!routerOk) throw new HttpError(503, 'The configured payment contract is not a valid CooketPayRouter for Arc USDC.', 'router_invalid')
  }

  const input: CreateLinkInput = { recipient, description, merchant, mode: mode, amount, expiresAt, issuedAt, nonce, router: ROUTER_ADDRESS }
  const message = buildCreateMessage(input, USDC_ADDRESS)
  const valid = await client.verifyMessage({ address: recipient, message, signature }).catch(() => false)
  if (!valid) throw new HttpError(401, 'The signature does not prove control of the recipient wallet.', 'bad_signature')

  const id = randomBytes(8).toString('base64url')
  const link: DbLink = { id, ownerDid: did, recipient, description, merchant, mode: mode, amountRaw: amountRaw?.toString(), expiresAt, createdAt: now, router: ROUTER_ADDRESS }
  try {
    await getStore().createLink(link, nonce)
  } catch (error) {
    if (error instanceof StoreConflict) throw new HttpError(409, 'That signature was already used.', 'replayed')
    throw error
  }
  return toPublic(link, 0)
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local')
  // Behind Vercel the function sees /api/...; the Vite dev proxy already strips it.
  const pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  const parts = pathname.split('/').filter(Boolean)
  const method = req.method ?? 'GET'

  if (pathname === '/health') {
    const ok = storageStatus() !== 'not_configured' && ROUTER_CONFIG_VALID
    return send(res, ok ? 200 : 503, { ok, chainId: CHAIN_ID, auth: Boolean(PRIVY_APP_ID), router: ROUTER_ADDRESS ?? null, routerConfigured: ROUTER_CONFIG_VALID, storage: storageStatus() })
  }

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
    const rows = await getStore().listByOwner(did)
    const links = rows.map(({ link, payments }): MerchantLink => ({ ...toPublic(link, payments.length), payments }))
    return send(res, 200, { links })
  }

  const id = parts[1] ?? ''
  if (!/^[A-Za-z0-9_-]{6,24}$/.test(id)) throw new HttpError(404, 'Payment link not found.', 'not_found')

  // GET /links/:id  public checkout details
  if (parts.length === 2 && method === 'GET') {
    limit(req, 'read', 120)
    const found = await getStore().getLink(id)
    const link = found ? toPublic(found.link, found.payments.length) : null
    if (!link) throw new HttpError(404, 'Payment link not found.', 'not_found')
    return send(res, 200, link)
  }

  // POST /links/:id/deactivate  merchant turns a link off for real
  if (parts.length === 3 && parts[2] === 'deactivate' && method === 'POST') {
    const did = await authenticate(req)
    if (!did) throw new HttpError(401, 'Sign in first.', 'unauthorized')
    const row = await getStore().deactivate(id, did)
    const result = row ? toPublic(row.link, row.payments.length) : null
    if (!result) throw new HttpError(404, 'Payment link not found.', 'not_found')
    return send(res, 200, result)
  }

  // POST /links/:id/payments  verify a transaction against the link, then record it
  if (parts.length === 3 && parts[2] === 'payments' && method === 'POST') {
    limit(req, 'verify', 30)
    const body = await readJson(req)
    const txHash = str(body.txHash)
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, 'Transaction hash is invalid.')
    const row = await getStore().getLink(id)
    if (!row) throw new HttpError(404, 'Payment link not found.', 'not_found')
    const link = row.link
    if (link.inactive) throw new HttpError(409, 'This payment link was turned off by the merchant.', 'inactive')

    const result = await verifyPayment(link, txHash as `0x${string}`)
    if (!result.ok) throw new HttpError(['rpc_unavailable', 'router_not_configured', 'router_invalid'].includes(result.code) ? 503 : 422, result.message, result.code)

    let recorded
    try {
      // Older router records used the PaymentReceived index. Preserve their idempotence when
      // verification now identifies the underlying system Transfer instead.
      const existing = link.router ? await getStore().findPayment(id, txHash) : null
      recorded = existing ?? await getStore().recordPayment(id, result.payment)
    } catch (error) {
      if (error instanceof StoreConflict) throw new HttpError(409, 'That transfer already counts toward another payment link.', 'already_claimed')
      throw error
    }
    return send(res, 200, { verified: true, payment: recorded })
  }

  throw new HttpError(404, 'Not found.', 'not_found')
}

/** One request, one response. Used by the local server and by the Vercel function. */
export function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return route(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message, code: error.code })
    if (error instanceof StorageNotConfigured) return send(res, 503, { error: 'Payment link storage is not configured on the server.', code: 'storage_not_configured' })
    if (error instanceof StoreUnavailable) return send(res, 503, { error: 'Payment link storage is temporarily unavailable. Try again shortly.', code: 'storage_unavailable' })
    console.error('[cooket-server]', error)
    return send(res, 500, { error: 'Something went wrong on the server.', code: 'internal' })
  })
}
