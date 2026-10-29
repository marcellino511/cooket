import { useQuery } from '@tanstack/react-query'
import type { Network } from '@/lib/networks'
import type { Address } from '@/domain/types'
import { clientFor } from './client'

export interface RecipientCheck {
  isContract: boolean
  isUsdcContract: boolean
}

/** Inspects the recipient on the selected network: smart contracts may not be able to move received USDC. */
export function useRecipientCheck(network: Network, recipient?: Address) {
  return useQuery({
    queryKey: ['recipient-check', network.chainId, recipient],
    enabled: Boolean(recipient),
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<RecipientCheck> => {
      if (!recipient) throw new Error('No recipient')
      const code = await clientFor(network.chainId).getCode({ address: recipient })
      return {
        isContract: Boolean(code && code !== '0x'),
        isUsdcContract: recipient.toLowerCase() === network.usdcAddress.toLowerCase(),
      }
    },
  })
}
