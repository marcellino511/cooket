import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ExternalAnchor } from '@/components/ui/misc'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { LocalTx } from '@/domain/types'

/** Unresolved attempts have no pay/approve action. Checking can only read and register the saved hash. */
export function RecoveryNotice({ tx, checking, onRetry }: { tx: LocalTx; checking: boolean; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-warning-50 p-4 text-center" aria-live="polite">
      <Clock className="mx-auto size-7 text-warning" aria-hidden />
      <p className="mt-2 font-semibold text-ink">Payment verification pending</p>
      <p className="mt-1 text-sm text-muted">{tx.recoveryMessage ?? 'We are checking your existing transaction and registering it with the merchant. Do not pay again.'}</p>
      <Button size="sm" className="mt-3" loading={checking} onClick={onRetry}>Check existing payment</Button>
      <ExternalAnchor href={buildTxExplorerUrl(tx.chainId, tx.replacementHash ?? tx.hash)} className="mt-3 text-sm">View transaction</ExternalAnchor>
    </div>
  )
}
