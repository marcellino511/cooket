import { ON_VERCEL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './config'
import { StorageNotConfigured, type Store } from './store-types'
import { FileStore } from './store-file'
import { SupabaseStore } from './store-supabase'

export { StorageNotConfigured, StoreConflict, StoreUnavailable, type LinkWithPayments, type Store } from './store-types'

let store: Store | null = null

export function getStore(): Store {
  if (store) return store
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    store = new SupabaseStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  } else if (ON_VERCEL) {
    throw new StorageNotConfigured('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on Vercel')
  } else {
    store = new FileStore()
  }
  return store
}

/** Safe to expose: says which backend is active, never a credential. */
export function storageStatus(): 'supabase' | 'file' | 'not_configured' {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return 'supabase'
  return ON_VERCEL ? 'not_configured' : 'file'
}
