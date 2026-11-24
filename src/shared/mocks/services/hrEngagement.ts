import type { User } from '@/shared/types'
import type {
  Answer,
  AnswerInput,
  Audience,
  DistributionBar,
  EngagementOptions,
  EngagementOverview,
  EngagementSettings,
  GroupResult,
  IndividualResponse,
  Language,
  MySurveyForm,
  MySurveyRow,
  MySurveys,
  QuestionResult,
  Survey,
  SurveyExport,
  SurveyInput,
  SurveyQuestion,
  SurveyResults,
  TenureBand,
  TrendPoint,
} from '@/modules/hr/engagement/types'
import { DRIVERS, MIN_FEEDBACK_GROUP, MIN_SURVEY_GROUP, QUESTION_TYPES, TENURE_BANDS, TENURE_LABEL } from '@/modules/hr/engagement/types'
import { commentThemes, driverScores, engagementScore, enpsOf, isSuppressed, suppressBreakdown, tenureBandOf } from '@/modules/hr/engagement/calc'
import { addDaysIso } from '@/shared/lib/companyDay'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import {
  SURVEY_TEMPLATES,
  ensureEngSettings,
  engSettingsOf,
  hrEngParticipants,
  hrEngResponses,
  hrEngSurveys,
  insertAtRandom,
  nextEngId,
  randomResponseId,
  sealKey,
  templateByKey,
  type ResponseRecord,
  type SurveyRecord,
} from '@/shared/mocks/data/hrEngagement'
import { delay } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import {
  canAnswer,
  conflict,
  engCtx,
  forbidden,
  hasResponded,
  headedDepartmentIds,
  invalid,
  isFull,
  notFound,
  requireFull,
  responsesOf,
  resultsScope,
  surveyOf,
  teamMaySee,
  type EngCtx,
} from './hrEngagementCore'
import { openSurvey, runEngagementTick } from './hrEngagementTick'

/**
 * HR › Engagement surveys (docs/API.md › HR › Engagement surveys). Roles: services/hrEngagementCore.ts. Every read
 * runs the company's engagement tick first (scheduled → open → closed, reminders, recurring waves, exit surveys).
 *
 * ANONYMITY: no answer of an anonymous survey is ever served with a name or an employee / user id, to anyone, in
 * any read or export; every group (the selection, each department, each tenure band, each wave of the trend) with
 * fewer than 5 responses is suppressed, and breakdowns hide the next-smallest groups too so that the total minus
 * the shown groups never isolates fewer than 5 people. One filter at a time (department OR tenure band).
 */

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const date = (v: unknown) => (typeof v === 'string' && isRealIsoDate(v) ? v : null)
const pct = (part: number, whole: number) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : null)

function ctxOf(user: User): EngCtx {
  const ctx = engCtx(user)
  runEngagementTick(ctx.co, ctx.now)
  return ctx
}

const deptName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? null) : null)
const companyDept = (co: string, id: string) => departments.find((d) => d.companyId === co && d.id === id && d.active)

/* ======================= Views ======================= */

function surveyView(ctx: EngCtx, s: Tenant<SurveyRecord>): Survey {
  const responses = responsesOf(ctx.co, s.id).length
  const targets = s.status === 'draft' || s.status === 'scheduled' ? 0 : s.targetEmployeeIds.length
  const full = isFull(ctx)
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    templateKey: s.templateKey,
    anonymous: s.anonymous,
    status: s.status,
    audience: structuredClone(s.audience),
    opensOn: s.opensOn,
    closesOn: s.closesOn,
    recurrence: s.recurrence,
    seriesId: s.seriesId,
    wave: s.wave,
    targetCount: targets,
    responseCount: responses,
    responseRate: s.status === 'draft' || s.status === 'scheduled' ? null : pct(responses, targets),
    questions: structuredClone(s.questions),
    subjectName: full && s.subjectEmployeeId ? (employeeById(ctx.co, s.subjectEmployeeId)?.fullName ?? null) : null,
    journeyId: full ? s.journeyId : null,
    createdAt: s.createdAt,
    createdByName: s.createdByName,
  }
}

/* ======================= Options, settings ======================= */

function settingsView(co: string): EngagementSettings {
  const s = engSettingsOf(co)
  return { feedbackNamesVisibleToHr: s.feedbackNamesVisibleToHr, exitSurveyAuto: s.exitSurveyAuto, minSurveyGroup: MIN_SURVEY_GROUP, minFeedbackGroup: MIN_FEEDBACK_GROUP }
}

export async function getOptions(user: User): Promise<EngagementOptions> {
  const ctx = ctxOf(user)
  const full = isFull(ctx)
  const scope = resultsScope(ctx)
  const headed = headedDepartmentIds(ctx)
  return delay({
    manage: full,
    results: scope !== null,
    scope: full ? 'full' : scope ? 'team' : null,
    departments: departments.filter((d) => d.companyId === ctx.co && d.active && (full || headed.has(d.id))).map((d) => ({ id: d.id, name: d.name })),
    templates: full ? structuredClone(SURVEY_TEMPLATES) : [],
    settings: full ? settingsView(ctx.co) : null,
    today: ctx.today,
    timezone: ctx.timezone,
  })
}

export async function updateSettings(user: User, input: Partial<EngagementSettings> | null): Promise<EngagementSettings> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  if (!input) throw invalid('Send the settings to change.')
  const row = ensureEngSettings(ctx.co)
  if (typeof input.feedbackNamesVisibleToHr === 'boolean') row.feedbackNamesVisibleToHr = input.feedbackNamesVisibleToHr
  if (typeof input.exitSurveyAuto === 'boolean') row.exitSurveyAuto = input.exitSurveyAuto
  recordAudit(user, { action: 'update', entity: 'engagement_settings', entityId: ctx.co, summary: `Engagement settings: names to HR ${row.feedbackNamesVisibleToHr ? 'on' : 'off'}, exit survey ${row.exitSurveyAuto ? 'on' : 'off'}` })
  return delay(settingsView(ctx.co))
}

/* ======================= Surveys (HR full; Department Heads read) ======================= */

function visibleSurveys(ctx: EngCtx): Tenant<SurveyRecord>[] {
  const all = hrEngSurveys.filter((s) => s.companyId === ctx.co)
  if (isFull(ctx)) return all
  const scope = resultsScope(ctx)
  if (scope === null || scope === 'company') return []
  return all.filter((s) => teamMaySee(s, scope))
}

export async function listSurveys(user: User): Promise<Survey[]> {
  const ctx = ctxOf(user)
  if (!isFull(ctx) && resultsScope(ctx) === null) throw forbidden('Survey results are for HR and department heads.')
  const rows = visibleSurveys(ctx).map((s) => surveyView(ctx, s))
  const order = { open: 0, scheduled: 1, draft: 2, closed: 3 }
  return delay(rows.sort((a, b) => order[a.status] - order[b.status] || b.opensOn.localeCompare(a.opensOn) || a.name.localeCompare(b.name)))
}

function visibleSurvey(ctx: EngCtx, id: string): Tenant<SurveyRecord> {
  if (resultsScope(ctx) === null) throw forbidden('Survey results are for HR and department heads.')
  const s = visibleSurveys(ctx).find((x) => x.id === id)
  if (!s) throw notFound()
  return s
}

export async function getSurvey(user: User, id: string): Promise<Survey> {
  const ctx = ctxOf(user)
  return delay(surveyView(ctx, visibleSurvey(ctx, id)))
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i

function cleanQuestions(v: unknown): SurveyQuestion[] {
  const list = arr(v)
  if (!list.length) throw invalid('Add at least one question.', 'validation_failed', { field: 'questions' })
  if (list.length > 40) throw invalid('A survey has at most 40 questions.', 'validation_failed', { field: 'questions' })
  const used = new Set<string>()
  return list.map((raw, i) => {
    const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const type = QUESTION_TYPES.find((t) => t === q.type)
    if (!type) throw invalid(`Question ${i + 1}: pick a question type.`, 'validation_failed', { field: `questions.${i}.type` })
    const text = str(q.text, 300)
    if (!text) throw invalid(`Question ${i + 1}: write the question.`, 'validation_failed', { field: `questions.${i}.text` })
    let id = typeof q.id === 'string' && ID_RE.test(q.id) && !used.has(q.id) ? q.id : `q-${i + 1}`
    while (used.has(id)) id = `${id}-x`
    used.add(id)
    const driver = type === 'likert' ? (DRIVERS.find((d) => d === q.driver) ?? null) : null
    let options: SurveyQuestion['options'] = []
    if (type === 'single' || type === 'multi') {
      const opts = arr(q.options)
      if (opts.length < 2 || opts.length > 12) throw invalid(`Question ${i + 1}: give 2 to 12 choices.`, 'validation_failed', { field: `questions.${i}.options` })
      const oUsed = new Set<string>()
      options = opts.map((o, j) => {
        const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        const ot = str(r.text, 120)
        if (!ot) throw invalid(`Question ${i + 1}: choice ${j + 1} is empty.`, 'validation_failed', { field: `questions.${i}.options.${j}.text` })
        let oid = typeof r.id === 'string' && ID_RE.test(r.id) && !oUsed.has(r.id) ? r.id : `o-${j + 1}`
        while (oUsed.has(oid)) oid = `${oid}-x`
        oUsed.add(oid)
        return { id: oid, text: ot, textAr: str(r.textAr, 120) }
      })
    }
    return { id, type, text, textAr: str(q.textAr, 300), driver, options, required: typeof q.required === 'boolean' ? q.required : type !== 'text' }
  })
}

function cleanAudience(co: string, v: unknown, prev?: Audience): Audience {
  if (v === undefined && prev) return prev
  const a = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const type = a.type === 'departments' || a.type === 'tenure' ? a.type : 'all'
  if (type === 'departments') {
    const ids = [...new Set(arr(a.departmentIds).filter((x): x is string => typeof x === 'string'))]
    if (!ids.length) throw invalid('Pick at least one department.', 'validation_failed', { field: 'audience.department_ids' })
    for (const id of ids) if (!companyDept(co, id)) throw invalid('Unknown department.', 'validation_failed', { field: 'audience.department_ids' })
    return { type, departmentIds: ids, tenureBands: [] }
  }
  if (type === 'tenure') {
    const bands = TENURE_BANDS.filter((b) => arr(a.tenureBands).includes(b))
    if (!bands.length) throw invalid('Pick at least one tenure band.', 'validation_failed', { field: 'audience.tenure_bands' })
    return { type, departmentIds: [], tenureBands: bands }
  }
  return { type: 'all', departmentIds: [], tenureBands: [] }
}

type Input = Partial<SurveyInput> & { subjectEmployeeId?: string | null }

function cleanSurvey(ctx: EngCtx, input: Input | null, prev?: Tenant<SurveyRecord>): Omit<SurveyRecord, 'id' | 'seriesId' | 'wave' | 'targetEmployeeIds' | 'launchedAt' | 'closedAt' | 'createdAt' | 'createdBy' | 'createdByName' | 'marks' | 'journeyId' | 'status'> {
  if (!input) throw invalid('Send the survey.')
  const template = input.templateKey !== undefined && input.templateKey !== null ? templateByKey(input.templateKey) : prev?.templateKey ? templateByKey(prev.templateKey) : undefined
  if (input.templateKey && !template) throw invalid('Unknown survey template.', 'validation_failed', { field: 'template_key' })
  const name = input.name !== undefined ? str(input.name, 120) : (prev?.name ?? template?.name ?? '')
  if (!name) throw invalid('Give the survey a name.', 'validation_failed', { field: 'name' })
  const questions = input.questions !== undefined ? cleanQuestions(input.questions) : prev ? prev.questions : template ? structuredClone(template.questions) : cleanQuestions([])
  const opensOn = input.opensOn !== undefined ? date(input.opensOn) : (prev?.opensOn ?? ctx.today)
  if (!opensOn) throw invalid('Pick a valid open date.', 'validation_failed', { field: 'opens_on' })
  const closesOn = input.closesOn !== undefined ? date(input.closesOn) : (prev?.closesOn ?? addDaysIso(opensOn, template?.durationDays ?? 14))
  if (!closesOn || closesOn < opensOn) throw invalid('The close date must be on or after the open date.', 'validation_failed', { field: 'closes_on' })
  const recurrence = input.recurrence === 'monthly' || input.recurrence === 'quarterly' || input.recurrence === 'none' ? input.recurrence : (prev?.recurrence ?? template?.recurrence ?? 'none')
  const kind = template?.kind ?? (input.kind === 'exit' || input.kind === 'onboarding' || input.kind === 'enps' || input.kind === 'engagement' ? input.kind : (prev?.kind ?? 'custom'))
  let subject = prev?.subjectEmployeeId ?? null
  if (input.subjectEmployeeId !== undefined) {
    subject = null
    if (input.subjectEmployeeId) {
      const e = employeeById(ctx.co, String(input.subjectEmployeeId))
      if (!e || !canAnswer(e)) throw invalid('Unknown employee (or without an active login).', 'validation_failed', { field: 'subject_employee_id' })
      subject = e.id
    }
  }
  return {
    name,
    kind,
    templateKey: template?.key ?? null,
    anonymous: typeof input.anonymous === 'boolean' ? input.anonymous : (prev?.anonymous ?? template?.anonymous ?? true),
    questions,
    audience: cleanAudience(ctx.co, input.audience, prev?.audience),
    opensOn,
    closesOn,
    recurrence: subject ? 'none' : recurrence,
    subjectEmployeeId: subject,
  }
}

export async function createSurvey(user: User, input: Input | null): Promise<Survey> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const clean = cleanSurvey(ctx, input)
  const id = nextEngId('ESV-')
  const s: Tenant<SurveyRecord> = {
    companyId: ctx.co,
    id,
    ...clean,
    status: 'draft',
    seriesId: id,
    wave: 1,
    targetEmployeeIds: [],
    journeyId: null,
    launchedAt: null,
    closedAt: null,
    createdAt: ctx.stamp,
    createdBy: user.id,
    createdByName: user.name,
    marks: [],
  }
  hrEngSurveys.push(s)
  recordAudit(user, { action: 'create', entity: 'survey', entityId: id, summary: `Survey created: ${s.name}` })
  return delay(surveyView(ctx, s))
}

function companySurvey(ctx: EngCtx, id: string): Tenant<SurveyRecord> {
  const s = surveyOf(ctx.co, id)
  if (!s) throw notFound()
  return s
}

export async function updateSurvey(user: User, id: string, input: Input | null): Promise<Survey> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const s = companySurvey(ctx, id)
  if (!input) throw invalid('Send the changes.')
  if (s.status === 'draft') {
    Object.assign(s, cleanSurvey(ctx, input, s))
  } else {
    // Once launched: the name, a later close date (open / scheduled) and the recurrence (stop a series) only.
    const FIELDS: (keyof Input)[] = ['name', 'templateKey', 'kind', 'anonymous', 'questions', 'audience', 'opensOn', 'closesOn', 'recurrence', 'subjectEmployeeId']
    const touched = FIELDS.filter((k) => input[k] !== undefined)
    const allowed = s.status === 'closed' ? ['recurrence'] : ['name', 'closesOn', 'recurrence']
    if (touched.some((k) => !allowed.includes(k))) throw conflict(s.status === 'closed' ? 'A closed survey can only stop its recurrence.' : 'Questions, audience and anonymity are fixed once a survey is launched.', 'survey_locked')
    if (input.name !== undefined) {
      const name = str(input.name, 120)
      if (!name) throw invalid('Give the survey a name.', 'validation_failed', { field: 'name' })
      s.name = name
    }
    if (input.closesOn !== undefined) {
      const c = date(input.closesOn)
      if (!c || c < s.opensOn || c < ctx.today) throw invalid('The close date must be today or later.', 'validation_failed', { field: 'closes_on' })
      s.closesOn = c
    }
    if (input.recurrence !== undefined) s.recurrence = input.recurrence === 'monthly' || input.recurrence === 'quarterly' ? input.recurrence : 'none'
  }
  return delay(surveyView(ctx, s))
}

export async function launchSurvey(user: User, id: string): Promise<Survey> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const s = companySurvey(ctx, id)
  if (s.status !== 'draft') throw conflict('This survey was launched already.', 'survey_launched')
  if (s.closesOn < ctx.today) throw invalid('The close date has passed. Pick a later one.', 'validation_failed', { field: 'closes_on' })
  if (s.opensOn <= ctx.today) {
    s.opensOn = ctx.today
    openSurvey(s, ctx.today, ctx.stamp)
    if (!s.targetEmployeeIds.length) {
      s.status = 'draft'
      s.launchedAt = null
      s.marks = []
      throw invalid('Nobody matches the audience (people need an active login to answer).', 'no_audience')
    }
  } else {
    s.status = 'scheduled'
    s.launchedAt = ctx.stamp
  }
  recordAudit(user, { action: 'update', entity: 'survey', entityId: s.id, summary: `Survey launched: ${s.name} (${s.status})` })
  return delay(surveyView(ctx, s))
}

export async function closeSurvey(user: User, id: string): Promise<Survey> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const s = companySurvey(ctx, id)
  if (s.status === 'closed') throw conflict('This survey is closed already.', 'survey_closed')
  if (s.status === 'draft') throw conflict('Launch the survey first (or just leave the draft).', 'survey_draft')
  s.status = 'closed'
  s.closedAt = ctx.stamp
  if (s.closesOn > ctx.today) s.closesOn = ctx.today
  return delay(surveyView(ctx, s))
}

/* ======================= Results ======================= */

interface Selection {
  scope: 'company' | Set<string>
  departmentId: string | null
  tenureBand: TenureBand | null
}

function cleanSelection(ctx: EngCtx, q: { departmentId?: string; tenureBand?: string }): Selection {
  const scope = resultsScope(ctx)
  if (scope === null) throw forbidden('Survey results are for HR and department heads.')
  const departmentId = q.departmentId || null
  const tenureBand = q.tenureBand ? (TENURE_BANDS.find((b) => b === q.tenureBand) ?? null) : null
  if (q.tenureBand && !tenureBand) throw invalid('Unknown tenure band.', 'validation_failed', { field: 'tenure_band' })
  if (departmentId && tenureBand) throw invalid('Filter by department or by tenure, not both (small groups could be singled out).', 'one_filter_only')
  if (departmentId && (!companyDept(ctx.co, departmentId) || (scope !== 'company' && !scope.has(departmentId)))) throw invalid('Unknown department.', 'validation_failed', { field: 'department_id' })
  return { scope, departmentId, tenureBand }
}

const inScope = (sel: Selection, departmentId: string | null) => sel.scope === 'company' || (!!departmentId && sel.scope.has(departmentId))
const matches = (sel: Selection, departmentId: string | null, band: TenureBand) =>
  inScope(sel, departmentId) && (!sel.departmentId || departmentId === sel.departmentId) && (!sel.tenureBand || band === sel.tenureBand)

function selected(co: string, s: SurveyRecord, sel: Selection): { responses: Tenant<ResponseRecord>[]; targets: number } {
  const responses = responsesOf(co, s.id).filter((r) => matches(sel, r.departmentId, r.tenureBand))
  let targets = 0
  for (const id of s.targetEmployeeIds) {
    const e = employeeById(co, id)
    if (e && matches(sel, e.departmentId, tenureBandOf(e.hireDate, s.opensOn))) targets++
  }
  return { responses, targets: Math.max(targets, responses.length) }
}

const npsValues = (s: SurveyRecord, rs: readonly ResponseRecord[]) => {
  const q = s.questions.find((x) => x.type === 'nps')
  return q ? rs.flatMap((r) => r.answers.filter((a) => a.questionId === q.id && a.value !== null).map((a) => a.value as number)) : []
}

/** Threshold: every anonymous survey, and any non-HR-full viewer; HR full sees a non-anonymous survey whole. */
const thresholdApplies = (ctx: EngCtx, s: SurveyRecord) => s.anonymous || !isFull(ctx)

const LIKERT_LABEL = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']

function questionResult(q: SurveyQuestion, rs: readonly ResponseRecord[], suppressed: boolean): QuestionResult {
  const answers = rs.map((r) => r.answers.find((a) => a.questionId === q.id)).filter((a): a is Answer => !!a)
  const answered = answers.filter((a) => (q.type === 'text' ? !!a.text.trim() : q.type === 'single' || q.type === 'multi' ? a.choiceIds.length > 0 : a.value !== null))
  const base = { questionId: q.id, type: q.type, text: q.text, driver: q.driver, responses: answered.length, suppressed }
  if (suppressed) return { ...base, average: null, distribution: [], comments: [] }
  let distribution: DistributionBar[] = []
  let average: number | null = null
  if (q.type === 'nps' || q.type === 'likert') {
    const values = answered.map((a) => a.value as number)
    average = values.length ? Math.round((values.reduce((x, y) => x + y, 0) / values.length) * 100) / 100 : null
    const range = q.type === 'nps' ? [...Array(11).keys()] : [1, 2, 3, 4, 5]
    distribution = range.map((v) => ({ value: String(v), label: q.type === 'likert' ? LIKERT_LABEL[v - 1] : String(v), count: values.filter((x) => x === v).length }))
  } else if (q.type === 'single' || q.type === 'multi') {
    distribution = q.options.map((o) => ({ value: o.id, label: o.text, count: answered.filter((a) => a.choiceIds.includes(o.id)).length }))
  }
  const comments = q.type === 'text' ? answered.map((a) => a.text.trim()).sort((a, b) => a.localeCompare(b)) : []
  return { ...base, average, distribution, comments }
}

function groupRows(s: SurveyRecord, groups: { key: string; label: string; rs: ResponseRecord[] }[], apply: boolean): GroupResult[] {
  const hidden = apply ? suppressBreakdown(groups.map((g) => g.rs.length)) : groups.map(() => false)
  return groups.map((g, i) => ({
    key: g.key,
    label: g.label,
    responses: g.rs.length,
    suppressed: hidden[i],
    enps: hidden[i] ? null : (enpsOf(npsValues(s, g.rs))?.score ?? null),
    score: hidden[i] ? null : engagementScore(s.questions, g.rs),
  }))
}

function trendOf(ctx: EngCtx, s: SurveyRecord, sel: Selection): TrendPoint[] {
  const same = hrEngSurveys
    .filter((x) => x.companyId === ctx.co && (x.status === 'open' || x.status === 'closed') && !x.subjectEmployeeId && (x.seriesId === s.seriesId || (s.kind !== 'custom' && x.kind === s.kind)))
    .filter((x) => isFull(ctx) || (sel.scope !== 'company' && teamMaySee(x, sel.scope)))
    .sort((a, b) => a.opensOn.localeCompare(b.opensOn) || a.wave - b.wave)
    .slice(-8)
  return same.map((x) => {
    const { responses, targets } = selected(ctx.co, x, sel)
    const suppressed = thresholdApplies(ctx, x) && isSuppressed(responses.length)
    return {
      surveyId: x.id,
      name: x.name,
      opensOn: x.opensOn,
      status: x.status,
      responses: responses.length,
      responseRate: pct(responses.length, targets),
      suppressed,
      enps: suppressed ? null : (enpsOf(npsValues(x, responses))?.score ?? null),
      score: suppressed ? null : engagementScore(x.questions, responses),
    }
  })
}

function display(q: SurveyQuestion, a: Answer | undefined): string {
  if (!a) return ''
  if (q.type === 'text') return a.text
  if (q.type === 'single' || q.type === 'multi') return a.choiceIds.map((id) => q.options.find((o) => o.id === id)?.text ?? id).join('; ')
  return a.value === null ? '' : String(a.value)
}

function resultsOf(ctx: EngCtx, s: Tenant<SurveyRecord>, sel: Selection): SurveyResults {
  const { responses, targets } = selected(ctx.co, s, sel)
  const apply = thresholdApplies(ctx, s)
  const suppressed = apply && isSuppressed(responses.length)
  const filtered = !!(sel.departmentId || sel.tenureBand)
  const deptIds = [...new Set([...s.targetEmployeeIds.map((id) => employeeById(ctx.co, id)?.departmentId ?? null), ...responses.map((r) => r.departmentId)])].filter((id) => inScope(sel, id))
  const byDepartment = filtered
    ? []
    : groupRows(
        s,
        deptIds
          .map((id) => ({ key: id ?? 'none', label: deptName(ctx.co, id) ?? 'No department', rs: responses.filter((r) => r.departmentId === id) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        apply,
      )
  const byTenure = filtered ? [] : groupRows(s, TENURE_BANDS.map((b) => ({ key: b, label: TENURE_LABEL[b], rs: responses.filter((r) => r.tenureBand === b) })).filter((g) => g.rs.length > 0), apply)
  const comments = suppressed ? [] : s.questions.filter((q) => q.type === 'text').flatMap((q) => responses.map((r) => r.answers.find((a) => a.questionId === q.id)?.text.trim() ?? '').filter(Boolean))
  const individual: IndividualResponse[] | null =
    !s.anonymous && isFull(ctx)
      ? responses
          .filter((r) => r.respondentEmployeeId)
          .map((r) => ({
            employeeName: employeeById(ctx.co, r.respondentEmployeeId!)?.fullName ?? '—',
            departmentName: deptName(ctx.co, r.departmentId),
            submittedOn: r.submittedOn,
            language: r.language,
            answers: s.questions.map((q) => ({ questionId: q.id, display: display(q, r.answers.find((a) => a.questionId === q.id)) })),
          }))
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      : null
  return {
    survey: surveyView(ctx, s),
    scope: sel.scope === 'company' ? 'company' : 'departments',
    filter: { departmentId: sel.departmentId, tenureBand: sel.tenureBand },
    minGroup: MIN_SURVEY_GROUP,
    targetCount: targets,
    responseCount: responses.length,
    responseRate: s.status === 'draft' || s.status === 'scheduled' ? null : pct(responses.length, targets),
    suppressed,
    enps: suppressed ? null : enpsOf(npsValues(s, responses)),
    engagementScore: suppressed ? null : engagementScore(s.questions, responses),
    drivers: suppressed ? [] : driverScores(s.questions, responses),
    questions: s.questions.map((q) => questionResult(q, responses, suppressed)),
    byDepartment,
    byTenure,
    themes: suppressed ? [] : commentThemes(comments),
    trend: trendOf(ctx, s, sel),
    individual,
  }
}

export async function getResults(user: User, id: string, q: { departmentId?: string; tenureBand?: string } = {}): Promise<SurveyResults> {
  const ctx = ctxOf(user)
  const s = visibleSurvey(ctx, id)
  if (s.status === 'draft') throw conflict('This survey hasn’t been launched yet.', 'survey_draft')
  return delay(resultsOf(ctx, s, cleanSelection(ctx, q)))
}

/** CSV rows: aggregates only for an anonymous survey (no comments: free text can identify); per person otherwise. HR full. */
export async function exportResults(user: User, id: string): Promise<SurveyExport> {
  const ctx = ctxOf(user)
  requireFull(ctx)
  const s = companySurvey(ctx, id)
  if (s.status === 'draft') throw conflict('This survey hasn’t been launched yet.', 'survey_draft')
  const r = resultsOf(ctx, s, { scope: 'company', departmentId: null, tenureBand: null })
  // No dates or other digit runs in the name (card-number-like strings trip the secrets guard of exports).
  const fileName = `engagement-results-${s.id.toLowerCase()}.csv`
  if (r.individual) {
    return delay({
      fileName,
      headers: ['Employee', 'Department', 'Submitted on', 'Language', ...s.questions.map((q) => q.text)],
      rows: r.individual.map((i) => [i.employeeName, i.departmentName, i.submittedOn, i.language, ...i.answers.map((a) => a.display)]),
    })
  }
  const headers = ['Section', 'Item', 'Value', 'Responses', 'Score / count']
  const rows: (string | number | null)[][] = [['Summary', 'Response rate', r.responseRate === null ? null : `${r.responseRate}%`, r.responseCount, r.targetCount]]
  if (r.suppressed) {
    rows.push(['Summary', 'Not enough responses to show', `Fewer than ${MIN_SURVEY_GROUP}`, r.responseCount, null])
    return delay({ fileName, headers, rows })
  }
  if (r.enps) rows.push(['Summary', 'eNPS', `${r.enps.promoters} promoters · ${r.enps.passives} passives · ${r.enps.detractors} detractors`, r.enps.responses, r.enps.score])
  if (r.engagementScore !== null) rows.push(['Summary', 'Engagement score (1–5)', null, r.responseCount, r.engagementScore])
  for (const d of r.drivers) rows.push(['Driver', d.label, d.favorablePct === null ? null : `${d.favorablePct}% favourable`, d.responses, d.score])
  for (const q of r.questions) {
    if (q.type === 'text') continue
    rows.push(['Question', q.text, 'Average', q.responses, q.average])
    for (const b of q.distribution) rows.push(['Distribution', q.text, b.label, q.responses, b.count])
  }
  for (const g of r.byDepartment) rows.push(['Department', g.label, g.suppressed ? 'Not enough responses to show' : g.enps === null ? null : `eNPS ${g.enps}`, g.responses, g.score])
  for (const g of r.byTenure) rows.push(['Tenure', g.label, g.suppressed ? 'Not enough responses to show' : g.enps === null ? null : `eNPS ${g.enps}`, g.responses, g.score])
  for (const t of r.themes) rows.push(['Comment theme', t.label, null, t.count, null])
  return delay({ fileName, headers, rows })
}

/** Overview for the Engagement page and HR Reports › Engagement: eNPS trend, the latest engagement survey, open surveys. */
export async function getOverview(user: User): Promise<EngagementOverview> {
  const ctx = ctxOf(user)
  const scope = resultsScope(ctx)
  if (scope === null) throw forbidden('Survey results are for HR and department heads.')
  const sel: Selection = { scope, departmentId: null, tenureBand: null }
  const visible = visibleSurveys(ctx).filter((s) => (s.status === 'open' || s.status === 'closed') && !s.subjectEmployeeId)
  const byOpen = (a: SurveyRecord, b: SurveyRecord) => b.opensOn.localeCompare(a.opensOn) || b.wave - a.wave
  const latestEnpsSurvey = visible.filter((s) => s.kind === 'enps').sort(byOpen)[0]
  const enpsTrend = latestEnpsSurvey ? trendOf(ctx, latestEnpsSurvey, sel) : []
  const eng = visible.filter((s) => s.kind === 'engagement').sort(byOpen)[0]
  let latestEngagement: EngagementOverview['latestEngagement'] = null
  if (eng) {
    const r = resultsOf(ctx, eng, sel)
    latestEngagement = { surveyId: eng.id, name: eng.name, status: eng.status, responses: r.responseCount, suppressed: r.suppressed, score: r.engagementScore, drivers: r.drivers }
  }
  return delay({
    scope: scope === 'company' ? 'company' : 'departments',
    minGroup: MIN_SURVEY_GROUP,
    latestEnps: enpsTrend.at(-1) ?? null,
    enpsTrend,
    latestEngagement,
    openSurveys: visible
      .filter((s) => s.status === 'open')
      .map((s) => {
        const x = selected(ctx.co, s, sel)
        return { surveyId: s.id, name: s.name, closesOn: s.closesOn, responseRate: pct(x.responses.length, x.targets) }
      }),
  })
}

/* ======================= Answering (self-service, every employee) ======================= */

function myResponse(ctx: EngCtx, s: SurveyRecord, employeeId: string): Tenant<ResponseRecord> | undefined {
  if (s.anonymous) {
    const key = sealKey(ctx.co, s.id, employeeId)
    return hrEngResponses.find((r) => r.companyId === ctx.co && r.surveyId === s.id && r.sealedKey === key)
  }
  return hrEngResponses.find((r) => r.companyId === ctx.co && r.surveyId === s.id && r.respondentEmployeeId === employeeId)
}

function myRow(ctx: EngCtx, s: Tenant<SurveyRecord>, employeeId: string): MySurveyRow {
  const responded = hasResponded(ctx.co, s.id, employeeId)
  return { surveyId: s.id, name: s.name, kind: s.kind, anonymous: s.anonymous, closesOn: s.closesOn, responded, editable: s.status === 'open', questionCount: s.questions.length }
}

export async function getMySurveys(user: User): Promise<MySurveys> {
  const ctx = ctxOf(user)
  const me = ctx.self
  if (!me) return delay({ employeeLinked: false, toAnswer: [], answered: [] })
  const mine = hrEngSurveys.filter((s) => s.companyId === ctx.co && (s.status === 'open' || s.status === 'closed') && s.targetEmployeeIds.includes(me.id))
  const rows = mine.map((s) => myRow(ctx, s, me.id))
  return delay({
    employeeLinked: true,
    toAnswer: rows.filter((r) => r.editable && !r.responded).sort((a, b) => a.closesOn.localeCompare(b.closesOn)),
    answered: rows.filter((r) => r.responded).sort((a, b) => b.closesOn.localeCompare(a.closesOn)).slice(0, 10),
  })
}

function mySurvey(ctx: EngCtx, id: string): { s: Tenant<SurveyRecord>; employeeId: string } {
  const me = ctx.self
  const s = surveyOf(ctx.co, id)
  if (!me || !s || (s.status !== 'open' && s.status !== 'closed') || !s.targetEmployeeIds.includes(me.id)) throw notFound()
  return { s, employeeId: me.id }
}

function formOf(ctx: EngCtx, s: Tenant<SurveyRecord>, employeeId: string): MySurveyForm {
  const r = myResponse(ctx, s, employeeId)
  return {
    surveyId: s.id,
    name: s.name,
    kind: s.kind,
    anonymous: s.anonymous,
    closesOn: s.closesOn,
    questions: structuredClone(s.questions),
    answers: r ? structuredClone(r.answers) : null,
    language: r?.language ?? 'en',
    editable: s.status === 'open',
  }
}

export async function getMySurvey(user: User, id: string): Promise<MySurveyForm> {
  const ctx = ctxOf(user)
  const { s, employeeId } = mySurvey(ctx, id)
  return delay(formOf(ctx, s, employeeId))
}

function cleanAnswers(s: SurveyRecord, v: unknown): Answer[] {
  const given = arr(v).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  return s.questions.map((q) => {
    const raw = given.find((a) => a.questionId === q.id)
    const value = raw && typeof raw.value === 'number' && Number.isInteger(raw.value) ? raw.value : null
    const choiceIds = [...new Set(arr(raw?.choiceIds).filter((x): x is string => typeof x === 'string'))]
    const a: Answer = { questionId: q.id, value: null, choiceIds: [], text: '' }
    if (q.type === 'nps' || q.type === 'likert') {
      const [min, max] = q.type === 'nps' ? [0, 10] : [1, 5]
      if (value !== null && (value < min || value > max)) throw invalid(`“${q.text}”: pick a value from ${min} to ${max}.`, 'validation_failed', { field: q.id })
      a.value = value
      if (q.required && value === null) throw invalid(`“${q.text}” needs an answer.`, 'answer_required', { field: q.id })
    } else if (q.type === 'single' || q.type === 'multi') {
      if (choiceIds.some((id) => !q.options.some((o) => o.id === id))) throw invalid(`“${q.text}”: unknown choice.`, 'validation_failed', { field: q.id })
      if (q.type === 'single' && choiceIds.length > 1) throw invalid(`“${q.text}”: pick one choice.`, 'validation_failed', { field: q.id })
      a.choiceIds = choiceIds
      if (q.required && !choiceIds.length) throw invalid(`“${q.text}” needs an answer.`, 'answer_required', { field: q.id })
    } else {
      a.text = str(raw?.text, 2000)
      if (q.required && !a.text) throw invalid(`“${q.text}” needs an answer.`, 'answer_required', { field: q.id })
    }
    return a
  })
}

/** Submits (or, until the survey closes, replaces) the caller's own answers. */
export async function answerSurvey(user: User, id: string, input: Partial<AnswerInput> | null): Promise<MySurveyForm> {
  const ctx = ctxOf(user)
  const { s, employeeId } = mySurvey(ctx, id)
  if (s.status !== 'open') throw conflict('This survey is closed.', 'survey_closed')
  if (!input) throw invalid('Send your answers.')
  const answers = cleanAnswers(s, input.answers)
  const language: Language = input.language === 'ar' ? 'ar' : 'en'
  const existing = myResponse(ctx, s, employeeId)
  if (existing) {
    existing.answers = answers
    existing.language = language
    existing.submittedOn = ctx.today
  } else {
    const e = employeeById(ctx.co, employeeId)!
    const row: Tenant<ResponseRecord> = {
      companyId: ctx.co,
      id: s.anonymous ? randomResponseId() : nextEngId('ERS-'),
      surveyId: s.id,
      respondentEmployeeId: s.anonymous ? null : employeeId,
      sealedKey: s.anonymous ? sealKey(ctx.co, s.id, employeeId) : null,
      departmentId: e.departmentId,
      tenureBand: tenureBandOf(e.hireDate, s.opensOn),
      answers,
      language,
      submittedOn: ctx.today,
    }
    if (s.anonymous) insertAtRandom(hrEngResponses, row)
    else hrEngResponses.push(row)
  }
  if (!hasResponded(ctx.co, s.id, employeeId)) hrEngParticipants.push({ companyId: ctx.co, surveyId: s.id, employeeId })
  return delay(formOf(ctx, s, employeeId))
}

export { headedDepartmentIds }
