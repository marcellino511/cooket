import { useQuery } from '@tanstack/react-query'
import { DISPLAY_CURRENCIES, settingsStore, type DisplayCurrency } from '@/stores'

const FX_URL = 'https://api.frankfurter.dev/v1/latest'

async function fetchRates(): Promise<Record<string, number>> {
  const symbols = DISPLAY_CURRENCIES.filter((c) => c !== 'USD').join(',')
  const response = await fetch(`${FX_URL}?base=USD&symbols=${symbols}`)
  if (!response.ok) throw new Error(`Rate service responded with ${response.status}`)
  const json = (await response.json()) as { rates?: Record<string, number> }
  if (!json.rates) throw new Error('Unexpected rate response')
  return json.rates
}

export interface FxState {
  /** The currency actually used for display. Falls back to USD when a rate is unavailable. */
  currency: DisplayCurrency
  requested: DisplayCurrency
  rate: number
  isFallback: boolean
}

/**
 * Fiat estimates assume 1 USDC = 1 USD, then apply a public reference rate for other currencies.
 * Both are estimates, never settlement values.
 */
export function useFx(): FxState {
  const { currency: requested } = settingsStore.use()
  const query = useQuery({ queryKey: ['fx'], queryFn: fetchRates, staleTime: 60 * 60_000, retry: 1, enabled: requested !== 'USD' })
  if (requested === 'USD') return { currency: 'USD', requested, rate: 1, isFallback: false }
  const rate = query.data?.[requested]
  if (typeof rate === 'number' && rate > 0) return { currency: requested, requested, rate, isFallback: false }
  return { currency: 'USD', requested, rate: 1, isFallback: true }
}
