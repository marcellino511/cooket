import { useMemo, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, linksApi, useAuthToken } from '@/api/links'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TextAreaField, SelectField, TextField } from '@/components/ui/Field'
import { Notice, Segmented, CopyButton } from '@/components/ui/misc'
import { CheckoutCard } from '@/features/checkout/CheckoutCard'
import { sanitizeAmountInput } from '@/features/send/useSendFlow'
import { useSession } from '@/chain/useSession'
import { parseTxError } from '@/lib/errors'
import { randomId } from '@/lib/store'
import { useShareBase } from '@/lib/useShareBase'
import { parseAmount } from '@/onchain-money'
import { settingsStore } from '@/stores'
import { MAX_DESCRIPTION, buildCreateMessage, type LinkMode, type PublicLink } from '@/shared/links'

type Expiry = 'never' | '1h' | '24h' | '7d' | '30d' | 'custom'
const EXPIRY_MS: Record<Exclude<Expiry, 'never' | 'custom'>, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

export function CreateLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} variant="drawer" title="Create payment link" description="You sign once to prove you control the receiving wallet. Payers then pay you in USDC on Arc Mainnet.">
      {open && <Form onClose={onClose} />}
    </Modal>
  )
}

function Form({ onClose }: { onClose: () => void }) {
  const { address, network } = useSession()
  const settings = settingsStore.use()
  const shareBase = useShareBase()
  const token = useAuthToken()
  const queryClient = useQueryClient()
  const { signMessageAsync } = useSignMessage()
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<LinkMode>('fixed')
  const [amountInput, setAmountInput] = useState('')
  const [expiry, setExpiry] = useState<Expiry>('never')
  const [customExpiry, setCustomExpiry] = useState('')
  const [created, setCreated] = useState<PublicLink | null>(null)
  const [openedAt] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const amount = useMemo<{ raw?: bigint; error?: string }>(() => {
    if (mode === 'open' || !amountInput) return {}
    try {
      const parsed = parseAmount(network.chainId, amountInput)
      return parsed.isPositive() ? { raw: parsed.raw } : { error: 'Enter an amount greater than zero.' }
    } catch {
      return { error: 'Enter a valid amount.' }
    }
  }, [mode, amountInput, network.chainId])

  const expiresAt = useMemo(() => {
    if (expiry === 'never') return undefined
    if (expiry === 'custom') return customExpiry ? new Date(customExpiry).getTime() : undefined
    return openedAt + EXPIRY_MS[expiry]
  }, [expiry, customExpiry, openedAt])
  const expiryError = expiry === 'custom' && customExpiry && (Number.isNaN(expiresAt) || (expiresAt ?? 0) <= openedAt) ? 'Choose a time in the future.' : null
  const merchant = settings.businessName || settings.displayName || undefined

  const valid = description.trim().length > 0 && (mode === 'open' || amount.raw !== undefined) && !expiryError && !(expiry === 'custom' && !customExpiry)

  const create = async () => {
    if (!address || !valid || submitting) return
    setSubmitting(true)
    setFailure(null)
    try {
      const issuedAt = Date.now()
      const finalExpiry = expiry === 'never' ? undefined : expiry === 'custom' ? expiresAt : issuedAt + EXPIRY_MS[expiry]
      // The server decides which router new links bind to; the merchant signs exactly that.
      const { router } = await linksApi.config()
      const input = {
        recipient: address,
        description: description.trim(),
        merchant,
        mode,
        amount: mode === 'fixed' ? amountInput.trim() : undefined,
        expiresAt: finalExpiry,
        issuedAt,
        nonce: randomId(16),
        router: router ?? undefined,
      }
      const signature = await signMessageAsync({ message: buildCreateMessage(input, network.usdcAddress) })
      const link = await linksApi.create(await token(), { ...input, signature })
      void queryClient.invalidateQueries({ queryKey: ['my-links'] })
      setCreated(link)
      toast.success('Payment link created')
    } catch (error) {
      const parsed = parseTxError(error)
      setFailure(error instanceof ApiError ? error.message : parsed.kind === 'rejected' ? 'You declined the signature request, so no link was created.' : 'The link could not be created. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (created) {
    const url = shareBase ? `${shareBase}/pay?id=${encodeURIComponent(created.id)}` : ''
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl bg-success-50 p-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-success text-canvas">
            <Check className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Link created</p>
            <p className="text-sm text-muted">It is live now. Payments appear here only after they are verified onchain.</p>
          </div>
        </div>
        <div>
          <label htmlFor="new-link" className="mb-1.5 block text-sm font-medium text-ink">
            Payment link
          </label>
          <div className="flex items-center gap-2">
            <input id="new-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-control border border-line bg-elevated px-3 font-mono text-xs text-ink" />
            <CopyButton value={url} label="Copy link" className="h-11 border border-line bg-surface text-ink shadow-card" />
          </div>
        </div>
        <Notice tone="info">You can turn this link off at any time from your list. A turned-off link can no longer be paid.</Notice>
        <Button variant="primary" size="lg" full onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <TextAreaField
        label="Description"
        placeholder="Logo design, invoice #1042, monthly retainer…"
        value={description}
        maxLength={MAX_DESCRIPTION}
        onChange={(e) => setDescription(e.target.value)}
        hint={`${description.length}/${MAX_DESCRIPTION}. Visible to the payer.`}
      />

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Amount</p>
        <Segmented
          label="Amount type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'fixed', label: 'Fixed amount' },
            { value: 'open', label: 'Payer chooses' },
          ]}
        />
        {mode === 'fixed' && (
          <div className="mt-3">
            <TextField
              label="Amount in USDC"
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, network.usdcDecimals))}
              error={amountInput ? amount.error : null}
            />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Expires" value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
          <option value="never">Never</option>
          <option value="1h">In 1 hour</option>
          <option value="24h">In 24 hours</option>
          <option value="7d">In 7 days</option>
          <option value="30d">In 30 days</option>
          <option value="custom">Pick a date and time</option>
        </SelectField>
        {expiry === 'custom' && <TextField label="Expires at" type="datetime-local" value={customExpiry} onChange={(e) => setCustomExpiry(e.target.value)} error={expiryError} />}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Checkout preview</p>
        <CheckoutCard
          mode="preview"
          link={{
            id: 'preview',
            description: description.trim() || 'What the payment is for',
            merchant,
            mode,
            amountRaw: mode === 'fixed' ? (amount.raw ?? 0n).toString() : undefined,
            expiresAt: expiresAt && !expiryError ? expiresAt : undefined,
            recipient: address,
            status: 'open',
          }}
        />
      </div>

      {failure && <Notice tone="danger" title="Link not created">{failure}</Notice>}

      <Button variant="primary" size="lg" full loading={submitting} disabled={!valid || !address} onClick={() => void create()} icon={<Link2 className="size-5" aria-hidden />}>
        {submitting ? 'Waiting for signature…' : 'Sign and create link'}
      </Button>
    </div>
  )
}
