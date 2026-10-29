import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Inbox, Link2, ListOrdered } from 'lucide-react'
import { BalanceCard } from '@/components/overview/BalanceCard'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, Notice } from '@/components/ui/misc'
import { ActivityCards, ActivitySkeletonRows } from '@/components/activity/ActivityList'
import { TxDetailsDrawer } from '@/components/activity/TxDetailsDrawer'
import { UsdcAmount, useHidden } from '@/components/common/Money'
import { useActivity } from '@/chain/useActivity'
import { useSession } from '@/chain/useSession'
import { Link, navigate } from '@/lib/router'
import { settingsStore } from '@/stores'
import type { ActivityItem } from '@/domain/types'
import type { ReactNode } from 'react'

function Metric({ label, children, note }: { label: string; children: ReactNode; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{children}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </Card>
  )
}

const ACTIONS = [
  { to: '/send', label: 'Send USDC', hint: 'Pay a wallet or contact', icon: <ArrowUpRight className="size-5" aria-hidden /> },
  { to: '/receive', label: 'Receive USDC', hint: 'Share your address and QR', icon: <ArrowDownLeft className="size-5" aria-hidden /> },
  { to: '/payment-links', label: 'Create payment link', hint: 'Get paid by anyone', icon: <Link2 className="size-5" aria-hidden /> },
  { to: '/activity', label: 'View activity', hint: 'Search and filter history', icon: <ListOrdered className="size-5" aria-hidden /> },
] as const

export default function Overview() {
  const { network } = useSession()
  const { items, stats, history } = useActivity()
  const hidden = useHidden()
  const { displayName } = settingsStore.use()
  const [selected, setSelected] = useState<ActivityItem | null>(null)

  const recent = items.slice(0, 5)
  const loading = history.isLoading
  const scopeNote = history.hasMore ? 'From loaded activity' : 'From all activity'
  
  return (
    <>
      <PageHeader
        title={displayName ? `Welcome back, ${displayName.split(' ')[0]}` : 'Overview'}
        description="Your USDC balance, recent payments, and shortcuts."
      />

      <div className="space-y-6">

        <BalanceCard />

        <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="group flex min-h-[88px] flex-col justify-between rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand">{a.icon}</span>
              <span className="mt-3">
                <span className="block text-sm font-semibold text-ink">{a.label}</span>
                <span className="mt-0.5 hidden text-xs text-muted sm:block">{a.hint}</span>
              </span>
            </Link>
          ))}
        </section>

        <section aria-label="Payment totals" className="grid gap-3 sm:grid-cols-3">
          <Metric label="Total sent" note={scopeNote}>
            <UsdcAmount raw={stats.totalSent} hidden={hidden} /> <span className="text-base font-medium text-muted">USDC</span>
          </Metric>
          <Metric label="Total received" note={scopeNote}>
            <UsdcAmount raw={stats.totalReceived} hidden={hidden} /> <span className="text-base font-medium text-muted">USDC</span>
          </Metric>
          <Metric label="Completed this month" note={scopeNote}>
            <span className="num">{stats.completedThisMonth}</span> <span className="text-base font-medium text-muted">payments</span>
          </Metric>
        </section>

        <Card>
          <CardHeader
            title="Recent transactions"
            action={
              <div className="flex items-center gap-3">
                <Link to="/activity" className="text-sm font-medium text-brand hover:text-brand-hover">
                  View all
                </Link>
              </div>
            }
          />
          <div className="border-t border-line">
            {loading ? (
              <ActivitySkeletonRows />
            ) : history.isError ? (
              <div className="p-5">
                <Notice tone="danger" title="Could not load activity" action={<Button size="sm" onClick={history.refetch}>Retry</Button>}>
                  We could not reach {network.name}. Your funds are not affected.
                </Notice>
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-6" aria-hidden />}
                title="No payments yet"
                description="Send or receive USDC and it will appear here once the network confirms it."
                action={<Button variant="primary" onClick={() => navigate('/send')}>Send USDC</Button>}
              />
            ) : (
              <ActivityCards items={recent} onSelect={setSelected} />
            )}
          </div>
        </Card>
      </div>

      <TxDetailsDrawer item={selected} onClose={() => setSelected(null)} />
    </>
  )
}
