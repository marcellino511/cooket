import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/Card'
import { AmountStep } from '@/features/send/AmountStep'
import { ConfirmStep } from '@/features/send/ConfirmStep'
import { RecipientStep } from '@/features/send/RecipientStep'
import { ResultStep } from '@/features/send/ResultStep'
import { ReviewStep } from '@/features/send/ReviewStep'
import { Stepper } from '@/features/send/Stepper'
import { useSendFlow } from '@/features/send/useSendFlow'

const TITLES = {
  recipient: 'Who are you paying?',
  amount: 'How much?',
  review: 'Review payment',
  confirm: 'Confirm payment',
  result: 'Payment status',
} as const

export default function Send() {
  const flow = useSendFlow()
  const { step, session } = flow

  return (
    <>
      <PageHeader title="Send USDC" description={`Send USDC on ${session.network.name} to any wallet address or saved contact.`} />
      <div className="mx-auto max-w-2xl space-y-6">
        <Card className="p-5 sm:p-7">
          <Stepper current={step} />
          <h2 className="mb-5 mt-6 text-lg font-semibold text-ink">{TITLES[step]}</h2>
          {step === 'recipient' && <RecipientStep flow={flow} />}
          {step === 'amount' && <AmountStep flow={flow} />}
          {step === 'review' && <ReviewStep flow={flow} />}
          {step === 'confirm' && <ConfirmStep flow={flow} />}
          {step === 'result' && <ResultStep flow={flow} />}
        </Card>
      </div>
    </>
  )
}
