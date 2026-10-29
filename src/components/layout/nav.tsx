import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, LayoutDashboard, Link2, ListOrdered, Settings, Users } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const icon = 'size-5 shrink-0'

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard className={icon} aria-hidden /> },
  { to: '/send', label: 'Send', icon: <ArrowUpRight className={icon} aria-hidden /> },
  { to: '/receive', label: 'Receive', icon: <ArrowDownLeft className={icon} aria-hidden /> },
  { to: '/activity', label: 'Activity', icon: <ListOrdered className={icon} aria-hidden /> },
  { to: '/payment-links', label: 'Payment Links', icon: <Link2 className={icon} aria-hidden /> },
  { to: '/contacts', label: 'Contacts', icon: <Users className={icon} aria-hidden /> },
  { to: '/settings', label: 'Settings', icon: <Settings className={icon} aria-hidden /> },
]

export function isActive(itemTo: string, pathname: string): boolean {
  return itemTo === '/' ? pathname === '/' : pathname === itemTo || pathname.startsWith(`${itemTo}/`)
}
