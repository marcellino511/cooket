import { Eye, EyeOff, ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/misc'
import { FiatEstimate, UsdcAmount } from '@/components/common/Money'
import { useSession, useUsdcBalance } from '@/chain/useSession'
import { navigate } from '@/lib/router'
import { settingsStore, txStore } from '@/stores'
import { useFx } from '@/lib/fx'

export function BalanceCard() {
  const { address, network } = useSession()
  const balance = useUsdcBalance()
  const { hideBalance } = settingsStore.use()
  const txs = txStore.use()
  const fx = useFx()

  const pendingOut = useMemo(() => {
    const list = address ? (txs[address.toLowerCase()] ?? []) : []
    return list.filter((t) => t.status === 'pending' && t.chainId === network.chainId).reduce((sum, t) => sum + BigInt(t.amountRaw), 0n)
  }, [address, txs, network.chainId])

  const total = balance.raw
  const available = total !== undefined ? (total > pendingOut ? total - pendingOut : 0n) : undefined
  const loading = balance.isLoading

  return (
    <Card className="p-5 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-muted">Total USDC balance</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Refresh balance" onClick={() => void balance.refetch()}>
            <RefreshCw className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={hideBalance ? 'Show balance' : 'Hide balance'} aria-pressed={hideBalance} onClick={() => settingsStore.set((s) => ({ ...s, hideBalance: !s.hideBalance }))}>
            {hideBalance ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </IconButton>
        </div>
      </div>

      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-11 w-56" />
        ) : balance.isError ? (
          <p className="text-sm text-danger">
            Could not load your balance.{' '}
            <button type="button" className="font-medium underline" onClick={() => void balance.refetch()}>
              Try again
            </button>
          </p>
        ) : total !== undefined ? (
          <p className="flex flex-wrap items-baseline gap-x-2 text-ink">
            <UsdcAmount raw={total} hidden={hideBalance} className="text-4xl font-semibold tracking-tight sm:text-5xl" />
            <span className="text-lg font-medium text-muted">USDC</span>
          </p>
        ) : (
          <p className="text-4xl font-semibold tracking-tight text-slate-300">—</p>
        )}
        <p className="mt-1.5 text-sm text-muted">
          {total !== undefined ? <FiatEstimate raw={total} hidden={hideBalance} /> : null}
          {total !== undefined && <span className="ml-1.5 text-xs">estimated in {fx.currency}, assuming 1 USDC = 1 USD</span>}
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5">
        <div>
          <dt className="text-xs text-muted">Available to send</dt>
          <dd className="mt-1 text-base font-semibold text-ink">
            {available !== undefined ? <UsdcAmount raw={available} hidden={hideBalance} /> : '—'} <span className="text-sm font-medium text-muted">USDC</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pending outgoing</dt>
          <dd className="mt-1 text-base font-semibold text-ink">
            <UsdcAmount raw={pendingOut} hidden={hideBalance} /> <span className="text-sm font-medium text-muted">USDC</span>
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" size="lg" icon={<ArrowUpRight className="size-5" aria-hidden />} onClick={() => navigate('/send')} className="sm:min-w-40">
          Send
        </Button>
        <Button size="lg" icon={<ArrowDownLeft className="size-5" aria-hidden />} onClick={() => navigate('/receive')} className="sm:min-w-40">
          Receive
        </Button>
        <p className="self-center text-xs text-muted sm:ml-auto">USDC on {network.name}</p>
      </div>
    </Card>
  )
}
