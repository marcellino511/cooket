import type { ReactNode } from 'react'
import { useTxReconciler } from '@/chain/useTxReconciler'
import { useIncomingWatcher } from '@/chain/useTransferHistory'
import { useSession } from '@/chain/useSession'
import { SignIn, Splash, WalletPending } from '@/components/auth/AuthGate'
import { Badge } from '@/components/ui/Badge'
import { shortAddress } from '@/lib/format'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { Wordmark } from './Wordmark'
import { NetworkStatus } from './NetworkStatus'
import { Notifications } from './Notifications'
import { ProfileMenu } from './ProfileMenu'

function Shell({ children }: { children: ReactNode }) {
  useTxReconciler()
  useIncomingWatcher()
  const { address } = useSession()

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <Sidebar />
      <div className="md:pl-[72px] lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="md:hidden" compact />
            <span className="text-[17px] font-semibold tracking-tight text-ink md:hidden">Cooket</span>
            <div className="hidden md:block">
              <Badge tone="success">Wallet {address ? shortAddress(address) : ''}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NetworkStatus />
            <Notifications />
            <ProfileMenu />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}

/** Everything inside the app requires a Privy session and a connected wallet. */
export function AppShell({ children }: { children: ReactNode }) {
  const { ready, authenticated, isConnected } = useSession()
  if (!ready) return <Splash />
  if (!authenticated) return <SignIn />
  if (!isConnected) return <WalletPending />
  return <Shell>{children}</Shell>
}
