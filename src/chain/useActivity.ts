import { useMemo } from 'react'
import { useMyLinks } from '@/api/links'
import { buildActivity, computeStats } from '@/domain/activity'
import { contactsStore, txStore } from '@/stores'
import { useSession } from './useSession'
import { useTransferHistory } from './useTransferHistory'

/** The activity feed: transfers Cooket submitted merged with verified onchain USDC transfers for the connected wallet. */
export function useActivity() {
  const { address, network } = useSession()
  const history = useTransferHistory()
  const contacts = contactsStore.use()
  const txs = txStore.use()
  const links = useMyLinks()
  const key = address?.toLowerCase() ?? ''
  const localAll = key ? txs[key] : undefined

  const linkByHash = useMemo(() => {
    const map = new Map<string, { id: string; description: string }>()
    for (const link of links.data ?? []) {
      for (const p of link.payments) map.set(p.txHash.toLowerCase(), { id: link.id, description: link.description })
    }
    return map
  }, [links.data])

  const items = useMemo(() => {
    if (!address) return []
    const local = (localAll ?? []).filter((t) => t.chainId === network.chainId)
    return buildActivity({ account: address, local, transfers: history.transfers, contacts, linkByHash })
  }, [address, network.chainId, localAll, history.transfers, contacts, linkByHash])

  const stats = useMemo(() => computeStats(items), [items])
  return { items, stats, history }
}
