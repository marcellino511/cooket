import { requireChain } from '../src/onchain-facts'

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
    : chain.rpcUrls[0]

export const DATA_FILE = process.env.COOKET_DATA_FILE ?? new URL('./data/db.json', import.meta.url).pathname
