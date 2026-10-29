import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Inbox, RefreshCw, Search, SearchX } from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, ExternalAnchor, Notice } from '@/components/ui/misc'
import { SelectField, TextField } from '@/components/ui/Field'
import { ActivityCards, ActivitySkeletonRows, ActivityTable } from '@/components/activity/ActivityList'
import { TxDetailsDrawer } from '@/components/activity/TxDetailsDrawer'
import { useActivity } from '@/chain/useActivity'
import { useSession } from '@/chain/useSession'
import { DEFAULT_FILTERS, filterActivity, isFiltered, type ActivityFilters, type DateRange } from '@/domain/activity'
import { formatDate } from '@/lib/format'
import { navigate, useLocation } from '@/lib/router'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import type { ActivityItem } from '@/domain/types'

const PAGE_SIZE = 10

export default function Activity() {
  const { address, network } = useSession()
  const { items, history } = useActivity()
  const { params } = useLocation()
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<ActivityItem | null>(null)

  const set = <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
  }

  const filtered = useMemo(() => filterActivity(items, filters), [items, filters])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // Deep link: /activity?tx=<hash> opens that transaction once it is loaded.
  const txParam = params.get('tx')
  const deepLinked = txParam ? (items.find((i) => i.hash?.toLowerCase() === txParam.toLowerCase()) ?? null) : null
  const shown = selected ?? deepLinked

  const close = () => {
    setSelected(null)
    if (txParam) navigate('/activity', { replace: true })
  }

  const loading = history.isLoading
  const filtering = isFiltered(filters)

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every USDC payment you sent or received, with its confirmation status."
        actions={
          <>
            <Button icon={<RefreshCw className="size-4" aria-hidden />} onClick={history.refetch}>
              Refresh
            </Button>
          </>
        }
      />

      <Card>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute bottom-[14px] left-3.5 z-10 size-4 text-muted" aria-hidden />
            <TextField
              label="Search"
              placeholder="Name, address, transaction hash, or note"
              value={filters.query}
              onChange={(e) => set('query', e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Date" value={filters.range} onChange={(e) => set('range', e.target.value as DateRange)}>
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom range</option>
            </SelectField>
            <SelectField label="Type" value={filters.type} onChange={(e) => set('type', e.target.value as ActivityFilters['type'])}>
              <option value="all">Sent and received</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </SelectField>
            <SelectField label="Status" value={filters.status} onChange={(e) => set('status', e.target.value as ActivityFilters['status'])}>
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </SelectField>
          </div>
          {filters.range === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="From" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
              <TextField label="To" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
            </div>
          )}
          {filtering && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted" aria-live="polite">
                {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0) }}>
                Clear filters
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-line">
          {loading ? (
            <ActivitySkeletonRows rows={6} />
          ) : history.isError && items.length === 0 ? (
            <div className="p-5">
              <Notice tone="danger" title="Could not load activity" action={<Button size="sm" onClick={history.refetch}>Retry</Button>}>
                We could not reach {network.name}. Your funds are not affected.
              </Notice>
            </div>
          ) : filtered.length === 0 ? (
            filtering ? (
              <EmptyState
                icon={<SearchX className="size-6" aria-hidden />}
                title="No matching transactions"
                description="Try a different search or loosen the filters. Older activity may need to be loaded below."
                action={<Button onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0) }}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                icon={<Inbox className="size-6" aria-hidden />}
                title="No activity yet"
                description={`USDC you send or receive on ${network.name} will show up here.`}
                action={<Button variant="primary" onClick={() => navigate('/send')}>Send USDC</Button>}
              />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <ActivityTable items={visible} onSelect={setSelected} />
              </div>
              <div className="md:hidden">
                <ActivityCards items={visible} onSelect={setSelected} />
              </div>
            </>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span className="text-muted">
              Showing {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + visible.length} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} icon={<ChevronLeft className="size-4" aria-hidden />}>
                Previous
              </Button>
              <span className="num px-1 text-muted">
                {safePage + 1} / {pageCount}
              </span>
              <Button size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                Next
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {(
        <div className="mt-4 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 text-sm shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted">
            {history.oldestTimestamp ? `Loaded activity goes back to ${formatDate(history.oldestTimestamp)}.` : 'Loaded recent activity from the network.'}{' '}
            History is read from recent Arc blocks, so load older activity or use the explorer for the full record.
            {address && (
              <>
                {' '}
                <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, address)}>Full history on explorer</ExternalAnchor>
              </>
            )}
          </p>
          {history.hasMore && (
            <Button loading={history.isFetchingMore} onClick={history.loadMore}>
              Load older activity
            </Button>
          )}
        </div>
      )}

      <TxDetailsDrawer item={shown} onClose={close} />
    </>
  )
}
