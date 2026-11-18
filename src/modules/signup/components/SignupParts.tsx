import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Check } from 'lucide-react'
import { passwordStrength } from '@/shared/lib/passwordStrength'
import { cn } from '@/shared/lib/utils'
import { DEFAULT_BRANDING, PRODUCT_NAME } from '@/modules/tenancy/branding'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'
import { PATHS } from '@/app/paths'

/** Product-level page frame for sign-up and legal pages (Apex CRM branding, no workspace). */
export function ProductShell({ children, aside, wide }: { children: ReactNode; aside?: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-full flex-col bg-surface px-4 py-6 sm:px-10 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <Link to={PATHS.signup} className="flex items-center gap-2">
          <TenantLogo size="sm" branding={DEFAULT_BRANDING} />
          <span className="text-[0.8125rem] font-semibold text-ink">{PRODUCT_NAME}</span>
        </Link>
        {aside}
      </div>
      <div className={cn('mx-auto flex w-full flex-1 flex-col py-10', wide ? 'max-w-5xl' : 'max-w-xl')}>{children}</div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
        <span>
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </span>
        <Link to="/legal/terms" className="hover:text-ink">
          Terms of Service
        </Link>
        <Link to="/legal/privacy" className="hover:text-ink">
          Privacy Policy
        </Link>
      </p>
    </main>
  )
}

export interface StepDef {
  id: string
  label: string
}

/** Horizontal step indicator: done steps get a check, the current one is highlighted. */
export function Stepper({ steps, current }: { steps: StepDef[]; current: number }) {
  return (
    <ol aria-label="Sign-up progress" className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                done && 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500',
                active && 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300',
                !done && !active && 'border-line-strong text-subtle',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn('truncate text-xs font-medium', active ? 'text-ink' : 'text-muted', !active && 'hidden sm:inline')}>
              {s.label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden className={cn('h-px min-w-3 flex-1', done ? 'bg-brand-500' : 'bg-line')} />}
          </li>
        )
      })}
    </ol>
  )
}

const SEGMENT_TONE = ['bg-danger-500', 'bg-danger-500', 'bg-warning-500', 'bg-success-500', 'bg-success-600']
const LABEL_TONE = [
  'text-danger-600 dark:text-danger-500',
  'text-danger-600 dark:text-danger-500',
  'text-warning-700 dark:text-warning-500',
  'text-success-700 dark:text-success-500',
  'text-success-700 dark:text-success-500',
]

/** 4-segment strength bar, label and the first hints for the sign-up password. */
export function PasswordMeter({ password, id }: { password: string; id?: string }) {
  if (!password) return null
  const s = passwordStrength(password)
  return (
    <div id={id} className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('h-1 flex-1 rounded-full transition-colors', s.score >= n ? SEGMENT_TONE[s.score] : 'bg-sunken')} />
        ))}
      </div>
      <p className="mt-1.5 text-xs">
        <span className={cn('font-medium', LABEL_TONE[s.score])}>Password strength: {s.label}</span>
        {s.hints.length > 0 && <span className="text-muted"> · {s.hints.slice(0, 2).join(' ')}</span>}
      </p>
    </div>
  )
}

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function StepHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      {description && <p className="mt-1.5 text-[0.8125rem] text-muted">{description}</p>}
    </div>
  )
}
