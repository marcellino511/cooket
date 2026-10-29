import { formatUnitsExact, formatUnitsFixed } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}…${address.slice(-tail)}`
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Display form with a fixed number of fraction digits (truncated, never rounded up). */
export function formatUsdc(raw: bigint, fractionDigits = 2): string {
  const fixed = formatUnitsFixed(raw, USDC_DECIMALS, fractionDigits)
  const negative = fixed.startsWith('-')
  const body = negative ? fixed.slice(1) : fixed
  const [whole, fraction] = body.split('.')
  return `${negative ? '-' : ''}${groupThousands(whole)}${fraction ? `.${fraction}` : ''}`
}

/** Full precision with at least two decimals, e.g. 12.50 or 0.000001. */
export function formatUsdcPrecise(raw: bigint): string {
  const exact = formatUnitsExact(raw, USDC_DECIMALS)
  const negative = exact.startsWith('-')
  const body = negative ? exact.slice(1) : exact
  const [whole, fraction = ''] = body.split('.')
  return `${negative ? '-' : ''}${groupThousands(whole)}.${fraction.padEnd(2, '0')}`
}

export function usdcToNumber(raw: bigint): number {
  return Number(formatUnitsExact(raw, USDC_DECIMALS))
}

export function formatFiat(raw: bigint, currency: string, rate: number): string {
  const value = usdcToNumber(raw) * rate
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const timeOnly = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export const formatDateTime = (ts: number) => dateTime.format(ts)
export const formatDate = (ts: number) => dateOnly.format(ts)
export const formatTime = (ts: number) => timeOnly.format(ts)

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(ts)
}

export function startOfMonth(now = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
