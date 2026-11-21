import type { User } from '@/shared/types'
import type {
  AcknowledgeInput,
  Answer,
  Assessment,
  AssessmentInput,
  CalibrateInput,
  Calibration,
  Cycle,
  CycleDetail,
  CycleInput,
  CyclePhase,
  CycleType,
  DepartmentProgress,
  Goal,
  GoalInput,
  GoalRating,
  GoalStatus,
  ManagerAssessmentInput,
  MyPerformance,
  PerformanceOptions,
  PhaseDeadlines,
  ProbationRecommendation,
  RatingLevel,
  ReviewDetail,
  ReviewRow,
  ReviewStage,
  ReviewTemplate,
  TemplateInput,
  TemplateSection,
  TemplateSnapshot,
} from '@/modules/hr/performance/types'
import { CYCLE_TYPES, DEFAULT_SCALE, GOAL_STATUSES, PHASE_LABEL, PROBATION_LOOKAHEAD_DAYS, PROBATION_RECOMMENDATIONS, REVIEW_STAGES } from '@/modules/hr/performance/types'
import { goalWeightProblem, labelOf, nextPhase, ratingFromScore, scoresOf, weightsOf } from '@/modules/hr/performance/calc'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { employeeById, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrCourses } from '@/shared/mocks/data/hrTalent'
import {
  emptyAssessment,
  emptyManagerAssessment,
  ensurePerfTemplates,
  hrPerfCycles,
  hrPerfGoals,
  hrPerfReviews,
  hrPerfTemplates,
  nextPerfId,
  snapshotOf,
  type PerfCycleRecord,
  type PerfGoalRecord,
  type PerfReviewRecord,
  type PerfTemplateRecord,
} from '@/shared/mocks/data/hrPerformance'
import { delay } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import { logHr, hrFullUsers } from './hrAccess'
import {
  announceAcknowledged,
  announcePhase,
  announceShared,
  applyProbationOutcome,
  conflict,
  cycleOf,
  deadlineOf,
  forbidden,
  goalsOfReview,
  invalid,
  isFull,
  isOpenPhase,
  notFound,
  notifyUsers,
  pendingDeadline,
  pendingOf,
  perfCtx,
  requireFull,
  reviewerUsers,
  reviewLink,
  reviewsOfCycle,
  salesKpisFor,
  stageOf,
  userOfEmployee,
  visibleReview,
  visibleReviews,
  type PerfCtx,
  type Relation,
} from './hrPerformanceCore'
import { runPerformanceTick } from './hrPerformanceTick'

/**
 * HR › Performance (docs/API.md › HR › Performance). Templates and cycles are HR full; reviews and goals follow
 * hrPerformanceCore.ts (own / direct manager / team / HR). Every read runs the company's performance tick
 * first (probation reviews, due reminders). Dates are company calendar days (regional timezone, mock clock).
 */

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const LOCKED = () => conflict('This review was acknowledged and is locked.', 'review_locked')
const CLOSED = () => conflict('This review cycle is closed.', 'cycle_closed')

function ctxOf(user: User): PerfCtx {
  const ctx = perfCtx(user)
  runPerformanceTick(ctx.co, ctx.now)
  return ctx
}

const deptName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? null) : null)

/* ================= Templates ================= */

function templateView(t: Tenant<PerfTemplateRecord>): ReviewTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    scale: structuredClone(t.scale),
    sections: structuredClone(t.sections),
    goalsEnabled: t.goalsEnabled,
    goalsWeight: t.goalsWeight,
    competencyWeight: t.competencyWeight,
    selfReview: t.selfReview,
    forProbation: t.forProbation,
    active: t.active,
    cycleCount: hrPerfCycles.filter((c) => c.companyId === t.companyId && c.templateId === t.id).length,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

function cleanScale(v: unknown): RatingLevel[] {
  if (v === undefined) return structuredClone(DEFAULT_SCALE)
  const labels = arr(v).map((x) => str(typeof x === 'string' ? x : (x as { label?: unknown } | null)?.label, 60))
  if (labels.length < 2 || labels.length > 10 || labels.some((l) => !l)) throw invalid('The rating scale needs 2 to 10 levels, each with a label.', 'validation_failed', { field: 'scale' })
  return labels.map((label, i) => ({ value: i + 1, label }))
}

function cleanSections(v: unknown): TemplateSection[] {
  const raw = arr(v)
  if (!raw.length || raw.length > 12) throw invalid('Add 1 to 12 competency sections.', 'validation_failed', { field: 'sections' })
  const used = new Set<string>()
  const keyOf = (want: unknown, fallback: string) => {
    let id = typeof want === 'string' && /^[a-z0-9-]{1,40}$/i.test(want) && !used.has(want) ? want : fallback
    for (let n = 2; used.has(id); n++) id = `${fallback}-${n}`
    used.add(id)
    return id
  }
  return raw.map((s, i) => {
    const sec = (s ?? {}) as { id?: unknown; title?: unknown; questions?: unknown }
    const title = str(sec.title, 120)
    if (!title) throw invalid('Each section needs a title.', 'validation_failed', { field: 'sections' })
    const qs = arr(sec.questions)
    if (!qs.length || qs.length > 20) throw invalid(`Section “${title}” needs 1 to 20 questions.`, 'validation_failed', { field: 'sections' })
    const sid = keyOf(sec.id, `s-${i + 1}`)
    return {
      id: sid,
      title,
      questions: qs.map((q, j) => {
        const qq = (q ?? {}) as { id?: unknown; text?: unknown }
        const text = str(typeof q === 'string' ? q : qq.text, 300)
        if (!text) throw invalid(`Every question in “${title}” needs text.`, 'validation_failed', { field: 'sections' })
        return { id: keyOf(qq.id, `${sid}-q${j + 1}`), text }
      }),
    }
  })
}

function cleanTemplate(input: Partial<TemplateInput> | null, prev?: Tenant<PerfTemplateRecord>): Omit<PerfTemplateRecord, 'id' | 'createdAt' | 'updatedAt'> {
  if (!input || typeof input !== 'object') throw invalid('Send the template.')
  const name = input.name === undefined && prev ? prev.name : str(input.name, 120)
  if (!name) throw invalid('Give the template a name.', 'validation_failed', { field: 'name' })
  const goalsEnabled = bool(input.goalsEnabled, prev?.goalsEnabled ?? true)
  const rawWeight = input.goalsWeight === undefined ? (prev?.goalsWeight ?? 40) : Number(input.goalsWeight)
  if (goalsEnabled && (!Number.isInteger(rawWeight) || rawWeight < 0 || rawWeight > 100)) throw invalid('The goals weight is a whole number from 0 to 100 (%).', 'validation_failed', { field: 'goals_weight' })
  return {
    name,
    description: input.description === undefined && prev ? prev.description : str(input.description, 500),
    scale: input.scale === undefined && prev ? prev.scale : cleanScale(input.scale),
    sections: input.sections === undefined && prev ? prev.sections : cleanSections(input.sections),
    goalsEnabled,
    ...weightsOf(goalsEnabled, rawWeight),
    selfReview: bool(input.selfReview, prev?.selfReview ?? true),
    forProbation: bool(input.forProbation, prev?.forProbation ?? false),
    active: bool(input.active, prev?.active ?? true),
  }
}

export async function listTemplates(user: User): Promise<ReviewTemplate[]> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  return delay(ensurePerfTemplates(ctx.co, ctx.stamp).map(templateView))
}

/** One probation template per company: making another one the probation default clears the flag elsewhere. */
function keepOneProbationDefault(co: string, keep: string): void {
  for (const t of hrPerfTemplates) if (t.companyId === co && t.id !== keep && t.forProbation) t.forProbation = false
}

export async function createTemplate(user: User, input: Partial<TemplateInput> | null): Promise<ReviewTemplate> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const values = cleanTemplate(input)
  ensurePerfTemplates(ctx.co, ctx.stamp)
  const t: Tenant<PerfTemplateRecord> = { companyId: ctx.co, id: nextPerfId('PRT-'), ...values, createdAt: ctx.stamp, updatedAt: ctx.stamp }
  hrPerfTemplates.push(t)
  if (t.forProbation) keepOneProbationDefault(ctx.co, t.id)
  return delay(templateView(t))
}

export async function updateTemplate(user: User, id: string, input: Partial<TemplateInput> | null): Promise<ReviewTemplate> {
  const ctx = ctxOf(user)
  const t = hrPerfTemplates.find((x) => x.companyId === ctx.co && x.id === id)
  if (!t) throw notFound()
  requireFull(ctx)
  Object.assign(t, cleanTemplate(input, t), { updatedAt: ctx.stamp })
  if (t.forProbation) keepOneProbationDefault(ctx.co, t.id)
  // Draft cycles follow the template; launched cycles keep their snapshot.
  for (const c of hrPerfCycles) if (c.companyId === ctx.co && c.templateId === t.id && c.phase === 'draft') c.template = snapshotOf(t)
  return delay(templateView(t))
}

/* ================= Cycles ================= */

function progressOf(c: Tenant<PerfCycleRecord>): Cycle['progress'] {
  const rs = reviewsOfCycle(c.companyId, c.id)
  const total = rs.length
  const managerDone = rs.filter((r) => r.manager.submittedAt).length
  return {
    total,
    goalsReady: c.template.goalsEnabled ? rs.filter((r) => goalWeightProblem(goalsOfReview(c.companyId, r.id).map((g) => g.weight)) === null).length : 0,
    selfDone: rs.filter((r) => r.self.submittedAt).length,
    managerDone,
    shared: rs.filter((r) => r.sharedAt).length,
    acknowledged: rs.filter((r) => r.acknowledgedAt).length,
    completionPct: total ? Math.round((managerDone / total) * 100) : 0,
  }
}

function cycleView(c: Tenant<PerfCycleRecord>): Cycle {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    phase: c.phase,
    templateId: c.templateId,
    templateName: c.template.name,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    departmentIds: [...c.departmentIds],
    employeeIds: [...c.employeeIds],
    hiredBefore: c.hiredBefore,
    deadlines: { ...c.deadlines },
    currentDeadline: deadlineOf(c),
    launchedAt: c.launchedAt,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
    createdByName: c.createdByName,
    progress: progressOf(c),
  }
}

/** Final rating: the latest calibration, else the overall score rounded to a scale level (manager submitted only). */
function resultOf(r: Tenant<PerfReviewRecord>, c: PerfCycleRecord) {
  if (!r.manager.submittedAt) return { scores: null, final: null }
  const goals = goalsOfReview(r.companyId, r.id)
  const scores = scoresOf(c.template, goals, r.manager.answers, r.manager.goalRatings)
  const calibrated = r.calibrations.length ? r.calibrations[r.calibrations.length - 1].rating : null
  return { scores, final: calibrated ?? ratingFromScore(c.template.scale, scores.overall) }
}

/** Results are visible to HR / manager / team once submitted; to the employee only once shared. */
const resultsVisible = (rel: Relation, r: PerfReviewRecord) => (rel.own ? !!r.sharedAt : !!r.manager.submittedAt)

function rowOf(r: Tenant<PerfReviewRecord>, c: Tenant<PerfCycleRecord>, rel: Relation, today: string): ReviewRow {
  const e = employeeById(r.companyId, r.employeeId)
  const m = r.managerId ? employeeById(r.companyId, r.managerId) : undefined
  const pending = pendingOf(r, c)
  const dueDate = pendingDeadline(r, c, pending?.action)
  const show = resultsVisible(rel, r)
  const res = show ? resultOf(r, c) : { scores: null, final: null }
  return {
    id: r.id,
    cycleId: c.id,
    cycleName: c.name,
    cycleType: c.type,
    cyclePhase: c.phase,
    employeeId: r.employeeId,
    employeeName: e?.fullName ?? '—',
    employeeNo: e?.employeeNo ?? '',
    jobTitle: e?.jobTitle ?? '',
    departmentId: e?.departmentId ?? null,
    departmentName: deptName(r.companyId, e?.departmentId ?? null),
    managerId: r.managerId,
    managerName: m?.fullName ?? null,
    stage: stageOf(r, c),
    dueDate,
    overdue: !!dueDate && daysBetweenIso(today, dueDate) < 0,
    selfSubmittedAt: r.self.submittedAt,
    managerSubmittedAt: r.manager.submittedAt,
    overallScore: res.scores?.overall ?? null,
    finalRating: res.final,
    finalLabel: labelOf(c.template.scale, res.final),
    sharedAt: r.sharedAt,
    acknowledgedAt: r.acknowledgedAt,
  }
}

const HR_REL: Relation = { own: false, hr: true, manager: false, team: false }

function cycleDetail(c: Tenant<PerfCycleRecord>, today: string): CycleDetail {
  const rows = reviewsOfCycle(c.companyId, c.id).map((r) => rowOf(r, c, HR_REL, today))
  const byStage = REVIEW_STAGES.map((stage) => ({ stage, count: rows.filter((r) => r.stage === stage).length })).filter((s) => s.count > 0)
  const distribution = c.template.scale.map((l) => ({ value: l.value, label: l.label, count: rows.filter((r) => r.finalRating === l.value).length }))
  const deptIds = [...new Set(rows.map((r) => r.departmentId))]
  const depts: DepartmentProgress[] = deptIds
    .map((id) => {
      const rs = rows.filter((r) => r.departmentId === id)
      const rated = rs.map((r) => r.finalRating).filter((x): x is number => x !== null)
      const done = rs.filter((r) => r.managerSubmittedAt).length
      return {
        departmentId: id,
        name: deptName(c.companyId, id) ?? 'No department',
        total: rs.length,
        managerDone: done,
        completionPct: rs.length ? Math.round((done / rs.length) * 100) : 0,
        averageRating: rated.length ? Math.round((rated.reduce((s, x) => s + x, 0) / rated.length) * 100) / 100 : null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { ...cycleView(c), template: structuredClone(c.template), byStage, distribution, departments: depts, reviews: rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)) }
}

export async function listCycles(user: User): Promise<Cycle[]> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  return delay(
    hrPerfCycles
      .filter((c) => c.companyId === ctx.co)
      .map(cycleView)
      .sort((a, b) => (a.phase === 'closed' ? 1 : 0) - (b.phase === 'closed' ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)),
  )
}

function companyCycle(ctx: PerfCtx, id: string): Tenant<PerfCycleRecord> {
  const c = cycleOf(ctx.co, id)
  if (!c) throw notFound()
  requireFull(ctx)
  return c
}

export async function getCycle(user: User, id: string): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  return delay(cycleDetail(companyCycle(ctx, id), ctx.today))
}

const date = (v: unknown) => (typeof v === 'string' && isRealIsoDate(v) ? v : null)

function cleanDeadlines(v: unknown, t: TemplateSnapshot, prev?: PhaseDeadlines): PhaseDeadlines {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const pick = (k: keyof PhaseDeadlines) => (d[k] === undefined ? (prev?.[k] ?? null) : date(d[k]))
  const out = { goalSetting: t.goalsEnabled ? pick('goalSetting') : null, selfReview: t.selfReview ? pick('selfReview') : null, managerReview: pick('managerReview'), calibration: pick('calibration') }
  const need: [keyof PhaseDeadlines, boolean][] = [
    ['goalSetting', t.goalsEnabled],
    ['selfReview', t.selfReview],
    ['managerReview', true],
    ['calibration', true],
  ]
  for (const [k, required] of need) if (required && !out[k]) throw invalid(`Set the ${PHASE_LABEL[k === 'goalSetting' ? 'goal_setting' : k === 'selfReview' ? 'self_review' : k === 'managerReview' ? 'manager_review' : 'calibration'].toLowerCase()} deadline.`, 'validation_failed', { field: `deadlines.${k}` })
  const seq = [out.goalSetting, out.selfReview, out.managerReview, out.calibration].filter((x): x is string => !!x)
  for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) throw invalid('Phase deadlines must follow each other: goal setting, self-review, manager review, calibration.', 'deadline_order')
  return out as PhaseDeadlines
}

function companyTemplate(co: string, id: unknown): Tenant<PerfTemplateRecord> {
  const t = typeof id === 'string' ? hrPerfTemplates.find((x) => x.companyId === co && x.id === id && x.active) : undefined
  if (!t) throw invalid('Choose an active review template.', 'validation_failed', { field: 'template_id' })
  return t
}

function cleanCycle(ctx: PerfCtx, input: Partial<CycleInput> | null, prev?: Tenant<PerfCycleRecord>) {
  if (!input || typeof input !== 'object') throw invalid('Send the cycle.')
  const name = input.name === undefined && prev ? prev.name : str(input.name, 120)
  if (!name) throw invalid('Give the cycle a name.', 'validation_failed', { field: 'name' })
  const type = (input.type === undefined && prev ? prev.type : input.type) as CycleType
  if (!CYCLE_TYPES.includes(type)) throw invalid('Choose the cycle type.', 'validation_failed', { field: 'type' })
  if (type === 'probation') throw invalid(`Probation reviews are created automatically ${PROBATION_LOOKAHEAD_DAYS} days before the probation ends.`, 'validation_failed', { field: 'type' })
  const t = input.templateId === undefined && prev ? hrPerfTemplates.find((x) => x.companyId === ctx.co && x.id === prev.templateId) : companyTemplate(ctx.co, input.templateId)
  const snapshot = t ? snapshotOf(t) : prev!.template
  const periodStart = input.periodStart === undefined && prev ? prev.periodStart : date(input.periodStart)
  const periodEnd = input.periodEnd === undefined && prev ? prev.periodEnd : date(input.periodEnd)
  if (!periodStart || !periodEnd || periodEnd < periodStart) throw invalid('Set the review period (start on or before the end).', 'validation_failed', { field: 'period' })
  const departmentIds = input.departmentIds === undefined && prev ? prev.departmentIds : [...new Set(arr(input.departmentIds).map((x) => String(x)))]
  for (const id of departmentIds) if (!departments.some((d) => d.companyId === ctx.co && d.id === id)) throw invalid('Unknown department.', 'validation_failed', { field: 'department_ids' })
  const employeeIds = input.employeeIds === undefined && prev ? prev.employeeIds : [...new Set(arr(input.employeeIds).map((x) => String(x)))]
  for (const id of employeeIds) if (!employeeById(ctx.co, id)) throw invalid('Unknown employee.', 'validation_failed', { field: 'employee_ids' })
  const hiredBefore = input.hiredBefore === undefined ? (prev?.hiredBefore ?? null) : input.hiredBefore === null || input.hiredBefore === '' ? null : date(input.hiredBefore)
  if (input.hiredBefore && !hiredBefore) throw invalid('The hire-date cutoff is a date.', 'validation_failed', { field: 'hired_before' })
  const deadlines = cleanDeadlines(input.deadlines, snapshot, prev?.deadlines)
  return { name, type, templateId: t?.id ?? prev!.templateId, template: snapshot, periodStart, periodEnd, departmentIds, employeeIds, hiredBefore, deadlines }
}

export async function createCycle(user: User, input: Partial<CycleInput> | null): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  ensurePerfTemplates(ctx.co, ctx.stamp)
  const v = cleanCycle(ctx, input)
  const c: Tenant<PerfCycleRecord> = {
    companyId: ctx.co,
    id: nextPerfId('PCY-'),
    ...v,
    phase: 'draft',
    probationContractId: null,
    probationEndDate: null,
    launchedAt: null,
    closedAt: null,
    createdAt: ctx.stamp,
    createdBy: user.id,
    createdByName: user.name,
    marks: [],
  }
  hrPerfCycles.push(c)
  return delay(cycleDetail(c, ctx.today))
}

export async function updateCycle(user: User, id: string, input: Partial<CycleInput> | null): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  const c = companyCycle(ctx, id)
  if (c.phase === 'closed') throw CLOSED()
  if (c.phase === 'draft') Object.assign(c, cleanCycle(ctx, input, c))
  else {
    // Launched: the name and the deadlines only (a new deadline re-arms its reminders: the marks hold the date).
    if (!input || typeof input !== 'object') throw invalid('Send the cycle.')
    if (input.name !== undefined) {
      const name = str(input.name, 120)
      if (!name) throw invalid('Give the cycle a name.', 'validation_failed', { field: 'name' })
      c.name = name
    }
    if (input.deadlines !== undefined) c.deadlines = cleanDeadlines(input.deadlines, c.template, c.deadlines)
  }
  return delay(cycleDetail(c, ctx.today))
}

/** Participants at launch: explicit employees, else the chosen departments (empty = all); active, hired on / before the cutoff. */
function participantsOf(c: Tenant<PerfCycleRecord>) {
  return employeesOf(c.companyId).filter(
    (e) =>
      (e.status === 'active' || e.status === 'on_leave') &&
      (c.employeeIds.length ? c.employeeIds.includes(e.id) : !c.departmentIds.length || (!!e.departmentId && c.departmentIds.includes(e.departmentId))) &&
      (!c.hiredBefore || e.hireDate <= c.hiredBefore),
  )
}

export async function launchCycle(user: User, id: string): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  const c = companyCycle(ctx, id)
  if (c.phase !== 'draft') throw conflict('This cycle is already launched.', 'invalid_transition')
  const t = hrPerfTemplates.find((x) => x.companyId === ctx.co && x.id === c.templateId)
  if (t) c.template = snapshotOf(t)
  const people = participantsOf(c)
  if (!people.length) throw invalid('No active employees match the participants of this cycle.', 'no_participants')
  for (const e of people) {
    hrPerfReviews.push({
      companyId: ctx.co,
      id: nextPerfId('PRV-'),
      cycleId: c.id,
      employeeId: e.id,
      managerId: e.managerId,
      self: emptyAssessment(),
      manager: emptyManagerAssessment(),
      calibrations: [],
      sharedAt: null,
      sharedBy: null,
      acknowledgedAt: null,
      ackComment: '',
      probationOutcome: null,
      outcomeAppliedAt: null,
      marks: [],
      createdAt: ctx.stamp,
    })
  }
  c.phase = nextPhase(c.template, 'draft')!
  c.launchedAt = ctx.stamp
  announcePhase(c, ctx.stamp)
  recordAudit(user, { action: 'update', entity: 'performance_cycle', entityId: c.id, summary: `Launched the review cycle “${c.name}” (${people.length} participants)` })
  return delay(cycleDetail(c, ctx.today))
}

function shareReview(r: Tenant<PerfReviewRecord>, c: Tenant<PerfCycleRecord>, user: User, at: string): void {
  r.sharedAt = at
  r.sharedBy = user.id
  announceShared(r, c, at)
  if (c.type === 'probation') applyProbationOutcome(r, c, user, at)
  logHr(r.companyId, r.employeeId, user, 'performance', `${c.name}: review shared with the employee`, at)
}

function moveTo(c: Tenant<PerfCycleRecord>, phase: CyclePhase, user: User, at: string): void {
  c.phase = phase
  if (phase === 'shared') for (const r of reviewsOfCycle(c.companyId, c.id)) if (r.manager.submittedAt && !r.sharedAt) shareReview(r, c, user, at)
  if (phase === 'closed') c.closedAt = at
  announcePhase(c, at)
}

export async function advanceCycle(user: User, id: string): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  const c = companyCycle(ctx, id)
  if (c.phase === 'draft') throw conflict('Launch the cycle first.', 'invalid_transition')
  const next = nextPhase(c.template, c.phase)
  if (!next || next === 'closed') throw conflict(c.phase === 'closed' ? 'This review cycle is closed.' : 'Results are shared: close the cycle instead.', 'invalid_transition')
  moveTo(c, next, user, ctx.stamp)
  recordAudit(user, { action: 'update', entity: 'performance_cycle', entityId: c.id, summary: `Moved the review cycle “${c.name}” to ${PHASE_LABEL[next]}` })
  return delay(cycleDetail(c, ctx.today))
}

export async function closeCycle(user: User, id: string): Promise<CycleDetail> {
  const ctx = ctxOf(user)
  const c = companyCycle(ctx, id)
  if (c.phase === 'draft' || c.phase === 'closed') throw conflict(c.phase === 'draft' ? 'A draft cycle can’t be closed; launch it first.' : 'This review cycle is already closed.', 'invalid_transition')
  moveTo(c, 'closed', user, ctx.stamp)
  recordAudit(user, { action: 'update', entity: 'performance_cycle', entityId: c.id, summary: `Closed the review cycle “${c.name}”` })
  return delay(cycleDetail(c, ctx.today))
}

/** POST /cycles/:id/remind: a nudge (not once-only) to everyone who must act now in the cycle. */
export async function remindCycle(user: User, id: string): Promise<{ sent: number }> {
  const ctx = ctxOf(user)
  const c = companyCycle(ctx, id)
  if (c.phase === 'draft' || c.phase === 'closed') throw conflict('Reminders are for running cycles.', 'invalid_transition')
  let sent = 0
  if (c.phase === 'calibration') {
    const waiting = reviewsOfCycle(ctx.co, c.id).filter((r) => r.manager.submittedAt && !r.sharedAt).length
    if (waiting) sent += notifyUsers(ctx.co, hrFullUsers(ctx.co).map((u) => u.id).filter((x) => x !== user.id), `Reminder: ${c.name} is waiting for calibration`, `${waiting} review(s) to calibrate and share.`, `/hr/performance?tab=cycles&cycle=${c.id}`, ctx.stamp)
  }
  for (const r of reviewsOfCycle(ctx.co, c.id)) {
    const p = pendingOf(r, c)
    if (!p) continue
    const to = p.by === 'employee' ? [userOfEmployee(ctx.co, r.employeeId)?.id ?? ''] : reviewerUsers(r).map((u) => u.id)
    const due = pendingDeadline(r, c, p.action)
    sent += notifyUsers(ctx.co, to, `Reminder: ${p.action === 'acknowledge' ? 'acknowledge your review' : PHASE_LABEL[c.phase].toLowerCase()} for ${c.name}`, due ? `Due ${due}.` : 'Please complete it.', reviewLink(r.id), ctx.stamp)
  }
  return delay({ sent })
}

/* ================= Reviews ================= */

function goalView(g: Tenant<PerfGoalRecord>): Goal {
  return {
    id: g.id,
    reviewId: g.reviewId,
    cycleId: g.cycleId,
    employeeId: g.employeeId,
    title: g.title,
    description: g.description,
    weight: g.weight,
    target: g.target,
    progress: g.progress,
    status: g.status,
    approved: g.approved,
    approvedAt: g.approvedAt,
    approvedByName: g.approvedByName,
    createdByName: g.createdByName,
    updatedAt: g.updatedAt,
  }
}

const locked = (r: PerfReviewRecord) => !!r.acknowledgedAt

function canOf(ctx: PerfCtx, r: Tenant<PerfReviewRecord>, c: Tenant<PerfCycleRecord>, rel: Relation): ReviewDetail['can'] {
  const live = c.phase !== 'closed' && !locked(r)
  const open = live && isOpenPhase(c.phase) && !r.manager.submittedAt
  const goalsOn = c.template.goalsEnabled
  const ownGoalTerms = rel.own && c.phase === 'goal_setting'
  const editSelf = rel.own && open && c.template.selfReview && !r.self.submittedAt && (c.phase === 'self_review' || c.phase === 'manager_review')
  const editManager = rel.manager && open && (c.phase === 'self_review' || c.phase === 'manager_review')
  const preShare = live && !!r.manager.submittedAt && !r.sharedAt
  return {
    editGoals: goalsOn && open && (rel.own || rel.manager),
    editGoalTerms: goalsOn && open && (ownGoalTerms || rel.manager),
    approveGoals: goalsOn && open && rel.manager && goalsOfReview(ctx.co, r.id).length > 0,
    editSelf,
    submitSelf: editSelf,
    editManager,
    submitManager: editManager && c.phase === 'manager_review',
    calibrate: rel.hr && preShare && c.phase === 'calibration',
    share: rel.hr && preShare && (c.phase === 'calibration' || c.phase === 'shared'),
    acknowledge: rel.own && !!r.sharedAt && !r.acknowledgedAt,
  }
}

function detailOf(ctx: PerfCtx, r: Tenant<PerfReviewRecord>, c: Tenant<PerfCycleRecord>, rel: Relation): ReviewDetail {
  const row = rowOf(r, c, rel, ctx.today)
  const goals = goalsOfReview(ctx.co, r.id)
  const showSelf = rel.own || !!r.self.submittedAt
  const showManager = rel.own ? !!r.sharedAt : rel.manager || !!r.manager.submittedAt
  const show = resultsVisible(rel, r)
  const res = show ? resultOf(r, c) : { scores: null, final: null }
  const last = r.calibrations[r.calibrations.length - 1]
  const calibration: Calibration | null =
    rel.hr && last
      ? {
          rating: last.rating,
          previousRating: last.previousRating,
          note: last.note,
          byName: last.byName,
          at: last.at,
          history: r.calibrations.map((x) => ({ rating: x.rating, previousRating: x.previousRating, note: x.note, byName: x.byName, at: x.at })),
        }
      : null
  const courseIds = showManager ? r.manager.recommendedCourseIds : []
  const emp = employeeById(ctx.co, r.employeeId)
  const viewer = rel.own ? 'employee' : rel.hr ? 'hr' : rel.manager ? 'manager' : 'team'
  return {
    ...row,
    viewer,
    template: structuredClone(c.template),
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    deadlines: { ...c.deadlines },
    goals: goals.map(goalView),
    goalWeightTotal: goals.reduce((s, g) => s + g.weight, 0),
    self: showSelf ? structuredClone(r.self) : null,
    selfScores: showSelf && r.self.submittedAt ? scoresOf(c.template, goals, r.self.answers, r.self.goalRatings) : null,
    manager: showManager
      ? {
          ...structuredClone(r.manager),
          // The employee sees the recommendation of a probation review only through the applied outcome.
          ...(rel.own ? { recommendation: r.probationOutcome, extendMonths: r.probationOutcome === 'extend' ? r.manager.extendMonths : null } : {}),
        }
      : null,
    scores: res.scores,
    calibration,
    acknowledgement: r.acknowledgedAt ? { at: r.acknowledgedAt, comment: r.ackComment } : null,
    probation:
      c.type === 'probation' && c.probationEndDate
        ? { contractId: rel.own ? null : c.probationContractId, endDate: c.probationEndDate, outcome: rel.own && !r.sharedAt ? null : r.probationOutcome, outcomeAppliedAt: rel.own && !r.sharedAt ? null : r.outcomeAppliedAt }
        : null,
    recommendedCourses: courseIds.map((id) => ({ id, title: hrCourses.find((x) => x.companyId === ctx.co && x.id === id)?.title ?? '—' })),
    salesKpis: !rel.own && emp ? salesKpisFor(ctx.co, emp, c.periodStart, c.periodEnd, ctx.today) : null,
    locked: locked(r),
    can: canOf(ctx, r, c, rel),
  }
}

export async function listReviews(user: User, q: { cycleId?: string; stage?: string } = {}): Promise<ReviewRow[]> {
  const ctx = ctxOf(user)
  const rows = visibleReviews(ctx)
    .filter(({ review, rel }) => !rel.own && (!q.cycleId || review.cycleId === q.cycleId))
    .map(({ review, rel }) => rowOf(review, cycleOf(ctx.co, review.cycleId)!, rel, ctx.today))
    .filter((r) => !q.stage || r.stage === q.stage)
  return delay(rows.sort((a, b) => (a.cyclePhase === 'closed' ? 1 : 0) - (b.cyclePhase === 'closed' ? 1 : 0) || a.cycleName.localeCompare(b.cycleName) || a.employeeName.localeCompare(b.employeeName)))
}

export async function getReview(user: User, id: string): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review, cycle, rel } = visibleReview(ctx, id)
  return delay(detailOf(ctx, review, cycle, rel))
}

function cleanAnswers(v: unknown, t: TemplateSnapshot, prev: Answer[]): Answer[] {
  if (v === undefined) return prev
  const questionIds = new Set(t.sections.flatMap((s) => s.questions.map((q) => q.id)))
  const values = new Set(t.scale.map((l) => l.value))
  const out = new Map<string, Answer>()
  for (const raw of arr(v)) {
    const a = (raw ?? {}) as { questionId?: unknown; rating?: unknown; comment?: unknown }
    const qid = String(a.questionId ?? '')
    if (!questionIds.has(qid)) throw invalid('An answer names a question that isn’t in this review.', 'validation_failed', { field: 'answers' })
    const rating = a.rating === null || a.rating === undefined || a.rating === '' ? null : Number(a.rating)
    if (rating !== null && !values.has(rating)) throw invalid('Ratings must be a level of the scale.', 'validation_failed', { field: 'answers' })
    out.set(qid, { questionId: qid, rating, comment: str(a.comment, 2000) })
  }
  return [...out.values()]
}

function cleanGoalRatings(v: unknown, t: TemplateSnapshot, goalIds: Set<string>, prev: GoalRating[]): GoalRating[] {
  if (v === undefined) return prev
  const values = new Set(t.scale.map((l) => l.value))
  const out = new Map<string, GoalRating>()
  for (const raw of arr(v)) {
    const g = (raw ?? {}) as { goalId?: unknown; rating?: unknown; comment?: unknown }
    const gid = String(g.goalId ?? '')
    if (!goalIds.has(gid)) throw invalid('A goal rating names a goal that isn’t in this review.', 'validation_failed', { field: 'goal_ratings' })
    const rating = g.rating === null || g.rating === undefined || g.rating === '' ? null : Number(g.rating)
    if (rating !== null && !values.has(rating)) throw invalid('Ratings must be a level of the scale.', 'validation_failed', { field: 'goal_ratings' })
    out.set(gid, { goalId: gid, rating, comment: str(g.comment, 2000) })
  }
  return [...out.values()]
}

/** Before a submit: every question (and every goal, when goals count) rated; goal weights total 100. */
function assertComplete(a: Assessment, c: PerfCycleRecord, goals: PerfGoalRecord[]): void {
  const rated = new Set(a.answers.filter((x) => x.rating !== null).map((x) => x.questionId))
  const missing = c.template.sections.flatMap((s) => s.questions).filter((q) => !rated.has(q.id)).length
  if (missing) throw invalid(`Rate every question before submitting (${missing} left).`, 'incomplete', { missing })
  if (c.template.goalsEnabled && c.template.goalsWeight > 0) {
    const problem = goalWeightProblem(goals.map((g) => g.weight))
    if (problem) throw invalid(problem, 'goal_weights')
    const ratedGoals = new Set(a.goalRatings.filter((x) => x.rating !== null).map((x) => x.goalId))
    const left = goals.filter((g) => !ratedGoals.has(g.id)).length
    if (left) throw invalid(`Rate every goal before submitting (${left} left).`, 'incomplete', { missing: left })
  }
}

function writable(r: PerfReviewRecord, c: PerfCycleRecord): void {
  if (locked(r)) throw LOCKED()
  if (c.phase === 'closed') throw CLOSED()
}

export async function saveSelf(user: User, id: string, input: Partial<AssessmentInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, id)
  if (!rel.own) throw forbidden('Only the employee writes their self-assessment.')
  writable(r, c)
  if (!input || typeof input !== 'object') throw invalid('Send the self-assessment.')
  const can = canOf(ctx, r, c, rel)
  if (!can.editSelf) throw conflict(r.self.submittedAt ? 'Your self-assessment is already submitted.' : `The self-review isn’t open (${PHASE_LABEL[c.phase]}).`, 'phase_closed')
  const goals = goalsOfReview(ctx.co, r.id)
  const next: Assessment = {
    answers: cleanAnswers(input.answers, c.template, r.self.answers),
    goalRatings: cleanGoalRatings(input.goalRatings, c.template, new Set(goals.map((g) => g.id)), r.self.goalRatings),
    summary: input.summary === undefined ? r.self.summary : str(input.summary, 4000),
    submittedAt: null,
  }
  if (input.submit === true) {
    assertComplete(next, c, goals)
    next.submittedAt = ctx.stamp
  }
  r.self = next
  if (next.submittedAt) {
    const u = reviewerUsers(r)
    if (c.type === 'probation' && c.phase === 'self_review') moveTo(c, 'manager_review', user, ctx.stamp)
    else notifyUsers(ctx.co, u.map((x) => x.id), `${employeeById(ctx.co, r.employeeId)?.fullName ?? 'An employee'} submitted their self-review`, `${c.name}: you can read it now.`, reviewLink(r.id), ctx.stamp)
  }
  return delay(detailOf(ctx, r, c, rel))
}

export async function saveManager(user: User, id: string, input: Partial<ManagerAssessmentInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, id)
  if (!rel.manager) throw forbidden('Only the employee’s direct manager writes the manager assessment.')
  writable(r, c)
  if (!input || typeof input !== 'object') throw invalid('Send the assessment.')
  const can = canOf(ctx, r, c, rel)
  if (!can.editManager) throw conflict(r.manager.submittedAt ? 'The manager assessment is already submitted.' : `The manager review isn’t open (${PHASE_LABEL[c.phase]}).`, 'phase_closed')
  const goals = goalsOfReview(ctx.co, r.id)
  const courseIds =
    input.recommendedCourseIds === undefined
      ? r.manager.recommendedCourseIds
      : [...new Set(arr(input.recommendedCourseIds).map((x) => String(x)))].slice(0, 10)
  for (const cid of courseIds) if (!hrCourses.some((x) => x.companyId === ctx.co && x.id === cid)) throw invalid('Unknown training course.', 'validation_failed', { field: 'recommended_course_ids' })
  let recommendation: ProbationRecommendation | null = r.manager.recommendation
  let extendMonths = r.manager.extendMonths
  if (c.type === 'probation') {
    if (input.recommendation !== undefined) {
      if (input.recommendation !== null && !PROBATION_RECOMMENDATIONS.includes(input.recommendation)) throw invalid('Recommend confirm, extend or terminate.', 'validation_failed', { field: 'recommendation' })
      recommendation = input.recommendation
    }
    if (input.extendMonths !== undefined) extendMonths = input.extendMonths === null ? null : Number(input.extendMonths)
    if (recommendation === 'extend' && (extendMonths === null || !Number.isInteger(extendMonths) || extendMonths < 1 || extendMonths > 6)) throw invalid('Extend the probation by 1 to 6 months.', 'validation_failed', { field: 'extend_months' })
    if (recommendation !== 'extend') extendMonths = null
  }
  const next = {
    answers: cleanAnswers(input.answers, c.template, r.manager.answers),
    goalRatings: cleanGoalRatings(input.goalRatings, c.template, new Set(goals.map((g) => g.id)), r.manager.goalRatings),
    summary: input.summary === undefined ? r.manager.summary : str(input.summary, 4000),
    submittedAt: null as string | null,
    recommendedCourseIds: courseIds,
    recommendation,
    extendMonths,
  }
  if (input.submit === true) {
    if (!can.submitManager) throw conflict('The manager review opens after the self-review phase.', 'phase_closed')
    assertComplete(next, c, goals)
    if (c.type === 'probation' && !recommendation) throw invalid('Recommend confirm, extend or terminate.', 'validation_failed', { field: 'recommendation' })
    next.submittedAt = ctx.stamp
    // Submitting approves the goals as rated.
    for (const g of goals) if (!g.approved) Object.assign(g, { approved: true, approvedAt: ctx.stamp, approvedBy: user.id, approvedByName: user.name })
  }
  r.manager = next
  if (next.submittedAt) {
    logHr(ctx.co, r.employeeId, user, 'performance', `${c.name}: manager assessment submitted`, ctx.stamp)
    if (c.type === 'probation' && isOpenPhase(c.phase)) moveTo(c, 'calibration', user, ctx.stamp)
  }
  return delay(detailOf(ctx, r, c, rel))
}

export async function calibrateReview(user: User, id: string, input: Partial<CalibrateInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, id)
  if (!rel.hr) throw forbidden(rel.own ? 'You can’t calibrate your own review.' : 'Only HR calibrates ratings.')
  writable(r, c)
  if (!canOf(ctx, r, c, rel).calibrate) throw conflict(r.sharedAt ? 'This review is already shared.' : !r.manager.submittedAt ? 'Calibrate after the manager review is submitted.' : 'Calibration happens in the calibration phase.', 'phase_closed')
  const rating = Number(input?.rating)
  if (!c.template.scale.some((l) => l.value === rating)) throw invalid('Choose a rating on the scale.', 'validation_failed', { field: 'rating' })
  const note = str(input?.note, 2000)
  if (note.length < 3) throw invalid('A calibration note is required: say why the rating changes.', 'note_required', { field: 'note' })
  if (c.type === 'probation' && input?.recommendation !== undefined && input.recommendation !== null) {
    if (!PROBATION_RECOMMENDATIONS.includes(input.recommendation)) throw invalid('Recommend confirm, extend or terminate.', 'validation_failed', { field: 'recommendation' })
    r.probationOutcome = input.recommendation
  }
  const before = resultOf(r, c).final
  r.calibrations.push({ rating, previousRating: before, note, by: user.id, byName: user.name, at: ctx.stamp })
  const emp = employeeById(ctx.co, r.employeeId)
  recordAudit(user, {
    action: 'update',
    entity: 'performance_review',
    entityId: r.id,
    summary: `Calibrated the ${c.name} rating of ${emp?.fullName ?? r.employeeId}: ${before ?? '—'} → ${rating}. Note: ${note}`,
    changes: [{ field: 'final_rating', from: String(before ?? ''), to: String(rating) }],
  })
  return delay(detailOf(ctx, r, c, rel))
}

export async function shareOne(user: User, id: string): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, id)
  if (!rel.hr) throw forbidden('Only HR shares results with the employee.')
  writable(r, c)
  if (!canOf(ctx, r, c, rel).share) throw conflict(r.sharedAt ? 'This review is already shared.' : !r.manager.submittedAt ? 'Share after the manager review is submitted.' : 'Results are shared from the calibration phase.', 'phase_closed')
  shareReview(r, c, user, ctx.stamp)
  if (c.type === 'probation' && c.phase === 'calibration') moveTo(c, 'shared', user, ctx.stamp)
  return delay(detailOf(ctx, r, c, rel))
}

export async function acknowledgeReview(user: User, id: string, input: Partial<AcknowledgeInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, id)
  if (!rel.own) throw forbidden('Only the employee acknowledges their review.')
  if (locked(r)) throw LOCKED()
  if (!r.sharedAt) throw conflict('This review isn’t shared with you yet.', 'not_shared')
  r.acknowledgedAt = ctx.stamp
  r.ackComment = str(input?.comment, 1000)
  announceAcknowledged(r, c, ctx.stamp)
  logHr(ctx.co, r.employeeId, user, 'performance', `${c.name}: review acknowledged`, ctx.stamp)
  if (c.type === 'probation' && c.phase === 'shared') moveTo(c, 'closed', user, ctx.stamp)
  return delay(detailOf(ctx, r, c, rel))
}

/* ================= Goals ================= */

function cleanGoal(input: Partial<GoalInput> | null, prev?: PerfGoalRecord): Partial<PerfGoalRecord> {
  if (!input || typeof input !== 'object') throw invalid('Send the goal.')
  const out: Partial<PerfGoalRecord> = {}
  if (input.title !== undefined || !prev) {
    out.title = str(input.title, 200)
    if (!out.title) throw invalid('Give the goal a title.', 'validation_failed', { field: 'title' })
  }
  if (input.description !== undefined) out.description = str(input.description, 2000)
  if (input.target !== undefined) out.target = str(input.target, 300)
  if (input.weight !== undefined || !prev) {
    const w = Number(input.weight)
    if (!Number.isInteger(w) || w < 1 || w > 100) throw invalid('The weight is a whole number from 1 to 100 (%).', 'validation_failed', { field: 'weight' })
    out.weight = w
  }
  if (input.progress !== undefined) {
    const p = Number(input.progress)
    if (!Number.isFinite(p) || p < 0 || p > 100) throw invalid('Progress is 0 to 100 (%).', 'validation_failed', { field: 'progress' })
    out.progress = Math.round(p)
  }
  if (input.status !== undefined) {
    if (!GOAL_STATUSES.includes(input.status as GoalStatus)) throw invalid('Unknown goal status.', 'validation_failed', { field: 'status' })
    out.status = input.status as GoalStatus
  }
  return out
}

const TERMS: (keyof PerfGoalRecord)[] = ['title', 'description', 'target', 'weight']

function assertWeightRoom(co: string, reviewId: string, goalId: string | null, weight: number): void {
  const others = goalsOfReview(co, reviewId).filter((g) => g.id !== goalId).reduce((s, g) => s + g.weight, 0)
  if (others + weight > 100) throw invalid(`Goal weights would total ${others + weight}%; they must total 100%.`, 'goal_weights', { total: others + weight })
}

function goalAccess(ctx: PerfCtx, reviewId: string) {
  const v = visibleReview(ctx, reviewId)
  if (!v.rel.own && !v.rel.manager) throw forbidden('Goals are set by the employee and their manager.')
  writable(v.review, v.cycle)
  const can = canOf(ctx, v.review, v.cycle, v.rel)
  if (!can.editGoals) throw conflict(v.cycle.template.goalsEnabled ? 'Goals can’t be changed at this stage.' : 'This review has no goals.', 'phase_closed')
  return { ...v, can }
}

export async function createGoal(user: User, reviewId: string, input: Partial<GoalInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel, can } = goalAccess(ctx, reviewId)
  if (!can.editGoalTerms) throw conflict('New goals are added during goal setting.', 'phase_closed')
  const values = cleanGoal(input)
  assertWeightRoom(ctx.co, r.id, null, values.weight!)
  if (goalsOfReview(ctx.co, r.id).length >= 10) throw invalid('A review has at most 10 goals.', 'validation_failed')
  hrPerfGoals.push({
    companyId: ctx.co,
    id: nextPerfId('PGL-'),
    reviewId: r.id,
    cycleId: c.id,
    employeeId: r.employeeId,
    title: values.title!,
    description: values.description ?? '',
    weight: values.weight!,
    target: values.target ?? '',
    progress: values.progress ?? 0,
    status: values.status ?? 'not_started',
    approved: false,
    approvedAt: null,
    approvedBy: null,
    approvedByName: null,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: ctx.stamp,
    updatedAt: ctx.stamp,
  })
  return delay(detailOf(ctx, r, c, rel))
}

function companyGoal(ctx: PerfCtx, id: string): Tenant<PerfGoalRecord> {
  const g = hrPerfGoals.find((x) => x.companyId === ctx.co && x.id === id)
  if (!g) throw notFound()
  return g
}

export async function updateGoal(user: User, id: string, input: Partial<GoalInput> | null): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const g = companyGoal(ctx, id)
  const { review: r, cycle: c, rel, can } = goalAccess(ctx, g.reviewId)
  const values = cleanGoal(input, g)
  const termsChange = TERMS.some((k) => values[k] !== undefined && values[k] !== g[k])
  if (termsChange && !can.editGoalTerms) throw conflict('After goal setting, only progress and status can change.', 'phase_closed')
  if (values.weight !== undefined) assertWeightRoom(ctx.co, r.id, g.id, values.weight)
  Object.assign(g, values, { updatedAt: ctx.stamp })
  if (termsChange) Object.assign(g, { approved: false, approvedAt: null, approvedBy: null, approvedByName: null })
  return delay(detailOf(ctx, r, c, rel))
}

export async function deleteGoal(user: User, id: string): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const g = companyGoal(ctx, id)
  const { review: r, cycle: c, rel, can } = goalAccess(ctx, g.reviewId)
  if (!can.editGoalTerms) throw conflict('Goals are removed during goal setting.', 'phase_closed')
  hrPerfGoals.splice(hrPerfGoals.indexOf(g), 1)
  for (const a of [r.self, r.manager]) a.goalRatings = a.goalRatings.filter((x) => x.goalId !== g.id)
  return delay(detailOf(ctx, r, c, rel))
}

export async function approveGoals(user: User, reviewId: string): Promise<ReviewDetail> {
  const ctx = ctxOf(user)
  const { review: r, cycle: c, rel } = visibleReview(ctx, reviewId)
  if (!rel.manager) throw forbidden('The direct manager approves the goals.')
  writable(r, c)
  if (!canOf(ctx, r, c, rel).approveGoals) throw conflict('Goals can’t be approved at this stage.', 'phase_closed')
  const goals = goalsOfReview(ctx.co, r.id)
  const problem = goalWeightProblem(goals.map((g) => g.weight))
  if (problem) throw invalid(problem, 'goal_weights')
  for (const g of goals) Object.assign(g, { approved: true, approvedAt: ctx.stamp, approvedBy: user.id, approvedByName: user.name })
  const u = userOfEmployee(ctx.co, r.employeeId)
  if (u) notifyUsers(ctx.co, [u.id], `Your goals for ${c.name} are approved`, `${user.name} approved your ${goals.length} goal${goals.length === 1 ? '' : 's'}.`, reviewLink(r.id), ctx.stamp)
  return delay(detailOf(ctx, r, c, rel))
}

/* ================= My performance, options ================= */

export async function getMyPerformance(user: User): Promise<MyPerformance> {
  const ctx = ctxOf(user)
  const visible = visibleReviews(ctx)
  const pending: MyPerformance['pending'] = []
  let teamToComplete = 0
  for (const { review: r, rel } of visible) {
    const c = cycleOf(ctx.co, r.cycleId)!
    const p = pendingOf(r, c)
    const due = pendingDeadline(r, c, p?.action)
    const overdue = !!due && daysBetweenIso(ctx.today, due) < 0
    const emp = employeeById(ctx.co, r.employeeId)
    if (rel.manager && !r.manager.submittedAt && isOpenPhase(c.phase)) teamToComplete++
    if (!p) continue
    if ((rel.own && p.by === 'employee') || (rel.manager && p.by === 'manager')) {
      pending.push({ reviewId: r.id, action: p.action, employeeName: emp?.fullName ?? '—', cycleName: c.name, dueDate: due, overdue })
    }
  }
  const own = visible.filter((v) => v.rel.own)
  const reviews = own.map(({ review, rel }) => rowOf(review, cycleOf(ctx.co, review.cycleId)!, rel, ctx.today)).sort((a, b) => (b.sharedAt ?? b.cycleName).localeCompare(a.sharedAt ?? a.cycleName))
  const openIds = new Set(own.filter(({ review }) => cycleOf(ctx.co, review.cycleId)!.phase !== 'closed').map(({ review }) => review.id))
  const goals = hrPerfGoals.filter((g) => g.companyId === ctx.co && openIds.has(g.reviewId)).map(goalView)
  const latestShared = reviews.filter((r) => r.sharedAt).sort((a, b) => b.sharedAt!.localeCompare(a.sharedAt!))[0] ?? null
  pending.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  return delay({ employeeId: ctx.self?.id ?? null, pending, reviews, goals, teamToComplete, latestShared })
}

export async function getOptions(user: User): Promise<PerformanceOptions> {
  const ctx = ctxOf(user)
  const full = isFull(ctx)
  const reviews = full || ctx.scope === 'team' || visibleReviews(ctx).some((v) => v.rel.manager)
  return delay({
    manage: full,
    reviews,
    templates: full
      ? ensurePerfTemplates(ctx.co, ctx.stamp)
          .filter((t) => t.active)
          .map((t) => ({ id: t.id, name: t.name, goalsEnabled: t.goalsEnabled, selfReview: t.selfReview, forProbation: t.forProbation }))
      : [],
    departments: full ? departments.filter((d) => d.companyId === ctx.co && d.active).map((d) => ({ id: d.id, name: d.name })) : [],
    courses: reviews ? hrCourses.filter((c) => c.companyId === ctx.co && c.active).map((c) => ({ id: c.id, title: c.title })) : [],
    probationLookaheadDays: PROBATION_LOOKAHEAD_DAYS,
  })
}

export type { ReviewStage }
