import { getAddress, isAddress } from 'viem'
import type { Address } from './types'

export type AddressCheck =
  | { ok: true; address: Address }
  | { ok: false; error: string; unsupportedFormat?: 'solana' | 'bitcoin' | 'ens' | 'hash' }

const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const BITCOIN = /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/
const ZERO = '0x0000000000000000000000000000000000000000'

/** Validates an EVM address, including the EIP-55 checksum when the input is mixed case. */
export function checkAddress(input: string): AddressCheck {
  const value = input.trim()
  if (!value) return { ok: false, error: 'Enter a wallet address.' }
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return { ok: false, error: 'This is 32 bytes long, so it looks like a transaction hash, not a wallet address.', unsupportedFormat: 'hash' }
  }
  if (/\.eth$/i.test(value)) {
    return { ok: false, error: 'ENS names are not supported yet. Paste the 0x address instead.', unsupportedFormat: 'ens' }
  }
  if (BITCOIN.test(value)) {
    return { ok: false, error: 'This looks like a Bitcoin address. Cooket sends USDC to EVM wallet addresses that start with 0x.', unsupportedFormat: 'bitcoin' }
  }
  if (!value.startsWith('0x') && SOLANA.test(value)) {
    return { ok: false, error: 'This looks like a Solana address. Cooket sends USDC to EVM wallet addresses that start with 0x.', unsupportedFormat: 'solana' }
  }
  if (!value.startsWith('0x')) return { ok: false, error: 'EVM addresses start with 0x.' }
  if (value.length !== 42) return { ok: false, error: `An address has 42 characters. This one has ${value.length}.` }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, error: 'This address contains characters that are not valid.' }
  if (!isAddress(value)) return { ok: false, error: 'The checksum does not match. Check for a typo or copy the address again.' }
  if (value.toLowerCase() === ZERO) return { ok: false, error: 'The zero address cannot receive funds. Sending there would burn them.' }
  return { ok: true, address: getAddress(value) }
}
