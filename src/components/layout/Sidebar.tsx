import { cn } from '@/lib/cn'
import { Link, useLocation } from '@/lib/router'
import { useSession } from '@/chain/useSession'
import { shortAddress } from '@/lib/format'
import { Wordmark } from './Wordmark'
import { NAV_ITEMS, isActive } from './nav'

export function Sidebar() {
  const { pathname } = useLocation()
  const { address, network, isConnected } = useSession()

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-line bg-surface md:flex lg:w-64">
      <div className="flex h-16 items-center justify-center px-4 lg:justify-start lg:px-6">
        <Wordmark className="lg:hidden" compact />
        <Wordmark className="hidden lg:inline-flex" />
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.to, pathname)
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-11 items-center justify-center gap-3 rounded-control text-sm font-medium transition-colors lg:justify-start lg:px-3',
                active ? 'bg-brand-50 text-brand' : 'text-muted hover:bg-slate-50 hover:text-ink',
              )}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-line p-3 lg:p-4">
        {isConnected && address && (
          <div className="hidden rounded-xl bg-elevated p-3 lg:block">
            <p className="text-xs text-muted">Connected wallet</p>
            <p className="mt-0.5 font-mono text-[13px] text-ink">{shortAddress(address)}</p>
            <p className="mt-1 text-xs text-muted">{network.name}</p>
          </div>
        )}
        <div className="flex justify-center lg:hidden">
          <span title={isConnected ? 'Wallet connected' : 'No wallet'} className={cn('size-2.5 rounded-full', isConnected ? 'bg-success' : 'bg-warning')} />
        </div>
      </div>
    </aside>
  )
}
