import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/misc'
import { formatUsdc } from '@/lib/format'
import { SummaryRows } from './Summary'
import type { SendFlow } from './useSendFlow'

function Check({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: string; id: string }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line p-3.5 text-sm text-ink hover:bg-slate-50">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#60A5FA]" />
      <span>{children}</span>
    </label>
  )
}

export function ConfirmStep({ flow }: { flow: SendFlow }) {
  const { verified, setVerified, largeAck, setLargeAck, isLarge, thresholdRaw, sender, blocked, session } = flow
  const signing = sender.state.phase === 'signing'
  const ready = verified && (!isLarge || largeAck) && !blocked && !signing

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-4 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <p>
          Nothing is sent until you approve it in your wallet. Cooket never holds your funds or your keys, and blockchain payments cannot be reversed.
        </p>
      </div>

      <SummaryRows flow={flow} />

      <div className="space-y-2">
        <Check id="verified" checked={verified} onChange={setVerified}>
          I have checked the recipient address and amount, and I understand this payment cannot be undone.
        </Check>
        {isLarge && thresholdRaw !== undefined && (
          <Check id="large" checked={largeAck} onChange={setLargeAck}>
            {`This is a large transfer (${formatUsdc(thresholdRaw, 0)} USDC or more, your warning threshold). I have double-checked it.`}
          </Check>
        )}
      </div>

      {signing && (
        <Notice tone="info" title="Waiting for your wallet">
          Approve the request in your wallet to send. If no prompt appears, open your wallet extension. You can reject it there to cancel.
        </Notice>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button size="lg" disabled={signing} icon={<ArrowLeft className="size-5" aria-hidden />} onClick={() => flow.setStep('review')}>
          Back
        </Button>
        <Button variant="primary" size="lg" disabled={!ready} loading={signing} onClick={() => void flow.submit()} className="sm:min-w-56">
          {signing ? 'Confirm in wallet…' : `Confirm and send on ${session.network.name}`}
        </Button>
      </div>
    </div>
  )
}
