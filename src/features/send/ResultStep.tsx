import { AlertCircle, CheckCircle2, Clock, UserPlus } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Address, CopyButton, ExternalAnchor, copyText } from '@/components/ui/misc'
import { formatUsdcPrecise } from '@/lib/format'
import { navigate } from '@/lib/router'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { SendFlow } from './useSendFlow'

export function ResultStep({ flow }: { flow: SendFlow }) {
  const { sender, session, contact, recipient } = flow
  const { state } = sender
  const { network } = session
  const params = state.params
  const amountText = params ? `${formatUsdcPrecise(params.amountRaw)} USDC` : ''
  const who = contact?.name ?? (recipient ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : 'the recipient')
  const explorer = state.hash ? buildTxExplorerUrl(network.chainId, state.hash) : null

  type View = { tone: 'success' | 'pending' | 'failure'; title: string; body: string }
  const view: View = (() => {
    switch (state.phase) {
      case 'confirmed':
        return { tone: 'success', title: 'Payment completed', body: `${amountText} to ${who} is confirmed on ${network.name}${state.blockNumber ? ` in block ${state.blockNumber.toLocaleString('en-US')}` : ''}.` }
      case 'confirming':
        return { tone: 'pending', title: 'Payment submitted', body: `Waiting for ${network.name} to confirm ${amountText} to ${who}. This page updates by itself. It is not complete yet.` }
      case 'unconfirmed':
        return { tone: 'pending', title: 'Still pending', body: 'The network has not confirmed this payment yet. It stays in Activity as Pending and updates automatically. Do not send it again.' }
      case 'reverted':
        return { tone: 'failure', title: state.error?.title ?? 'Payment failed', body: `${state.error?.detail ?? ''} ${state.error?.recovery ?? ''}`.trim() }
      default:
        return { tone: 'failure', title: state.error?.title ?? 'Payment not sent', body: `${state.error?.detail ?? ''} ${state.error?.recovery ?? ''}`.trim() }
    }
  })()

  const details = [
    `Cooket payment`,
    `Status: ${view.title}`,
    `Amount: ${amountText}`,
    `To: ${params?.to ?? ''}`,
    `Network: ${network.name}`,
    state.hash ? `Transaction hash: ${state.hash}` : '',
    explorer ? `Explorer: ${explorer}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const icon =
    view.tone === 'success' ? (
      <CheckCircle2 className="size-8 text-success" aria-hidden />
    ) : view.tone === 'pending' ? (
      state.phase === 'confirming' ? <Loader2 className="size-8 animate-spin text-warning" aria-hidden /> : <Clock className="size-8 text-warning" aria-hidden />
    ) : (
      <AlertCircle className="size-8 text-danger" aria-hidden />
    )
  const ring = view.tone === 'success' ? 'bg-success-50' : view.tone === 'pending' ? 'bg-warning-50' : 'bg-danger-50'

  return (
    <div className="space-y-6" aria-live="polite">
      <div className="flex flex-col items-center text-center">
        <div className={`flex size-16 items-center justify-center rounded-full ${ring}`}>{icon}</div>
        <h2 className="mt-4 text-xl font-semibold text-ink">{view.title}</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted">{view.body}</p>
      </div>

      {params && (
        <dl className="divide-y divide-line rounded-xl border border-line px-4 text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Amount</dt>
            <dd className="num font-semibold text-ink">{amountText}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">To</dt>
            <dd className="text-right">
              {contact && <span className="block font-medium text-ink">{contact.name}</span>}
              <Address value={params.to} full className="text-xs" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-muted">Transaction hash</dt>
            <dd className="flex items-center gap-1">
              {state.hash ? (
                <>
                  <Address value={state.hash} />
                  <CopyButton value={state.hash} label="Copy transaction hash" iconOnly />
                </>
              ) : (
                <span className="text-muted">Not created</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {explorer && <ExternalAnchor href={explorer}>View on block explorer</ExternalAnchor>}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {view.tone === 'failure' && state.phase === 'failed' && (
          <Button variant="primary" size="lg" onClick={flow.goBackToConfirm}>
            Try again
          </Button>
        )}
        {view.tone === 'failure' && state.phase === 'failed' && (
          <Button size="lg" onClick={() => { flow.sender.reset(); flow.setStep('amount') }}>
            Edit payment
          </Button>
        )}
        {view.tone !== 'failure' || state.phase === 'reverted' ? (
          <Button variant="primary" size="lg" onClick={() => navigate('/')}>
            Back to overview
          </Button>
        ) : (
          <Button size="lg" onClick={() => navigate('/')}>
            Back to overview
          </Button>
        )}
        {view.tone !== 'failure' && (
          <Button size="lg" onClick={flow.restart}>
            Send another
          </Button>
        )}
        <Button size="lg" onClick={() => void copyText(details, 'Payment details copied')}>
          Copy details
        </Button>
        {state.phase === 'confirmed' && !contact && params && (
          <Button size="lg" variant="ghost" icon={<UserPlus className="size-5" aria-hidden />} onClick={() => navigate(`/contacts?add=${params.to}`)}>
            Save to contacts
          </Button>
        )}
      </div>
    </div>
  )
}
