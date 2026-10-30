import type { LinkPayment } from '../src/shared/links'
import { mutate, read, type DbLink } from './db'
import { StoreConflict, type LinkWithPayments, type Store } from './store-types'

const SIGNATURE_WINDOW_MS = 20 * 60_000

/** Local development store: one JSON file, written atomically. Not for production. */
export class FileStore implements Store {
  readonly kind = 'file' as const

  getLink(id: string): Promise<LinkWithPayments | null> {
    return read((db) => {
      const link = db.links[id]
      return link ? { link, payments: db.payments[id] ?? [] } : null
    })
  }

  listByOwner(ownerDid: string): Promise<LinkWithPayments[]> {
    return read((db) =>
      Object.values(db.links)
        .filter((l) => l.ownerDid === ownerDid)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((link) => ({ link, payments: db.payments[link.id] ?? [] })),
    )
  }

  findPayment(linkId: string, txHash: string): Promise<LinkPayment | null> {
    return read((db) => db.payments[linkId]?.find((payment) => payment.txHash.toLowerCase() === txHash.toLowerCase()) ?? null)
  }

  createLink(link: DbLink, nonce: string): Promise<void> {
    return mutate((db) => {
      if (db.nonces[nonce]) throw new StoreConflict('replayed')
      for (const [n, t] of Object.entries(db.nonces)) if (link.createdAt - t > SIGNATURE_WINDOW_MS) delete db.nonces[n]
      db.nonces[nonce] = link.createdAt
      db.links[link.id] = link
      db.payments[link.id] = []
    })
  }

  deactivate(id: string, ownerDid: string): Promise<LinkWithPayments | null> {
    return mutate((db) => {
      const link = db.links[id]
      if (!link || link.ownerDid !== ownerDid) return null
      link.inactive = true
      return { link, payments: db.payments[id] ?? [] }
    })
  }

  recordPayment(linkId: string, payment: LinkPayment): Promise<LinkPayment> {
    const key = `${payment.txHash.toLowerCase()}:${payment.logIndex}`
    return mutate((db) => {
      const owner = db.claimed[key]
      if (owner && owner !== linkId) throw new StoreConflict('already_claimed')
      if (!owner) {
        db.claimed[key] = linkId
        db.payments[linkId] = [...(db.payments[linkId] ?? []), payment]
      }
      return db.payments[linkId]?.find((p) => `${p.txHash.toLowerCase()}:${p.logIndex}` === key) ?? payment
    })
  }
}
