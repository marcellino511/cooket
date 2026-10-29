import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LinkMode, LinkPayment } from '../src/shared/links'
import { DATA_FILE } from './config'

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

let db: Db | null = null
let queue: Promise<unknown> = Promise.resolve()

async function load(): Promise<Db> {
  if (db) return db
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8')) as Partial<Db>
    db = { ...EMPTY, ...parsed }
  } catch {
    db = structuredClone(EMPTY)
  }
  return db
}

/** Serialises mutations and writes atomically (temp file then rename), so a crash never leaves a half-written file. */
export function mutate<T>(fn: (state: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const state = await load()
    const result = await fn(state)
    await mkdir(dirname(DATA_FILE), { recursive: true })
    const tmp = `${DATA_FILE}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(state), 'utf8')
    await rename(tmp, DATA_FILE)
    return result
  })
  queue = run.catch(() => undefined)
  return run
}

export async function read<T>(fn: (state: Db) => T): Promise<T> {
  await queue
  return fn(await load())
}
