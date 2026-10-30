export type Address = `0x${string}`
export type Hex = `0x${string}`

export type TxStatus = 'pending' | 'completed' | 'failed'
export type Direction = 'sent' | 'received'
export type ActivityKind = 'transfer' | 'payment-link'
export type ActivitySource = 'local' | 'chain'

/** A transfer Cooket submitted from this browser. Amounts are raw USDC units stored as decimal strings. */
export interface LocalTx {
  hash: Hex
  chainId: number
  from: Address
  to: Address
  amountRaw: string
  note?: string
  kind: ActivityKind
  linkId?: string
  status: TxStatus
  submittedAt: number
  confirmedAt?: number
  blockNumber?: string
  failureReason?: string
  /** Recovery metadata. Absence of a receipt or an RPC error is never failure evidence. */
  nonce?: number
  replacementHash?: Hex
  failureEvidence?: 'reverted' | 'cancelled'
  linkVerifiedAt?: number
  verifiedPaymentHash?: Hex
  recoveryMessage?: string
}

/** A USDC Transfer event read from the chain or the explorer. */
export interface ChainTransfer {
  hash: Hex
  logIndex: number
  chainId: number
  from: Address
  to: Address
  value: bigint
  blockNumber: bigint
  /** Milliseconds since epoch, when known. */
  timestamp: number | null
}

export interface ActivityItem {
  id: string
  hash?: Hex
  chainId: number
  direction: Direction
  amount: bigint
  counterparty?: Address
  counterpartyName?: string
  status: TxStatus
  timestamp: number | null
  submittedAt?: number
  blockNumber?: bigint
  note?: string
  kind: ActivityKind
  linkId?: string
  source: ActivitySource
  failureReason?: string
}

export interface Contact {
  id: string
  name: string
  address: Address
  note?: string
  createdAt: number
}

export interface AppNotification {
  id: string
  ts: number
  title: string
  body: string
  tone: 'success' | 'warning' | 'danger' | 'info'
  href?: string
  read: boolean
}
