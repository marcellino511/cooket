import { DefinitionRow, Address, Skeleton } from '@/components/ui/misc'
import { formatUsdcPrecise } from '@/lib/format'
import { formatGasFee } from '@/chain/useFee'
import type { SendFlow } from './useSendFlow'

export function FeeValue({ flow }: { flow: SendFlow }) {
  const { fee, session } = flow
  const { network } = session
  if (fee.isLoading) return <Skeleton className="ml-auto h-4 w-24" />
  if (!fee.data) return <span className="text-muted">Unavailable</span>
  if (network.isArc && fee.data.usdcRaw !== undefined) return <span className="num">≈ {formatUsdcPrecise(fee.data.usdcRaw)} USDC</span>
  return <span className="num">≈ {formatGasFee(network, fee.data.gasTokenRaw)}</span>
}

export function TotalValue({ flow }: { flow: SendFlow }) {
  const { amount, fee, session } = flow
  const { network } = session
  if (!amount.value) return <span>—</span>
  if (network.isArc) {
    if (fee.data?.usdcRaw === undefined) return <span className="num">{formatUsdcPrecise(amount.value.raw)} USDC + network fee</span>
    return <span className="num">≈ {formatUsdcPrecise(amount.value.raw + fee.data.usdcRaw)} USDC</span>
  }
  return (
    <span className="num">
      {formatUsdcPrecise(amount.value.raw)} USDC
      {fee.data && <span className="block text-xs font-normal text-muted">plus ≈ {formatGasFee(network, fee.data.gasTokenRaw)} for gas</span>}
    </span>
  )
}

export function SummaryRows({ flow }: { flow: SendFlow }) {
  const { recipient, contact, amount, session, note, fee } = flow
  const { network } = session
  return (
    <dl className="divide-y divide-line rounded-xl border border-line px-4">
      <DefinitionRow label="Recipient">
        <span className="block">
          {contact && <span className="block">{contact.name}</span>}
          {recipient && <Address value={recipient} full className="text-xs" />}
        </span>
      </DefinitionRow>
      <DefinitionRow label="Amount">
        <span className="num text-base font-semibold">{amount.value ? formatUsdcPrecise(amount.value.raw) : '—'} USDC</span>
      </DefinitionRow>
      <DefinitionRow label="Network">{network.name}</DefinitionRow>
      <DefinitionRow label="Estimated network fee" hint={fee.data ? 'Estimate, not final' : undefined}>
        <FeeValue flow={flow} />
      </DefinitionRow>
      <DefinitionRow label="Total">
        <span className="text-base font-semibold">
          <TotalValue flow={flow} />
        </span>
      </DefinitionRow>
      {note.trim() && <DefinitionRow label="Note">{note.trim()}</DefinitionRow>}
    </dl>
  )
}
