import { useState } from 'react'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Link, useLocation } from '@/lib/router'
import { Modal } from '@/components/ui/Modal'
import { NAV_ITEMS, isActive } from './nav'

const PRIMARY = NAV_ITEMS.slice(0, 4)
const MORE = NAV_ITEMS.slice(4)

export function MobileNav() {
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE.some((i) => isActive(i.to, pathname))

  const itemClass = (active: boolean) =>
    cn('flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-brand' : 'text-muted')

  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-safe md:hidden">
        {PRIMARY.map((item) => {
          const active = isActive(item.to, pathname)
          return (
            <Link key={item.to} to={item.to} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
              {item.icon}
              {item.label}
            </Link>
          )
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={itemClass(moreActive)}>
          <Menu className="size-5" aria-hidden />
          More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="-my-2 divide-y divide-line">
          {MORE.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={cn('flex min-h-[56px] items-center gap-3 text-base font-medium', isActive(item.to, pathname) ? 'text-brand' : 'text-ink')}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  )
}
