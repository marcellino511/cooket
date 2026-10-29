import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { TxStatus } from '@/domain/types'

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand',
  success: 'bg-success-50 text-success',
  warning: 'bg-warning-50 text-warning',
  danger: 'bg-danger-50 text-danger',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

const statusMeta: Record<TxStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  completed: { label: 'Completed', tone: 'success', icon: <CheckCircle2 className="size-3.5" aria-hidden /> },
  pending: { label: 'Pending', tone: 'warning', icon: <Clock className="size-3.5" aria-hidden /> },
  failed: { label: 'Failed', tone: 'danger', icon: <AlertCircle className="size-3.5" aria-hidden /> },
}

export function StatusBadge({ status }: { status: TxStatus }) {
  const meta = statusMeta[status]
  return (
    <Badge tone={meta.tone}>
      {meta.icon}
      {meta.label}
    </Badge>
  )
}
