import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReadContract, useWriteContract } from 'wagmi'
import { erc20Abi, zeroHash } from 'viem'
import { parseTxError, type ParsedTxError } from '@/lib/errors'
import { formatUsdc } from '@/lib/format'
import { pushNotification, settingsStore, txStore, upsertLocalTx } from '@/stores'
import { ARC_MIN_MAX_FEE_PER_GAS, type Network } from '@/lib/networks'
import { ROUTER_ABI, linkIdToBytes32 } from '@/shared/router'
import type { Address, Hex } from '@/domain/types'
import { CONFIRMATIONS, clientFor } from './client'
import { useSession } from './useSession'
import type { SendPhase } from './useSendUsdc'
import { checkoutBlocked } from './transaction-recovery'

const WAIT_MS = 90_000

export type ApprovalPhase = 'idle' | 'signing' | 'confirming' | 'unconfirmed' | 'failed'

export interface RouterPayState {
  /** The payment transaction (the second signature). Same vocabulary as a plain send. */
  phase: SendPhase
  hash?: Hex
  error?: ParsedTxError
  blockNumber?: bigint
}

export interface ApprovalState {
  phase: ApprovalPhase
  hash?: Hex
  error?: ParsedTxError
}

interface Params {
  network: Network
  router?: Address
  linkId: string
  recipient?: Address
  amountRaw?: bigint
  note?: string
}

/** Arc's mempool rejects a maxFeePerGas below a floor, so fees are set explicitly and never below it. */
async function arcFees(network: Network) {
  const fees = await clientFor(network.chainId)
    .estimateFeesPerGas()
    .catch(() => ({ maxFeePerGas: ARC_MIN_MAX_FEE_PER_GAS, maxPriorityFeePerGas: 0n }))
  const maxFeePerGas = fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : fees.maxPriorityFeePerGas
  return { maxFeePerGas, maxPriorityFeePerGas }
}

/**
 * Checkout through the CooketPayRouter: two explicit wallet signatures.
 *   1. approve(router, amount): the exact payment amount, never unlimited.
 *   2. router.pay(linkId, recipient, amount, 0): moves USDC payer to recipient and emits PaymentReceived.
 * Nothing chains automatically; the payer starts each step.
 */
export function useRouterCheckout({ network, router, linkId, recipient, amountRaw, note }: Params) {
  const { address } = useSession()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [pay, setPay] = useState<RouterPayState>({ phase: 'idle' })
  const [approval, setApproval] = useState<ApprovalState>({ phase: 'idle' })
  const inFlight = useRef(false)

  const allowance = useReadContract({
    address: network.usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && router ? [address, router] : undefined,
    chainId: network.chainId,
    query: { enabled: Boolean(address && router), refetchInterval: approval.phase === 'unconfirmed' ? 4_000 : false },
  })
  const allowanceRaw = allowance.data
  const needsApproval = allowanceRaw === undefined || amountRaw === undefined ? undefined : allowanceRaw < amountRaw

  const approve = useCallback(async () => {
    if (!address || !router || amountRaw === undefined || inFlight.current || checkoutBlocked(txStore.get(), linkId, recipient, false)) return
    inFlight.current = true
    setApproval({ phase: 'signing' })
    let hash: Hex
    try {
      const fees = await arcFees(network)
      hash = await writeContractAsync({
        address: network.usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, amountRaw], // exactly this payment, not an unlimited allowance
        chainId: network.chainId,
        ...fees,
      })
    } catch (error) {
      setApproval({ phase: 'failed', error: parseTxError(error) })
      inFlight.current = false
      return
    }
    setApproval({ phase: 'confirming', hash })
    try {
      const receipt = await clientFor(network.chainId).waitForTransactionReceipt({ hash, confirmations: CONFIRMATIONS, timeout: WAIT_MS })
      if (receipt.status === 'success') {
        await allowance.refetch()
        setApproval({ phase: 'idle', hash })
      } else {
        setApproval({
          phase: 'failed',
          hash,
          error: { kind: 'reverted', title: 'The approval was rejected by the network', detail: 'The approval transaction reverted, so nothing was approved.', recovery: 'Try the approval again.' },
        })
      }
    } catch {
      setApproval({ phase: 'unconfirmed', hash })
    } finally {
      inFlight.current = false
    }
  }, [address, allowance, amountRaw, network, router, writeContractAsync, linkId, recipient])

  const submit = useCallback(async () => {
    if (!address || !router || !recipient || amountRaw === undefined || inFlight.current || checkoutBlocked(txStore.get(), linkId, recipient, false)) return
    inFlight.current = true
    const notifyOutgoing = settingsStore.get().notifyOutgoing
    setPay({ phase: 'signing' })
    let hash: Hex
    try {
      const fees = await arcFees(network)
      hash = await writeContractAsync({
        address: router,
        abi: ROUTER_ABI,
        functionName: 'pay',
        args: [linkIdToBytes32(linkId), recipient, amountRaw, zeroHash],
        chainId: network.chainId,
        ...fees,
      })
    } catch (error) {
      setPay({ phase: 'failed', error: parseTxError(error) })
      inFlight.current = false
      return
    }

    const base = {
      hash,
      chainId: network.chainId,
      from: address,
      to: recipient,
      amountRaw: amountRaw.toString(),
      note: note || undefined,
      kind: 'payment-link' as const,
      linkId,
      submittedAt: Date.now(),
    }
    upsertLocalTx({ ...base, status: 'pending' })
    setPay({ phase: 'confirming', hash })

    try {
      const receipt = await clientFor(network.chainId).waitForTransactionReceipt({
        hash, confirmations: CONFIRMATIONS, timeout: WAIT_MS,
        onReplaced: ({ replacedTransaction, transaction }) => {
          if (replacedTransaction.from.toLowerCase() === address.toLowerCase() && replacedTransaction.hash.toLowerCase() === hash.toLowerCase()) {
            upsertLocalTx({ ...base, status: 'pending', nonce: replacedTransaction.nonce, replacementHash: transaction.hash })
          }
        },
      })
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
        upsertLocalTx({ ...base, status: 'pending', replacementHash: receipt.transactionHash })
        setPay({ phase: 'unconfirmed', hash })
        return
      }
      const amountText = `${formatUsdc(amountRaw)} USDC`
      if (receipt.status === 'success') {
        upsertLocalTx({ ...base, status: 'completed', confirmedAt: Date.now(), blockNumber: receipt.blockNumber.toString() })
        if (notifyOutgoing) pushNotification({ title: 'Payment completed', body: `${amountText} was confirmed on ${network.name}.`, tone: 'success', href: `/activity?tx=${hash}` })
        setPay({ phase: 'confirmed', hash, blockNumber: receipt.blockNumber })
      } else {
        upsertLocalTx({ ...base, status: 'failed', failureReason: 'The transaction was reverted onchain.' })
        if (notifyOutgoing) pushNotification({ title: 'Payment failed', body: `${amountText} was not sent. The transaction reverted.`, tone: 'danger', href: `/activity?tx=${hash}` })
        setPay({
          phase: 'reverted',
          hash,
          error: { kind: 'reverted', title: 'The network rejected this payment', detail: 'The transaction was included but reverted, so no USDC moved.', recovery: 'Check your balance and the approval, then try again.' },
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['readContract'] })
      void queryClient.invalidateQueries({ queryKey: ['history'] })
    } catch {
      // No receipt in the wait window. The transaction stays pending and is checked in the background.
      setPay({ phase: 'unconfirmed', hash })
    } finally {
      inFlight.current = false
    }
  }, [address, amountRaw, linkId, network, note, queryClient, recipient, router, writeContractAsync])

  const busy = pay.phase === 'signing' || pay.phase === 'confirming' || approval.phase === 'signing' || approval.phase === 'confirming'

  return {
    pay,
    approval,
    allowance: allowanceRaw,
    allowanceLoading: allowance.isLoading,
    allowanceError: allowance.isError,
    refetchAllowance: allowance.refetch,
    needsApproval,
    approve,
    submit,
    busy,
  }
}
