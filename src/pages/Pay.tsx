import { Link2Off } from 'lucide-react'
import { ApiError, usePublicLink } from '@/api/links'
import { CheckoutCard } from '@/features/checkout/CheckoutCard'
import { Wordmark } from '@/components/layout/Wordmark'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/misc'
import { useTxReconciler } from '@/chain/useTxReconciler'
import { Link, navigate, useLocation } from '@/lib/router'

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-50">
        <Link2Off className="size-6 text-danger" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <p className="mt-1 text-sm text-muted">No payment was made.</p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        Open Cooket
      </Button>
    </div>
  )
}

/** The public checkout a payer sees when they open a payment link. Rendered outside the app shell. */
export default function Pay() {
  useTxReconciler()
  const { params } = useLocation()
  const id = params.get('id')
  const link = usePublicLink(id)

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-16 items-center justify-between border-b border-line bg-surface px-4 sm:px-8">
        <Wordmark />
        <span className="text-sm text-muted">Payment request</span>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 pb-24 pt-8 sm:pt-12">
        {!id ? (
          <Unavailable title="This payment link cannot be used" body="The link is missing its ID." />
        ) : link.isLoading ? (
          <div className="space-y-4" aria-busy aria-label="Loading payment request">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : link.isError ? (
          link.error instanceof ApiError && link.error.status === 404 ? (
            <Unavailable title="Payment link not found" body="This link does not exist or was removed." />
          ) : (
            <Unavailable title="Could not load this payment request" body="The Cooket payment server is not reachable right now. Try again in a moment." />
          )
        ) : link.data ? (
          <CheckoutCard link={link.data} mode="live" />
        ) : null}
        <p className="mt-6 text-center text-xs text-muted">
          Payments are made in USDC on Arc Mainnet from your own wallet. <Link to="/" className="font-medium text-brand">What is Cooket?</Link>
        </p>
      </main>
    </div>
  )
}
