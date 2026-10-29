import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Eye, Link2, Plus, PowerOff, Share2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, linksApi, useAuthToken, useMyLinks } from '@/api/links'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { CopyButton, EmptyState, ExternalAnchor, Notice, Skeleton, copyText } from '@/components/ui/misc'
import { UsdcAmount } from '@/components/common/Money'
import { CheckoutCard } from '@/features/checkout/CheckoutCard'
import { CreateLinkModal } from '@/features/links/CreateLinkModal'
import { formatDateTime, formatRelative, shortAddress } from '@/lib/format'
import { ARC_NETWORK } from '@/lib/networks'
import { useShareBase } from '@/lib/useShareBase'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { LinkStatus, MerchantLink } from '@/shared/links'

const STATUS: Record<LinkStatus, { label: string; tone: 'brand' | 'success' | 'neutral' | 'danger' }> = {
  open: { label: 'Open', tone: 'brand' },
  paid: { label: 'Paid', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  inactive: { label: 'Turned off', tone: 'danger' },
}

function LinkCard({ link, shareBase, onPreview, onDeactivate }: { link: MerchantLink; shareBase: string | null; onPreview: (l: MerchantLink) => void; onDeactivate: (l: MerchantLink) => void }) {
  const [open, setOpen] = useState(false)
  const [hash, setHash] = useState('')
  const queryClient = useQueryClient()
  const status = STATUS[link.status]
  const url = shareBase ? `${shareBase}/pay?id=${encodeURIComponent(link.id)}` : ''
  const total = link.payments.reduce((sum, p) => sum + BigInt(p.amountRaw), 0n)

  const verify = useMutation({
    mutationFn: (txHash: string) => linksApi.verifyPayment(link.id, txHash.trim()),
    onSuccess: () => {
      setHash('')
      toast.success('Payment verified onchain')
      void queryClient.invalidateQueries({ queryKey: ['my-links'] })
    },
  })

  const share = async () => {
    if (!url) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: link.description, text: `Pay ${link.description} in USDC`, url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copyText(url, 'Link copied')
  }

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{link.description}</h3>
            <p className="mt-1 text-sm text-muted">
              Created {formatRelative(link.createdAt)}
              {link.expiresAt && ` · ${link.status === 'expired' ? 'Expired' : 'Expires'} ${formatDateTime(link.expiresAt)}`}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted">{link.mode === 'fixed' ? 'Fixed amount' : 'Payer chooses amount'}</p>
            <p className="mt-0.5 text-xl font-semibold text-ink">
              {link.mode === 'fixed' && link.amountRaw ? <UsdcAmount raw={BigInt(link.amountRaw)} /> : 'Any amount'}{' '}
              <span className="text-sm font-medium text-muted">{link.mode === 'fixed' ? 'USDC' : ''}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Verified payments</p>
            <p className="mt-0.5 text-base font-semibold text-ink">
              <UsdcAmount raw={total} /> <span className="text-sm font-medium text-muted">USDC</span>
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <CopyButton value={url} label="Copy link" className="h-10 border border-line bg-surface text-ink shadow-card disabled:opacity-50" />
          <Button size="sm" className="h-10" icon={<Share2 className="size-4" aria-hidden />} disabled={!url} onClick={() => void share()}>
            Share
          </Button>
          <Button size="sm" className="h-10" icon={<Eye className="size-4" aria-hidden />} onClick={() => onPreview(link)}>
            Preview
          </Button>
          {link.status !== 'inactive' && (
            <Button size="sm" variant="ghost" className="h-10" icon={<PowerOff className="size-4" aria-hidden />} onClick={() => onDeactivate(link)}>
              Turn off
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between border-t border-line px-5 text-sm font-medium text-muted hover:bg-elevated sm:px-6"
      >
        <span>Payments ({link.payments.length})</span>
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line">
          {link.payments.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted sm:px-6">No verified payments yet. A payment is listed only after its transaction is checked onchain against this link’s recipient, amount, token, and network.</p>
          ) : (
            <ul className="divide-y divide-line">
              {link.payments.map((p) => (
                <li key={`${p.txHash}:${p.logIndex}`} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <ShieldCheck className="size-4 text-success" aria-hidden />
                      <span className="font-mono text-[13px]" title={p.payer}>{shortAddress(p.payer)}</span>
                    </span>
                    <span className="block text-xs text-muted">{formatDateTime(p.paidAt)}</span>
                    <ExternalAnchor href={buildTxExplorerUrl(ARC_NETWORK.chainId, p.txHash)} className="text-xs">
                      Transaction
                    </ExternalAnchor>
                  </span>
                  <span className="num text-sm font-semibold text-success">
                    +<UsdcAmount raw={BigInt(p.amountRaw)} /> USDC
                  </span>
                </li>
              ))}
            </ul>
          )}
          {link.status !== 'inactive' && (
            <form
              className="border-t border-line px-5 py-4 sm:px-6"
              onSubmit={(e) => {
                e.preventDefault()
                if (hash.trim()) verify.mutate(hash)
              }}
            >
              <TextField
                label="Verify a payment by transaction hash"
                mono
                placeholder="0x…"
                value={hash}
                onChange={(e) => setHash(e.target.value.trim())}
                error={verify.error instanceof ApiError ? verify.error.message : verify.isError ? 'Could not verify this transaction.' : null}
                hint="Use this if a payer’s payment was not reported automatically."
                trailing={
                  <Button type="submit" size="sm" variant="primary" loading={verify.isPending} disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash)}>
                    Verify
                  </Button>
                }
              />
            </form>
          )}
        </div>
      )}
    </Card>
  )
}

export default function PaymentLinks() {
  const links = useMyLinks()
  const token = useAuthToken()
  const queryClient = useQueryClient()
  const shareBase = useShareBase()
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState<MerchantLink | null>(null)
  const [deactivating, setDeactivating] = useState<MerchantLink | null>(null)

  const deactivate = useMutation({
    mutationFn: async (id: string) => linksApi.deactivate(await token(), id),
    onSuccess: () => {
      toast.success('Payment link turned off')
      setDeactivating(null)
      void queryClient.invalidateQueries({ queryKey: ['my-links'] })
    },
  })

  const data = links.data ?? []

  return (
    <>
      <PageHeader
        title="Payment links"
        description="Create a link, share it anywhere, and get paid in USDC on Arc Mainnet. Payments are listed only after they are verified onchain."
        actions={
          <Button variant="primary" icon={<Plus className="size-5" aria-hidden />} onClick={() => setCreating(true)}>
            Create link
          </Button>
        }
      />

      <div className="space-y-5">
        {links.isLoading ? (
          <div className="grid gap-4 xl:grid-cols-2" aria-busy aria-label="Loading payment links">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : links.isError ? (
          <Notice tone="danger" title="Could not load your payment links" action={<Button size="sm" onClick={() => void links.refetch()}>Retry</Button>}>
            {links.error instanceof ApiError ? links.error.message : 'The payment link server is not reachable.'} Payment links need the Cooket payment server to be running and deployed.
          </Notice>
        ) : data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Link2 className="size-6" aria-hidden />}
              title="No payment links yet"
              description="Create a fixed-price link for an invoice, or let payers choose the amount for tips and donations. A link is live only after you sign and create it."
              action={
                <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-5" aria-hidden />}>
                  Create your first link
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {data.map((link) => (
              <LinkCard key={link.id} link={link} shareBase={shareBase} onPreview={setPreviewing} onDeactivate={setDeactivating} />
            ))}
          </div>
        )}
      </div>

      <CreateLinkModal open={creating} onClose={() => setCreating(false)} />
      <Modal open={previewing !== null} onClose={() => setPreviewing(null)} title="Checkout preview" description="This is what a payer sees. Payment is disabled here.">
        {previewing && <CheckoutCard link={previewing} mode="preview" />}
      </Modal>
      <Modal
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        title="Turn off this link?"
        description="Payers will no longer be able to pay it. Payments already verified stay in your list. This cannot be undone."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setDeactivating(null)}>Keep link</Button>
            <Button variant="danger" loading={deactivate.isPending} onClick={() => deactivating && deactivate.mutate(deactivating.id)}>
              Turn off
            </Button>
          </div>
        }
      >
        {deactivating && <p className="text-sm text-slate-700">{deactivating.description}</p>}
        {deactivate.isError && <p role="alert" className="mt-3 text-sm text-danger">{deactivate.error instanceof ApiError ? deactivate.error.message : 'Could not turn off the link.'}</p>}
      </Modal>
    </>
  )
}
