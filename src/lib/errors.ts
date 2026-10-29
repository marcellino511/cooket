export type TxErrorKind = 'rejected' | 'insufficient' | 'reverted' | 'network' | 'unknown'

export interface ParsedTxError {
  kind: TxErrorKind
  title: string
  detail: string
  recovery: string
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { shortMessage?: unknown; message?: unknown }
    if (typeof e.shortMessage === 'string') return e.shortMessage
    if (typeof e.message === 'string') return e.message
  }
  return typeof error === 'string' ? error : ''
}

function codeOf(error: unknown): number | undefined {
  let cursor: unknown = error
  for (let i = 0; i < 4 && cursor && typeof cursor === 'object'; i++) {
    const c = (cursor as { code?: unknown }).code
    if (typeof c === 'number') return c
    cursor = (cursor as { cause?: unknown }).cause
  }
  return undefined
}

/** Turns a wallet or RPC error into copy a person can act on. Never exposes raw error text. */
export function parseTxError(error: unknown): ParsedTxError {
  const raw = messageOf(error).toLowerCase()
  const code = codeOf(error)

  if (code === 4001 || raw.includes('user rejected') || raw.includes('user denied') || raw.includes('rejected the request')) {
    return {
      kind: 'rejected',
      title: 'Request cancelled',
      detail: 'You declined the request in your wallet. Nothing was sent and no funds moved.',
      recovery: 'Review the payment and try again when you are ready.',
    }
  }
  if (raw.includes('chain mismatch') || raw.includes('does not match the target chain') || raw.includes('wrong chain')) {
    return {
      kind: 'network',
      title: 'Wallet is on the wrong network',
      detail: 'Your wallet is not on Arc Mainnet, so the payment was not sent.',
      recovery: 'Switch your wallet to Arc Mainnet when prompted, then try again.',
    }
  }
  if (raw.includes('insufficient funds') || raw.includes('exceeds balance') || raw.includes('transfer amount exceeds')) {
    return {
      kind: 'insufficient',
      title: 'Not enough funds',
      detail: 'Your wallet does not hold enough to cover the amount and the network fee.',
      recovery: 'Add funds or lower the amount, then try again.',
    }
  }
  if (raw.includes('reverted') || raw.includes('execution reverted')) {
    return {
      kind: 'reverted',
      title: 'The network rejected this transfer',
      detail: 'The transaction was reverted, so no USDC moved.',
      recovery: 'Check the recipient and amount, then try again.',
    }
  }
  if (raw.includes('network') || raw.includes('timeout') || raw.includes('timed out') || raw.includes('fetch') || raw.includes('http request failed')) {
    return {
      kind: 'network',
      title: 'Network problem',
      detail: 'We could not reach the network. If you already signed, the payment may still go through.',
      recovery: 'Check your connection, then look at Activity before retrying to avoid paying twice.',
    }
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: 'The payment could not be completed.',
    recovery: 'Try again. If it keeps failing, check Activity before retrying to avoid paying twice.',
  }
}
