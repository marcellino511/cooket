/**
 * wagmi configuration, driven by Privy.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http } from 'wagmi'
import { createConfig } from '@privy-io/wagmi'
import { registerChain } from './tracing'
import { ARC_NETWORK, ARC_VIEM_CHAIN } from './lib/networks'

registerChain(ARC_NETWORK.chainId, ARC_NETWORK.rpcUrl)

export const config = createConfig({
  chains: [ARC_VIEM_CHAIN],
  transports: {
    [ARC_VIEM_CHAIN.id]: http(ARC_NETWORK.rpcUrl),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
