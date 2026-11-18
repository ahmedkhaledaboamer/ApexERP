import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/** Chart colours; SVG can't read Tailwind classes. Same set as the dashboard. */
export const C = {
  brand: 'var(--color-brand-600)',
  blue: '#2563eb',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  grey: '#c9c9d1',
}

export const AXIS_TICK = { fill: '#8e8e99', fontSize: '0.75rem' }

export const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-line)',
  borderRadius: 10,
  color: 'var(--color-ink)',
  fontSize: '0.75rem',
  boxShadow: 'var(--shadow-pop)',
}

export const CURSOR = { fill: 'currentColor', fillOpacity: 0.04 }

export function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={line ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-full'} style={{ background: color }} aria-hidden />
      {label}
    </span>
  )
}

export function LegendRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap gap-4 text-[0.8125rem] text-ink-2', className)}>{children}</div>
}

/** Thin horizontal meter with a value label; used for shares, win rates and targets. */
export function Meter({ value, color, className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-sunken', className)} aria-hidden>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? C.brand }} />
    </div>
  )
}

export const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const fmtPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

export function fmtHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return '< 1 h'
  if (h < 48) return `${Math.round(h)} h`
  return `${(h / 24).toFixed(1)} d`
}

/** Section heading inside a report card. */
export function SubHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-[0.8125rem] font-semibold text-ink">{children}</h3>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}
