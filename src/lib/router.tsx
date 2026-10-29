import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const NAV_EVENT = 'cooket:navigate'

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAV_EVENT, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAV_EVENT, listener)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export function useLocation() {
  const full = useSyncExternalStore(subscribe, snapshot, snapshot)
  const idx = full.indexOf('?')
  const pathname = idx === -1 ? full : full.slice(0, idx)
  const search = idx === -1 ? '' : full.slice(idx)
  return { pathname: pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname, search, params: new URLSearchParams(search) }
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === snapshot()) return
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
  window.scrollTo({ top: 0 })
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (rest.target && rest.target !== '_self') return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
