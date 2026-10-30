import { createStore, randomId } from '@/lib/store'
import type { AppNotification, Contact, LocalTx } from '@/domain/types'
import { isUnresolvedPayment } from '@/chain/transaction-recovery'

export type DisplayCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'CHF' | 'JPY'
export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']

export interface Settings {
  displayName: string
  businessName: string
  currency: DisplayCurrency
  hideBalance: boolean
  notifyIncoming: boolean
  notifyOutgoing: boolean
  /** Extra confirmation is required at or above this USDC amount. Empty disables it. */
  largeTransferThreshold: string
  warnNewRecipients: boolean
}

export const settingsStore = createStore<Settings>('settings', {
  displayName: '',
  businessName: '',
  currency: 'USD',
  hideBalance: false,
  notifyIncoming: true,
  notifyOutgoing: true,
  largeTransferThreshold: '1000',
  warnNewRecipients: true,
})

export const contactsStore = createStore<Contact[]>('contacts', [])

/** Local transactions keyed by lowercase sender address. */
export const txStore = createStore<Record<string, LocalTx[]>>('transactions', {})

export const notificationsStore = createStore<AppNotification[]>('notifications', [])

export function pushNotification(n: Omit<AppNotification, 'id' | 'ts' | 'read'>) {
  notificationsStore.set((prev) => [{ ...n, id: randomId(), ts: Date.now(), read: false }, ...prev].slice(0, 30))
}

export function upsertLocalTx(tx: LocalTx) {
  const key = tx.from.toLowerCase()
  txStore.set((prev) => {
    const list = prev[key] ?? []
    const exists = list.some((t) => t.hash.toLowerCase() === tx.hash.toLowerCase())
    const next = exists ? list.map((t) => {
      if (t.hash.toLowerCase() !== tx.hash.toLowerCase()) return t
      const merged = { ...t, ...tx }
      // A slower receipt waiter must not downgrade an acknowledged merchant payment.
      return t.linkVerifiedAt ? { ...merged, status: 'completed' as const, linkVerifiedAt: t.linkVerifiedAt,
        verifiedPaymentHash: t.verifiedPaymentHash, failureEvidence: undefined, failureReason: undefined, recoveryMessage: undefined } : merged
    }) : [tx, ...list]
    // History limits must never evict a payment that still needs merchant verification.
    // Keep a newly acknowledged old payment long enough to survive cache refresh/reload.
    const updated = next.find((row) => row.hash.toLowerCase() === tx.hash.toLowerCase())
    const ordered = tx.kind === 'payment-link' && updated ? [updated, ...next.filter((row) => row !== updated)] : next
    const retained = ordered.slice(0, 200)
    return { ...prev, [key]: [...retained, ...ordered.slice(200).filter(isUnresolvedPayment)] }
  })
}

export function resetLocalData() {
  contactsStore.set([])
  txStore.set({})
  notificationsStore.set([])
}
