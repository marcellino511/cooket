/**
 * Types and rules shared by the browser and the payment link server.
 * Keep this file free of browser and server specific imports.
 */

export const LINK_CHAIN_ID = 5042
/** The USDC system emitter. Every explicit USDC movement (native sends and ERC-20 transfers) logs a Transfer here at 18 decimals. */
export const ARC_SYSTEM_EMITTER = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE' as const
export const MAX_DESCRIPTION = 140
export const MAX_MERCHANT = 60
/** The merchant's creation signature must be this fresh. */
export const SIGNATURE_MAX_AGE_MS = 10 * 60_000

export type LinkMode = 'fixed' | 'open'
export type LinkStatus = 'open' | 'paid' | 'expired' | 'inactive'

export interface LinkPayment {
  txHash: `0x${string}`
  logIndex: number
  payer: `0x${string}`
  /** Raw 6-decimal USDC units, as a decimal string. */
  amountRaw: string
  blockNumber: string
  /** Block timestamp in ms. */
  paidAt: number
  verifiedAt: number
}

/** What a payer is allowed to see. */
export interface PublicLink {
  id: string
  recipient: `0x${string}`
  chainId: number
  description: string
  merchant?: string
  mode: LinkMode
  amountRaw?: string
  expiresAt?: number
  createdAt: number
  status: LinkStatus
}

/** What the merchant sees: the public view plus verified payments. */
export interface MerchantLink extends PublicLink {
  payments: LinkPayment[]
}

export interface CreateLinkInput {
  recipient: `0x${string}`
  description: string
  merchant?: string
  mode: LinkMode
  /** Decimal USDC amount such as "25.5". Required for fixed links. */
  amount?: string
  expiresAt?: number
  issuedAt: number
  nonce: string
}

/** The exact text the merchant's wallet signs. The server rebuilds it from the request and verifies the signature. */
export function buildCreateMessage(input: CreateLinkInput, usdcAddress: string): string {
  return [
    'Cooket payment link',
    `Recipient: ${input.recipient}`,
    `Network: Arc Mainnet (${LINK_CHAIN_ID})`,
    `Token: USDC ${usdcAddress}`,
    `Mode: ${input.mode}`,
    `Amount: ${input.mode === 'fixed' ? (input.amount ?? '') : 'payer chooses'}`,
    `Description: ${input.description}`,
    `Merchant: ${input.merchant ?? ''}`,
    `Expires: ${input.expiresAt ? new Date(input.expiresAt).toISOString() : 'never'}`,
    `Issued: ${new Date(input.issuedAt).toISOString()}`,
    `Nonce: ${input.nonce}`,
  ].join('\n')
}

/** Display status for a link. Expiry is derived from the clock; the server stores the rest. */
export function deriveStatus(link: { mode: LinkMode; expiresAt?: number; inactive?: boolean }, paymentCount: number, now: number): LinkStatus {
  if (link.inactive) return 'inactive'
  if (link.mode === 'fixed' && paymentCount > 0) return 'paid'
  if (link.expiresAt && now > link.expiresAt) return 'expired'
  return 'open'
}
