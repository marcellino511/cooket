import { ArrowDownLeft, ArrowUpRight, Link2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateTime, shortAddress } from '@/lib/format'
import { getNetwork } from '@/lib/networks'
import type { ActivityItem } from '@/domain/types'

export function counterpartyLabel(item: ActivityItem): string {
  if (item.counterpartyName) return item.counterpartyName
  if (item.counterparty === '0x0000000000000000000000000000000000000000') return 'USDC mint or burn'
  if (item.counterparty) return shortAddress(item.counterparty)
  return 'Unknown'
}

export function typeLabel(item: ActivityItem): string {
  if (item.kind === 'payment-link') return item.direction === 'received' ? 'Payment link' : 'Link payment'
  return item.direction === 'sent' ? 'Sent' : 'Received'
}

export function whenLabel(item: ActivityItem): string {
  if (item.timestamp !== null) return formatDateTime(item.timestamp)
  return item.blockNumber !== undefined ? `Block ${item.blockNumber.toLocaleString('en-US')}` : '—'
}

export function networkName(item: ActivityItem): string {
  return getNetwork(item.chainId).name
}

export function DirectionIcon({ item, className }: { item: ActivityItem; className?: string }) {
  const received = item.direction === 'received'
  const Icon = item.kind === 'payment-link' ? Link2 : received ? ArrowDownLeft : ArrowUpRight
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full',
        received ? 'bg-success-50 text-success' : 'bg-slate-100 text-slate-600',
        className,
      )}
      aria-hidden
    >
      <Icon className="size-5" />
    </span>
  )
}

export function amountTone(item: ActivityItem): string {
  if (item.status === 'failed') return 'text-slate-400 line-through'
  return item.direction === 'received' ? 'text-success' : 'text-ink'
}
