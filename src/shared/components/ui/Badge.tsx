import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export type Tone = 'neutral' | 'brand' | 'blue' | 'sky' | 'green' | 'amber' | 'red' | 'pink' | 'teal'

/** Soft fill (HubSpot-style pills). */
const SOFT: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/20',
  blue: 'bg-accent-50 text-accent-700 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/20',
  sky: 'bg-info-50 text-info-700 ring-info-100 dark:bg-info-500/15 dark:text-info-500 dark:ring-info-500/20',
  green: 'bg-success-50 text-success-700 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/20',
  amber: 'bg-warning-50 text-warning-700 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/20',
  red: 'bg-danger-50 text-danger-700 ring-danger-100 dark:bg-danger-500/15 dark:text-danger-500 dark:ring-danger-500/20',
  pink: 'bg-pink-50 text-pink-700 ring-pink-100 dark:bg-pink-500/15 dark:text-pink-300 dark:ring-pink-500/20',
  teal: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/20',
}

/** Dot colour for the Attio-style "dot + label" chip. */
export const DOT: Record<Tone, string> = {
  neutral: 'bg-subtle',
  brand: 'bg-brand-500',
  blue: 'bg-accent-500',
  sky: 'bg-info-500',
  green: 'bg-success-500',
  amber: 'bg-warning-500',
  red: 'bg-danger-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
}

interface BadgeProps {
  tone?: Tone
  /** `soft`: tinted pill. `dot`: neutral chip with a coloured dot. `outline`: hairline only. */
  variant?: 'soft' | 'dot' | 'outline'
  children: ReactNode
  className?: string
  icon?: ReactNode
}

export function Badge({ tone = 'neutral', variant = 'soft', children, className, icon }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[1.375rem] max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3',
        variant === 'soft' && SOFT[tone],
        variant === 'dot' && 'bg-surface text-ink-2 ring-line-strong',
        variant === 'outline' && 'text-muted ring-line-strong',
        className,
      )}
    >
      {variant === 'dot' && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}
