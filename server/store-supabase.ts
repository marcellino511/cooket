import type { LinkMode, LinkPayment } from '../src/shared/links'
import { isAddress } from 'viem'
import type { DbLink } from './db'
import { StoreConflict, StoreUnavailable, type LinkWithPayments, type Store } from './store-types'

/*
 * Supabase storage over PostgREST with the service role key. This runs on the server only: the key bypasses
 * row level security, so it must never reach the browser. The tables have RLS enabled and no policies, so the
 * public anon key can read and write nothing (see supabase/migrations/0001_payment_links.sql).
 */

const NONCE_TTL_MS = 20 * 60_000

interface LinkRow {
  id: string
  owner_did: string
  recipient: string
  description: string
  merchant: string | null
  mode: LinkMode
  amount_raw: string | null
  expires_at: number | null
  created_at: number
  inactive: boolean
  router: string | null
}

interface PaymentRow {
  link_id: string
  tx_hash: string
  log_index: number
  payer: string
  amount_raw: string
  block_number: string
  paid_at: number
  verified_at: number
}

const decimal = (value: unknown): boolean => typeof value === 'string' && /^[0-9]{1,30}$/.test(value)
const timestamp = (value: unknown): boolean => (typeof value === 'number' || (typeof value === 'string' && /^[0-9]+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0
const walletAddress = (value: unknown): boolean => typeof value === 'string' && isAddress(value, { strict: false }) && !/^0x0{40}$/i.test(value)

const toLink = (r: LinkRow): DbLink => {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.owner_did !== 'string' || typeof r.description !== 'string' ||
      !walletAddress(r.recipient) ||
      (r.mode !== 'fixed' && r.mode !== 'open') || typeof r.inactive !== 'boolean' ||
      !(r.merchant === null || typeof r.merchant === 'string') ||
      !(r.router === null || walletAddress(r.router)) ||
      !(r.amount_raw === null || decimal(r.amount_raw)) || (r.mode === 'fixed' && (!decimal(r.amount_raw) || BigInt(r.amount_raw!) <= 0n)) ||
      !timestamp(r.created_at) || !(r.expires_at === null || timestamp(r.expires_at))) {
    throw new StoreUnavailable('storage returned an invalid link row')
  }
  return {
    id: r.id,
    ownerDid: r.owner_did,
    recipient: r.recipient as `0x${string}`,
    description: r.description,
    merchant: r.merchant ?? undefined,
    mode: r.mode,
    amountRaw: r.amount_raw ?? undefined,
    expiresAt: r.expires_at === null ? undefined : Number(r.expires_at),
    createdAt: Number(r.created_at),
    inactive: r.inactive || undefined,
    router: (r.router ?? undefined) as `0x${string}` | undefined,
  }
}

const toPayment = (r: PaymentRow): LinkPayment => {
  if (!r || typeof r !== 'object' || typeof r.link_id !== 'string' || typeof r.tx_hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(r.tx_hash) ||
      !Number.isSafeInteger(r.log_index) || r.log_index < 0 ||
      !walletAddress(r.payer) ||
      !decimal(r.amount_raw) || BigInt(r.amount_raw) <= 0n || !decimal(r.block_number) ||
      !timestamp(r.paid_at) || !timestamp(r.verified_at)) {
    throw new StoreUnavailable('storage returned an invalid payment row')
  }
  return {
    txHash: r.tx_hash as `0x${string}`,
    logIndex: r.log_index,
    payer: r.payer as `0x${string}`,
    amountRaw: r.amount_raw,
    blockNumber: r.block_number,
    paidAt: Number(r.paid_at),
    verifiedAt: Number(r.verified_at),
  }
}

class UniqueViolation extends Error {}

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  private async rest<T>(table: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; query?: Record<string, string>; body?: unknown; returning?: boolean } = {}): Promise<T> {
    const query = new URLSearchParams(init.query)
    let response: Response
    try {
      response = await fetch(`${this.url}/rest/v1/${table}${query.size ? `?${query}` : ''}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: this.key,
          authorization: `Bearer ${this.key}`,
          'content-type': 'application/json',
          ...(init.returning ? { prefer: 'return=representation' } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      })
    } catch {
      throw new StoreUnavailable('storage request failed')
    }
    if (!response.ok) {
      const detail: unknown = await response.json().catch(() => null)
      if (response.status === 409 && detail && typeof detail === 'object' && 'code' in detail && detail.code === '23505') throw new UniqueViolation()
      throw new StoreUnavailable(`storage responded ${response.status}`)
    }
    const expectedStatus = !init.method || init.method === 'GET' ? 200 : init.method === 'POST' ? 201 : init.returning ? 200 : 204
    if (response.status !== expectedStatus) throw new StoreUnavailable('storage returned an unexpected status')
    if (response.status === 204) {
      if (!init.method || init.method === 'GET' || init.returning) throw new StoreUnavailable('storage returned no rows response')
      return undefined as T
    }
    const body: unknown = await response.json().catch(() => undefined)
    if ((!init.method || init.method === 'GET' || init.returning) &&
        (!Array.isArray(body) || body.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row)))) {
      throw new StoreUnavailable('storage returned an invalid response')
    }
    return body as T
  }

  private paymentsFor(linkId: string): Promise<PaymentRow[]> {
    return this.rest<PaymentRow[]>('link_payments', { query: { link_id: `eq.${linkId}`, order: 'paid_at.asc', select: '*' } })
  }

  async getLink(id: string): Promise<LinkWithPayments | null> {
    const rows = await this.rest<LinkRow[]>('payment_links', { query: { id: `eq.${id}`, select: '*' } })
    const row = rows[0]
    if (!row) return null
    return { link: toLink(row), payments: (await this.paymentsFor(id)).map(toPayment) }
  }

  async findPayment(linkId: string, txHash: string): Promise<LinkPayment | null> {
    const rows = await this.rest<PaymentRow[]>('link_payments', {
      query: { link_id: `eq.${linkId}`, tx_hash: `eq.${txHash.toLowerCase()}`, select: '*', order: 'log_index.asc', limit: '1' },
    })
    const row = rows[0]
    if (!row) return null
    const payment = toPayment(row)
    if (row.link_id !== linkId || payment.txHash !== txHash.toLowerCase()) throw new StoreUnavailable('storage returned a mismatched payment')
    return payment
  }

  async listByOwner(ownerDid: string): Promise<LinkWithPayments[]> {
    const rows = await this.rest<(LinkRow & { link_payments: PaymentRow[] })[]>('payment_links', {
      query: { owner_did: `eq.${ownerDid}`, order: 'created_at.desc', select: '*,link_payments(*)' },
    })
    return rows.map((row) => {
      if (!Array.isArray(row.link_payments)) throw new StoreUnavailable('storage returned no embedded payments')
      return { link: toLink(row), payments: row.link_payments.map(toPayment).sort((a, b) => a.paidAt - b.paidAt) }
    })
  }

  async createLink(link: DbLink, nonce: string): Promise<void> {
    try {
      await this.rest('used_nonces', { method: 'POST', body: { nonce, used_at: link.createdAt } })
    } catch (error) {
      if (error instanceof UniqueViolation) throw new StoreConflict('replayed')
      throw error
    }
    // Housekeeping only: failures here must never block link creation.
    void this.rest('used_nonces', { method: 'DELETE', query: { used_at: `lt.${link.createdAt - NONCE_TTL_MS}` } }).catch(() => undefined)

    const row: LinkRow = {
      id: link.id,
      owner_did: link.ownerDid,
      recipient: link.recipient,
      description: link.description,
      merchant: link.merchant ?? null,
      mode: link.mode,
      amount_raw: link.amountRaw ?? null,
      expires_at: link.expiresAt ?? null,
      created_at: link.createdAt,
      inactive: false,
      router: link.router ?? null,
    }
    try {
      await this.rest('payment_links', { method: 'POST', body: row })
    } catch (error) {
      if (error instanceof UniqueViolation) throw new StoreUnavailable('link id collision')
      throw error
    }
  }

  async deactivate(id: string, ownerDid: string): Promise<LinkWithPayments | null> {
    const rows = await this.rest<LinkRow[]>('payment_links', {
      method: 'PATCH',
      query: { id: `eq.${id}`, owner_did: `eq.${ownerDid}` },
      body: { inactive: true },
      returning: true,
    })
    const row = rows[0]
    if (!row) return null
    return { link: toLink(row), payments: (await this.paymentsFor(id)).map(toPayment) }
  }

  async recordPayment(linkId: string, payment: LinkPayment): Promise<LinkPayment> {
    const txHash = payment.txHash.toLowerCase()
    const row: PaymentRow = {
      link_id: linkId,
      tx_hash: txHash,
      log_index: payment.logIndex,
      payer: payment.payer,
      amount_raw: payment.amountRaw,
      block_number: payment.blockNumber,
      paid_at: payment.paidAt,
      verified_at: payment.verifiedAt,
    }
    try {
      await this.rest('link_payments', { method: 'POST', body: row })
      return payment
    } catch (error) {
      if (!(error instanceof UniqueViolation)) throw error
    }
    // The (tx_hash, log_index) primary key already exists: fine if it is this link's own record, a conflict otherwise.
    const existing = (await this.rest<PaymentRow[]>('link_payments', { query: { tx_hash: `eq.${txHash}`, log_index: `eq.${payment.logIndex}`, select: '*' } }))[0]
    if (!existing || existing.link_id !== linkId) throw new StoreConflict('already_claimed')
    if (existing.tx_hash !== txHash || existing.log_index !== payment.logIndex) throw new StoreUnavailable('storage returned a mismatched conflict row')
    return toPayment(existing)
  }
}
