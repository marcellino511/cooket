import { QrCode as QrIcon, Share2 } from 'lucide-react'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Address, CopyButton, DefinitionRow, ExternalAnchor, Notice, copyText } from '@/components/ui/misc'
import { QrCode } from '@/components/common/QrCode'
import { useSession } from '@/chain/useSession'
import { buildAddressExplorerUrl } from '@/onchain-facts'

export default function Receive() {
  const { address, network, wrongNetwork } = useSession()

  const shareText = address
    ? `Send USDC to my wallet\nNetwork: ${network.name} (chain ID ${network.chainId})\nToken: USDC\nAddress: ${address}`
    : ''

  const share = async () => {
    if (!address) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Receive USDC', text: shareText })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copyText(shareText, 'Payment details copied')
  }

  return (
    <>
      <PageHeader title="Receive USDC" description="Share your address or QR code. Anyone can pay you from a wallet or exchange that supports this network." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card className="p-5 sm:p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Your wallet address</h2>
          </div>

          <div className="mt-5 flex justify-center">
            {address ? (
              <div className="rounded-2xl border border-line bg-white p-3">
                <QrCode value={address} label={`QR code for wallet address ${address}`} />
              </div>
            ) : (
              <div className="flex aspect-square w-full max-w-[248px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <QrIcon className="size-10 text-slate-300" aria-hidden />
                <p className="mt-3 text-sm font-medium text-ink">No QR code yet</p>
                <p className="mt-1 text-sm text-muted">Connect a wallet to generate a QR code for your own address.</p>
              </div>
            )}
          </div>

          {address ? (
            <>
              <p className="mt-5 text-center text-xs text-muted">The QR code contains only this address.</p>
              <div className="mt-2 rounded-xl bg-slate-50 p-3.5 text-center">
                <Address value={address} full className="text-[13px] leading-relaxed" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <CopyButton value={address} label="Copy address" className="h-11 justify-center border border-line bg-surface text-ink shadow-card" />
                <Button onClick={() => void share()} icon={<Share2 className="size-4" aria-hidden />}>
                  Share details
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-5 text-center text-sm text-muted">Sign in to see your receiving address.</p>
          )}
        </Card>

        <div className="space-y-6">
          {wrongNetwork && (
            <Notice tone="warning" title={`Your wallet is not on ${network.name}`}>
              The address is the same on every EVM network, but senders must use {network.name} for USDC to arrive where Cooket is looking.
            </Notice>
          )}
          <Card>
            <CardHeader title="Supported network" description="Only USDC on this network will show up in Cooket." />
            <dl className="divide-y divide-line border-t border-line px-5 sm:px-6">
              <DefinitionRow label="Network">{network.name}</DefinitionRow>
              <DefinitionRow label="Chain ID">
                <span className="num">{network.chainId}</span>
              </DefinitionRow>
              <DefinitionRow label="Token">USDC ({network.usdcDecimals} decimals)</DefinitionRow>
              <DefinitionRow label="USDC contract">
                <span className="inline-flex items-center gap-1">
                  <Address value={network.usdcAddress} />
                  <CopyButton value={network.usdcAddress} label="Copy USDC contract" iconOnly />
                </span>
              </DefinitionRow>
              {address && (
                <DefinitionRow label="Explorer">
                  <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, address)}>View your address</ExternalAnchor>
                </DefinitionRow>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Instructions for the sender" />
            <ol className="list-decimal space-y-2.5 border-t border-line px-5 py-5 pl-9 text-sm text-slate-700 sm:px-6 sm:pl-10">
              <li>Open the wallet or exchange you want to pay from and choose Send.</li>
              <li>
                Select <span className="font-medium text-ink">USDC</span> on <span className="font-medium text-ink">{network.name}</span>.
              </li>
              <li>Paste the address above or scan the QR code, and check the first and last characters match.</li>
              <li>Send a small test amount first if this is a new payment route.</li>
            </ol>
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <Notice tone="warning" title="Network matters">
                Funds sent as another token or on another network may not arrive and can be impossible to recover.
              </Notice>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
