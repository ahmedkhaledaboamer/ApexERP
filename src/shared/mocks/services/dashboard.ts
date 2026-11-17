import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  isBefore,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'
import type { DashboardPeriod, DashboardSummary, SeriesPoint, TargetLine, User } from '@/shared/types'
import { scopeOf } from '@/shared/lib/permissions'
import { toDate } from '@/shared/lib/utils'
import { activities } from '@/shared/mocks/db'
import { TARGET_KEYS, TARGET_LABELS } from '@/shared/mocks/data/targets'
import { delay, fail } from '@/shared/mocks/server'
import { isClosedStatus, isLostStatus, isWonStatus, probabilityOf } from '@/shared/mocks/data/lookups'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { targetTotalsFor } from '@/shared/mocks/services/targets'

export const DASHBOARD_PERIODS: DashboardPeriod[] = ['30d', 'quarter', 'ytd', '12m']

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  '30d': 'Last 30 days',
  quarter: 'Last quarter',
  ytd: 'Year to date',
  '12m': 'Last 12 months',
}

interface Bucket {
  start: Date
  /** Exclusive. */
  end: Date
  label: string
}

/** Buckets for a period ending today: daily for 30 days, weekly for a quarter, monthly otherwise. */
function bucketsFor(period: DashboardPeriod, now: Date): Bucket[] {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  if (period === '30d') {
    return Array.from({ length: 30 }, (_, i) => {
      const start = subDays(today, 29 - i)
      return { start, end: addDays(start, 1), label: format(start, 'd MMM') }
    })
  }
  if (period === 'quarter') {
    const first = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 12)
    return Array.from({ length: 13 }, (_, i) => {
      const start = addWeeks(first, i)
      return { start, end: i === 12 ? tomorrow : addWeeks(start, 1), label: format(start, 'd MMM') }
    })
  }
  const first = period === 'ytd' ? startOfYear(today) : subMonths(startOfMonth(today), 11)
  const count = period === 'ytd' ? today.getMonth() + 1 : 12
  return Array.from({ length: count }, (_, i) => {
    const start = addMonths(first, i)
    return { start, end: i === count - 1 ? tomorrow : addMonths(start, 1), label: format(start, 'MMM') }
  })
}

/** The comparison window: same length just before, or for YTD the same dates last year. */
function previousRange(period: DashboardPeriod, from: Date, to: Date): { from: Date; to: Date } {
  if (period === 'ytd') return { from: subYears(from, 1), to: subYears(to, 1) }
  const days = differenceInCalendarDays(to, from)
  return { from: subDays(from, days), to: from }
}

/**
 * The seed only covers a few months, so every bucket gets a stable synthetic baseline scaled to
 * its length and the caller's share of the data. The real backend returns real counts only.
 */
function baseline(start: Date, end: Date, scale: number) {
  const WAVE = [6, 7, 9, 8, 10, 9, 7, 6, 9, 11, 10, 12]
  const days = Math.max(1, differenceInCalendarDays(end, start))
  const f = (days / 30) * scale
  const wave = WAVE[start.getMonth()]
  const jitter = ((start.getDate() * 7 + start.getMonth() * 13) % 5) / 10 + 0.8
  return {
    created: Math.round(wave * f * jitter),
    won: Math.round((wave / 3.2) * f * jitter),
    wonValue: Math.round((wave * 24_000 * f * jitter) / 1000) * 1000,
    activities: Math.round(wave * 10 * f * jitter),
  }
}

export async function getDashboardSummary(user: User, period: DashboardPeriod = '12m'): Promise<DashboardSummary> {
  if (!DASHBOARD_PERIODS.includes(period)) return fail('Pick 30d, quarter, ytd or 12m.', 422)
  const scope = scopeOf(user.role, 'sales')
  const scoped = scope === 'hidden' ? [] : visibleLeads(user)
  const scopedIds = new Set(scoped.map((l) => l.id))
  const scopedActivities = activities.filter((a) => scopedIds.has(a.leadId))
  const now = new Date()
  const today = startOfDay(now)
  const scale = Math.max(0.15, scoped.length / 30)

  // Open = statuses of kind "open" (parked Cold leads are out of the active pipeline).
  const open = scoped.filter((l) => !isClosedStatus(l.status))
  const won = scoped.filter((l) => isWonStatus(l.status))

  let dueToday = 0
  let overdue = 0
  for (const l of open) {
    const d = toDate(l.nextFollowUpDate)
    if (!d) continue
    if (isSameDay(d, now)) dueToday++
    else if (isBefore(d, today)) overdue++
  }

  const inRange = (iso: string, from: Date, to: Date) => {
    const t = new Date(iso).getTime()
    return t >= from.getTime() && t < to.getTime()
  }

  /** Real records plus the synthetic baseline for one window. */
  function measure(from: Date, to: Date) {
    const base = baseline(from, to, scale)
    const wonIn = won.filter((l) => inRange(l.stageChangedAt, from, to))
    return {
      created: scoped.filter((l) => inRange(l.createdAt, from, to)).length + base.created,
      won: wonIn.length + base.won,
      wonValue: wonIn.reduce((s, l) => s + l.value, 0) + base.wonValue,
      activities: scopedActivities.filter((a) => inRange(a.at, from, to)).length + base.activities,
    }
  }

  const buckets = bucketsFor(period, now)
  const series: SeriesPoint[] = buckets.map((b) => ({ label: b.label, start: format(b.start, 'yyyy-MM-dd'), ...measure(b.start, b.end) }))
  const from = buckets[0].start
  const to = buckets[buckets.length - 1].end
  const sum = (key: 'created' | 'won' | 'wonValue' | 'activities') => series.reduce((s, p) => s + p[key], 0)

  // The previous window is measured in the same bucket sizes so baselines compare like for like.
  const prevRange = previousRange(period, from, to)
  const prevBuckets = buckets.map((b) => {
    const offset = differenceInCalendarDays(b.start, from)
    const len = differenceInCalendarDays(b.end, b.start)
    const start = addDays(prevRange.from, offset)
    return { start, end: addDays(start, len) }
  })
  const prev = prevBuckets.reduce(
    (acc, b) => {
      const m = measure(b.start, b.end)
      return { created: acc.created + m.created, wonValue: acc.wonValue + m.wonValue, activities: acc.activities + m.activities }
    },
    { created: 0, wonValue: 0, activities: 0 },
  )

  // Win rate from deals closed inside the period.
  const closedIn = scoped.filter((l) => (isWonStatus(l.status) || isLostStatus(l.status)) && inRange(l.stageChangedAt, from, to))
  const wonInPeriod = sum('won')
  const lostInPeriod = closedIn.filter((l) => isLostStatus(l.status)).length + Math.round(wonInPeriod * 0.45)
  const closedCount = wonInPeriod + lostInPeriod

  // Targets: summed over the agents in scope; actuals come from logged activities (see services/targets).
  // Kinds not tracked yet (events, until EVENTS_ENABLED) come back with actual 0; clients show
  // them as "n/a" and leave them out of the gauge (isTracked in modules/targets/lib).
  const totals = targetTotalsFor(user, now)
  const targets: TargetLine[] = TARGET_KEYS.map((key) => ({
    key,
    label: TARGET_LABELS[key],
    target: totals.values[key],
    actual: totals.actuals[key],
  }))

  return delay({
    period,
    periodLabel: PERIOD_LABEL[period],
    from: format(from, 'yyyy-MM-dd'),
    to: format(subDays(to, 1), 'yyyy-MM-dd'),
    openPipelineValue: open.reduce((s, l) => s + l.value, 0),
    openLeads: open.length,
    weightedForecast: Math.round(open.reduce((s, l) => s + (l.value * probabilityOf(l.status)) / 100, 0)),
    wonValue: sum('wonValue'),
    wonValuePrev: prev.wonValue,
    wonCount: wonInPeriod,
    totalLeads: scoped.length,
    newLeads: sum('created'),
    newLeadsPrev: prev.created,
    winRate: closedCount ? Math.round((wonInPeriod / closedCount) * 100) : 0,
    closedCount,
    followUpsDueToday: dueToday,
    followUpsOverdue: overdue,
    activities: sum('activities'),
    activitiesPrev: prev.activities,
    series,
    targets,
  })
}
