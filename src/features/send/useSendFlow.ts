import { useMemo, useState } from 'react'
import { useSwitchChain } from 'wagmi'
import { Amount, AmountError, parseAmount } from '@/onchain-money'
import { checkAddress } from '@/domain/address'
import { useLocation } from '@/lib/router'
import { contactsStore, settingsStore, txStore } from '@/stores'
import { useGasBalance, useSession, useUsdcBalance } from '@/chain/useSession'
import { useFeeEstimate } from '@/chain/useFee'
import { useRecipientCheck } from '@/chain/useRecipientCheck'
import { useSendUsdc } from '@/chain/useSendUsdc'
import type { Address, Contact } from '@/domain/types'

export type Step = 'recipient' | 'amount' | 'review' | 'confirm' | 'result'
export const STEPS: readonly { id: Step; label: string }[] = [
  { id: 'recipient', label: 'Recipient' },
  { id: 'amount', label: 'Amount' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'result', label: 'Result' },
]

export const NOTE_MAX = 140

export interface ReviewIssue {
  tone: 'danger' | 'warning'
  title: string
  detail: string
  /** True when this issue must be resolved before the payment can continue. */
  blocking: boolean
}

export function sanitizeAmountInput(raw: string, decimals: number): string {
  let value = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const firstDot = value.indexOf('.')
  if (firstDot !== -1) value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, '')
  const [whole, fraction] = value.split('.')
  if (fraction !== undefined) value = `${whole}.${fraction.slice(0, decimals)}`
  return value
}

export function useSendFlow() {
  const session = useSession()
  const { address, network, isConnected, wrongNetwork } = session
  const { params } = useLocation()
  const contacts = contactsStore.use()
  const settings = settingsStore.use()
  const txs = txStore.use()
  const balance = useUsdcBalance()
  const gas = useGasBalance()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const sender = useSendUsdc()

  const initialTo = params.get('to') ?? ''
  const [recipientInput, setRecipientInput] = useState(initialTo)
  const [amountInput, setAmountInput] = useState(params.get('amount') ?? '')
  const [note, setNote] = useState((params.get('note') ?? '').slice(0, NOTE_MAX))
  const [step, setStep] = useState<Step>(() => (initialTo && checkAddress(initialTo).ok ? 'amount' : 'recipient'))
  const [verified, setVerified] = useState(false)
  const [largeAck, setLargeAck] = useState(false)

  const addressCheck = useMemo(() => checkAddress(recipientInput), [recipientInput])
  const recipient: Address | undefined = addressCheck.ok ? addressCheck.address : undefined
  const recipientInfo = useRecipientCheck(network, recipient)
  const contact: Contact | undefined = recipient ? contacts.find((c) => c.address.toLowerCase() === recipient.toLowerCase()) : undefined
  const isSelf = Boolean(recipient && address && recipient.toLowerCase() === address.toLowerCase())

  const hasSentBefore = useMemo(() => {
    if (!recipient || !address) return false
    return (txs[address.toLowerCase()] ?? []).some((t) => t.to.toLowerCase() === recipient.toLowerCase() && t.status !== 'failed')
  }, [txs, recipient, address])
  const isNewRecipient = Boolean(recipient) && !contact && !hasSentBefore

  const amount = useMemo<{ value?: Amount; error?: string }>(() => {
    if (amountInput.trim() === '' || amountInput === '.') return {}
    try {
      const parsed = parseAmount(network.chainId, amountInput)
      if (!parsed.isPositive()) return { error: 'Enter an amount greater than zero.' }
      return { value: parsed }
    } catch (error) {
      if (error instanceof AmountError && error.code === 'TOO_MANY_FRACTION_DIGITS') return { error: `USDC supports up to ${network.usdcDecimals} decimal places.` }
      return { error: 'Enter a valid amount.' }
    }
  }, [amountInput, network])

  const pendingOut = useMemo(() => {
    if (!address) return 0n
    return (txs[address.toLowerCase()] ?? []).filter((t) => t.status === 'pending' && t.chainId === network.chainId).reduce((sum, t) => sum + BigInt(t.amountRaw), 0n)
  }, [txs, address, network.chainId])

  const available = balance.raw !== undefined ? (balance.raw > pendingOut ? balance.raw - pendingOut : 0n) : undefined

  const amountError =
    amount.error ??
    (amount.value && available !== undefined && amount.value.raw > available ? 'This is more than your available balance.' : null)

  const reviewing = step === 'review' || step === 'confirm'
  const fee = useFeeEstimate({ network, from: address, to: recipient, amount: amount.value?.raw, enabled: reviewing && isConnected && !wrongNetwork })

  const thresholdRaw = useMemo(() => {
    try {
      return settings.largeTransferThreshold.trim() ? parseAmount(network.chainId, settings.largeTransferThreshold).raw : undefined
    } catch {
      return undefined
    }
  }, [settings.largeTransferThreshold, network])
  const isLarge = Boolean(amount.value && thresholdRaw !== undefined && amount.value.raw >= thresholdRaw)

  const issues = useMemo<ReviewIssue[]>(() => {
    const list: ReviewIssue[] = []
    if (isSelf) list.push({ tone: 'danger', blocking: true, title: 'This is your own address', detail: 'Sending to yourself moves nothing and costs a network fee.' })
    if (recipientInfo.data?.isUsdcContract)
      list.push({ tone: 'danger', blocking: true, title: 'This is the USDC contract', detail: 'Funds sent to the token contract itself are lost permanently.' })
    if (recipientInfo.data?.isContract && !recipientInfo.data.isUsdcContract)
      list.push({
        tone: 'warning',
        blocking: false,
        title: 'Recipient is a smart contract',
        detail: 'Some contracts cannot move USDC they receive. Continue only if you know this contract accepts USDC.',
      })
    if (isNewRecipient && settings.warnNewRecipients)
      list.push({ tone: 'warning', blocking: false, title: 'New recipient', detail: 'You have not sent to this address from Cooket before and it is not in your contacts.' })
    if (amount.value && available !== undefined && amount.value.raw > available)
      list.push({ tone: 'danger', blocking: true, title: 'Insufficient funds', detail: 'The amount is more than your available USDC balance.' })
    if (amount.value && available !== undefined && fee.data?.usdcRaw !== undefined && amount.value.raw <= available && amount.value.raw + fee.data.usdcRaw > available)
      list.push({
        tone: 'danger',
        blocking: true,
        title: 'Not enough left for the network fee',
        detail: `On ${network.name} the fee is paid in USDC from the same balance, so the amount plus the fee must fit.`,
      })
    if (!network.isArc && fee.data && gas.raw !== undefined && gas.raw < fee.data.gasTokenRaw)
      list.push({ tone: 'danger', blocking: true, title: `Not enough ${network.gasSymbol} for gas`, detail: `Network fees on ${network.name} are paid in ${network.gasSymbol}, which your wallet does not hold enough of.` })
    if (fee.isError && !fee.isLoading)
      list.push({ tone: 'warning', blocking: false, title: 'Fee estimate unavailable', detail: 'We could not estimate the fee. Your wallet will show the final fee before you sign.' })
    return list
  }, [isSelf, recipientInfo.data, isNewRecipient, settings.warnNewRecipients, amount.value, available, fee.data, fee.isError, fee.isLoading, network, gas.raw])

  const blocked = issues.some((i) => i.blocking)

  // As soon as a transaction exists or the wallet request ended, the result is what the user should see.
  const phase = sender.state.phase
  const visibleStep: Step = phase !== 'idle' && phase !== 'signing' ? 'result' : step

  const goBackToConfirm = () => {
    sender.reset()
    setStep('confirm')
  }

  const restart = () => {
    sender.reset()
    setRecipientInput('')
    setAmountInput('')
    setNote('')
    setVerified(false)
    setLargeAck(false)
    setStep('recipient')
  }

  const submit = async () => {
    if (!recipient || !amount.value || !address) return
    if (wrongNetwork) {
      try {
        await switchChainAsync({ chainId: network.chainId })
      } catch {
        return
      }
    }
    await sender.send({ to: recipient, amountRaw: amount.value.raw, note: note.trim() || undefined })
  }

  return {
    session,
    step: visibleStep,
    setStep,
    recipientInput,
    setRecipientInput,
    amountInput,
    setAmountInput,
    note,
    setNote,
    verified,
    setVerified,
    largeAck,
    setLargeAck,
    addressCheck,
    recipient,
    recipientInfo,
    contact,
    contacts,
    isSelf,
    isNewRecipient,
    amount,
    amountError,
    available,
    balance,
    fee,
    isLarge,
    thresholdRaw,
    issues,
    blocked,
    sender,
    switching,
    switchNetwork: () => switchChainAsync({ chainId: network.chainId }).catch(() => undefined),
    submit,
    goBackToConfirm,
    restart,
  }
}

export type SendFlow = ReturnType<typeof useSendFlow>
