import { CalendarClock } from 'lucide-react'
import type { LeadStatus } from '@/shared/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtDate } from '@/shared/lib/utils'
import { followUpStateOn, type FollowUpState } from '@/shared/domain/followUp'
import { companyTodayIso } from '@/modules/leads/lib/followUp'

export type { FollowUpState }

/**
 * Where a follow-up date (a company-local yyyy-MM-dd) stands today in the company's timezone. Pass
 * `closedKeys` (useLookups().closedStatusKeys) to ignore won / lost / parked leads; the server
 * already clears their follow-up date. `today` defaults to the tenant's today.
 */
export function followUpState(
  date: string | null,
  status: LeadStatus,
  closedKeys?: readonly string[],
  today: string = companyTodayIso(),
): FollowUpState {
  return followUpStateOn(date, today, !!closedKeys?.includes(status))
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
