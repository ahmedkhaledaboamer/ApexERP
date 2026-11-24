import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { Field } from '@/shared/components/form/Field'
import type { Scope } from '@/shared/types'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { cn } from '@/shared/lib/utils'
import { DAY_STATUS_LABEL, LEAVE_STATUS_LABEL, type DailyRecord, type DayStatus, type LeaveStatus } from '../types'

/** The caller's `hr` scope and what it unlocks on the HR time screens (the API decides; this only shapes the UI). */
export function useHrScope(): { scope: Scope; full: boolean; manage: boolean; userId: string | null } {
  const user = useCurrentUser()
  const scope: Scope = user ? scopeOf(user.role, 'hr') : 'hidden'
  return { scope, full: scope === 'full', manage: scope === 'full' || scope === 'team', userId: user?.id ?? null }
}

export const DAY_TONE: Record<DayStatus, Tone> = {
  present: 'green',
  late: 'amber',
  absent: 'red',
  on_leave: 'sky',
  holiday: 'teal',
  weekend: 'neutral',
  half_day: 'blue',
}

export function DayBadge({ day }: { day: DailyRecord }) {
  if (day.status === 'absent' && day.inProgress) return <Badge tone="neutral">{day.open ? 'In' : 'Not in yet'}</Badge>
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={DAY_TONE[day.status]}>{DAY_STATUS_LABEL[day.status]}</Badge>
      {day.open && <Badge tone="green" variant="dot">Clocked in</Badge>}
      {day.missingCheckOut && <Badge tone="red" variant="outline">No clock-out</Badge>}
    </span>
  )
}

export const LEAVE_TONE: Record<LeaveStatus, Tone> = { pending_head: 'amber', pending_hr: 'amber', approved: 'green', rejected: 'red', cancelled: 'neutral' }

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={LEAVE_TONE[status]}>{LEAVE_STATUS_LABEL[status]}</Badge>
}

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'warning' | 'success' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          'num mt-1 text-[1.375rem] font-semibold text-ink',
          tone === 'danger' && 'text-danger-600 dark:text-danger-500',
          tone === 'warning' && 'text-warning-600 dark:text-warning-500',
          tone === 'success' && 'text-success-600 dark:text-success-500',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  )
}

export function Table({ head, children, minWidth = 640, label }: { head: ReactNode[]; children: ReactNode; minWidth?: number; label: string }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-[0.8125rem]" style={{ minWidth: `${minWidth / 16}rem` }} aria-label={label}>
        <thead>
          <tr className="border-b border-line text-start text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}

export const td = 'px-3 py-2 align-middle'

/** A labelled form field: the label is tied to the control through a generated id. */
export function F({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      {cloneElement(children, { id })}
    </Field>
  )
}

/** "2026-11" → "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "2026-11-23" → "Mon 23 Nov". */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function rangeLabel(from: string, to: string): string {
  return from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
export const errorCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code ?? '') : '')
