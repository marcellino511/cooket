import { cn } from '@/lib/cn'
import { useFx } from '@/lib/fx'
import { formatFiat, formatUsdc } from '@/lib/format'
import { settingsStore } from '@/stores'

export const MASK = '••••••'

/** Whether balances should currently be masked. */
export function useHidden(): boolean {
  return settingsStore.use().hideBalance
}

export function UsdcAmount({ raw, hidden, digits = 2, className, sign }: { raw: bigint; hidden?: boolean; digits?: number; className?: string; sign?: '+' | '-' }) {
  return (
    <span className={cn('num', className)}>
      {hidden ? MASK : `${sign ?? ''}${formatUsdc(raw, digits)}`}
    </span>
  )
}

/** A fiat estimate for a USDC amount. Always marked with ≈ because it is an estimate. */
export function FiatEstimate({ raw, hidden, className }: { raw: bigint; hidden?: boolean; className?: string }) {
  const fx = useFx()
  return <span className={cn('num', className)}>{hidden ? MASK : `≈ ${formatFiat(raw, fx.currency, fx.rate)}`}</span>
}
