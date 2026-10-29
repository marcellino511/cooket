import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isSupportedChainId } from '@/lib/networks'
import { pushNotification, settingsStore, txStore, upsertLocalTx } from '@/stores'
import { formatUsdc } from '@/lib/format'
import type { LocalTx } from '@/domain/types'
import { CONFIRMATIONS, clientFor } from './client'
import { useSession } from './useSession'

const POLL_MS = 8000
const DROPPED_AFTER_MS = 15 * 60_000

async function reconcile(tx: LocalTx): Promise<boolean> {
  if (!isSupportedChainId(tx.chainId)) return false
  const client = clientFor(tx.chainId)
  const notify = settingsStore.get().notifyOutgoing
  const amountText = `${formatUsdc(BigInt(tx.amountRaw))} USDC`

  try {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash })
    const head = await client.getBlockNumber()
    if (head - receipt.blockNumber + 1n < BigInt(CONFIRMATIONS)) return false
    if (receipt.status === 'success') {
      upsertLocalTx({ ...tx, status: 'completed', confirmedAt: Date.now(), blockNumber: receipt.blockNumber.toString() })
      if (notify) pushNotification({ title: 'Payment completed', body: `${amountText} was confirmed.`, tone: 'success', href: `/activity?tx=${tx.hash}` })
    } else {
      upsertLocalTx({ ...tx, status: 'failed', failureReason: 'The transaction was reverted onchain.' })
      if (notify) pushNotification({ title: 'Payment failed', body: `${amountText} was not sent. The transaction reverted.`, tone: 'danger', href: `/activity?tx=${tx.hash}` })
    }
    return true
  } catch {
    // No receipt yet. If the network has forgotten the transaction for a long time, mark it dropped.
    if (Date.now() - tx.submittedAt < DROPPED_AFTER_MS) return false
    try {
      await client.getTransaction({ hash: tx.hash })
      return false
    } catch {
      upsertLocalTx({ ...tx, status: 'failed', failureReason: 'The network no longer has this transaction. It was dropped or replaced.' })
      if (notify) pushNotification({ title: 'Payment dropped', body: `${amountText} was never confirmed and the transaction is gone.`, tone: 'warning', href: `/activity?tx=${tx.hash}` })
      return true
    }
  }
}

/** Keeps locally recorded pending transfers honest: resolves them from receipts, even after a reload. */
export function useTxReconciler() {
  const { address } = useSession()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!address) return
    let cancelled = false
    const key = address.toLowerCase()

    const tick = async () => {
      const pending = (txStore.get()[key] ?? []).filter((t) => t.status === 'pending')
      if (pending.length === 0) return
      const results = await Promise.all(pending.map((t) => reconcile(t).catch(() => false)))
      if (!cancelled && results.some(Boolean)) {
        void queryClient.invalidateQueries({ queryKey: ['readContract'] })
        void queryClient.invalidateQueries({ queryKey: ['history'] })
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [address, queryClient])
}
