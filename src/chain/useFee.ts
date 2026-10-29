import { useQuery } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import { Amount, formatUnitsFixed, gasTokenToUsdc } from '@/onchain-money'
import { ARC_MIN_MAX_FEE_PER_GAS, type Network } from '@/lib/networks'
import type { Address } from '@/domain/types'
import { clientFor } from './client'

export interface FeeEstimate {
  /** Gas units times the current gas price, in the network's gas token at its own decimals. */
  gasTokenRaw: bigint
  /** Where gas is USDC (Arc), the same fee in 6-decimal USDC, rounded up. */
  usdcRaw?: bigint
}

export function useFeeEstimate(params: { network: Network; from?: Address; to?: Address; amount?: bigint; enabled: boolean }) {
  const { network, from, to, amount, enabled } = params
  return useQuery({
    queryKey: ['fee', network.chainId, from, to, amount?.toString()],
    enabled: enabled && Boolean(from && to && amount && amount > 0n),
    retry: 1,
    staleTime: 15_000,
    queryFn: async (): Promise<FeeEstimate> => {
      if (!from || !to || !amount) throw new Error('Missing transfer details')
      const client = clientFor(network.chainId)
      const [gas, price] = await Promise.all([
        client.estimateContractGas({ address: network.usdcAddress, abi: erc20Abi, functionName: 'transfer', args: [to, amount], account: from }),
        client.getGasPrice(),
      ])
      // Arc rejects fees below its maxFeePerGas floor, so never estimate below it.
      const gasTokenRaw = gas * (price > ARC_MIN_MAX_FEE_PER_GAS ? price : ARC_MIN_MAX_FEE_PER_GAS)
      if (!network.isArc) return { gasTokenRaw }
      const truncated = gasTokenToUsdc(network.chainId, Amount.fromRaw(gasTokenRaw, network.gasDecimals), 'trunc')
      const roundedUp = truncated.toDecimals(network.gasDecimals).raw < gasTokenRaw ? truncated.raw + 1n : truncated.raw
      return { gasTokenRaw, usdcRaw: roundedUp }
    },
  })
}

export function formatGasFee(network: Network, raw: bigint): string {
  return `${formatUnitsFixed(raw, network.gasDecimals, 6)} ${network.gasSymbol}`
}
