import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ExternalLink } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Address, CopyButton, DefinitionRow, Notice, Skeleton, copyText } from '@/components/ui/misc'
import { UsdcAmount } from '@/components/common/Money'
import { clientFor } from '@/chain/client'
import { formatGasFee } from '@/chain/useFee'
import { useSession } from '@/chain/useSession'
import { formatDateTime } from '@/lib/format'
import { formatUsdcPrecise } from '@/lib/format'
import { getNetwork, isSupportedChainId } from '@/lib/networks'
import { navigate } from '@/lib/router'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import type { ActivityItem } from '@/domain/types'
import { counterpartyLabel, typeLabel } from './parts'

function useOnchainDetails(item: ActivityItem | null) {
  return useQuery({
    queryKey: ['tx-details', item?.chainId, item?.hash],
    enabled: Boolean(item?.hash) && isSupportedChainId(item?.chainId),
    retry: 1,
    refetchInterval: (query) => (query.state.data && query.state.data.receipt ? false : 8000),
    queryFn: async () => {
      if (!item?.hash || !isSupportedChainId(item.chainId)) throw new Error('No transaction')
      const client = clientFor(item.chainId)
      const receipt = await client.getTransactionReceipt({ hash: item.hash }).catch(() => null)
      if (!receipt) return { receipt: null, confirmations: 0n, blockTime: null as number | null, feeRaw: null as bigint | null }
      const [head, block] = await Promise.all([client.getBlockNumber(), client.getBlock({ blockNumber: receipt.blockNumber })])
      return {
        receipt,
        confirmations: head - receipt.blockNumber + 1n,
        blockTime: Number(block.timestamp) * 1000,
        feeRaw: receipt.gasUsed * receipt.effectiveGasPrice,
      }
    },
  })
}

export function TxDetailsDrawer({ item, onClose }: { item: ActivityItem | null; onClose: () => void }) {
  const { address } = useSession()
  const details = useOnchainDetails(item)
  const network = getNetwork(item?.chainId)

  const from = item ? (item.direction === 'sent' ? address : item.counterparty) : undefined
  const to = item ? (item.direction === 'sent' ? item.counterparty : address) : undefined

  const summary = item
    ? [
        `Cooket transaction details`,
        `Type: ${typeLabel(item)}`,
        `Status: ${item.status}`,
        `Amount: ${formatUsdcPrecise(item.amount)} USDC`,
        `From: ${from ?? 'n/a'}`,
        `To: ${to ?? 'n/a'}`,
        `Network: ${network.name}`,
        item.hash ? `Transaction hash: ${item.hash}` : 'Transaction hash: unavailable',
        item.hash ? `Explorer: ${buildTxExplorerUrl(item.chainId, item.hash)}` : '',
        item.note ? `Note: ${item.note}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const receipt = details.data?.receipt

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      variant="drawer"
      title="Transaction details"
      description={item ? `${typeLabel(item)} · ${counterpartyLabel(item)}` : undefined}
      footer={
        item && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {item.hash && (
              <a
                href={buildTxExplorerUrl(item.chainId, item.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-medium text-canvas hover:bg-brand-hover"
              >
                View on explorer <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
            <Button full onClick={() => void copyText(summary, 'Transaction details copied')}>
              Copy details
            </Button>
          </div>
        )
      }
    >
      {item && (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted">{item.direction === 'sent' ? 'You sent' : 'You received'}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
                <UsdcAmount raw={item.amount} digits={2} /> <span className="text-lg font-medium text-muted">USDC</span>
              </p>
              <p className="num mt-1 text-xs text-muted">Exact: {formatUsdcPrecise(item.amount)} USDC</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          <div className="mt-5 space-y-3">
            {item.status === 'pending' && (
              <Notice tone="warning" title="Waiting for confirmation">
                Amount and recipient come from the transaction you submitted. They are not confirmed until the network includes it in a block.
              </Notice>
            )}
            {item.status === 'failed' && (
              <Notice tone="danger" title="This payment did not go through">
                {item.failureReason ?? 'The transaction failed.'} No USDC moved.
              </Notice>
            )}
          </div>

          <dl className="mt-4 divide-y divide-line">
            <DefinitionRow label="Status">
              <StatusBadge status={item.status} />
            </DefinitionRow>
            <DefinitionRow label="Token">USDC</DefinitionRow>
            <DefinitionRow label="From">{from ? <span className="inline-flex items-center gap-1"><Address value={from} /><CopyButton value={from} label="Copy sender address" iconOnly /></span> : '—'}</DefinitionRow>
            <DefinitionRow label="To">{to ? <span className="inline-flex items-center gap-1"><Address value={to} /><CopyButton value={to} label="Copy recipient address" iconOnly /></span> : '—'}</DefinitionRow>
            <DefinitionRow label="Network">{network.name}</DefinitionRow>
            <DefinitionRow label="Transaction hash">
              {item.hash ? (
                <span className="inline-flex items-center gap-1">
                  <Address value={item.hash} />
                  <CopyButton value={item.hash} label="Copy transaction hash" iconOnly />
                </span>
              ) : (
                <span className="text-muted">Unavailable</span>
              )}
            </DefinitionRow>
            {item.submittedAt && <DefinitionRow label="Submitted">{formatDateTime(item.submittedAt)}</DefinitionRow>}
            {item.note && <DefinitionRow label="Note">{item.note}</DefinitionRow>}
          </dl>

          {item.hash && (
            <section className="mt-5 rounded-xl border border-line bg-slate-50 p-4" aria-label="Confirmed blockchain data">
              <h3 className="text-sm font-semibold text-ink">Confirmed blockchain data</h3>
              <p className="mt-0.5 text-xs text-muted">Read directly from {network.name}. Anything not shown here is not yet confirmed.</p>
              {details.isLoading ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : details.isError ? (
                <p className="mt-3 text-sm text-danger">Could not load onchain data right now. Try the explorer link below.</p>
              ) : receipt ? (
                <dl className="mt-1 divide-y divide-line">
                  <DefinitionRow label="Block">{receipt.blockNumber.toLocaleString('en-US')}</DefinitionRow>
                  <DefinitionRow label="Block time">{details.data?.blockTime ? formatDateTime(details.data.blockTime) : '—'}</DefinitionRow>
                  <DefinitionRow label="Confirmations">{(details.data?.confirmations ?? 0n).toLocaleString('en-US')}</DefinitionRow>
                  <DefinitionRow label="Network fee" hint={network.isArc ? 'Paid in USDC' : undefined}>
                    {details.data?.feeRaw != null ? formatGasFee(network, details.data.feeRaw) : '—'}
                  </DefinitionRow>
                  <DefinitionRow label="Result">{receipt.status === 'success' ? 'Succeeded' : 'Reverted'}</DefinitionRow>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted">No receipt yet. This page checks again every few seconds.</p>
              )}
            </section>
          )}

          {item.direction === 'sent' && item.counterparty && (
            <Button
              className="mt-5"
              variant="ghost"
              icon={<ArrowUpRight className="size-4" aria-hidden />}
              onClick={() => {
                onClose()
                navigate(`/send?to=${item.counterparty}`)
              }}
            >
              Send to {counterpartyLabel(item)} again
            </Button>
          )}
          {from && item.direction === 'received' && (
            <p className="mt-4 text-xs text-muted">
              Sender on explorer:{' '}
              <a className="font-medium text-brand" target="_blank" rel="noopener noreferrer" href={buildAddressExplorerUrl(item.chainId, from)}>
                open
              </a>
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
