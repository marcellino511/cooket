import { useAccount, useBalance, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { usePrivy } from '@privy-io/react-auth'
import { ARC_NETWORK, type Network } from '@/lib/networks'
import type { Address } from '@/domain/types'

export interface Session {
  address?: Address
  /** A wallet is connected through Privy and exposed to wagmi. */
  isConnected: boolean
  isConnecting: boolean
  /** Privy has finished initialising. */
  ready: boolean
  /** The user is signed in with Privy (a wallet may still be loading). */
  authenticated: boolean
  /** Cooket only runs on Arc Mainnet. */
  network: Network
  walletChainId?: number
  /** The connected wallet is not on Arc Mainnet. Cooket never switches networks without an explicit click. */
  wrongNetwork: boolean
  unsupportedWalletNetwork: boolean
}

export function useSession(): Session {
  const { ready, authenticated } = usePrivy()
  const { address, isConnected, isConnecting, isReconnecting, chainId } = useAccount()
  const wrong = isConnected && chainId !== ARC_NETWORK.chainId
  return {
    address,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    ready,
    authenticated,
    network: ARC_NETWORK,
    walletChainId: chainId,
    wrongNetwork: wrong,
    unsupportedWalletNetwork: wrong,
  }
}

export function useUsdcBalance(networkOverride?: Network) {
  const session = useSession()
  const { address } = session
  const network = networkOverride ?? session.network
  const query = useReadContract({
    address: network.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  })
  return { raw: query.data, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch }
}

/** Native gas balance. Only meaningful where gas is not USDC; on Arc the USDC balance already is the gas balance. */
export function useGasBalance(networkOverride?: Network) {
  const session = useSession()
  const { address } = session
  const network = networkOverride ?? session.network
  const query = useBalance({
    address,
    chainId: network.chainId,
    query: { enabled: Boolean(address) && !network.isArc, refetchInterval: 15_000 },
  })
  return { raw: query.data?.value, isLoading: query.isLoading }
}
