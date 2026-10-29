import { Bell, BellOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { navigate } from '@/lib/router'
import { formatRelative } from '@/lib/format'
import { notificationsStore } from '@/stores'
import { Popover } from '@/components/ui/Popover'
import { Button } from '@/components/ui/Button'

const toneDot = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-brand' } as const

export function Notifications() {
  const items = notificationsStore.use()
  const unread = items.filter((n) => !n.read).length

  return (
    <Popover
      label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      triggerClassName="relative flex size-11 items-center justify-center rounded-control border border-line bg-surface text-muted shadow-card hover:bg-slate-50 hover:text-ink md:size-10"
      trigger={
        <>
          <Bell className="size-5" aria-hidden />
          {unread > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-brand ring-2 ring-surface" />}
        </>
      }
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <Button size="sm" variant="ghost" disabled={unread === 0} onClick={() => notificationsStore.set((prev) => prev.map((n) => ({ ...n, read: true })))}>
              Mark all read
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <BellOff className="size-6 text-slate-400" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink">Nothing yet</p>
              <p className="mt-1 text-sm text-muted">Payment confirmations and incoming transfers show up here.</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      notificationsStore.set((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
                      if (n.href) navigate(n.href)
                      close()
                    }}
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', toneDot[n.tone], n.read && 'opacity-30')} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm text-ink', !n.read && 'font-semibold')}>{n.title}</span>
                      <span className="mt-0.5 block text-sm text-muted">{n.body}</span>
                      <span className="mt-1 block text-xs text-slate-400">{formatRelative(n.ts)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  )
}
