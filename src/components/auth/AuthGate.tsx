import { useEffect, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { Loader2, LockKeyhole, ShieldCheck, Zap } from 'lucide-react'
import { LogoMark } from '@/components/layout/Wordmark'
import { ConnectWalletButton } from '@/components/layout/ConnectWalletButton'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/misc'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

export function Splash() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 10000)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <Frame>
      <div className="flex flex-col items-center gap-4 text-muted" role="status">
        <LogoMark className="size-12" />
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Loading Cooket</span>
      </div>
      {slow && (
        <div className="mt-8 space-y-3">
          <Notice tone="warning" title="Sign-in is taking longer than expected">
            Privy has not finished starting. If this persists, add this site&apos;s domain to the allowed origins in the Privy Dashboard, then reload.
          </Notice>
          <Button full onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
    </Frame>
  )
}

export function SignIn() {
  return (
    <Frame>
      <div className="rounded-card border border-line bg-surface p-7 shadow-card sm:p-8">
        <LogoMark className="size-11" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">Pay and get paid in USDC</h1>
        <p className="mt-2 text-sm text-muted">Sign in with email, Google, X, or a wallet you already own. If you do not have a wallet, Privy creates one for you.</p>
        <div className="mt-6">
          <ConnectWalletButton full size="lg" label="Sign in to Cooket" />
        </div>
        <ul className="mt-6 space-y-3 border-t border-line pt-6 text-sm text-slate-700">
          <li className="flex gap-3">
            <Zap className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            Real USDC on Arc Mainnet, with confirmations in about a second.
          </li>
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            You approve every payment in your wallet. Cooket never sees your keys.
          </li>
          <li className="flex gap-3">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            Mainnet payments are real and cannot be reversed.
          </li>
        </ul>
      </div>
    </Frame>
  )
}

/** Signed in with Privy, but no wallet is connected to the app yet. */
export function WalletPending() {
  const { logout } = usePrivy()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <Frame>
      <div className="rounded-card border border-line bg-surface p-7 text-center shadow-card sm:p-8" role="status">
        <Loader2 className="mx-auto size-7 animate-spin text-brand" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-ink">Setting up your wallet</h1>
        <p className="mt-1.5 text-sm text-muted">This takes a few seconds the first time you sign in.</p>
        {slow && (
          <div className="mt-5 space-y-3 text-left">
            <Notice tone="warning" title="This is taking longer than expected">
              No wallet has connected yet. If it keeps spinning, embedded wallets may not be enabled for this Privy app, or your external wallet was disconnected.
            </Notice>
            <div className="flex gap-2">
              <Button full onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button full onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
        )}
      </div>
    </Frame>
  )
}

export function MissingConfig() {
  return (
    <Frame>
      <div className="rounded-card border border-danger-100 bg-surface p-7 shadow-card">
        <h1 className="text-lg font-semibold text-ink">Privy is not configured</h1>
        <p className="mt-2 text-sm text-muted">
          Cooket needs the <span className="font-mono text-xs text-ink">VITE_PRIVY_APP_ID</span> environment variable to sign users in. Add it to <span className="font-mono text-xs text-ink">.env</span> and restart the dev server.
        </p>
      </div>
    </Frame>
  )
}
