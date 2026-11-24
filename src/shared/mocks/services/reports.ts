import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  eachMonthOfInterval,
  endOfDay,
  format,
  getDaysInMonth,
  getISODay,
  isAfter,
  isBefore,
  isSameMonth,
  isValid,
  isWithinInterval,
  max as maxDate,
  min as minDate,
  parseISO,
  setDate,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns'
import type { ActivityType, Lead, User } from '@/shared/types'
import { ACTIVITY_TYPES } from '@/shared/lib/constants'
import { isClosedStatus, isLostStatus, isWonStatus, statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import {
  industryLabelOf,
  orderedIndustries,
  orderedSources,
  orderedStatuses,
  sourceLabelOf,
  statusLabelOf,
  subIndustryLabelOf,
} from '@/shared/mocks/lookupChecks'
import { departmentSubtree, inScope, scopeOf } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { companyDayOf, companyTeamIds } from '@/shared/mocks/selectors/company'
import { findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { buildTree, walk } from '@/modules/departments/lib/tree'
import { activities, leads, users } from '@/shared/mocks/db'
import { overdueTasks, toTaskView } from '@/shared/mocks/selectors/tasks'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { TARGET_KEYS, TARGET_LABELS, targetsFor, type TargetKey } from '@/shared/mocks/data/targets'
import { isTracked } from '@/modules/targets/lib'
import { eventsAttendedBy, eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { nextScheduleId, reportSchedules } from '@/shared/mocks/data/reportSchedules'
import { REPORT_IDS } from '@/modules/reports/lib/reportCatalog'
import type {
  AgentRow,
  CustomReport,
  CustomReportInput,
  CustomReportRow,
  FunnelMonth,
  FunnelStep,
  IndustryRow,
  OverdueFollowUp,
  OverdueTask,
  ReportKpis,
  ReportDepartment,
  ReportOwner,
  ReportSchedule,
  ReportScope,
  SalesReport,
  SalesReportQuery,
  ScheduleInput,
  SourceRow,
  StatusRow,
  TargetReport,
  TargetRow,
} from '@/modules/reports/types'
import { isParkedType } from '@/shared/domain/leadStatus'
import { followUpStateOn } from '@/shared/domain/followUp'

/* ------------------------------------------------------------------------------------------
 * Scope: a report shows data according to the viewer's permissions (spec: Reports).
 * The narrower of the role's Reports scope and its Sales scope wins. Every figure is computed
 * over the caller's company only (leads, people, departments, tasks, lookups, schedules).
 * ---------------------------------------------------------------------------------------- */

async function reportScopeOf(user: User): Promise<ReportScope> {
  const sales = scopeOf(user.role, 'sales')
  const reports = scopeOf(user.role, 'reports')
  if (sales === 'hidden' || reports === 'hidden') return fail('Your role has no access to sales reports.', 403)
  if (sales === 'own' || reports === 'own') return 'own'
  if (sales === 'team' || reports === 'team') return 'team'
  return 'full'
}

function ownersFor(user: User, scope: ReportScope): ReportOwner[] {
  if (scope === 'own') return []
  const co = tenantOf(user)
  const ids =
    scope === 'team'
      ? companyTeamIds(user)
      : [...new Set([...scoped(leads, user).map((l) => l.ownerId), ...users.filter((u) => u.companyId === co && u.role === 'Sales Agent').map((u) => u.id)])]
  return ids
    .map((id) => ({ id, name: ownerName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Departments a viewer may filter reports by. full: every department. team: the departments
 * they head and their sub-departments (the department part of the Team scope). own: none.
 */
function departmentsFor(user: User, scope: ReportScope): ReportDepartment[] {
  if (scope === 'own') return []
  const mine = scoped(departments, user)
  const ids =
    scope === 'full'
      ? new Set(mine.map((d) => d.id))
      : new Set(mine.filter((d) => d.active && d.headId === user.id).flatMap((d) => departmentSubtree(d.id, mine)))
  const out: ReportDepartment[] = []
  walk(
    buildTree(
      mine.filter((d) => ids.has(d.id)),
      (a, b) => a.name.localeCompare(b.name),
    ),
    (t) => out.push({ id: t.node.id, name: t.node.name, depth: t.depth, active: t.node.active }),
  )
  return out
}

interface Ctx {
  user: User
  /** The caller's company. */
  co: string
  scope: ReportScope
  owners: ReportOwner[]
  departments: ReportDepartment[]
  /** Owner ids the report covers after the owner filter. */
  ownerIds: Set<string>
  leads: Tenant<Lead>[]
  from: Date
  to: Date
}

async function contextFor(user: User, q: Partial<SalesReportQuery>): Promise<Ctx> {
  const scope = await reportScopeOf(user)
  const from = q.from ? startOfDay(parseISO(q.from)) : null
  const to = q.to ? endOfDay(parseISO(q.to)) : null
  if (!from || !to || !isValid(from) || !isValid(to)) return fail('Pick a valid date range (from and to).', 400)
  if (isAfter(from, to)) return fail('The start date must be on or before the end date.', 400)
  if (differenceInCalendarDays(to, from) > 366 * 3) return fail('Reports cover at most three years at a time.', 400)

  const co = tenantOf(user)
  const team = companyTeamIds(user)
  const allowedDepts = departmentsFor(user, scope)
  let owners = ownersFor(user, scope)
  // Customers added directly never went through the pipeline: kept out of the sales numbers.
  let list = scoped(leads, user).filter((l) => !l.addedAsCustomer && inScope(scope, user, l.ownerId, team))
  if (q.departmentId) {
    if (scope === 'own') return fail('Your role sees only your own records, so it can’t filter by department.', 403)
    // Another company's department is "doesn't exist", like a missing one.
    if (!findInTenant(departments, user, (d) => d.id === q.departmentId)) return fail('That department doesn’t exist.', 404)
    if (!allowedDepts.some((d) => d.id === q.departmentId)) return fail('That department is outside your team.', 403)
    // Membership is the owner's department; a department includes its sub-departments.
    const members = departmentMembers(user, q.departmentId)
    owners = owners.filter((o) => members.has(o.id))
    list = list.filter((l) => members.has(l.ownerId))
    if (q.ownerId && !members.has(q.ownerId)) return fail('That owner isn’t in the selected department.', 422)
  }
  let ownerIds = new Set(scope === 'own' ? [user.id] : owners.map((o) => o.id))
  if (q.ownerId) {
    const allowed = scope === 'own' ? q.ownerId === user.id : owners.some((o) => o.id === q.ownerId)
    if (!allowed) return fail('That owner is outside your access.', 403)
    list = list.filter((l) => l.ownerId === q.ownerId)
    ownerIds = new Set([q.ownerId])
  }
  return { user, co, scope, owners, departments: allowedDepts, ownerIds, leads: list, from, to }
}

/** People of the caller's company in a department or any of its sub-departments. */
function departmentMembers(user: User, departmentId: string): Set<string> {
  const co = tenantOf(user)
  const deptIds = new Set(departmentSubtree(departmentId, scoped(departments, user)))
  return new Set(users.filter((u) => u.companyId === co && u.departmentId && deptIds.has(u.departmentId)).map((u) => u.id))
}

/* ------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------- */

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)
type LeadRow = Tenant<Lead>
const sum = (list: Lead[]) => list.reduce((s, l) => s + l.value, 0)
/** Decided deals (won or lost kinds); parked Cold leads are neither open nor decided. Status kinds come from the lead's company. */
const isClosed = (l: LeadRow) => isWonStatus(l.companyId, l.status) || isLostStatus(l.companyId, l.status)
const isLost = (l: LeadRow) => isLostStatus(l.companyId, l.status)
const isWon = (l: LeadRow) => isWonStatus(l.companyId, l.status)
/** Lookup keys first (configured order), then any key only found on old records. */
const keysWithRecords = (listed: { key: string; active: boolean }[], used: string[]) => [
  ...new Set([...listed.filter((i) => i.active || used.includes(i.key)).map((i) => i.key), ...used.filter(Boolean)]),
]

function inRange(iso: string, ctx: Pick<Ctx, 'from' | 'to'>): boolean {
  return isWithinInterval(new Date(iso), { start: ctx.from, end: ctx.to })
}

/** Leads created in the range. */
const createdIn = (ctx: Ctx) => ctx.leads.filter((l) => inRange(l.createdAt, ctx))
/** Leads whose deal was decided in the range (their stage date is the close date). */
const closedIn = (ctx: Ctx) => ctx.leads.filter((l) => isClosed(l) && inRange(l.stageChangedAt, ctx))
const wonIn = (ctx: Ctx) => closedIn(ctx).filter(isWon)

function scopedActivities(ctx: Ctx) {
  const ids = new Set(ctx.leads.map((l) => l.id))
  return activities.filter((a) => ids.has(a.leadId))
}

/* ------------------------------------------------------------------------------------------
 * Reports
 * ---------------------------------------------------------------------------------------- */

function kpis(ctx: Ctx): ReportKpis {
  const won = wonIn(ctx)
  const closed = closedIn(ctx)
  const wonValue = sum(won)
  const days = won.map((l) => Math.max(0, differenceInCalendarDays(new Date(l.stageChangedAt), new Date(l.createdAt))))
  return {
    leadsCreated: createdIn(ctx).length,
    wonCount: won.length,
    wonValue,
    closedCount: closed.length,
    conversionRate: pct(won.length, closed.length),
    avgDealSize: won.length ? Math.round(wonValue / won.length) : 0,
    avgDaysToClose: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
    activitiesLogged: scopedActivities(ctx).filter((a) => inRange(a.at, ctx)).length,
  }
}

function byStatus(ctx: Ctx): StatusRow[] {
  const cohort = createdIn(ctx)
  const keys = keysWithRecords(orderedStatuses(ctx.co), cohort.map((l) => l.status))
  return keys.map((status) => {
    const list = cohort.filter((l) => l.status === status)
    return { status, label: statusLabelOf(ctx.co, status), count: list.length, share: pct(list.length, cohort.length), value: sum(list) }
  })
}

/** The main New → Won journey (built-in keys; labels and on/off come from the lookups). */
const FUNNEL_PATH = [
  SYSTEM_STATUS.new,
  SYSTEM_STATUS.contacted,
  SYSTEM_STATUS.interested,
  SYSTEM_STATUS.meeting,
  SYSTEM_STATUS.proposal,
  SYSTEM_STATUS.won,
]

function funnelStages(co: string): string[] {
  return FUNNEL_PATH.filter((k) => statusOf(co, k)?.active)
}

/**
 * How far along the funnel a lead in a status got: path statuses by position; other open
 * statuses by their configured order; won = the end; parked = contacted; lost = Lost after
 * interest, any other lost status after contact.
 */
function reachOf(co: string, status: string, stages: string[]): number {
  const at = stages.indexOf(status)
  if (at >= 0) return at
  const s = statusOf(co, status)
  if (!s) return 0
  if (s.type === 'won') return stages.length - 1
  const contacted = Math.max(0, stages.indexOf(SYSTEM_STATUS.contacted))
  if (isParkedType(s.type)) return contacted
  if (s.type === 'lost') return status === SYSTEM_STATUS.lost ? Math.max(contacted, stages.indexOf(SYSTEM_STATUS.interested)) : contacted
  let reach = 0
  stages.forEach((k, i) => {
    const o = statusOf(co, k)
    if (o && o.type === 'open' && o.order < s.order) reach = i
  })
  return reach
}

function funnel(ctx: Ctx): FunnelStep[] {
  const cohort = createdIn(ctx)
  const stages = funnelStages(ctx.co)
  const counts = stages.map((_, i) => (i === 0 ? cohort.length : cohort.filter((l) => reachOf(ctx.co, l.status, stages) >= i).length))
  return stages.map((stage, i) => ({
    stage,
    label: statusLabelOf(ctx.co, stage),
    reached: counts[i],
    fromPrevious: i === 0 ? 100 : pct(counts[i], counts[i - 1]),
    fromStart: pct(counts[i], counts[0]),
  }))
}

function byIndustry(ctx: Ctx): IndustryRow[] {
  const cohort = createdIn(ctx)
  const listed = orderedIndustries(ctx.co)
  const names = keysWithRecords(listed, cohort.map((l) => l.industry))
  return names
    .map((industry) => {
      const list = cohort.filter((l) => l.industry === industry)
      const won = list.filter(isWon)
      const listedSubs = listed.find((i) => i.key === industry)?.subIndustries ?? []
      const subs = keysWithRecords(listedSubs, list.map((l) => l.subIndustry))
      return {
        industry,
        label: industryLabelOf(ctx.co, industry),
        leads: list.length,
        value: sum(list),
        won: won.length,
        wonValue: sum(won),
        winRate: pct(won.length, list.filter(isClosed).length),
        subIndustries: subs
          .map((subIndustry) => {
            const sl = list.filter((l) => l.subIndustry === subIndustry)
            const sw = sl.filter(isWon).length
            return { subIndustry, label: subIndustryLabelOf(ctx.co, industry, subIndustry), leads: sl.length, value: sum(sl), won: sw, winRate: pct(sw, sl.filter(isClosed).length) }
          })
          .sort((a, b) => b.leads - a.leads || b.value - a.value),
      }
    })
    .filter((r) => r.leads > 0)
    .sort((a, b) => b.leads - a.leads || b.value - a.value)
}

function bySource(ctx: Ctx): SourceRow[] {
  const cohort = createdIn(ctx)
  return keysWithRecords(orderedSources(ctx.co), cohort.map((l) => l.sourceType)).map((source) => {
    const list = cohort.filter((l) => l.sourceType === source)
    const won = list.filter(isWon)
    const lost = list.filter(isLost)
    const details = [...new Set(list.map((l) => l.sourceDetail))].map((detail) => {
      const dl = list.filter((l) => l.sourceDetail === detail)
      return { detail, leads: dl.length, won: dl.filter(isWon).length, value: sum(dl) }
    })
    return {
      source,
      label: sourceLabelOf(ctx.co, source),
      leads: list.length,
      won: won.length,
      lost: lost.length,
      value: sum(list),
      wonValue: sum(won),
      winRate: pct(won.length, won.length + lost.length),
      details: details.sort((a, b) => b.leads - a.leads),
    }
  }).sort((a, b) => b.leads - a.leads)
}

/**
 * Same stable baseline as the dashboard mock (services/dashboard.ts): the seed only covers a
 * few months, so earlier months get synthetic totals scaled to the caller's share of the data.
 * The real backend computes these from history.
 */
function baseline(monthIndex: number, scale: number) {
  const i = ((monthIndex % 12) + 12) % 12
  const wave = [3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 10][i]
  return {
    created: Math.round(wave * scale),
    won: Math.round((wave / 3) * scale),
    wonValue: Math.round(((wave * 23_000 + ((Math.abs(monthIndex) * 9_973) % 40_000)) * scale) / 1000) * 1000,
  }
}

function funnelMonthly(ctx: Ctx): FunnelMonth[] {
  const now = new Date()
  // Trends stop at the current month; future months have nothing to show yet.
  const end = startOfMonth(minDate([ctx.to, now]))
  const start = minDate([startOfMonth(ctx.from), subMonths(end, 5)])
  const months = eachMonthOfInterval({ start: maxDate([start, subMonths(end, 23)]), end })
  const scale = Math.max(0.15, ctx.leads.length / 30)
  return months.map((month) => {
    const created = ctx.leads.filter((l) => isSameMonth(new Date(l.createdAt), month))
    const won = ctx.leads.filter((l) => isWon(l) && isSameMonth(new Date(l.stageChangedAt), month))
    const offset = differenceInCalendarMonths(now, month)
    const base = offset >= 1 ? baseline(11 - offset, scale) : { created: 0, won: 0, wonValue: 0 }
    const c = created.length + base.created
    const w = won.length + base.won
    return {
      month: format(month, 'yyyy-MM'),
      label: format(month, 'MMM yy'),
      created: c,
      won: w,
      wonValue: sum(won) + base.wonValue,
      conversion: pct(w, c),
    }
  })
}

function agentRows(ctx: Ctx): AgentRow[] {
  const acts = scopedActivities(ctx).filter((a) => inRange(a.at, ctx))
  const cohort = createdIn(ctx)
  const closed = closedIn(ctx)
  const ids = [...ctx.ownerIds].filter((id) => ctx.leads.some((l) => l.ownerId === id) || users.find((u) => u.id === id)?.role === 'Sales Agent')
  return ids
    .map((userId) => {
      const mine = acts.filter((a) => a.userId === userId)
      const byType = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, mine.filter((a) => a.type === t).length])) as Record<ActivityType, number>
      const myClosed = closed.filter((l) => l.ownerId === userId)
      const myWon = myClosed.filter(isWon)
      const myLeads = cohort.filter((l) => l.ownerId === userId)
      const responses = myLeads
        .map((l) => {
          const first = activities
            .filter((a) => a.leadId === l.id)
            .reduce<string | null>((m, a) => (m === null || a.at < m ? a.at : m), null)
          return first ? (new Date(first).getTime() - new Date(l.createdAt).getTime()) / 3_600_000 : null
        })
        .filter((h): h is number => h !== null && h >= 0)
      const proposals = ctx.leads.filter(
        (l) => l.ownerId === userId && (l.status === SYSTEM_STATUS.proposal || isWon(l)) && inRange(l.stageChangedAt, ctx),
      ).length
      return {
        userId,
        name: ownerName(userId),
        leads: myLeads.length,
        activities: byType,
        totalActivities: mine.length,
        meetings: byType.meeting,
        proposals,
        won: myWon.length,
        wonValue: sum(myWon),
        closed: myClosed.length,
        conversion: pct(myWon.length, myClosed.length),
        avgResponseHours: responses.length ? Math.round((responses.reduce((s, h) => s + h, 0) / responses.length) * 10) / 10 : null,
      }
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.totalActivities - a.totalActivities)
}

/** Reached the proposal stage or beyond: open statuses ordered at/after Proposal, or won. */
function reachedProposal(l: LeadRow): boolean {
  if (isWonStatus(l.companyId, l.status)) return true
  const s = statusOf(l.companyId, l.status)
  const proposal = statusOf(l.companyId, SYSTEM_STATUS.proposal)
  return !!s && !!proposal && s.type === 'open' && s.order >= proposal.order
}

/** Kinds with no data source yet: partnerships stay at the paced mock level. Events attended come from the Events module. */
const NOT_TRACKED: TargetKey[] = ['partnerships']

const ACTIVITY_FOR_TARGET: Partial<Record<TargetKey, ActivityType[]>> = {
  calls: ['call'],
  emails: ['email', 'whatsapp'],
  visits: ['visit'],
  meetings: ['meeting'],
}

function targetReport(ctx: Ctx): TargetReport {
  const now = new Date()
  const month = startOfMonth(isAfter(ctx.to, now) ? now : ctx.to)
  const key = format(month, 'yyyy-MM')
  const elapsed = isSameMonth(month, now) ? (now.getDate() / getDaysInMonth(now)) * 100 : isBefore(month, now) ? 100 : 0
  const inMonth = (iso: string) => isSameMonth(new Date(iso), month)

  const agentIds =
    ctx.scope === 'own'
      ? [ctx.user.id]
      : [...ctx.ownerIds].filter((id) => users.find((u) => u.id === id)?.role === 'Sales Agent')

  const rows: TargetRow[] = agentIds.map((userId, agentIndex) => {
    const goals = targetsFor(userId, key)
    const mineLeads = scoped(leads, ctx.user).filter((l) => l.ownerId === userId)
    const mineActs = activities.filter((a) => a.userId === userId && inMonth(a.at))
    const eventsOn = eventsEnabledIn(ctx.user.companyId)
    const cells = TARGET_KEYS.map((k, keyIndex) => {
      // Events attended: real counts from the Events module only (no pacing); n/a without the module.
      if (k === 'events') {
        const actual = eventsOn ? eventsAttendedBy(ctx.user.companyId, userId, key) : 0
        return { key: k, label: TARGET_LABELS[k], target: goals[k], actual, pct: goals[k] && eventsOn ? Math.round((actual / goals[k]) * 100) : 0 }
      }
      const real = NOT_TRACKED.includes(k)
        ? 0
        : k === 'leads'
          ? mineLeads.filter((l) => inMonth(l.createdAt)).length
          : k === 'proposals'
            ? mineLeads.filter((l) => reachedProposal(l) && inMonth(l.stageChangedAt)).length
            : mineActs.filter((a) => ACTIVITY_FOR_TARGET[k]?.includes(a.type)).length
      // Like the dashboard, pace the mock towards a realistic month-to-date level.
      const factor = 0.6 + ((agentIndex * 13 + keyIndex * 7) % 55) / 100
      const paced = Math.round(goals[k] * (elapsed / 100) * factor)
      const actual = Math.max(real, paced)
      return { key: k, label: TARGET_LABELS[k], target: goals[k], actual, pct: goals[k] ? Math.round((actual / goals[k]) * 100) : 0 }
    })
    // A target of 0 means "no target", and untracked kinds (events without the module) are n/a: neither counts toward the overall.
    const counted = cells.filter((c) => c.target > 0 && isTracked(c.key, eventsOn))
    const overall = counted.length ? Math.round(counted.reduce((s, c) => s + Math.min(100, c.pct), 0) / counted.length) : 0
    return { userId, name: ownerName(userId), cells, overall }
  })

  return { month: key, monthLabel: format(month, 'MMMM yyyy'), elapsed: Math.round(elapsed), rows: rows.sort((a, b) => b.overall - a.overall) }
}

function overdue(ctx: Ctx, q: Partial<SalesReportQuery>): { followUps: OverdueFollowUp[]; tasks: OverdueTask[] } {
  // Follow-ups are company-local calendar dates; overdue = before the company's today.
  const today = companyDayOf(ctx.user.companyId).today
  const followUps = ctx.leads
    .filter((l) => !isClosedStatus(l.companyId, l.status) && followUpStateOn(l.nextFollowUpDate, today) === 'overdue')
    .map((l) => ({
      leadId: l.id,
      company: l.company,
      status: l.status,
      ownerId: l.ownerId,
      ownerName: ownerName(l.ownerId),
      dueDate: l.nextFollowUpDate as string,
      daysOverdue: daysBetweenIso(l.nextFollowUpDate as string, today),
      nextStep: l.nextStep,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
  return { followUps, tasks: overdueTaskRows(ctx, q) }
}

/**
 * Overdue tasks: the shared overdueTasks selector (the viewer's tasks scope — the same numbers as
 * the dashboard and the bell), narrowed by the report's scope and its department / owner filters.
 * Covers every kind of task (project delivery, lead follow-up, customer, personal).
 */
function overdueTaskRows(ctx: Ctx, q: Partial<SalesReportQuery>): OverdueTask[] {
  // The company's today (regional timezone, mock clock), as the overdueTasks selector uses.
  const day = companyDayOf(ctx.user.companyId)
  let members: Set<string> | null = null
  if (q.departmentId) {
    // contextFor already validated the department against the viewer's access.
    members = departmentMembers(ctx.user, q.departmentId)
  }
  const team = ctx.scope === 'team' ? new Set(companyTeamIds(ctx.user)) : null
  return scoped(overdueTasks(ctx.user, day), ctx.user)
    .filter(
      (t) =>
        (ctx.scope !== 'own' || t.ownerId === ctx.user.id) &&
        (!team || team.has(t.ownerId) || t.followerIds.includes(ctx.user.id)) &&
        (!members || members.has(t.ownerId)) &&
        (!q.ownerId || t.ownerId === q.ownerId),
    )
    .map((t) => toTaskView(t, ctx.user))
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      // The related link (lead, customer, event), else the task's project.
      linkType: t.linkView?.type ?? (t.projectId ? ('project' as const) : null),
      linkId: t.linkView?.id ?? t.projectId,
      linkLabel: t.linkView?.label ?? t.projectName,
      linkAvailable: t.linkView?.available ?? !!t.projectId,
      projectId: t.projectId,
      projectName: t.projectName,
      ownerId: t.ownerId,
      ownerName: t.ownerName,
      dueDate: t.dueDate as string,
      daysOverdue: daysBetweenIso(t.dueDate as string, day.today),
      priority: t.priority,
      status: t.status,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}

export async function getSalesReport(user: User, q: Partial<SalesReportQuery>): Promise<SalesReport> {
  const ctx = await contextFor(user, q)
  const late = overdue(ctx, q)
  return delay({
    query: {
      from: q.from as string,
      to: q.to as string,
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    },
    scope: ctx.scope,
    owners: ctx.owners,
    departments: ctx.departments,
    generatedAt: new Date().toISOString(),
    kpis: kpis(ctx),
    byStatus: byStatus(ctx),
    funnel: funnel(ctx),
    byIndustry: byIndustry(ctx),
    bySource: bySource(ctx),
    funnelMonthly: funnelMonthly(ctx),
    agents: agentRows(ctx),
    targets: targetReport(ctx),
    overdueFollowUps: late.followUps,
    overdueTasks: late.tasks,
  })
}

/* ------------------------------------------------------------------------------------------
 * Report builder
 * ---------------------------------------------------------------------------------------- */

const DIMENSIONS = ['status', 'industry', 'source', 'owner', 'month'] as const
const MEASURES = ['count', 'value', 'wonValue', 'conversion'] as const

export async function runCustomReport(user: User, input: Partial<CustomReportInput>): Promise<CustomReport> {
  if (!input.dimension || !DIMENSIONS.includes(input.dimension)) return fail('Pick what to group by.', 422)
  if (!input.measure || !MEASURES.includes(input.measure)) return fail('Pick what to measure.', 422)
  const ctx = await contextFor(user, input)
  const { dimension, measure } = input
  const cohort = createdIn(ctx)
  const won = wonIn(ctx)

  type Group = { key: string; label: string; match: (l: LeadRow, date: string) => boolean }
  let groups: Group[]
  switch (dimension) {
    case 'status':
      groups = keysWithRecords(orderedStatuses(ctx.co), ctx.leads.map((l) => l.status)).map((s) => ({
        key: s,
        label: statusOf(ctx.co, s)?.label ?? s,
        match: (l) => l.status === s,
      }))
      break
    case 'industry':
      groups = keysWithRecords(orderedIndustries(ctx.co), ctx.leads.map((l) => l.industry)).map((i) => ({
        key: i,
        label: industryLabelOf(ctx.co, i),
        match: (l) => l.industry === i,
      }))
      break
    case 'source':
      groups = keysWithRecords(orderedSources(ctx.co), ctx.leads.map((l) => l.sourceType)).map((s) => ({
        key: s,
        label: sourceLabelOf(ctx.co, s),
        match: (l) => l.sourceType === s,
      }))
      break
    case 'owner':
      groups = [...ctx.ownerIds].map((id) => ({ key: id, label: ownerName(id), match: (l) => l.ownerId === id }))
      break
    case 'month': {
      const end = startOfMonth(ctx.to)
      const first = startOfMonth(ctx.from)
      const months = eachMonthOfInterval({ start: maxDate([first, subMonths(end, 23)]), end })
      groups = months.map((m) => ({ key: format(m, 'yyyy-MM'), label: format(m, 'MMM yyyy'), match: (_l, date) => isSameMonth(new Date(date), m) }))
      break
    }
  }

  const rows: CustomReportRow[] = groups.map((g) => {
    const list = cohort.filter((l) => g.match(l, l.createdAt))
    let value: number
    if (measure === 'count') value = list.length
    else if (measure === 'value') value = sum(list)
    else if (measure === 'wonValue') value = sum(won.filter((l) => g.match(l, l.stageChangedAt)))
    else value = pct(list.filter(isWon).length, list.filter(isClosed).length)
    return { key: g.key, label: g.label, value, leads: list.length }
  })

  const sorted = dimension === 'industry' || dimension === 'owner' ? rows.sort((a, b) => b.value - a.value || b.leads - a.leads) : rows
  const total =
    measure === 'count'
      ? cohort.length
      : measure === 'value'
        ? sum(cohort)
        : measure === 'wonValue'
          ? sum(won)
          : pct(cohort.filter(isWon).length, cohort.filter(isClosed).length)

  // Echo only the known query fields (never unknown body keys such as a spoofed companyId).
  const echo: CustomReportInput = { from: input.from!, to: input.to!, dimension, measure }
  if (input.ownerId) echo.ownerId = input.ownerId
  if (input.departmentId) echo.departmentId = input.departmentId
  return delay({ input: echo, rows: sorted, total })
}

/* ------------------------------------------------------------------------------------------
 * Scheduled e-mail delivery
 * ---------------------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function nextRun(s: Pick<ReportSchedule, 'frequency' | 'day' | 'time'>, now = new Date()): string {
  const [h, m] = s.time.split(':').map(Number)
  const at = (d: Date) => {
    const x = startOfDay(d)
    x.setHours(h, m, 0, 0)
    return x
  }
  if (s.frequency === 'weekly') {
    let d = at(addDays(now, (s.day - getISODay(now) + 7) % 7))
    if (!isAfter(d, now)) d = addDays(d, 7)
    return d.toISOString()
  }
  let d = at(setDate(now, s.day))
  if (!isAfter(d, now)) d = at(setDate(addMonths(startOfMonth(now), 1), s.day))
  return d.toISOString()
}

/** Client shape: next run filled in, companyId left out. */
function withNextRun(row: Tenant<ReportSchedule>): ReportSchedule {
  const { companyId: _co, ...s } = row
  return { ...s, nextRunAt: nextRun(s) }
}

export async function getSchedules(user: User): Promise<ReportSchedule[]> {
  const scope = await reportScopeOf(user)
  const list = scoped(reportSchedules, user)
    .filter((s) => scope === 'full' || s.createdBy === user.id)
    .map(withNextRun)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
  return delay(list)
}

export async function createSchedule(user: User, input: Partial<ScheduleInput>): Promise<ReportSchedule> {
  await reportScopeOf(user)
  const report = input.report
  if (!report || !(report === 'all' || REPORT_IDS.includes(report))) return fail('Pick a report to send.', 422)
  if (input.frequency !== 'weekly' && input.frequency !== 'monthly') return fail('Pick weekly or monthly.', 422)
  const day = Number(input.day)
  const maxDay = input.frequency === 'weekly' ? 7 : 28
  if (!Number.isInteger(day) || day < 1 || day > maxDay) return fail('Pick a valid delivery day.', 422)
  if (!input.time || !TIME.test(input.time)) return fail('Pick a delivery time.', 422)
  if (input.format !== 'excel' && input.format !== 'pdf') return fail('Pick Excel or PDF.', 422)
  const recipients = [...new Set((input.recipients ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean))]
  if (recipients.length === 0) return fail('Add at least one recipient.', 422)
  if (recipients.length > 10) return fail('Send to at most 10 recipients.', 422)
  const bad = recipients.find((r) => !EMAIL.test(r))
  if (bad) return fail(`“${bad}” isn’t a valid e-mail address.`, 422)

  const schedule = stamp<ReportSchedule>({
    id: nextScheduleId(),
    report,
    frequency: input.frequency,
    day,
    time: input.time,
    recipients,
    format: input.format,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
    nextRunAt: '',
  }, user)
  reportSchedules.push(schedule)
  return delay(withNextRun(schedule))
}

export async function deleteSchedule(user: User, id: string): Promise<{ id: string }> {
  const scope = await reportScopeOf(user)
  // Another company's schedule answers exactly like a missing one.
  const co = tenantOf(user)
  const index = reportSchedules.findIndex((s) => s.id === id && s.companyId === co)
  if (index < 0) return fail('That schedule no longer exists.', 404)
  if (scope !== 'full' && reportSchedules[index].createdBy !== user.id) return fail('Only its creator can remove this schedule.', 403)
  reportSchedules.splice(index, 1)
  return delay({ id })
}
