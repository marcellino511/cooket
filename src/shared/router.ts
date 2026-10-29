/**
 * The CooketPayRouter interface, shared by the browser (checkout) and the payment link server (verification).
 * Keep this file free of browser and server specific imports.
 */
import { isAddress, keccak256, parseAbi, stringToBytes } from 'viem'

/** Must match contracts/CooketPayRouter.sol. A test compares these against the compiled artifact. */
export const ROUTER_ABI = parseAbi([
  'function USDC() view returns (address)',
  'function pay(bytes32 linkId, address recipient, uint256 amount, bytes32 reference_)',
  'event PaymentReceived(bytes32 indexed linkId, address indexed payer, address indexed recipient, uint256 amount, bytes32 reference_)',
  'error InvalidToken(address token)',
  'error InvalidRecipient(address recipient)',
  'error ZeroLinkId()',
  'error ZeroAmount()',
])

/**
 * The bytes32 that identifies a Payment Link inside the router event.
 * It is the keccak256 of the link id text, so the browser and the server derive the same value without storing it.
 */
export function linkIdToBytes32(linkId: string): `0x${string}` {
  return keccak256(stringToBytes(linkId))
}

/** Parses an optional router address from configuration. Returns undefined unless it is a valid, non-zero address. */
export function parseRouterAddress(value: string | undefined): `0x${string}` | undefined {
  const v = value?.trim()
  if (!v || !isAddress(v, { strict: false })) return undefined
  if (/^0x0{40}$/i.test(v)) return undefined
  return v
}
