import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isSupportedChainId } from '@/lib/networks'
import { pushNotification, settingsStore, txStore, upsertLocalTx } from '@/stores'
import { linksApi } from '@/api/links'
import type { LocalTx } from '@/domain/types'
import { CONFIRMATIONS, clientFor } from './client'
import { isUnresolvedPayment, recoverTransaction } from './transaction-recovery'
import { useSession } from './useSession'

const POLL_MS = 8000
const inFlight = new Map<string, Promise<void>>()

/** StrictMode, multiple mounted consumers and manual retries share a single read/registration attempt. */
export function retryTransaction(tx: LocalTx): Promise<void> {
  const key = `${tx.chainId}:${tx.from.toLowerCase()}:${tx.hash.toLowerCase()}`
  const running = inFlight.get(key)
  if (running) return running
  const run = (async () => {
    if (!isSupportedChainId(tx.chainId)) return
    const latest = () => txStore.get()[tx.from.toLowerCase()]?.find((row) => row.hash.toLowerCase() === tx.hash.toLowerCase()) ?? tx
    const start = latest()
    if (start.linkVerifiedAt) return
    const next = await recoverTransaction(start, { client: clientFor(tx.chainId), confirmations: CONFIRMATIONS, verifyPayment: linksApi.verifyPayment, now: Date.now })
    const current = latest()
    if (current.linkVerifiedAt && !next.linkVerifiedAt) return
    upsertLocalTx({ ...current, ...next, nonce: next.nonce ?? current.nonce, replacementHash: current.replacementHash ?? next.replacementHash })
    if (settingsStore.get().notifyOutgoing && start.status !== next.status) {
      if (next.status === 'completed' && (next.kind !== 'payment-link' || next.linkVerifiedAt)) {
        pushNotification({ title: 'Payment completed', body: 'The existing payment was confirmed and checked.', tone: 'success', href: `/activity?tx=${next.verifiedPaymentHash ?? next.hash}` })
      } else if (next.status === 'failed' && next.failureEvidence) {
        pushNotification({ title: 'Payment not completed', body: next.failureReason ?? 'The transaction could not complete.', tone: 'warning', href: `/activity?tx=${next.hash}` })
      }
    }
  })().finally(() => { inFlight.delete(key) })
  inFlight.set(key, run)
  return run
}

/** Recover all saved checkout payments, including completed-but-unregistered ones, without signing in. */
export function useTxReconciler() {
  const { address } = useSession()
  const queryClient = useQueryClient()
  useEffect(() => {
    let cancelled = false
    let ticking = false
    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        const records = Object.values(txStore.get()).flat()
        const pending = records.filter((tx) => isUnresolvedPayment(tx) ||
          (address && tx.from.toLowerCase() === address.toLowerCase() && tx.kind !== 'payment-link' &&
            (tx.status === 'pending' || (tx.status === 'failed' && !tx.failureEvidence && tx.failureReason === 'The network no longer has this transaction. It was dropped or replaced.'))))
        if (!pending.length) return
        await Promise.all(pending.map((tx) => retryTransaction(tx).catch(() => undefined)))
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: ['readContract'] })
          void queryClient.invalidateQueries({ queryKey: ['history'] })
          void queryClient.invalidateQueries({ queryKey: ['public-link'] })
          void queryClient.invalidateQueries({ queryKey: ['my-links'] })
        }
      } finally { ticking = false }
    }
    void tick()
    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [address, queryClient])
}
