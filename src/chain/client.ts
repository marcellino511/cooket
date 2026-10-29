import { getPublicClient } from 'wagmi/actions'
import type { PublicClient } from 'viem'
import { config } from '@/config'
import type { SupportedChainId } from '@/lib/networks'

/** Confirmation policy: a payment counts as completed once its receipt shows success with this many confirmations. */
export const CONFIRMATIONS = 1

/** One place where the wagmi client is narrowed to a plain viem PublicClient. */
export function clientFor(chainId: SupportedChainId): PublicClient {
  const client = getPublicClient(config, { chainId })
  if (!client) throw new Error(`No RPC client is configured for chain ${chainId}`)
  return client
}
