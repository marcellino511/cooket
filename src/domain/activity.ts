import { startOfMonth } from '@/lib/format'
import type { ActivityItem, Address, ChainTransfer, Contact, Direction, LocalTx, TxStatus } from './types'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

interface BuildInput {
  account: Address
  local: LocalTx[]
  transfers: ChainTransfer[]
  contacts: Contact[]
  /** Verified link payments by lowercase transaction hash, from the payment link server. */
  linkByHash: Map<string, { id: string; description: string }>
}

export function buildActivity({ account, local, transfers, contacts, linkByHash }: BuildInput): ActivityItem[] {
  const names = new Map(contacts.map((c) => [c.address.toLowerCase(), c.name]))
  const localHashes = new Set(local.map((t) => t.hash.toLowerCase()))
  const items: ActivityItem[] = []

  for (const tx of local) {
    items.push({
      id: tx.hash,
      hash: tx.hash,
      chainId: tx.chainId,
      direction: 'sent',
      amount: BigInt(tx.amountRaw),
      counterparty: tx.to,
      counterpartyName: names.get(tx.to.toLowerCase()),
      status: tx.status,
      timestamp: tx.confirmedAt ?? tx.submittedAt,
      submittedAt: tx.submittedAt,
      blockNumber: tx.blockNumber ? BigInt(tx.blockNumber) : undefined,
      note: tx.note,
      kind: tx.kind,
      linkId: tx.linkId,
      source: 'local',
      failureReason: tx.failureReason,
    })
  }

  for (const t of transfers) {
    if (localHashes.has(t.hash.toLowerCase())) continue
    const sent = same(t.from, account)
    const counterparty = sent ? t.to : t.from
    const matched = !sent ? linkByHash.get(t.hash.toLowerCase()) : undefined
    items.push({
      id: `${t.hash}:${t.logIndex}`,
      hash: t.hash,
      chainId: t.chainId,
      direction: sent ? 'sent' : 'received',
      amount: t.value,
      counterparty,
      counterpartyName: names.get(counterparty.toLowerCase()),
      status: 'completed',
      timestamp: t.timestamp,
      blockNumber: t.blockNumber,
      kind: matched ? 'payment-link' : 'transfer',
      linkId: matched?.id,
      note: matched?.description,
      source: 'chain',
    })
  }

  return items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
}

export type DateRange = 'all' | 'today' | '7d' | '30d' | 'month' | 'custom'

export interface ActivityFilters {
  query: string
  range: DateRange
  from: string
  to: string
  type: 'all' | Direction
  status: 'all' | TxStatus
}

export const DEFAULT_FILTERS: ActivityFilters = { query: '', range: 'all', from: '', to: '', type: 'all', status: 'all' }

export function isFiltered(f: ActivityFilters): boolean {
  return f.query !== '' || f.range !== 'all' || f.type !== 'all' || f.status !== 'all'
}

function rangeBounds(f: ActivityFilters, now: number): [number, number] {
  const day = 24 * 60 * 60_000
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
  switch (f.range) {
    case 'today':
      return [startOfToday, Infinity]
    case '7d':
      return [now - 7 * day, Infinity]
    case '30d':
      return [now - 30 * day, Infinity]
    case 'month':
      return [startOfMonth(now), Infinity]
    case 'custom': {
      const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity
      const to = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : Infinity
      return [from, to]
    }
    default:
      return [-Infinity, Infinity]
  }
}

export function filterActivity(items: ActivityItem[], f: ActivityFilters, now = Date.now()): ActivityItem[] {
  const q = f.query.trim().toLowerCase()
  const [from, to] = rangeBounds(f, now)
  return items.filter((item) => {
    if (f.type !== 'all' && item.direction !== f.type) return false
    if (f.status !== 'all' && item.status !== f.status) return false
    if (f.range !== 'all') {
      if (item.timestamp === null || item.timestamp < from || item.timestamp > to) return false
    }
    if (!q) return true
    return [item.counterpartyName, item.counterparty, item.hash, item.note].some((v) => v?.toLowerCase().includes(q))
  })
}

export interface ActivityStats {
  totalSent: bigint
  totalReceived: bigint
  completedThisMonth: number
}

export function computeStats(items: ActivityItem[], now = Date.now()): ActivityStats {
  const monthStart = startOfMonth(now)
  let totalSent = 0n
  let totalReceived = 0n
  let completedThisMonth = 0
  for (const item of items) {
    if (item.status !== 'completed') continue
    if (item.direction === 'sent') totalSent += item.amount
    else totalReceived += item.amount
    if (item.timestamp !== null && item.timestamp >= monthStart) completedThisMonth += 1
  }
  return { totalSent, totalReceived, completedThisMonth }
}
