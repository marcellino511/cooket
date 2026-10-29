import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Info, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import { shortAddress } from '@/lib/format'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-100', className)} aria-hidden />
}

export async function copyText(text: string, successMessage = 'Copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
    return true
  } catch {
    toast.error('Could not copy. Select the text and copy it manually.')
    return false
  }
}

export function CopyButton({ value, label = 'Copy', className, iconOnly, disabled }: { value: string; label?: string; className?: string; iconOnly?: boolean; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || !value}
      onClick={() => {
        void (async () => {
          if (await copyText(value, `${label.replace(/^Copy\s*/i, '') || 'Value'} copied`)) {
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 1500)
          }
        })()
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-sm font-medium text-muted transition-colors hover:bg-slate-100 hover:text-ink',
        iconOnly ? 'size-9' : 'h-9 px-2.5',
        className,
      )}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

export function ExternalAnchor({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 font-medium text-brand hover:text-brand-hover', className)}
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}

export function Address({ value, full, className }: { value: string; full?: boolean; className?: string }) {
  return (
    <span title={value} className={cn('font-mono text-[13px] text-ink', full && 'break-all', className)}>
      {full ? value : shortAddress(value)}
    </span>
  )
}

const noticeStyles = {
  info: { box: 'border-brand-100 bg-brand-50 text-slate-700', icon: <Info className="size-4 text-brand" aria-hidden /> },
  warning: { box: 'border-warning-100 bg-warning-50 text-slate-700', icon: <AlertTriangle className="size-4 text-warning" aria-hidden /> },
  danger: { box: 'border-danger-100 bg-danger-50 text-slate-700', icon: <XCircle className="size-4 text-danger" aria-hidden /> },
  success: { box: 'border-success-100 bg-success-50 text-slate-700', icon: <CheckCircle2 className="size-4 text-success" aria-hidden /> },
} as const

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof noticeStyles
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const style = noticeStyles[tone]
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', style.box, className)}>
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-muted">{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand' : 'bg-slate-300')}
      >
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-control bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 rounded-lg px-3 text-sm font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function DefinitionRow({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-sm text-muted sm:w-40">
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </dt>
      <dd className="min-w-0 text-sm font-medium text-ink sm:text-right">{children}</dd>
    </div>
  )
}
