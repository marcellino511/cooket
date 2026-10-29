import { createStore, randomId } from '@/lib/store'
import type { AppNotification, Contact, LocalTx } from '@/domain/types'

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
    const exists = list.some((t) => t.hash === tx.hash)
    const next = exists ? list.map((t) => (t.hash === tx.hash ? { ...t, ...tx } : t)) : [tx, ...list]
    return { ...prev, [key]: next.slice(0, 200) }
  })
}

export function resetLocalData() {
  contactsStore.set([])
  txStore.set({})
  notificationsStore.set([])
}
