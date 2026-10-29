import { useBlockNumber, useSwitchChain } from 'wagmi'
import { cn } from '@/lib/cn'
import { useSession } from '@/chain/useSession'
import { Popover } from '@/components/ui/Popover'
import { Button } from '@/components/ui/Button'
import { Address, CopyButton, ExternalAnchor } from '@/components/ui/misc'
import { buildAddressExplorerUrl } from '@/onchain-facts'

export function NetworkStatus() {
  const { network, isConnected, wrongNetwork, walletChainId } = useSession()
  const { switchChain, isPending, error } = useSwitchChain()
  const block = useBlockNumber({ chainId: network.chainId, query: { refetchInterval: 15_000 } })

  const healthy = isConnected && !wrongNetwork
  const label = !isConnected ? 'Not connected' : wrongNetwork ? 'Wrong network' : network.name

  return (
    <Popover
      label={`Network status: ${label}`}
      align="right"
      triggerClassName="flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink shadow-card hover:bg-elevated md:h-10"
      trigger={
        <>
          <span className={cn('size-2 rounded-full', healthy ? 'bg-success' : 'bg-warning')} />
          <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
        </>
      }
    >
      {() => (
        <div className="p-4">
          <p className="text-sm font-semibold text-ink">{network.name}</p>
          <p className="mt-1 text-sm text-muted">
            {healthy && 'Your wallet is on Arc Mainnet. Payments here use real USDC.'}
            {!isConnected && 'Sign in to connect a wallet.'}
            {wrongNetwork && `Your wallet is on chain ${walletChainId ?? 'unknown'}. Cooket only works on Arc Mainnet and never switches your network on its own.`}
          </p>

          {wrongNetwork && (
            <>
              <Button className="mt-3" size="sm" variant="primary" full loading={isPending} onClick={() => switchChain({ chainId: network.chainId })}>
                Switch wallet to {network.name}
              </Button>
              {error && <p role="alert" className="mt-2 text-sm text-danger">Your wallet did not switch. Open it and add or approve Arc Mainnet.</p>}
            </>
          )}

          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Chain ID</dt>
              <dd className="num font-medium text-ink">{network.chainId}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Latest block</dt>
              <dd className="num font-medium text-ink">{block.data !== undefined ? block.data.toLocaleString('en-US') : '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">USDC contract</dt>
              <dd className="flex items-center gap-1">
                <Address value={network.usdcAddress} />
                <CopyButton value={network.usdcAddress} label="Copy USDC contract" iconOnly />
              </dd>
            </div>
          </dl>
          <div className="mt-2">
            <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, network.usdcAddress)} className="text-sm">
              View USDC contract
            </ExternalAnchor>
          </div>
        </div>
      )}
    </Popover>
  )
}
