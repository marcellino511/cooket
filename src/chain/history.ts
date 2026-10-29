import { getAddress, parseAbiItem, type PublicClient } from 'viem'
import { ARC_SYSTEM_EMITTER, type Network } from '@/lib/networks'
import type { Address, ChainTransfer } from '@/domain/types'

/**
 * Arc logs every explicit USDC movement (native sends and ERC-20 transfers alike) as a Transfer from the
 * system emitter at 18 decimals. Reading that one stream covers everything without double counting the
 * ERC-20 contract's own 6-decimal log. Values are converted to the 6-decimal USDC view (truncated).
 */
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

/** Block span per eth_getLogs request. Halved automatically if the provider rejects it. */
const SPAN = 2000n
const MIN_SPAN = 250n
/** How far back one page of the scan reaches. */
export const PAGE_SPAN = SPAN * 6n

export interface HistoryPage {
  items: ChainTransfer[]
  /** Newest block of the next older page, when there is more history to scan. */
  nextTo?: string
}

export const transferKey = (t: Pick<ChainTransfer, 'hash' | 'logIndex'>) => `${t.hash.toLowerCase()}:${t.logIndex}`

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The primary endpoint is load balanced, so a backend may not have imported the newest block yet (-32014). */
function isLaggingBackend(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ''}` : ''
  return text.includes('-32014') || text.toLowerCase().includes('not imported')
}

async function logsChunk(client: PublicClient, network: Network, account: Address, from: bigint, to: bigint, retried = false): Promise<ChainTransfer[]> {
  const scale = 10n ** BigInt(network.gasDecimals - network.usdcDecimals)
  try {
    const [outgoing, incoming] = await Promise.all([
      client.getLogs({ address: ARC_SYSTEM_EMITTER, event: TRANSFER_EVENT, args: { from: account }, fromBlock: from, toBlock: to }),
      client.getLogs({ address: ARC_SYSTEM_EMITTER, event: TRANSFER_EVENT, args: { to: account }, fromBlock: from, toBlock: to }),
    ])
    const out: ChainTransfer[] = []
    for (const log of [...outgoing, ...incoming]) {
      const { transactionHash, logIndex, blockNumber, args } = log
      if (!transactionHash || logIndex === null || blockNumber === null) continue
      if (!args.from || !args.to || args.value === undefined) continue
      const value = args.value / scale
      if (value === 0n) continue // dust below one USDC micro-unit
      out.push({ hash: transactionHash, logIndex, chainId: network.chainId, from: getAddress(args.from), to: getAddress(args.to), value, blockNumber, timestamp: null })
    }
    return out
  } catch (error) {
    if (isLaggingBackend(error) && !retried) {
      await wait(400)
      return logsChunk(client, network, account, from, to, true)
    }
    const width = to - from + 1n
    if (width <= MIN_SPAN) throw error
    const mid = from + width / 2n
    const left = await logsChunk(client, network, account, from, mid - 1n)
    const right = await logsChunk(client, network, account, mid, to)
    return [...left, ...right]
  }
}

/** Scans USDC Transfer logs touching `account` between two blocks (inclusive), in bounded batches. */
export async function scanTransfers(client: PublicClient, network: Network, account: Address, from: bigint, to: bigint): Promise<ChainTransfer[]> {
  const out: ChainTransfer[] = []
  for (let start = from; start <= to; start += SPAN) {
    const end = start + SPAN - 1n > to ? to : start + SPAN - 1n
    out.push(...(await logsChunk(client, network, account, start, end)))
  }
  return dedupe(out)
}

export function dedupe(items: ChainTransfer[]): ChainTransfer[] {
  const map = new Map<string, ChainTransfer>()
  for (const item of items) {
    const key = transferKey(item)
    const existing = map.get(key)
    if (!existing || (existing.timestamp === null && item.timestamp !== null)) map.set(key, item)
  }
  return [...map.values()]
}

/** Looks up block timestamps for the newest transfers; older ones keep a null timestamp. */
export async function attachTimestamps(client: PublicClient, items: ChainTransfer[]): Promise<ChainTransfer[]> {
  const blocks = [...new Set(items.filter((i) => i.timestamp === null).map((i) => i.blockNumber))].sort((a, b) => (a > b ? -1 : 1)).slice(0, 40)
  const stamps = new Map<bigint, number>()
  await Promise.all(
    blocks.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber })
        stamps.set(blockNumber, Number(block.timestamp) * 1000)
      } catch {
        // Leave this block without a timestamp; the UI falls back to the block number.
      }
    }),
  )
  return items.map((i) => (i.timestamp === null && stamps.has(i.blockNumber) ? { ...i, timestamp: stamps.get(i.blockNumber) ?? null } : i))
}

/** One page of history: a bounded window ending at `toBlock` (or the chain head). */
export async function fetchPage(client: PublicClient, network: Network, account: Address, toBlock?: bigint): Promise<HistoryPage> {
  const head = toBlock ?? (await client.getBlockNumber())
  const from = head + 1n > PAGE_SPAN ? head - PAGE_SPAN + 1n : 0n
  const scanned = await scanTransfers(client, network, account, from, head)
  const items = await attachTimestamps(client, scanned)
  return { items, nextTo: from > 0n ? (from - 1n).toString() : undefined }
}

// Live polling keeps an in-memory ledger so every consumer shares one cursor per wallet.
const live = new Map<string, { head: bigint; items: Map<string, ChainTransfer> }>()
const LIVE_OVERLAP = 600n

export async function pollLive(client: PublicClient, network: Network, account: Address): Promise<ChainTransfer[]> {
  const key = `${network.chainId}:${account.toLowerCase()}`
  // Stay a couple of blocks behind the head so a lagging backend never rejects the range.
  const head = (await client.getBlockNumber()) - 2n
  let entry = live.get(key)
  const from = entry ? entry.head + 1n : head > LIVE_OVERLAP ? head - LIVE_OVERLAP : 0n
  if (!entry) {
    entry = { head: from > 0n ? from - 1n : 0n, items: new Map() }
    live.set(key, entry)
  }
  if (head >= from) {
    const boundedFrom = head - from > SPAN - 1n ? head - SPAN + 1n : from
    const found = await attachTimestamps(client, await scanTransfers(client, network, account, boundedFrom, head))
    for (const item of found) entry.items.set(transferKey(item), item)
    entry.head = head
  }
  return [...entry.items.values()]
}
