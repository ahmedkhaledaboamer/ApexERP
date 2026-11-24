import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
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
import { activities } from '@/shared/mocks/db'
import { TARGET_KEYS, TARGET_LABELS } from '@/shared/mocks/data/targets'
import { delay, fail } from '@/shared/mocks/server'
import { isClosedStatus, isLostStatus, isWonStatus, probabilityOf } from '@/shared/mocks/data/lookups'
import { pipelineLeads } from '@/shared/mocks/services/leads'
import { targetTotalsFor } from '@/shared/mocks/services/targets'
import { dueThisWeek, isOverdue, myTasks, overdueTasks, toTaskView } from '@/shared/mocks/selectors/tasks'
import { scoped, tenantOf } from '@/shared/mocks/tenant'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { followUpStateOn } from '@/shared/domain/followUp'

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

/** Task figures, all from the shared task selectors so they match My tasks, alerts and reports. */
function taskFigures(user: User): DashboardSummary['tasks'] {
  const scope = scopeOf(user.role, 'tasks')
  const mine = myTasks(user)
  const order = (dueDate: string | null) => dueDate ?? '9999-12-31'
  const next = [...mine]
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || order(a.dueDate).localeCompare(order(b.dueDate)))
    .slice(0, 5)
    .map((t) => toTaskView(t, user))
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
      blocked: t.blocked,
      overdue: t.overdue,
      linkLabel: t.linkView?.label ?? t.projectName,
      ownerName: t.ownerName,
    }))
  return {
    myOpenTasks: mine.length,
    myOverdueTasks: mine.filter((t) => isOverdue(t)).length,
    dueThisWeek: dueThisWeek(user).length,
    teamOverdueTasks: scope === 'hidden' ? 0 : overdueTasks(user).length,
    scope: scope === 'full' || scope === 'team' || scope === 'hidden' ? scope : 'own',
    next,
  }
}

export async function getDashboardSummary(user: User, period: DashboardPeriod = '12m'): Promise<DashboardSummary> {
  if (!DASHBOARD_PERIODS.includes(period)) return fail('Pick 30d, quarter, ytd or 12m.', 422)
  const scope = scopeOf(user.role, 'sales')
  // Everything below is the caller's company only (tenant first, then the role's sales scope).
  const co = tenantOf(user)
  const inScope = scope === 'hidden' ? [] : scoped(pipelineLeads(user), user)
  const scopedIds = new Set(inScope.map((l) => l.id))
  const scopedActivities = activities.filter((a) => scopedIds.has(a.leadId))
  const now = new Date()
  const scale = Math.max(0.15, inScope.length / 30)

  // Open = statuses of type "open" (cold / parked leads are out of the active pipeline).
  const open = inScope.filter((l) => !isClosedStatus(co, l.status))
  const won = inScope.filter((l) => isWonStatus(co, l.status))

  // Follow-ups are company-local calendar dates: "today" is the company's today (timezone, mock clock).
  const companyToday = companyDayOf(co).today
  let dueToday = 0
  let overdue = 0
  for (const l of open) {
    const state = followUpStateOn(l.nextFollowUpDate, companyToday)
    if (state === 'today') dueToday++
    else if (state === 'overdue') overdue++
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
      created: inScope.filter((l) => inRange(l.createdAt, from, to)).length + base.created,
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
  const closedIn = inScope.filter((l) => (isWonStatus(co, l.status) || isLostStatus(co, l.status)) && inRange(l.stageChangedAt, from, to))
  const wonInPeriod = sum('won')
  const lostInPeriod = closedIn.filter((l) => isLostStatus(co, l.status)).length + Math.round(wonInPeriod * 0.45)
  const closedCount = wonInPeriod + lostInPeriod

  // Targets: summed over the agents in scope; actuals come from logged activities (see services/targets).
  // Kinds not tracked for the company (events, without the Events module) come back with actual 0;
  // clients show them as "n/a" and leave them out of the gauge (isTracked in modules/targets/lib).
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
    weightedForecast: Math.round(open.reduce((s, l) => s + (l.value * probabilityOf(co, l.status)) / 100, 0)),
    wonValue: sum('wonValue'),
    wonValuePrev: prev.wonValue,
    wonCount: wonInPeriod,
    totalLeads: inScope.length,
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
    tasks: taskFigures(user),
  })
}
