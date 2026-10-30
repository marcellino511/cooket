import type { LinkPayment } from '../src/shared/links'
import type { DbLink } from './db'

export interface LinkWithPayments {
  link: DbLink
  payments: LinkPayment[]
}

/** A uniqueness rule was hit: a creation signature reused, or a transfer already counted for a link. */
export class StoreConflict extends Error {
  constructor(readonly kind: 'replayed' | 'already_claimed') {
    super(kind)
  }
}

/** The storage backend could not be reached or answered unexpectedly. */
export class StoreUnavailable extends Error {}

/** Production has no durable storage configured. The server refuses to run on an ephemeral disk. */
export class StorageNotConfigured extends Error {}

export interface Store {
  readonly kind: 'supabase' | 'file'
  getLink(id: string): Promise<LinkWithPayments | null>
  /** Exact lookup, independent of any paginated list of the link's payments. */
  findPayment(linkId: string, txHash: string): Promise<LinkPayment | null>
  listByOwner(ownerDid: string): Promise<LinkWithPayments[]>
  /** Stores the link and burns the creation nonce atomically enough that a replayed signature fails with StoreConflict('replayed'). */
  createLink(link: DbLink, nonce: string): Promise<void>
  /** Turns a link off for its owner. Returns null when the link does not exist or belongs to someone else. */
  deactivate(id: string, ownerDid: string): Promise<LinkWithPayments | null>
  /** Records a verified payment. A (txHash, logIndex) pair is unique across all links; a second claim by another link fails with StoreConflict('already_claimed'). */
  recordPayment(linkId: string, payment: LinkPayment): Promise<LinkPayment>
}

