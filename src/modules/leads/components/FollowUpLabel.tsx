import { isBefore, isSameDay, startOfDay } from 'date-fns'
import { CalendarClock } from 'lucide-react'
import type { LeadStatus } from '@/shared/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtDate, toDate } from '@/shared/lib/utils'

export type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

/**
 * Where a follow-up date stands. Pass `closedKeys` (useLookups().closedStatusKeys) to ignore
 * won / lost / parked leads; the server already clears their follow-up date.
 */
export function followUpState(date: string | null, status: LeadStatus, closedKeys?: readonly string[]): FollowUpState {
  const d = toDate(date)
  if (!d || closedKeys?.includes(status)) return 'none'
  const now = new Date()
  if (isSameDay(d, now)) return 'today'
  if (isBefore(d, startOfDay(now))) return 'overdue'
  return 'upcoming'
}

/** Next follow-up date with overdue / today emphasis. */
export function FollowUpLabel({
  date,
  status,
  withIcon = false,
}: {
  date: string | null
  status: LeadStatus
  withIcon?: boolean
}) {
  const { closedStatusKeys } = useLookups()
  const state = followUpState(date, status, closedStatusKeys)
  if (state === 'none') return <span className="text-subtle">—</span>
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        state === 'overdue' && 'font-medium text-danger-600 dark:text-danger-500',
        state === 'today' && 'font-medium text-brand-700 dark:text-brand-300',
        state === 'upcoming' && 'text-ink-2',
      )}
    >
      {withIcon && <CalendarClock className="size-3.5" aria-hidden />}
      {state === 'today' ? 'Today' : fmtDate(date, 'd MMM')}
      {state === 'overdue' && <span className="rounded bg-danger-50 px-1 text-[0.625rem] font-semibold uppercase dark:bg-danger-500/15">Overdue</span>}
    </span>
  )
}
