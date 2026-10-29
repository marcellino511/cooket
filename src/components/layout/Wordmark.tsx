import { cn } from '@/lib/cn'
import { Link } from '@/lib/router'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#60A5FA" />
      <path
        d="M21.2 11.4A6.4 6.4 0 1 0 21.2 20.6"
        fill="none"
        stroke="#080B12"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="22.6" cy="16" r="1.9" fill="#080B12" />
    </svg>
  )
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link to="/" aria-label="Cooket home" className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="text-[19px] font-semibold tracking-tight text-ink">Cooket</span>}
    </Link>
  )
}
