import { useMemo, useState } from 'react'
import { useSwitchChain } from 'wagmi'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Address, CopyButton, ExternalAnchor, Notice } from '@/components/ui/misc'
import { ConnectWalletButton } from '@/components/layout/ConnectWalletButton'
import { LogoMark } from '@/components/layout/Wordmark'
import { FiatEstimate } from '@/components/common/Money'
import { useGasBalance, useSession, useUsdcBalance } from '@/chain/useSession'
import { useSendUsdc } from '@/chain/useSendUsdc'
import { useRouterCheckout } from '@/chain/useRouterCheckout'
import { formatDateTime, formatUsdcPrecise, shortAddress } from '@/lib/format'
import { ARC_NETWORK } from '@/lib/networks'
import { txStore } from '@/stores'
import { checkoutBlocked, isUnresolvedPayment, selectCheckoutTransaction } from '@/chain/transaction-recovery'
import { retryTransaction } from '@/chain/useTxReconciler'
import { RecoveryNotice } from './RecoveryNotice'
import type { PublicLink } from '@/shared/links'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/useNow'
import { parseAmount } from '@/onchain-money'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { sanitizeAmountInput } from '@/features/send/useSendFlow'
import type { Address as Addr } from '@/domain/types'

export type CheckoutLink = Omit<PublicLink, 'recipient' | 'chainId' | 'createdAt'> & { recipient?: Addr }

export function CheckoutCard({ link, mode }: { link: CheckoutLink; mode: 'live' | 'preview' }) {
  const network = ARC_NETWORK
  const request = {
    id: link.id,
    recipient: link.recipient,
    description: link.description,
    merchant: link.merchant,
    fixedAmount: link.mode === 'fixed' && link.amountRaw ? BigInt(link.amountRaw) : undefined,
    expiresAt: link.expiresAt,
  }
  const session = useSession()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const balance = useUsdcBalance(network)
  const gas = useGasBalance(network)
  const sender = useSendUsdc(network)
  const [amountInput, setAmountInput] = useState('')

  const preview = mode === 'preview'
  const now = useNow()
  const expired = link.status === 'expired' || Boolean(request.expiresAt && now > request.expiresAt)
  const inactive = link.status === 'inactive'
  const alreadyPaid = link.status === 'paid'

  const chosen = useMemo<{ raw?: bigint; error?: string }>(() => {
    if (request.fixedAmount !== undefined) return { raw: request.fixedAmount }
    if (!amountInput) return {}
    try {
      const parsed = parseAmount(network.chainId, amountInput)
      return parsed.isPositive() ? { raw: parsed.raw } : { error: 'Enter an amount greater than zero.' }
    } catch {
      return { error: 'Enter a valid amount.' }
    }
  }, [request.fixedAmount, amountInput, network.chainId])

  const isOwnLink = Boolean(session.address && request.recipient && session.address.toLowerCase() === request.recipient.toLowerCase())
  const wrongNetwork = session.isConnected && session.walletChainId !== network.chainId
  const insufficient = chosen.raw !== undefined && balance.raw !== undefined && chosen.raw > balance.raw
  const noGas = !network.isArc && gas.raw !== undefined && gas.raw === 0n

  // Links created with a router settle through the CooketPayRouter (approve, then pay). Older links keep a direct transfer.
  const viaRouter = Boolean(link.router)
  const flow = useRouterCheckout({ network, router: link.router, linkId: request.id, recipient: request.recipient, amountRaw: chosen.raw, note: request.description || undefined })
  const payState = viaRouter ? flow.pay : sender.state
  const records = txStore.use()
  const recovery = preview ? undefined : selectCheckoutTransaction(records, request.id, request.recipient, link.mode === 'fixed', payState.hash)
  const [checking, setChecking] = useState(false)
  const phase = recovery?.failureEvidence && recovery.status === 'failed' ? 'reverted' : payState.phase
  const hash = recovery?.verifiedPaymentHash ?? recovery?.replacementHash ?? recovery?.hash ?? payState.hash
  const payError = payState.error
  const busy = viaRouter ? flow.busy : sender.isBusy
  const approving = flow.approval.phase === 'signing' || flow.approval.phase === 'confirming'
  const done = Boolean(recovery?.linkVerifiedAt)
  const unresolved = Boolean(recovery && isUnresolvedPayment(recovery))
  const retry = async () => {
    if (!recovery || checking) return
    setChecking(true)
    try { await retryTransaction(recovery) } catch { /* Keep the saved attempt blocked on unexpected errors. */ }
    finally { setChecking(false) }
  }
  const blocked = () => checkoutBlocked(txStore.get(), request.id, request.recipient, link.mode === 'fixed')

  const pay = async () => {
    if (!request.recipient || chosen.raw === undefined || expired || inactive || alreadyPaid || blocked()) return
    if (request.expiresAt && Date.now() > request.expiresAt) return
    if (viaRouter) {
      await flow.submit()
      return
    }
    await sender.send({ to: request.recipient, amountRaw: chosen.raw, note: request.description || undefined, kind: 'payment-link', linkId: request.id })
  }

  const amountText = chosen.raw !== undefined ? formatUsdcPrecise(chosen.raw) : undefined
  const payLabel = amountText ? `Pay ${amountText} USDC` : 'Enter an amount'
  const needsApproval = viaRouter && flow.needsApproval === true
  const approvalUnknown = viaRouter && !approving && flow.needsApproval === undefined && chosen.raw !== undefined && !preview
  const primaryLabel = phase === 'signing' ? 'Confirm in wallet…' : needsApproval ? (approving ? 'Approving…' : `Approve ${amountText ?? ''} USDC`) : approvalUnknown ? 'Checking approval…' : payLabel

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="border-b border-line bg-slate-50 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{request.merchant ?? (request.recipient ? shortAddress(request.recipient) : 'Your business')}</p>
            <p className="text-xs text-muted">requests a payment in USDC</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-7">
        <div>
          {request.description && <p className="text-sm text-muted">{request.description}</p>}
          {request.fixedAmount !== undefined ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight text-ink">
              <span className="num">{formatUsdcPrecise(request.fixedAmount)}</span> <span className="text-lg font-medium text-muted">USDC</span>
            </p>
          ) : (
            <div className="mt-2">
              <label htmlFor="payer-amount" className="text-sm font-medium text-ink">
                Amount to pay
              </label>
              <div className={cn('mt-1.5 flex items-baseline gap-2 rounded-2xl border bg-surface px-4 py-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20', chosen.error ? 'border-danger' : 'border-line')}>
                <input
                  id="payer-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountInput}
                  disabled={done || unresolved || busy}
                  onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, network.usdcDecimals))}
                  aria-invalid={chosen.error ? true : undefined}
                  className="num min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight text-ink outline-none placeholder:text-slate-300"
                />
                <span className="text-base font-medium text-muted">USDC</span>
              </div>
              {chosen.error && <p role="alert" className="mt-1.5 text-sm text-danger">{chosen.error}</p>}
            </div>
          )}
          {chosen.raw !== undefined && (
            <p className="mt-1 text-sm text-muted">
              <FiatEstimate raw={chosen.raw} />
            </p>
          )}
        </div>

        <dl className="divide-y divide-line rounded-xl border border-line px-4 text-sm">
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-muted">Pay to</dt>
            <dd className="text-right">
              {request.recipient ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Address value={request.recipient} full className="text-xs" />
                    <CopyButton value={request.recipient} label="Copy recipient address" iconOnly />
                  </span>
                  <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, request.recipient)} className="mt-0.5 text-xs">
                    Check on explorer
                  </ExternalAnchor>
                </>
              ) : (
                <span className="text-muted">Your connected wallet address</span>
              )}
            </dd>
          </div>
          {link.router && (
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-muted">Payment contract</dt>
              <dd className="text-right">
                <span className="inline-flex items-center gap-1">
                  <Address value={link.router} className="text-xs" />
                  <CopyButton value={link.router} label="Copy contract address" iconOnly />
                </span>
                <ExternalAnchor href={buildAddressExplorerUrl(network.chainId, link.router)} className="mt-0.5 text-xs">
                  View contract
                </ExternalAnchor>
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Network</dt>
            <dd className="font-medium text-ink">{network.name}</dd>
          </div>
          {request.expiresAt && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted">{expired ? 'Expired' : 'Valid until'}</dt>
              <dd className={cn('font-medium', expired ? 'text-danger' : 'text-ink')}>{formatDateTime(request.expiresAt)}</dd>
            </div>
          )}
        </dl>

        {preview ? (
          <Button variant="primary" size="lg" full disabled>
            Pay (preview only)
          </Button>
        ) : unresolved && recovery ? (
          <RecoveryNotice tx={recovery} checking={checking} onRetry={() => void retry()} />
        ) : done && hash ? (
          <div className="rounded-xl bg-success-50 p-4 text-center" aria-live="polite">
            <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
            <p className="mt-2 font-semibold text-ink">Payment verified on {network.name}</p>
            <p className="mt-1 text-sm text-muted">The merchant’s payment link verified and recorded this payment onchain.</p>
            <ExternalAnchor href={buildTxExplorerUrl(network.chainId, hash)} className="mt-3 text-sm">View transaction</ExternalAnchor>
          </div>
        ) : (
          <div className="space-y-3">
            {expired && <Notice tone="danger" title="This payment link has expired">Ask the sender for a new link.</Notice>}
            {inactive && <Notice tone="danger" title="This payment link was turned off">The merchant deactivated it. Ask them for a new link.</Notice>}
            {alreadyPaid && <Notice tone="success" title="This link has already been paid">A payment was verified for this fixed-amount link.</Notice>}
            {isOwnLink && <Notice tone="warning" title="This is your own link">You cannot pay yourself.</Notice>}
            {recovery?.failureEvidence && recovery.failureReason && <Notice tone="warning" title="Previous payment did not complete">{recovery.failureReason}</Notice>}
            {(phase === 'failed' || phase === 'reverted') && payError && (
              <Notice tone="danger" title={payError.title}>
                {payError.detail} {payError.recovery}
              </Notice>
            )}
            {viaRouter && flow.approval.phase === 'failed' && flow.approval.error && (
              <Notice tone="danger" title={flow.approval.error.title}>
                {flow.approval.error.detail} {flow.approval.error.recovery}
              </Notice>
            )}
            {viaRouter && flow.approval.phase === 'unconfirmed' && (
              <Notice tone="warning" title="Approval still pending">
                Your approval was submitted but is not confirmed yet. This page keeps checking. Do not approve again.
              </Notice>
            )}
            {viaRouter && flow.allowanceError && (
              <Notice tone="warning" title="Could not read your approval">
                The Arc Mainnet RPC did not answer. <button type="button" className="font-medium underline" onClick={() => void flow.refetchAllowance()}>Try again</button>
              </Notice>
            )}
            {viaRouter && !preview && chosen.raw !== undefined && !expired && !inactive && !alreadyPaid && (
              <Notice tone="info" title={needsApproval ? 'Step 1 of 2: approve this payment' : 'Review before you sign'}>
                {needsApproval
                  ? `Your wallet will ask you to approve exactly ${amountText} USDC for the Cooket payment contract. Nothing is paid yet, and the contract cannot move more than this amount.`
                  : `Your wallet will ask you to pay ${amountText} USDC from your wallet to ${request.recipient ? shortAddress(request.recipient) : 'the recipient'} through the Cooket payment contract. This payment is final.`}
              </Notice>
            )}
            {insufficient && <Notice tone="danger" title="Insufficient USDC">Your wallet holds less than this payment on {network.name}.</Notice>}
            {noGas && <Notice tone="warning" title={`No ${network.gasSymbol} for gas`}>Network fees on {network.name} are paid in {network.gasSymbol}.</Notice>}

            {!session.isConnected ? (
              <ConnectWalletButton full size="lg" label="Connect wallet to pay" />
            ) : wrongNetwork ? (
              <Button variant="primary" size="lg" full loading={switching} onClick={() => void switchChainAsync({ chainId: network.chainId }).catch(() => undefined)}>
                Switch to {network.name}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                full
                loading={busy}
                disabled={unresolved || expired || inactive || alreadyPaid || isOwnLink || chosen.raw === undefined || insufficient || !request.recipient || approvalUnknown || flow.approval.phase === 'unconfirmed'}
                onClick={() => { if (!blocked()) void (needsApproval ? flow.approve() : pay()) }}
              >
                {primaryLabel}
              </Button>
            )}

            <div className="flex items-start gap-2 text-xs text-muted">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Anyone can create a payment link. Only pay if you trust the sender, and check the address above. Payments are final and go straight to the recipient’s wallet.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
