import { arc } from 'viem/chains'
import { requireChain } from '@/onchain-facts'

/** Cooket runs on Arc Mainnet only. */
export const ARC_VIEM_CHAIN = arc
export type SupportedChainId = typeof arc.id

export interface Network {
  chainId: SupportedChainId
  name: string
  explorerBase: string
  rpcUrl: string
  usdcAddress: `0x${string}`
  usdcDecimals: number
  gasSymbol: string
  gasDecimals: number
  /** Gas is paid in USDC itself, so fees and balance share one pool. */
  isArc: boolean
}

/**
 * Arc enforces a floor on maxFeePerGas in the mempool (20 gwei, per Arc's EVM differences reference).
 * Fees below it are rejected, so every estimate and submission uses at least this value.
 */
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n

export { ARC_SYSTEM_EMITTER } from '@/shared/links'

function buildArc(): Network {
  const fact = requireChain(arc.id)
  if (!fact.usdc) throw new Error('Arc Mainnet has no USDC entry in Arc Studio onchain facts')
  return {
    chainId: arc.id,
    name: fact.name === 'Arc' ? 'Arc Mainnet' : fact.name,
    explorerBase: fact.explorerBase,
    rpcUrl: fact.rpcUrls[0],
    usdcAddress: fact.usdc.address as `0x${string}`,
    usdcDecimals: fact.usdc.decimals,
    gasSymbol: fact.nativeCurrency.symbol,
    gasDecimals: fact.nativeCurrency.decimals,
    isArc: fact.nativeCurrency.isUsdc,
  }
}

export const ARC_NETWORK: Network = buildArc()
export const NETWORKS: readonly Network[] = [ARC_NETWORK]

export function isSupportedChainId(id: number | undefined): id is SupportedChainId {
  return id === ARC_NETWORK.chainId
}

export function getNetwork(_id?: number): Network {
  return ARC_NETWORK
}

export const DEFAULT_CHAIN_ID: SupportedChainId = ARC_NETWORK.chainId
