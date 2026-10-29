import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { STEPS, type Step } from './useSendFlow'

export function Stepper({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Payment progress">
      <p className="text-sm font-medium text-ink sm:hidden">
        Step {index + 1} of {STEPS.length}: <span className="text-muted">{STEPS[index].label}</span>
      </p>
      <div className="mt-2 flex gap-1.5 sm:hidden" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s.id} className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-brand' : 'bg-slate-200')} />
        ))}
      </div>
      <ol className="hidden items-center sm:flex">
        {STEPS.map((s, i) => {
          const done = i < index
          const active = i === index
          return (
            <li key={s.id} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')} aria-current={active ? 'step' : undefined}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                    done && 'bg-brand text-white',
                    active && 'bg-brand-50 text-brand ring-2 ring-brand',
                    !done && !active && 'bg-slate-100 text-muted',
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className={cn('text-sm font-medium', active ? 'text-ink' : 'text-muted')}>{s.label}</span>
              </span>
              {i < STEPS.length - 1 && <span className={cn('mx-3 h-px flex-1', done ? 'bg-brand' : 'bg-slate-200')} aria-hidden />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
