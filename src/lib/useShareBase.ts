import { useEffect, useState } from 'react'
import { getShareBase } from './share'

/** Resolves the base URL for links people will copy or share. Null until the handshake finishes. */
export function useShareBase(): string | null {
  const [base, setBase] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void getShareBase().then((value) => {
      if (active) setBase(value)
    })
    return () => {
      active = false
    }
  }, [])
  return base
}
