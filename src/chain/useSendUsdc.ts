import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { parseTxError, type ParsedTxError } from '@/lib/errors'
import { pushNotification, settingsStore, txStore, upsertLocalTx } from '@/stores'
import { checkoutBlocked } from './transaction-recovery'
import { formatUsdc } from '@/lib/format'
import type { ActivityKind, Address, Hex } from '@/domain/types'
import { CONFIRMATIONS, clientFor } from './client'
import { ARC_MIN_MAX_FEE_PER_GAS, type Network } from '@/lib/networks'
import { useSession } from './useSession'

/**
 * idle        nothing submitted
 * signing     waiting for the wallet signature
 * confirming  submitted, waiting for the confirmation policy
 * confirmed   receipt succeeded with the required confirmations
 * reverted    receipt exists but the transfer failed
 * failed      never submitted (rejected or errored before a hash existed)
 * unconfirmed submitted, but no receipt yet after the wait window; still tracked in the background
 */
export type SendPhase = 'idle' | 'signing' | 'confirming' | 'confirmed' | 'reverted' | 'failed' | 'unconfirmed'

export interface SendParams {
  to: Address
  amountRaw: bigint
  note?: string
  kind?: ActivityKind
  linkId?: string
}

export interface SendState {
  phase: SendPhase
  hash?: Hex
  error?: ParsedTxError
  blockNumber?: bigint
  params?: SendParams
}

const WAIT_MS = 90_000

export function useSendUsdc(networkOverride?: Network) {
  const session = useSession()
  const { address } = session
  const network = networkOverride ?? session.network
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [state, setState] = useState<SendState>({ phase: 'idle' })
  const inFlight = useRef(false)

  const reset = useCallback(() => {
    if (!inFlight.current) setState({ phase: 'idle' })
  }, [])

  const send = useCallback(
    async (params: SendParams) => {
      if (!address || inFlight.current) return
      if (params.kind === 'payment-link' && params.linkId && checkoutBlocked(txStore.get(), params.linkId, params.to, false)) return
      inFlight.current = true
      const kind = params.kind ?? 'transfer'
      const notifyOutgoing = settingsStore.get().notifyOutgoing
      setState({ phase: 'signing', params })

      let hash: Hex
      try {
        // Arc's mempool rejects maxFeePerGas below a floor, so set the fee explicitly and never below it.
        const fees = await clientFor(network.chainId)
          .estimateFeesPerGas()
          .catch(() => ({ maxFeePerGas: ARC_MIN_MAX_FEE_PER_GAS, maxPriorityFeePerGas: 0n }))
        const maxFeePerGas = fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS
        const maxPriorityFeePerGas = fees.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : fees.maxPriorityFeePerGas
        hash = await writeContractAsync({
          address: network.usdcAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [params.to, params.amountRaw],
          chainId: network.chainId,
          maxFeePerGas,
          maxPriorityFeePerGas,
        })
      } catch (error) {
        setState({ phase: 'failed', params, error: parseTxError(error) })
        inFlight.current = false
        return
      }

      const base = {
        hash,
        chainId: network.chainId,
        from: address,
        to: params.to,
        amountRaw: params.amountRaw.toString(),
        note: params.note || undefined,
        kind,
        linkId: params.linkId,
        submittedAt: Date.now(),
      }
      upsertLocalTx({ ...base, status: 'pending' })
      setState({ phase: 'confirming', params, hash })

      try {
        const receipt = await clientFor(network.chainId).waitForTransactionReceipt({
          hash,
          confirmations: CONFIRMATIONS,
          timeout: WAIT_MS,
          onReplaced: kind === 'payment-link' ? ({ replacedTransaction, transaction }) => {
            if (replacedTransaction.from.toLowerCase() === address.toLowerCase() && replacedTransaction.hash.toLowerCase() === hash.toLowerCase()) {
              upsertLocalTx({ ...base, status: 'pending', nonce: replacedTransaction.nonce, replacementHash: transaction.hash })
            }
          } : undefined,
        })
        if (kind === 'payment-link' && receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
          upsertLocalTx({ ...base, status: 'pending', replacementHash: receipt.transactionHash })
          setState({ phase: 'unconfirmed', params, hash })
          return
        }
        const amountText = `${formatUsdc(params.amountRaw)} USDC`
        if (receipt.status === 'success') {
          upsertLocalTx({ ...base, status: 'completed', confirmedAt: Date.now(), blockNumber: receipt.blockNumber.toString() })
          if (notifyOutgoing) {
            pushNotification({ title: 'Payment completed', body: `${amountText} was confirmed on ${network.name}.`, tone: 'success', href: `/activity?tx=${hash}` })
          }
          setState({ phase: 'confirmed', params, hash, blockNumber: receipt.blockNumber })
        } else {
          upsertLocalTx({ ...base, status: 'failed', failureReason: 'The transaction was reverted onchain.' })
          if (notifyOutgoing) {
            pushNotification({ title: 'Payment failed', body: `${amountText} was not sent. The transaction reverted.`, tone: 'danger', href: `/activity?tx=${hash}` })
          }
          setState({
            phase: 'reverted',
            params,
            hash,
            error: { kind: 'reverted', title: 'The network rejected this transfer', detail: 'The transaction was included but reverted, so no USDC moved.', recovery: 'Check the recipient and amount, then try again.' },
          })
        }
        void queryClient.invalidateQueries({ queryKey: ['readContract'] })
        void queryClient.invalidateQueries({ queryKey: ['history'] })
      } catch {
        // No receipt in the wait window. The transaction stays pending and is checked in the background.
        setState({ phase: 'unconfirmed', params, hash })
      } finally {
        inFlight.current = false
      }
    },
    [address, network, queryClient, writeContractAsync],
  )

  return { state, send, reset, isBusy: state.phase === 'signing' || state.phase === 'confirming' }
}
