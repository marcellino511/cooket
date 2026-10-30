import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { LinkMode, LinkPayment } from '../src/shared/links'
import { DATA_FILE } from './config'
import { StoreUnavailable } from './store-types'

export interface DbLink {
  id: string
  ownerDid: string
  recipient: `0x${string}`
  description: string
  merchant?: string
  mode: LinkMode
  amountRaw?: string
  expiresAt?: number
  createdAt: number
  inactive?: boolean
  /** Set when the link was created while a router was configured. */
  router?: `0x${string}`
}

export interface Db {
  links: Record<string, DbLink>
  payments: Record<string, LinkPayment[]>
  /** `${txHash}:${logIndex}` to the link that claimed it. A transfer can pay only one link, once. */
  claimed: Record<string, string>
  /** Used creation nonces, to reject replayed signatures. */
  nonces: Record<string, number>
}

const EMPTY: Db = { links: {}, payments: {}, claimed: {}, nonces: {} }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const optional = (row: Record<string, unknown>, name: string, check: (value: unknown) => boolean) => row[name] === undefined || check(row[name])
const isString = (value: unknown): value is string => typeof value === 'string'

/** Validate structure without changing stored values or imposing new payment business rules. */
function decode(text: string): Db {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new StoreUnavailable('Development database contains invalid JSON; the file was not replaced.') }
  if (!isRecord(value)) throw new StoreUnavailable('Development database must contain a JSON object; the file was not replaced.')
  for (const key of ['links', 'payments', 'claimed', 'nonces']) {
    if (value[key] !== undefined && !isRecord(value[key])) throw new StoreUnavailable(`Development database has an invalid ${key} map; the file was not replaced.`)
  }
  const state = { ...structuredClone(EMPTY), ...value }
  const validLink = (row: unknown) => isRecord(row) &&
    ['id', 'ownerDid', 'recipient', 'description'].every((key) => isString(row[key])) &&
    (row.mode === 'fixed' || row.mode === 'open') && isNumber(row.createdAt) &&
    ['merchant', 'amountRaw', 'router'].every((key) => optional(row, key, isString)) &&
    optional(row, 'expiresAt', isNumber) && optional(row, 'inactive', (v) => typeof v === 'boolean')
  const validPayment = (row: unknown) => isRecord(row) &&
    ['txHash', 'payer', 'amountRaw', 'blockNumber'].every((key) => isString(row[key])) &&
    ['logIndex', 'paidAt', 'verifiedAt'].every((key) => isNumber(row[key]))
  if (!Object.values(state.links).every(validLink) ||
      !Object.values(state.payments).every((rows) => Array.isArray(rows) && rows.every(validPayment)) ||
      !Object.values(state.claimed).every(isString) || !Object.values(state.nonces).every(isNumber)) {
    throw new StoreUnavailable('Development database contains malformed records; the file was not replaced.')
  }
  return state
}

const hasCode = (error: unknown, code: string) => error !== null && typeof error === 'object' && 'code' in error && error.code === code

type Snapshot = { text: string; identity: string } | null

/** Each instance uses fresh disk reads and serializes both reads and writes. No failed state is cached. */
export function createFileDatabase(file: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const lockFile = `${file}.lock`

  async function snapshot(): Promise<Snapshot> {
    let stat
    try { stat = await lstat(file) } catch (error) {
      if (hasCode(error, 'ENOENT')) return null
      throw new StoreUnavailable('Development database cannot be inspected; no data was replaced.')
    }
    // In particular, a dangling symlink is an existing path, not a missing database.
    if (!stat.isFile()) throw new StoreUnavailable('Development database must be a regular file; no data was replaced.')
    try {
      const bytes = await readFile(file)
      // Reject invalid UTF-8 instead of silently replacing bytes with replacement characters.
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      return { text, identity: `${stat.dev}:${stat.ino}` }
    } catch {
      throw new StoreUnavailable('Development database cannot be read; no data was replaced.')
    }
  }

  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn)
    queue = run.catch(() => undefined)
    return run
  }

  function read<T>(fn: (state: Db) => T): Promise<T> {
    return serialized(async () => {
      const current = await snapshot()
      return fn(current === null ? structuredClone(EMPTY) : decode(current.text))
    })
  }

  function mutate<T>(fn: (state: Db) => T | Promise<T>): Promise<T> {
    return serialized(async () => {
      let lock
      try {
        await mkdir(dirname(file), { recursive: true })
        lock = await open(lockFile, 'wx', 0o600)
      } catch (error) {
        if (hasCode(error, 'EEXIST')) throw new StoreUnavailable('Development database is locked. Retry after the active writer finishes; leftover locks require manual inspection.')
        throw new StoreUnavailable('Development database cannot be locked for writing; no data was replaced.')
      }
      const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
      let tempCreated = false
      try {
        const original = await snapshot()
        const state = original === null ? structuredClone(EMPTY) : decode(original.text)
        const result = await fn(state)
        // Catch invalid mutations before touching disk. Preserve unknown fields and legacy optional maps.
        const text = JSON.stringify(state)
        decode(text)
        try {
          const pending = await open(tmp, 'wx', 0o600)
          tempCreated = true
          try { await pending.writeFile(text, 'utf8') } finally { await pending.close() }
          const current = await snapshot()
          if (current?.identity !== original?.identity || current?.text !== original?.text) {
            throw new StoreUnavailable('Development database changed during the write; no data was replaced.')
          }
          if (original === null) {
            // Atomic creation without replacing a file that appeared after our last check.
            await link(tmp, file)
          } else {
            await rename(tmp, file)
            tempCreated = false
          }
        } catch (error) {
          if (error instanceof StoreUnavailable) throw error
          throw new StoreUnavailable('Development database write failed; no automatic recovery was attempted.')
        }
        return result
      } finally {
        if (tempCreated) await unlink(tmp).catch(() => undefined)
        try {
          await lock.close()
          await unlink(lockFile)
        } catch {
          throw new StoreUnavailable('Development database lock could not be released; inspect it manually before retrying. A completed write may already be saved.')
        }
      }
    })
  }

  return { read, mutate }
}

const database = createFileDatabase(DATA_FILE)
export const read = database.read
export const mutate = database.mutate
