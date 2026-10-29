import { StatusBadge } from '@/components/ui/Badge'
import { UsdcAmount } from '@/components/common/Money'
import { cn } from '@/lib/cn'
import type { ActivityItem } from '@/domain/types'
import { amountTone, counterpartyLabel, DirectionIcon, networkName, typeLabel, whenLabel } from './parts'

/** Readable stacked rows. Used on mobile and for compact lists such as the dashboard. */
export function ActivityCards({ items, onSelect }: { items: ActivityItem[]; onSelect: (item: ActivityItem) => void }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item)}
            aria-label={`${typeLabel(item)} ${counterpartyLabel(item)}, view details`}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 sm:px-6"
          >
            <DirectionIcon item={item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{counterpartyLabel(item)}</span>
              <span className="mt-0.5 block truncate text-sm text-muted">
                {typeLabel(item)} · {networkName(item)}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">{whenLabel(item)}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              <span className={cn('text-sm font-semibold', amountTone(item))}>
                <UsdcAmount raw={item.amount} sign={item.direction === 'received' ? '+' : '-'} /> <span className="font-medium text-muted">USDC</span>
              </span>
              <StatusBadge status={item.status} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Dense table for tablet and desktop. Rows are keyboard-activatable. */
export function ActivityTable({ items, onSelect }: { items: ActivityItem[]; onSelect: (item: ActivityItem) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
            <th scope="col" className="py-3 pl-6 pr-3 font-medium">Counterparty</th>
            <th scope="col" className="px-3 py-3 font-medium">Type</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">Amount</th>
            <th scope="col" className="px-3 py-3 font-medium">Date</th>
            <th scope="col" className="px-3 py-3 font-medium">Network</th>
            <th scope="col" className="py-3 pl-3 pr-6 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => (
            <tr
              key={item.id}
              tabIndex={0}
              onClick={() => onSelect(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(item)
                }
              }}
              aria-label={`${typeLabel(item)} ${counterpartyLabel(item)}, view details`}
              className="cursor-pointer transition-colors hover:bg-slate-50"
            >
              <td className="py-3.5 pl-6 pr-3">
                <div className="flex items-center gap-3">
                  <DirectionIcon item={item} className="size-9" />
                  <div className="min-w-0">
                    <p className="max-w-[14rem] truncate font-semibold text-ink">{counterpartyLabel(item)}</p>
                    {item.note && <p className="max-w-[14rem] truncate text-xs text-muted">{item.note}</p>}
                  </div>
                </div>
              </td>
              <td className="px-3 py-3.5 text-muted">{typeLabel(item)}</td>
              <td className={cn('num px-3 py-3.5 text-right font-semibold', amountTone(item))}>
                <UsdcAmount raw={item.amount} sign={item.direction === 'received' ? '+' : '-'} /> <span className="font-medium text-muted">USDC</span>
              </td>
              <td className="px-3 py-3.5 text-muted">{whenLabel(item)}</td>
              <td className="px-3 py-3.5 text-muted">{networkName(item)}</td>
              <td className="py-3.5 pl-3 pr-6">
                <StatusBadge status={item.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ActivitySkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line" aria-busy aria-label="Loading activity">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6">
          <div className="size-10 animate-pulse rounded-full bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  )
}
