import { addMonths, format, parseISO } from 'date-fns'
import type { Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type { CyclePhase, PendingAction, ProbationRecommendation, ReviewStage, SalesKpi } from '@/modules/hr/performance/types'
import { DUE_SOON_DAYS, PHASE_LABEL } from '@/modules/hr/performance/types'
import { goalWeightProblem } from '@/modules/hr/performance/calc'
import { scopeOf } from '@/shared/lib/permissions'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { users } from '@/shared/mocks/db'
import { now as clockNow } from '@/shared/mocks/clock'
import { companyById } from '@/shared/mocks/data/tenancy'
import { employeeById, employeeForUser } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { TARGET_KEYS, TARGET_LABELS } from '@/shared/mocks/data/targets'
import { hrPerfCycles, hrPerfGoals, hrPerfReviews, type PerfCycleRecord, type PerfGoalRecord, type PerfReviewRecord } from '@/shared/mocks/data/hrPerformance'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { hrFullUsers, logHr, type HrActor } from './hrAccess'
import { teamEmployeeIds, type HrCtx } from './hrTimeAccess'
import { rowFor } from './targets'

/**
 * Shared rules of HR › Performance (docs/API.md › HR › Performance): who sees / acts on a review, review
 * stages, who must act next, notifications (stored, type `hr`, once-only through marks), probation outcomes.
 *
 * WHO SEES A REVIEW (the company always comes from the session; anything else answers 404 like a missing id):
 *   own      the employee themself, WHATEVER their `hr` scope (self-service, like leave): goals, their
 *            self-assessment; the manager's assessment, scores and final rating only once shared;
 *            never the HR calibration
 *   manager  the direct manager (employees.manager_id at launch), whatever their `hr` scope (a Sales
 *            Manager reviews their agents): writes the manager assessment, approves goals
 *   team     a Department Head (`hr` team): the reviews of their team, read-only
 *   hr       HR full (Company Admin, Management, HR Manager): every review incl. calibration; acts as the
 *            reviewer when the employee has no manager with an active login
 * Nobody sees a peer's review.
 */

export const PERF_ALERT_TYPE = 'hr'
export const reviewLink = (id: string) => `/hr/performance?review=${encodeURIComponent(id)}`
export const cycleLink = (id: string) => `/hr/performance?tab=cycles&cycle=${encodeURIComponent(id)}`

export const notFound = () => new CodedApiError(NOT_FOUND, 404, 'not_found')
export const forbidden = (message = 'Your role can’t do this in Performance.') => new CodedApiError(message, 403, 'forbidden')
export const invalid = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}) => new CodedApiError(message, 422, code, details)
export const conflict = (message: string, code: string) => new CodedApiError(message, 409, code)

export const plusMonths = (iso: string, months: number) => format(addMonths(parseISO(iso), months), 'yyyy-MM-dd')

export interface PerfCtx extends HrCtx {
  stamp: string
}

/** The caller's context (company from the session, company calendar day at the mock clock). */
export function perfCtx(user: User, at: Date = clockNow()): PerfCtx {
  const co = tenantOf(user)
  const c = companyById(co)
  const own = employeeForUser(co, user.id)
  return {
    user,
    co,
    scope: scopeOf(user.role, 'hr') as Scope,
    self: own && own.status !== 'terminated' ? own : undefined,
    timezone: c?.regional.timezone ?? DEFAULT_REGION.timezone,
    weekend: c?.regional.weekend ?? DEFAULT_REGION.weekend,
    country: c?.regional.country ?? 'AE',
    now: at,
    today: companyDayOf(co, at).today,
    stamp: at.toISOString(),
  }
}

export const isFull = (ctx: PerfCtx) => ctx.scope === 'full'
export function requireFull(ctx: PerfCtx): void {
  if (!isFull(ctx)) throw forbidden('Only HR (Company Admin, Management or HR Manager) can manage review cycles and templates.')
}

export const cycleOf = (co: string, id: string) => hrPerfCycles.find((c) => c.companyId === co && c.id === id)
export const reviewsOfCycle = (co: string, cycleId: string) => hrPerfReviews.filter((r) => r.companyId === co && r.cycleId === cycleId)
export const goalsOfReview = (co: string, reviewId: string) => hrPerfGoals.filter((g) => g.companyId === co && g.reviewId === reviewId)

/* ---------------- Who acts ---------------- */

/** The active user behind an employee id, if any. */
export function userOfEmployee(co: string, employeeId: string | null): User | undefined {
  const e = employeeId ? employeeById(co, employeeId) : undefined
  if (!e?.userId || e.status === 'terminated') return undefined
  return users.find((u) => u.id === e.userId && u.companyId === co && u.active !== false)
}

/** No direct manager with an active login: HR full acts as the reviewer. */
export const managerUnavailable = (r: Tenant<PerfReviewRecord>) => !userOfEmployee(r.companyId, r.managerId)

/** Users who write the manager assessment: the direct manager, or every HR-full user (not the employee). */
export function reviewerUsers(r: Tenant<PerfReviewRecord>): User[] {
  const m = userOfEmployee(r.companyId, r.managerId)
  if (m) return [m]
  const emp = employeeById(r.companyId, r.employeeId)
  return hrFullUsers(r.companyId).filter((u) => u.id !== emp?.userId)
}

export interface Relation {
  own: boolean
  hr: boolean
  /** Writes the manager assessment (direct manager, or HR when there's none). */
  manager: boolean
  team: boolean
}

export function relationTo(ctx: PerfCtx, r: Tenant<PerfReviewRecord>, team?: Set<string>): Relation {
  const own = !!ctx.self && r.employeeId === ctx.self.id
  const hr = !own && isFull(ctx)
  const direct = !own && !!ctx.self && r.managerId === ctx.self.id
  const manager = direct || (hr && managerUnavailable(r))
  const inTeam = !own && ctx.scope === 'team' && (team ?? teamEmployeeIds(ctx)).has(r.employeeId)
  return { own, hr, manager, team: inTeam }
}

export const canSee = (rel: Relation) => rel.own || rel.hr || rel.manager || rel.team

/** Reviews the caller may see (own + direct reports + team + all for HR). */
export function visibleReviews(ctx: PerfCtx): { review: Tenant<PerfReviewRecord>; rel: Relation }[] {
  const team = ctx.scope === 'team' ? teamEmployeeIds(ctx) : new Set<string>()
  const out: { review: Tenant<PerfReviewRecord>; rel: Relation }[] = []
  for (const r of hrPerfReviews) {
    if (r.companyId !== ctx.co) continue
    const rel = relationTo(ctx, r, team)
    if (canSee(rel)) out.push({ review: r, rel })
  }
  return out
}

/** A review the caller may see, or 404 (another company's id answers exactly like a missing one). */
export function visibleReview(ctx: PerfCtx, id: string): { review: Tenant<PerfReviewRecord>; cycle: Tenant<PerfCycleRecord>; rel: Relation } {
  const review = hrPerfReviews.find((r) => r.companyId === ctx.co && r.id === id)
  if (!review) throw notFound()
  const rel = relationTo(ctx, review)
  if (!canSee(rel)) throw notFound()
  const cycle = cycleOf(ctx.co, review.cycleId)
  if (!cycle) throw notFound()
  return { review, cycle, rel }
}

/* ---------------- Stage ---------------- */

export function stageOf(r: PerfReviewRecord, cycle: PerfCycleRecord): ReviewStage {
  if (r.acknowledgedAt) return 'acknowledged'
  if (r.sharedAt) return 'shared'
  if (r.manager.submittedAt) return cycle.phase === 'closed' ? 'incomplete' : 'calibration'
  if (cycle.phase === 'closed') return 'incomplete'
  if (cycle.phase === 'goal_setting') return 'goal_setting'
  if (cycle.template.selfReview && !r.self.submittedAt && cycle.phase === 'self_review') return 'self_review'
  return 'manager_review'
}

export function deadlineOf(cycle: PerfCycleRecord, phase: CyclePhase = cycle.phase): string | null {
  const d = cycle.deadlines
  if (phase === 'goal_setting') return d.goalSetting
  if (phase === 'self_review') return d.selfReview
  if (phase === 'manager_review') return d.managerReview
  if (phase === 'calibration') return d.calibration
  return null
}

const OPEN_PHASES: CyclePhase[] = ['goal_setting', 'self_review', 'manager_review']
export const isOpenPhase = (p: CyclePhase) => OPEN_PHASES.includes(p)

export function goalsReady(co: string, r: PerfReviewRecord): { weightsOk: boolean; approved: boolean } {
  const goals = goalsOfReview(co, r.id)
  return { weightsOk: goalWeightProblem(goals.map((g) => g.weight)) === null, approved: goals.length > 0 && goals.every((g) => g.approved) }
}

/** The next step of a review and who takes it (null when nobody has to act right now). */
export function pendingOf(r: Tenant<PerfReviewRecord>, cycle: PerfCycleRecord): { action: PendingAction; by: 'employee' | 'manager' } | null {
  if (r.sharedAt) return r.acknowledgedAt ? null : { action: 'acknowledge', by: 'employee' }
  if (r.manager.submittedAt || !isOpenPhase(cycle.phase)) return null
  if (cycle.phase === 'goal_setting') {
    const g = goalsReady(r.companyId, r)
    if (!g.weightsOk) return { action: 'set_goals', by: 'employee' }
    return g.approved ? null : { action: 'approve_goals', by: 'manager' }
  }
  if (cycle.phase === 'self_review') return cycle.template.selfReview && !r.self.submittedAt ? { action: 'self_review', by: 'employee' } : null
  return { action: 'manager_review', by: 'manager' }
}

export const pendingDeadline = (_r: PerfReviewRecord, cycle: PerfCycleRecord, action: PendingAction | undefined): string | null =>
  action === 'acknowledge' || !action ? null : deadlineOf(cycle)

/* ---------------- Notifications (stored, once-only) ---------------- */

export function notifyUsers(co: string, userIds: Iterable<string>, title: string, body: string, link: string, at: string): number {
  let sent = 0
  for (const id of new Set(userIds)) {
    const u = users.find((x) => x.id === id && x.companyId === co && x.active !== false)
    if (!u) continue
    pushNotification({ companyId: co, userId: u.id, type: PERF_ALERT_TYPE, title, body, link, at })
    sent++
  }
  return sent
}

/** Marks `key` on the record; false when it was already there (the notification was sent before). */
export function markOnce(rec: { marks: string[] }, key: string): boolean {
  if (rec.marks.includes(key)) return false
  rec.marks.push(key)
  return true
}

const due = (d: string | null) => (d ? ` Due ${d}.` : '')

/** Phase-opened notifications to whoever takes part in that phase (once per cycle and phase). */
export function announcePhase(cycle: Tenant<PerfCycleRecord>, at: string): number {
  if (!markOnce(cycle, `phase:${cycle.phase}`)) return 0
  const co = cycle.companyId
  const reviews = reviewsOfCycle(co, cycle.id)
  const deadline = deadlineOf(cycle)
  switch (cycle.phase) {
    case 'goal_setting':
      return reviews.reduce((n, r) => n + notifyUsers(co, [userOfEmployee(co, r.employeeId)?.id ?? ''], `Set your goals for ${cycle.name}`, `Goals are weighted and must total 100%; your manager approves them.${due(deadline)}`, reviewLink(r.id), at), 0)
    case 'self_review':
      return reviews.reduce(
        (n, r) => n + (r.self.submittedAt ? 0 : notifyUsers(co, [userOfEmployee(co, r.employeeId)?.id ?? ''], `Your self-review for ${cycle.name} is open`, `Rate yourself on each competency and goal.${due(deadline)}`, reviewLink(r.id), at)),
        0,
      )
    case 'manager_review': {
      const perReviewer = new Map<string, number>()
      for (const r of reviews) if (!r.manager.submittedAt) for (const u of reviewerUsers(r)) perReviewer.set(u.id, (perReviewer.get(u.id) ?? 0) + 1)
      let n = 0
      for (const [userId, count] of perReviewer) {
        const one = reviews.length === 1 ? reviews[0] : undefined
        const what = cycle.type === 'probation' && one ? `Probation review of ${employeeById(co, one.employeeId)?.fullName ?? 'an employee'}` : `Manager reviews for ${cycle.name}`
        n += notifyUsers(co, [userId], `${what}: ${count} to complete`, `Rate each competency${cycle.template.goalsEnabled ? ' and goal' : ''} and add your comments.${due(deadline)}`, one ? reviewLink(one.id) : '/hr/performance?tab=team', at)
      }
      return n
    }
    case 'calibration':
      return notifyUsers(co, hrFullUsers(co).map((u) => u.id), `${cycle.name} is ready for calibration`, `Check the ratings, adjust where needed (with a note) and share the results.${due(deadline)}`, cycleLink(cycle.id), at)
    default:
      return 0
  }
}

/** The review was shared: the employee is told once. */
export function announceShared(r: Tenant<PerfReviewRecord>, cycle: PerfCycleRecord, at: string): number {
  if (!markOnce(r, 'shared')) return 0
  const u = userOfEmployee(r.companyId, r.employeeId)
  return u ? notifyUsers(r.companyId, [u.id], `Your ${cycle.name} review has been shared`, 'Read your result and your manager’s comments, then acknowledge it.', reviewLink(r.id), at) : 0
}

/** The employee acknowledged: the manager and HR are told once. */
export function announceAcknowledged(r: Tenant<PerfReviewRecord>, cycle: PerfCycleRecord, at: string): number {
  if (!markOnce(r, 'ack')) return 0
  const emp = employeeById(r.companyId, r.employeeId)
  const ids = [...reviewerUsers(r), ...hrFullUsers(r.companyId)].map((u) => u.id).filter((id) => id !== emp?.userId)
  return notifyUsers(r.companyId, ids, `${emp?.fullName ?? 'An employee'} acknowledged their ${cycle.name} review`, r.ackComment ? `Comment: ${r.ackComment.slice(0, 200)}` : 'No comment.', reviewLink(r.id), at)
}

/** Due-soon / overdue reminders for the one who must act (once per review, phase and deadline). */
export function remindDue(cycle: Tenant<PerfCycleRecord>, today: string, at: string): number {
  const deadline = deadlineOf(cycle)
  if (!deadline || cycle.phase === 'draft' || cycle.phase === 'shared' || cycle.phase === 'closed') return 0
  const left = daysBetweenIso(today, deadline)
  const kind = left < 0 ? 'overdue' : left <= DUE_SOON_DAYS ? 'due' : null
  if (!kind) return 0
  const co = cycle.companyId
  const when = left < 0 ? `was due ${deadline}` : left === 0 ? 'is due today' : `is due in ${left} day${left === 1 ? '' : 's'} (${deadline})`
  let sent = 0
  if (cycle.phase === 'calibration') {
    const waiting = reviewsOfCycle(co, cycle.id).filter((r) => r.manager.submittedAt && !r.sharedAt).length
    if (waiting && markOnce(cycle, `${kind}:calibration:${deadline}`)) {
      sent += notifyUsers(co, hrFullUsers(co).map((u) => u.id), `Calibration of ${cycle.name} ${when}`, `${waiting} review${waiting === 1 ? '' : 's'} to calibrate and share.`, cycleLink(cycle.id), at)
    }
    return sent
  }
  for (const r of reviewsOfCycle(co, cycle.id)) {
    const p = pendingOf(r, cycle)
    if (!p || p.action === 'acknowledge') continue
    if (!markOnce(r, `${kind}:${cycle.phase}:${deadline}`)) continue
    const emp = employeeById(co, r.employeeId)
    const to = p.by === 'employee' ? [userOfEmployee(co, r.employeeId)?.id ?? ''] : reviewerUsers(r).map((u) => u.id)
    const whose = p.by === 'employee' ? 'Your' : `${emp?.fullName ?? 'An employee'}’s`
    sent += notifyUsers(co, to, `${whose} ${PHASE_LABEL[cycle.phase].toLowerCase()} for ${cycle.name} ${when}`, kind === 'overdue' ? 'This step is overdue.' : 'Please complete it before the deadline.', reviewLink(r.id), at)
  }
  return sent
}

/* ---------------- Probation outcome ---------------- */

export interface ProbationOutcomeEvent {
  companyId: string
  employeeId: string
  reviewId: string
  contractId: string | null
  outcome: ProbationRecommendation
  /** The new probation end date when extended. */
  newProbationEndDate: string | null
  at: string
}

const outcomeListeners = new Map<string, (e: ProbationOutcomeEvent) => void>()

/**
 * SEAM for other HR sections (onboarding / offboarding journeys): called when HR shares a probation review
 * and its outcome is applied. Register once per module with a stable name.
 */
export function onProbationOutcome(name: string, listener: (e: ProbationOutcomeEvent) => void): void {
  outcomeListeners.set(name, listener)
}

/**
 * Applies the probation outcome (the HR override, else the manager's recommendation):
 *   confirm    activity "Probation confirmed" on the employee
 *   extend     the active contract's probation end date moves by the recommended months (its probation
 *              reminder re-arms itself: the contract marks are keyed by date)
 *   terminate  recorded + HR told; HR then sets the employee's status / exit date through Employees
 */
export function applyProbationOutcome(r: Tenant<PerfReviewRecord>, cycle: Tenant<PerfCycleRecord>, actor: HrActor, at: string): void {
  const outcome = r.probationOutcome ?? r.manager.recommendation
  if (cycle.type !== 'probation' || !outcome || r.outcomeAppliedAt) return
  const co = r.companyId
  r.probationOutcome = outcome
  r.outcomeAppliedAt = at
  let newEnd: string | null = null
  const contract = cycle.probationContractId ? hrContracts.find((c) => c.companyId === co && c.id === cycle.probationContractId) : undefined
  if (outcome === 'confirm') {
    logHr(co, r.employeeId, actor, 'performance', 'Probation confirmed (probation review shared)', at)
  } else if (outcome === 'extend') {
    const months = Math.max(1, Math.min(6, r.manager.extendMonths ?? 3))
    if (contract && contract.status === 'active' && contract.probationEndDate) {
      newEnd = plusMonths(contract.probationEndDate, months)
      contract.probationEndDate = newEnd
      contract.probationMonths = Math.min(12, contract.probationMonths + months)
      contract.updatedAt = at
    }
    logHr(co, r.employeeId, actor, 'performance', `Probation extended by ${months} month${months === 1 ? '' : 's'}${newEnd ? ` (to ${newEnd})` : ''}`, at)
  } else {
    logHr(co, r.employeeId, actor, 'performance', 'Probation review: end of employment recommended', at)
    const emp = employeeById(co, r.employeeId)
    notifyUsers(co, hrFullUsers(co).map((u) => u.id), `End of employment recommended for ${emp?.fullName ?? 'an employee'}`, 'Their probation review is shared. Set the status and exit date in Employees to start the offboarding.', reviewLink(r.id), at)
  }
  const event: ProbationOutcomeEvent = { companyId: co, employeeId: r.employeeId, reviewId: r.id, contractId: contract?.id ?? null, outcome, newProbationEndDate: newEnd, at }
  for (const l of outcomeListeners.values()) {
    try {
      l(event)
    } catch {
      /* a listener never breaks the review flow */
    }
  }
}

/** SEAM for the onboarding checklist: the latest probation review of an employee (null when none yet). */
export function probationReviewFor(companyId: string, employeeId: string): { reviewId: string; stage: ReviewStage; recommendation: ProbationRecommendation | null; outcome: ProbationRecommendation | null; sharedAt: string | null } | null {
  const cycles = hrPerfCycles.filter((c) => c.companyId === companyId && c.type === 'probation').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const c of cycles) {
    const r = hrPerfReviews.find((x) => x.companyId === companyId && x.cycleId === c.id && x.employeeId === employeeId)
    if (r) return { reviewId: r.id, stage: stageOf(r, c), recommendation: r.manager.recommendation, outcome: r.probationOutcome, sharedAt: r.sharedAt }
  }
  return null
}

/* ---------------- Sales KPIs (optional, read-only) ---------------- */

/**
 * The employee's sales targets vs actuals summed over the review period's months up to today (the same
 * numbers as Sales › Targets, services/targets.ts rowFor). Only for employees with a login whose sales scope
 * is `own` (agents); null otherwise. Shown to the manager / HR as context, never scored automatically.
 */
export function salesKpisFor(co: string, employee: Employee, periodStart: string, periodEnd: string, today: string): SalesKpi[] | null {
  const u = employee.userId ? users.find((x) => x.id === employee.userId && x.companyId === co) : undefined
  if (!u || u.role !== 'Sales Agent') return null
  const end = periodEnd < today ? periodEnd : today
  if (end < periodStart) return null
  const months: string[] = []
  for (let m = periodStart.slice(0, 7); m <= end.slice(0, 7) && months.length < 12; m = plusMonths(`${m}-01`, 1).slice(0, 7)) months.push(m)
  const sum = Object.fromEntries(TARGET_KEYS.map((k) => [k, { target: 0, actual: 0 }])) as Record<string, { target: number; actual: number }>
  for (const m of months) {
    const row = rowFor(u, parseISO(`${m}-01`))
    for (const k of TARGET_KEYS) {
      if (row.values[k] <= 0) continue
      sum[k].target += row.values[k]
      sum[k].actual += row.actuals[k]
    }
  }
  const out = TARGET_KEYS.filter((k) => sum[k].target > 0).map((k) => ({
    key: k,
    label: TARGET_LABELS[k],
    target: sum[k].target,
    actual: sum[k].actual,
    attainmentPct: Math.round((sum[k].actual / sum[k].target) * 100),
  }))
  return out.length ? out : null
}

export type { PerfGoalRecord }
