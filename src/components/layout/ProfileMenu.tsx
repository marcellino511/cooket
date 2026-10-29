import { usePrivy } from '@privy-io/react-auth'
import { LogOut, Settings, User } from 'lucide-react'
import { Link } from '@/lib/router'
import { shortAddress } from '@/lib/format'
import { settingsStore } from '@/stores'
import { useSession } from '@/chain/useSession'
import { Popover } from '@/components/ui/Popover'
import { CopyButton, ExternalAnchor } from '@/components/ui/misc'
import { buildAddressExplorerUrl } from '@/onchain-facts'

function initials(name: string, address?: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 0) return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
  return address ? address.slice(2, 4).toUpperCase() : ''
}

export function ProfileMenu() {
  const { address, isConnected, network } = useSession()
  const { displayName } = settingsStore.use()
  const { logout, user } = usePrivy()
  const identity = user?.email?.address ?? user?.google?.email ?? null
  const text = initials(displayName, address)

  return (
    <Popover
      label="Profile menu"
      triggerClassName="flex size-11 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand hover:bg-brand-100 md:size-10"
      trigger={text ? <span aria-hidden>{text}</span> : <User className="size-5" aria-hidden />}
    >
      {(close) => (
        <div className="p-4">
          <p className="truncate text-sm font-semibold text-ink">{displayName || identity || 'Your account'}</p>
          {displayName && identity && <p className="truncate text-xs text-muted">{identity}</p>}
          {isConnected && address ? (
            <>
              <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 py-1 pl-3 pr-1">
                <span className="font-mono text-[13px] text-ink" title={address}>
                  {shortAddress(address, 8, 6)}
                </span>
                <CopyButton value={address} label="Copy wallet address" iconOnly />
              </div>
              <div className="mt-2">
                <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, address)} className="text-sm">
                  View on explorer
                </ExternalAnchor>
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Connect a wallet to see your own balance and activity.</p>
          )}

          <div className="mt-4 space-y-1 border-t border-line pt-3">
            <Link to="/settings" onClick={close} className="flex h-11 items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-ink hover:bg-elevated">
              <Settings className="size-4 text-muted" aria-hidden />
              Settings
            </Link>
            <button
              type="button"
              onClick={() => {
                void logout()
                close()
              }}
              className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-ink hover:bg-elevated"
            >
              <LogOut className="size-4 text-muted" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
