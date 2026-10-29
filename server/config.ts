import { requireChain } from '../src/onchain-facts'
import { parseRouterAddress } from '../src/shared/router'

/** The payment link server verifies Arc Mainnet only. */
export const CHAIN_ID = 5042
const chain = requireChain(CHAIN_ID)
if (!chain.usdc) throw new Error('Arc Mainnet has no USDC entry in the onchain facts registry')

export const USDC_ADDRESS = chain.usdc.address as `0x${string}`
export const USDC_DECIMALS = chain.usdc.decimals
export const GAS_DECIMALS = chain.nativeCurrency.decimals

export const PORT = Number(process.env.PORT ?? 3001)
export const PRIVY_APP_ID = process.env.VITE_PRIVY_APP_ID ?? ''

// Prefer the sandbox RPC proxy when it covers Arc; otherwise use the public endpoint from the facts registry.
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
export const RPC_URL =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`
    : (process.env.ARC_RPC_URL || chain.rpcUrls[0])

export const DATA_FILE = process.env.COOKET_DATA_FILE ?? new URL('./data/db.json', import.meta.url).pathname

/**
 * The deployed CooketPayRouter. One public key shared with the browser (VITE_ prefix); an address is public data.
 * When unset, new links use direct USDC transfers exactly as before the router existed.
 */
export const ROUTER_ADDRESS = parseRouterAddress(process.env.VITE_COOKET_ROUTER_ADDRESS)

/** Durable storage for payment links. Server-only secrets: never give these a VITE_ prefix. */
export const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
/** On Vercel the filesystem is ephemeral, so the JSON file store must never be used there. */
export const ON_VERCEL = Boolean(process.env.VERCEL)
