import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dedupe, fetchPage, pollLive, transferKey, type HistoryPage } from './history'
import { clientFor } from './client'
import { useSession } from './useSession'
import { pushNotification, settingsStore } from '@/stores'
import { formatUsdc } from '@/lib/format'
import type { ChainTransfer } from '@/domain/types'

function useLiveTransfers() {
  const { address, network, isConnected } = useSession()
  return useQuery({
    queryKey: ['live', network.chainId, address?.toLowerCase()],
    enabled: isConnected && Boolean(address),
    refetchInterval: 12_000,
    retry: 1,
    queryFn: () => {
      if (!address) throw new Error('No wallet')
      return pollLive(clientFor(network.chainId), network, address)
    },
  })
}

/** Raises a notification when a transfer arrives after the first poll for this wallet. Mount once. */
export function useIncomingWatcher() {
  const { address: account, network } = useSession()
  const liveQuery = useLiveTransfers()
  const seen = useRef<{ key: string; ids: Set<string> | null }>({ key: '', ids: null })
  useEffect(() => {
    if (!account || !liveQuery.data) return
    const key = `${network.chainId}:${account.toLowerCase()}`
    if (seen.current.key !== key || seen.current.ids === null) {
      seen.current = { key, ids: new Set(liveQuery.data.map(transferKey)) }
      return
    }
    for (const t of liveQuery.data) {
      const id = transferKey(t)
      if (seen.current.ids.has(id)) continue
      seen.current.ids.add(id)
      if (t.to.toLowerCase() === account.toLowerCase() && t.from.toLowerCase() !== account.toLowerCase() && settingsStore.get().notifyIncoming) {
        const body = `${formatUsdc(t.value)} USDC arrived on ${network.name}.`
        pushNotification({ title: 'Payment received', body, tone: 'success', href: `/activity?tx=${t.hash}` })
        toast.success('Payment received', { description: body })
      }
    }
  }, [liveQuery.data, account, network])
}

/**
 * Onchain USDC transfers for the connected wallet on Arc Mainnet.
 * History is read from Arc's USDC Transfer logs over RPC in bounded windows (older windows load on demand);
 * a separate poll keeps recent transfers fresh.
 */
export function useTransferHistory() {
  const { address: account, network, isConnected } = useSession()

  const history = useInfiniteQuery({
    queryKey: ['history', network.chainId, account?.toLowerCase()],
    enabled: isConnected && Boolean(account),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      if (!account) throw new Error('No wallet')
      return fetchPage(clientFor(network.chainId), network, account, pageParam ? BigInt(pageParam) : undefined)
    },
    getNextPageParam: (last) => last.nextTo,
  })

  const liveQuery = useLiveTransfers()

  const transfers = useMemo<ChainTransfer[]>(() => {
    const pages = history.data?.pages.flatMap((p) => p.items) ?? []
    const merged = dedupe([...pages, ...(liveQuery.data ?? [])])
    return merged.sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1))
  }, [history.data, liveQuery.data])

  const oldest = transfers.reduce<number | null>((min, t) => (t.timestamp !== null && (min === null || t.timestamp < min) ? t.timestamp : min), null)

  return {
    transfers,
    isLoading: history.isLoading,
    isError: history.isError,
    isFetchingMore: history.isFetchingNextPage,
    hasMore: Boolean(history.hasNextPage),
    loadMore: () => void history.fetchNextPage(),
    refetch: () => {
      void history.refetch()
      void liveQuery.refetch()
    },
    oldestTimestamp: oldest,
  }
}
