import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/misc'
import { FiatEstimate, UsdcAmount } from '@/components/common/Money'
import { Amount } from '@/onchain-money'
import { cn } from '@/lib/cn'
import { NOTE_MAX, sanitizeAmountInput, type SendFlow } from './useSendFlow'

export function AmountStep({ flow }: { flow: SendFlow }) {
  const { session, amountInput, setAmountInput, amount, amountError, available, balance, note, setNote, contact, recipient } = flow
  const { network, isConnected } = session
  const showError = amountInput.length > 0 && amountError

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Paying <span className="font-medium text-ink">{contact?.name ?? (recipient ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : '')}</span> on {network.name}
      </p>

      <div>
        <label htmlFor="amount" className="sr-only">
          Amount in USDC
        </label>
        <div className={cn('rounded-2xl border bg-surface p-5 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20', showError ? 'border-danger' : 'border-line')}>
          <div className="flex items-baseline gap-2">
            <input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, network.usdcDecimals))}
              aria-invalid={showError ? true : undefined}
              aria-describedby="amount-help"
              className="num min-w-0 flex-1 bg-transparent text-4xl font-semibold tracking-tight text-ink outline-none placeholder:text-slate-300 sm:text-5xl"
            />
            <span className="text-lg font-medium text-muted">USDC</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{amount.value ? <FiatEstimate raw={amount.value.raw} /> : '≈ —'}</span>
            <button
              type="button"
              disabled={available === undefined || available === 0n}
              onClick={() => available !== undefined && setAmountInput(Amount.fromRaw(available, network.usdcDecimals).toString())}
              className="rounded-md px-1.5 py-1 font-medium text-brand hover:bg-brand-50 disabled:text-slate-300 disabled:hover:bg-transparent"
            >
              Use max
            </button>
          </div>
        </div>
        <div id="amount-help" className="mt-2 text-sm">
          {showError ? (
            <p role="alert" className="text-danger">
              {amountError}
            </p>
          ) : (
            <p className="text-muted">
              Available:{' '}
              {!isConnected ? (
                'connect a wallet to see your balance'
              ) : balance.isLoading ? (
                <Skeleton className="inline-block h-4 w-20 align-middle" />
              ) : available !== undefined ? (
                <span className="font-medium text-ink">
                  <UsdcAmount raw={available} digits={2} /> USDC
                </span>
              ) : (
                'unavailable right now'
              )}
            </p>
          )}
        </div>
      </div>

      <TextAreaField
        label="Note"
        optional
        value={note}
        maxLength={NOTE_MAX}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What is this payment for?"
        hint={`${note.length}/${NOTE_MAX}. Saved on this device only, never sent to the network or the recipient.`}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button size="lg" icon={<ArrowLeft className="size-5" aria-hidden />} onClick={() => flow.setStep('recipient')}>
          Back
        </Button>
        <Button variant="primary" size="lg" disabled={!amount.value || Boolean(amountError)} onClick={() => flow.setStep('review')} icon={<ArrowRight className="size-5" aria-hidden />} className="sm:min-w-48">
          Review payment
        </Button>
      </div>
    </div>
  )
}
