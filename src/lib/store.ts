import { useSyncExternalStore } from 'react'

export interface PersistedStore<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: () => void) => () => void
  use: () => T
}

/** A tiny localStorage-backed store. Values must be JSON-serialisable (store bigints as strings). */
export function createStore<T>(key: string, initial: T): PersistedStore<T> {
  const storageKey = `cooket.v1.${key}`
  const listeners = new Set<() => void>()

  const read = (): T => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return initial
      const parsed: unknown = JSON.parse(raw)
      if (initial && typeof initial === 'object' && !Array.isArray(initial)) {
        return { ...initial, ...(parsed as object) }
      }
      return parsed as T
    } catch {
      return initial
    }
  }

  let state = read()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const set = (next: T | ((prev: T) => T)) => {
    state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Storage can be unavailable (private mode, quota). State still updates in memory.
    }
    emit()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const get = () => state

  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) {
      state = read()
      emit()
    }
  })

  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get, get) }
}

export function randomId(bytes = 6): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
