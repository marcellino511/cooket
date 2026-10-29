import { Suspense, lazy, type ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { navigate, useLocation } from '@/lib/router'
import { Skeleton } from '@/components/ui/misc'
import Overview from '@/pages/Overview'

const Send = lazy(() => import('@/pages/Send'))
const Receive = lazy(() => import('@/pages/Receive'))
const Activity = lazy(() => import('@/pages/Activity'))
const PaymentLinks = lazy(() => import('@/pages/PaymentLinks'))
const Contacts = lazy(() => import('@/pages/Contacts'))
const Settings = lazy(() => import('@/pages/Settings'))
const Pay = lazy(() => import('@/pages/Pay'))

function NotFound() {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-muted">That page does not exist in Cooket.</p>
      <Button variant="primary" className="mt-5" onClick={() => navigate('/')}>
        Back to overview
      </Button>
    </Card>
  )
}

function Fallback() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function page(pathname: string): ReactNode {
  switch (pathname) {
    case '/':
      return <Overview />
    case '/send':
      return <Send />
    case '/receive':
      return <Receive />
    case '/activity':
      return <Activity />
    case '/payment-links':
      return <PaymentLinks />
    case '/contacts':
      return <Contacts />
    case '/settings':
      return <Settings />
    default:
      return <NotFound />
  }
}

export default function App() {
  const { pathname } = useLocation()

  if (pathname === '/pay') {
    return (
      <Suspense fallback={null}>
        <Pay />
      </Suspense>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<Fallback />}>{page(pathname)}</Suspense>
    </AppShell>
  )
}
