import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/misc'
import { ConnectWalletButton } from '@/components/layout/ConnectWalletButton'
import { Amount } from '@/onchain-money'
import { SummaryRows } from './Summary'
import type { SendFlow } from './useSendFlow'

export function ReviewStep({ flow }: { flow: SendFlow }) {
  const { session, issues, blocked, amount, fee, available } = flow
  const { isConnected, wrongNetwork, unsupportedWalletNetwork, network } = session

  const canFitFee =
    network.isArc && fee.data?.usdcRaw !== undefined && available !== undefined && available > fee.data.usdcRaw && amount.value && amount.value.raw + fee.data.usdcRaw > available

  const walletReady = isConnected && !wrongNetwork

  return (
    <div className="space-y-5">
      <SummaryRows flow={flow} />

      <div className="space-y-3">
        {!isConnected && (
          <Notice tone="info" title="Connect your wallet to continue" action={<ConnectWalletButton size="sm" />}>
            You can review the payment now. Connecting lets you sign it.
          </Notice>
        )}
        {isConnected && wrongNetwork && (
          <Notice
            tone="warning"
            title={unsupportedWalletNetwork ? 'Your wallet is on an unsupported network' : `Your wallet is not on ${network.name}`}
            action={
              <Button size="sm" variant="primary" loading={flow.switching} onClick={() => void flow.switchNetwork()}>
                Switch network
              </Button>
            }
          >
            Switch to {network.name} so the payment is sent on the network you reviewed.
          </Notice>
        )}
        {issues.map((issue) => (
          <Notice key={issue.title} tone={issue.tone} title={issue.title}>
            {issue.detail}
          </Notice>
        ))}
        {canFitFee && fee.data?.usdcRaw !== undefined && available !== undefined && (
          <Button
            size="sm"
            onClick={() => {
              if (fee.data?.usdcRaw === undefined) return
              flow.setAmountInput(Amount.fromRaw(available - fee.data.usdcRaw, network.usdcDecimals).toString())
            }}
          >
            Lower the amount to fit the fee
          </Button>
        )}
      </div>

      <p className="text-sm text-muted">
        The fee is an estimate. The network sets the final fee when your payment is included in a block.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button size="lg" icon={<ArrowLeft className="size-5" aria-hidden />} onClick={() => flow.setStep('amount')}>
          Edit details
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={blocked || !walletReady || !amount.value || fee.isLoading}
          onClick={() => flow.setStep('confirm')}
          icon={<ArrowRight className="size-5" aria-hidden />}
          className="sm:min-w-48"
        >
          Continue to confirm
        </Button>
      </div>
    </div>
  )
}
