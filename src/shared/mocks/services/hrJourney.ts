import type { User } from '@/shared/types'
import type { Employee, EmploymentType } from '@/modules/hr/types'
import { EMPLOYMENT_STATUS_LABEL } from '@/modules/hr/types'
import type { AssetCategory, DocumentType, HrAccess } from '@/modules/hr/peopleTypes'
import { ASSET_CATEGORIES, DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import type {
  DueAnchor,
  ItemAction,
  JourneyDetail,
  JourneyItem,
  JourneyItemInput,
  JourneyKind,
  JourneyOptions,
  JourneyRow,
  JourneyTemplate,
  MyJourneyTask,
  OwnerRole,
  StartJourneyInput,
  SystemTaskKey,
  TemplateInput,
  TemplateItem,
  TemplateItemInput,
  TemplateView,
} from '@/modules/hr/journey/types'
import { DUE_ANCHORS, ITEM_ACTION_KINDS, JOURNEY_KINDS, JOURNEY_KIND_LABEL, OWNER_ROLES } from '@/modules/hr/journey/types'
import { daysLeft, dueDateFor, isOverdue, matchTemplate, progressOf } from '@/modules/hr/journey/calc'
import { ApiError } from '@/shared/lib/apiError'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts, hrDocuments } from '@/shared/mocks/data/hrPeople'
import { hrCertificates, hrCourses, hrEnrollments, hrSessions } from '@/shared/mocks/data/hrTalent'
import {
  dueCtx,
  hrJourneys,
  hrJourneyTemplates,
  itemFromTemplate,
  nextJourneyId,
  nextJourneyItemId,
  nextTemplateId,
  nextTemplateItemId,
  type JourneyItemRecord,
  type JourneyRecord,
} from '@/shared/mocks/data/hrJourney'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyModules, onLifecycleTick } from '@/shared/mocks/services/billing'
import { now as clockNow, nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertHrFull, hrAccessOf, hrFullUsers, isIsoDate, logHr, managerUserOf, visibleEmployeeIds, type HrActor } from './hrAccess'
import { assetsHeldBy } from './hrAssets'
import { offboardingSystemSteps } from './hrJourneySystem'
import { onProbationOutcome } from './hrPerformanceCore'
import { policiesAcknowledgedNote } from './hrPolicyAudience'

/**
 * HR › Onboarding & offboarding (docs/API.md › HR › Onboarding & offboarding).
 *
 * WHO
 *   full    (Company Admin, Management, HR Manager) templates; every journey; start / cancel / activate; add,
 *           remove, reassign and tick any item (except system items)
 *   team    (Department Head) journeys of the employees in their HR scope (services/hrAccess.ts); tick the
 *           Manager items of those journeys (not of their own) and items assigned to them
 *   own     (Employee) their own journeys; tick their Employee items and items assigned to them
 *   hidden  403 on the journey screens
 *   ASSIGNEE INBOX (any role, like the leave approver inbox): GET /hr/journeys/my-tasks and ticking an item
 *           assigned to you work whatever your `hr` scope (a Sales Manager onboarding their new agent, the
 *           Accountant's payroll item). Anything else outside your scope answers 404 like a missing id.
 *
 * LIFECYCLE (hooks called by services/hrEmployees.ts)
 *   createEmployee with status onboarding (incl. Recruitment's hire) → onboarding journey from the best template
 *   status → notice / terminated → offboarding journey (template items + SYSTEM items assets / login / settlement
 *   that complete from their real source); back to active → the running offboarding is cancelled
 *   POST /hr/employees/:id/offboarding/complete → the offboarding journey completes (open items are skipped)
 *   POST /hr/journeys/:id/activate → onboarding complete; an `onboarding` employee becomes `active`
 *
 * NOTIFICATIONS (stored, type `hr-journey`, bell group HR, once per item and threshold): item assigned → the
 * assignee; due tomorrow (or today when first seen then) / overdue → the assignee (HR team for unassigned items);
 * journey completed → HR full + the employee's manager. Days are the company's calendar (regional timezone, mock
 * clock). Runs on the company's lifecycle tick and before the journey reads.
 *
 * SEAM for HR › Performance (probation reviews): `completeProbationReviewItem(companyId, employeeId, ref)` ticks the
 * onboarding's probation review item; `probationReviewItemOf(companyId, employeeId)` reads it. No import the other way.
 */

export const JOURNEY_ALERT_TYPE = 'hr-journey'

const bad = (message: string, field?: string): never => {
  throw new CodedApiError(message, 422, 'validation_failed', field ? { field } : {})
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
const LEAVING = ['notice', 'terminated']
const EMPLOYMENT_TYPES: EmploymentType[] = ['full_time', 'part_time', 'contractor', 'intern']
const MY_TASKS_LINK = '/hr/journeys?tab=mine'
const journeyLink = (id: string) => `/hr/journeys/${encodeURIComponent(id)}`
const SYSTEM_OWNER: Record<SystemTaskKey, OwnerRole> = { assets: 'hr', login: 'it', settlement: 'finance' }

const employeeOf = (co: string, id: string) => hrEmployees.find((e) => e.companyId === co && e.id === id)
const userOf = (co: string, id: string | null | undefined) => (id ? users.find((u) => u.id === id && u.companyId === co) : undefined)
const activeUserOf = (co: string, id: string | null | undefined) => {
  const u = userOf(co, id)
  return u?.active ? u : undefined
}
const deptName = (co: string, id: string | null) => (id ? departments.find((d) => d.companyId === co && d.id === id)?.name ?? null : null)
const actorName = (a: HrActor) => a?.name ?? 'System'

/* ======================= automatic ticks (link actions, system items) ======================= */

/** What makes a linked item done, read from the real record (null = not yet). */
function autoDone(co: string, e: Tenant<Employee>, action: ItemAction): string | null {
  switch (action.kind) {
    case 'assign_asset': {
      const a = assetsHeldBy(e).find((x) => !action.assetCategory || x.category === action.assetCategory)
      return a ? `${a.tag} ${a.name} assigned` : null
    }
    case 'upload_document': {
      if (!action.documentType) return null
      const d = hrDocuments.find((x) => x.companyId === co && x.employeeId === e.id && x.type === action.documentType)
      return d ? `${DOCUMENT_TYPE_LABEL[d.type]} on file` : null
    }
    case 'sign_contract': {
      const c = hrContracts.find((x) => x.companyId === co && x.employeeId === e.id && (x.status === 'active' || x.status === 'draft') && !!x.signedDate)
      return c ? `Contract signed ${c.signedDate}` : null
    }
    case 'enrol_course': {
      const enrolledIn = (courseId: string) =>
        hrCertificates.some((c) => c.companyId === co && c.employeeId === e.id && c.courseId === courseId) ||
        hrEnrollments.some((en) => en.companyId === co && en.employeeId === e.id && !['no_show', 'failed'].includes(en.status) && hrSessions.some((s) => s.companyId === co && s.id === en.sessionId && s.courseId === courseId))
      if (action.courseId) {
        const course = hrCourses.find((c) => c.companyId === co && c.id === action.courseId)
        return course && enrolledIn(course.id) ? `Enrolled in ${course.title}` : null
      }
      const mandatory = hrCourses.filter((c) => c.companyId === co && c.active && c.mandatory)
      return mandatory.length && mandatory.every((c) => enrolledIn(c.id)) ? `Enrolled in ${mandatory.length} mandatory course${mandatory.length === 1 ? '' : 's'}` : null
    }
    case 'acknowledge_policies':
      // HR › Policies: every published policy addressed to the employee acknowledged at its current version.
      return policiesAcknowledgedNote(co, e)
    default:
      // probation_review: ticked by hand or by HR › Performance through completeProbationReviewItem.
      return null
  }
}

/**
 * Brings a running journey up to date: due dates follow the hire / exit / probation date (unless HR set one),
 * system items mirror their source (live, both ways), linked items tick themselves once their record exists.
 */
function syncJourney(j: Tenant<JourneyRecord>, at = nowIso()): void {
  if (j.status !== 'active') return
  const e = employeeOf(j.companyId, j.employeeId)
  if (!e) return
  const ctx = dueCtx(j.companyId, j.kind, e)
  const steps = j.kind === 'offboarding' ? offboardingSystemSteps(e) : []
  for (const item of j.items) {
    if (!item.dueOverridden) item.dueDate = dueDateFor(item.dueAnchor, item.dueOffsetDays, ctx)
    if (item.system) {
      const st = steps.find((s) => s.key === item.system)
      if (!st) continue
      item.detail = st.detail
      if (st.done && item.status === 'open') Object.assign(item, { status: 'done', doneAt: at, doneBy: null, doneByName: 'System' })
      else if (!st.done && item.status === 'done') Object.assign(item, { status: 'open', doneAt: null, doneBy: null, doneByName: null })
      continue
    }
    if (item.status === 'open' && item.action) {
      const how = autoDone(j.companyId, e, item.action)
      if (how) Object.assign(item, { status: 'done', doneAt: at, doneBy: null, doneByName: 'System', detail: how })
    }
  }
}

function syncCompany(co: string): void {
  const at = nowIso()
  for (const j of hrJourneys) if (j.companyId === co && j.status === 'active') syncJourney(j, at)
}

/* ======================= notifications ======================= */

function notify(co: string, userIds: Iterable<string>, title: string, body: string, link: string, at: string): number {
  let n = 0
  for (const userId of new Set(userIds)) {
    pushNotification({ companyId: co, userId, type: JOURNEY_ALERT_TYPE, title, body, link, at })
    n++
  }
  return n
}

/** The people an item's reminders go to: its assignee (active), else the HR team. */
function ownersOf(co: string, item: JourneyItemRecord): string[] {
  const a = activeUserOf(co, item.assigneeUserId)
  return a ? [a.id] : hrFullUsers(co).map((u) => u.id)
}

/** "Item assigned" to each assignee not told yet (one message per assignee and batch). The actor isn't told. */
function announceAssigned(j: Tenant<JourneyRecord>, items: JourneyItemRecord[], actor: HrActor, at = nowIso()): void {
  const e = employeeOf(j.companyId, j.employeeId)
  if (!e) return
  const byUser = new Map<string, JourneyItemRecord[]>()
  for (const item of items) {
    if (item.status !== 'open' || item.system) continue
    const u = activeUserOf(j.companyId, item.assigneeUserId)
    if (!u) continue
    const mark = `assigned:${u.id}`
    if (item.alertMarks.includes(mark)) continue
    item.alertMarks.push(mark)
    if (actor && actor.id === u.id) continue
    byUser.set(u.id, [...(byUser.get(u.id) ?? []), item])
  }
  const kind = JOURNEY_KIND_LABEL[j.kind].toLowerCase()
  for (const [userId, list] of byUser) {
    const first = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    const self = e.userId === userId
    const title = list.length === 1 ? `New ${kind} task: ${first.title}` : `${list.length} ${kind} tasks ${self ? 'for you' : `for ${e.fullName}`}`
    notify(j.companyId, [userId], title, `${self ? 'Your ' + kind : e.fullName} · first due ${first.dueDate}`, MY_TASKS_LINK, at)
  }
}

function announceCompleted(j: Tenant<JourneyRecord>, e: Tenant<Employee>, at: string): void {
  const ids = new Set(hrFullUsers(j.companyId).map((u) => u.id))
  const m = managerUserOf(j.companyId, e)
  if (m) ids.add(m.id)
  notify(j.companyId, ids, `${JOURNEY_KIND_LABEL[j.kind]} completed: ${e.fullName}`, `${e.fullName} · ${e.employeeNo} · ${EMPLOYMENT_STATUS_LABEL[e.status]}`, journeyLink(j.id), at)
}

export interface JourneyTick {
  due: number
  overdue: number
}

/**
 * Due tomorrow / overdue reminders, once per item and threshold. The marks carry the due date (`due:2027-01-05`),
 * so a moved due date re-arms them. An item first seen overdue gets the overdue notice only; one first seen on its
 * due date gets "due today".
 */
export function runJourneyAlerts(companyId: string, at: Date = clockNow()): JourneyTick {
  const out: JourneyTick = { due: 0, overdue: 0 }
  if (!companyModules(companyId).includes('hr')) return out
  const today = companyDayOf(companyId, at).today
  const stamp = at.toISOString()
  for (const j of hrJourneys) {
    if (j.companyId !== companyId || j.status !== 'active') continue
    syncJourney(j, stamp)
    const e = employeeOf(companyId, j.employeeId)
    if (!e) continue
    for (const item of j.items) {
      if (item.status !== 'open') continue
      const left = daysBetweenIso(today, item.dueDate)
      const kDue = `due:${item.dueDate}`
      const kOver = `overdue:${item.dueDate}`
      const who = `${e.fullName} · ${JOURNEY_KIND_LABEL[j.kind].toLowerCase()}`
      if (left < 0) {
        if (item.alertMarks.includes(kOver)) continue
        item.alertMarks.push(kOver)
        if (!item.alertMarks.includes(kDue)) item.alertMarks.push(kDue)
        notify(companyId, ownersOf(companyId, item), `Overdue: ${item.title}`, `${who} · was due ${item.dueDate}`, MY_TASKS_LINK, stamp)
        out.overdue++
      } else if (left <= 1 && !item.alertMarks.includes(kDue)) {
        item.alertMarks.push(kDue)
        notify(companyId, ownersOf(companyId, item), `Due ${left === 0 ? 'today' : 'tomorrow'}: ${item.title}`, `${who} · due ${item.dueDate}`, MY_TASKS_LINK, stamp)
        out.due++
      }
    }
  }
  return out
}

onLifecycleTick('hr-journey-alerts', (companyId, until) => runJourneyAlerts(companyId, new Date(until)))

/* ======================= starting / lifecycle ======================= */

function systemItems(co: string, e: Tenant<Employee>): JourneyItemRecord[] {
  return offboardingSystemSteps(e).map((s) => ({
    id: nextJourneyItemId(),
    title: s.label,
    description: s.key === 'assets' ? 'Every company asset returned or marked lost (Company Assets).' : s.key === 'login' ? 'The linked login deactivated (Settings › Users).' : 'The final settlement paid (Salary Management › Final settlements).',
    ownerRole: SYSTEM_OWNER[s.key],
    assigneeUserId: null,
    dueAnchor: 'start' as DueAnchor,
    dueOffsetDays: 0,
    dueDate: dueDateFor('start', 0, dueCtx(co, 'offboarding', e)),
    dueOverridden: false,
    required: true,
    blocking: s.blocking,
    action: null,
    system: s.key,
    status: 'open' as const,
    doneAt: null,
    doneBy: null,
    doneByName: null,
    detail: s.detail,
    note: '',
    alertMarks: [],
    externalRef: null,
  }))
}

const runningOf = (co: string, employeeId: string, kind: JourneyKind) => hrJourneys.find((j) => j.companyId === co && j.employeeId === employeeId && j.kind === kind && j.status === 'active')

function startJourney(co: string, e: Tenant<Employee>, kind: JourneyKind, template: Tenant<JourneyTemplate> | null, actor: HrActor, auto: boolean): Tenant<JourneyRecord> {
  const at = nowIso()
  const items = (template?.items ?? []).map((t) => itemFromTemplate(co, kind, e, t))
  if (kind === 'offboarding') items.push(...systemItems(co, e))
  const j: Tenant<JourneyRecord> = {
    companyId: co,
    id: nextJourneyId(),
    kind,
    employeeId: e.id,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    status: 'active',
    startedAt: at,
    startedBy: actor?.id ?? null,
    startedByName: actorName(actor),
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    items,
  }
  hrJourneys.push(j)
  syncJourney(j, at)
  announceAssigned(j, j.items, actor, at)
  logHr(co, e.id, actor, 'journey', `${JOURNEY_KIND_LABEL[kind]} checklist started${auto ? ' automatically' : ''}${template ? ` (${template.name})` : ' (no matching template)'}`, at)
  return j
}

const templatesOf = (co: string) => hrJourneyTemplates.filter((t) => t.companyId === co)

/** Hook: an employee was just created (Employees form or Recruitment's hire). */
export function journeyOnEmployeeCreated(e: Tenant<Employee>, actor: HrActor): void {
  if (e.status === 'onboarding') startJourney(e.companyId, e, 'onboarding', matchTemplate(templatesOf(e.companyId), 'onboarding', e), actor, true)
  else if (LEAVING.includes(e.status)) startJourney(e.companyId, e, 'offboarding', matchTemplate(templatesOf(e.companyId), 'offboarding', e), actor, true)
}

/** Hook: the employee's status changed (PATCH /hr/employees/:id). */
export function journeyOnStatusChanged(e: Tenant<Employee>, before: Employee['status'], actor: HrActor): void {
  const co = e.companyId
  if (LEAVING.includes(e.status) && !LEAVING.includes(before) && !runningOf(co, e.id, 'offboarding')) {
    startJourney(co, e, 'offboarding', matchTemplate(templatesOf(co), 'offboarding', e), actor, true)
  }
  if (!LEAVING.includes(e.status) && LEAVING.includes(before)) {
    const j = runningOf(co, e.id, 'offboarding')
    if (j) {
      j.status = 'cancelled'
      j.cancelledAt = nowIso()
      logHr(co, e.id, actor, 'journey', 'Offboarding checklist cancelled (the employee stays)')
    }
  }
  if (e.status === 'onboarding' && before !== 'onboarding' && !runningOf(co, e.id, 'onboarding')) {
    startJourney(co, e, 'onboarding', matchTemplate(templatesOf(co), 'onboarding', e), actor, true)
  }
}

/** Hook: POST /hr/employees/:id/offboarding/complete succeeded. Open items are skipped; system items frozen. */
export function journeyOnOffboardingCompleted(e: Tenant<Employee>, actor: HrActor): void {
  const j = runningOf(e.companyId, e.id, 'offboarding')
  if (!j) return
  const at = nowIso()
  syncJourney(j, at)
  for (const item of j.items) {
    if (item.status === 'open') Object.assign(item, { status: 'skipped', note: item.note || 'Open when the offboarding was completed.' })
  }
  j.status = 'completed'
  j.completedAt = at
  j.completedBy = actor?.id ?? null
  announceCompleted(j, e, at)
}

/* ======================= seam: HR › Performance ======================= */

/** The open (or done) probation review item of the employee's running / last onboarding, if any. */
export function probationReviewItemOf(companyId: string, employeeId: string): { journeyId: string; itemId: string; dueDate: string; status: string } | null {
  const j = [...hrJourneys].reverse().find((x) => x.companyId === companyId && x.employeeId === employeeId && x.kind === 'onboarding' && x.status !== 'cancelled')
  const item = j?.items.find((i) => i.action?.kind === 'probation_review')
  return j && item ? { journeyId: j.id, itemId: item.id, dueDate: item.dueDate, status: item.status } : null
}

/** Ticks the probation review item when HR › Performance records the review (idempotent). True when ticked. */
export function completeProbationReviewItem(companyId: string, employeeId: string, ref: { reviewId: string; actorName?: string }): boolean {
  const j = hrJourneys.find((x) => x.companyId === companyId && x.employeeId === employeeId && x.kind === 'onboarding' && x.status === 'active')
  const item = j?.items.find((i) => i.action?.kind === 'probation_review' && i.status === 'open')
  if (!item) return false
  Object.assign(item, { status: 'done', doneAt: nowIso(), doneBy: null, doneByName: ref.actorName ?? 'HR › Performance', detail: `Probation review ${ref.reviewId}`, externalRef: ref.reviewId })
  return true
}

// HR › Performance shares a probation review → the onboarding journey's probation item is done.
onProbationOutcome('hr-journey', (e) => {
  completeProbationReviewItem(e.companyId, e.employeeId, { reviewId: e.reviewId })
})

/* ======================= access ======================= */

function accessOrNull(user: User): HrAccess | null {
  try {
    return hrAccessOf(user)
  } catch {
    return null
  }
}

/** A journey of the caller's HR scope, or 404 (403 for roles without HR). */
function visibleJourney(user: User, id: string): { j: Tenant<JourneyRecord>; access: HrAccess } {
  const access = hrAccessOf(user)
  const ids = visibleEmployeeIds(user)
  const j = hrJourneys.find((x) => x.companyId === tenantOf(user) && x.id === id && ids.has(x.employeeId))
  if (!j) notFound()
  return { j: j!, access }
}

function canTick(user: User, access: HrAccess | null, visible: boolean, j: JourneyRecord, e: Employee, item: JourneyItemRecord): boolean {
  if (item.system || j.status !== 'active' || item.status === 'skipped') return false
  if (item.assigneeUserId === user.id) return true
  if (!visible || !access) return false
  if (access === 'full') return true
  const self = !!e.userId && e.userId === user.id
  if (item.ownerRole === 'employee') return self
  if (item.ownerRole === 'manager') return access === 'team' && !self
  return false
}

/* ======================= views ======================= */

function itemView(user: User, access: HrAccess | null, visible: boolean, j: Tenant<JourneyRecord>, e: Employee, item: JourneyItemRecord, today: string): JourneyItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    ownerRole: item.ownerRole,
    assigneeUserId: item.assigneeUserId,
    assigneeName: userOf(j.companyId, item.assigneeUserId)?.name ?? null,
    dueAnchor: item.dueAnchor,
    dueOffsetDays: item.dueOffsetDays,
    dueDate: item.dueDate,
    dueOverridden: item.dueOverridden,
    required: item.required,
    blocking: item.blocking,
    action: item.action ? { ...item.action } : null,
    system: item.system,
    status: item.status,
    doneAt: item.doneAt,
    doneByName: item.doneByName,
    detail: item.detail,
    note: item.note,
    overdue: isOverdue(item, today),
    daysLeft: item.status === 'open' ? daysLeft(item.dueDate, today) : null,
    canComplete: canTick(user, access, visible, j, e, item),
  }
}

function blockersOf(j: JourneyRecord): string[] {
  if (j.status !== 'active') return []
  if (j.kind === 'onboarding') return j.items.filter((i) => i.required && i.status === 'open').map((i) => i.title)
  return j.items.filter((i) => i.blocking && i.status === 'open').map((i) => `${i.title}${i.detail ? `: ${i.detail}` : ''}`)
}

function rowOf(j: Tenant<JourneyRecord>, e: Tenant<Employee>, today: string): JourneyRow {
  const open = j.items.filter((i) => i.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const manager = e.managerId ? employeeOf(j.companyId, e.managerId) : undefined
  return {
    id: j.id,
    kind: j.kind,
    employeeId: e.id,
    employeeName: e.fullName,
    employeeNo: e.employeeNo,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    departmentName: deptName(j.companyId, e.departmentId),
    managerName: manager?.fullName ?? null,
    employeeStatus: e.status,
    templateId: j.templateId,
    templateName: j.templateName,
    anchorDate: j.kind === 'offboarding' ? e.exitDate : e.hireDate,
    status: j.status,
    startedAt: j.startedAt,
    startedByName: j.startedByName,
    completedAt: j.completedAt,
    progress: progressOf(j.items),
    overdue: j.status === 'active' ? j.items.filter((i) => isOverdue(i, today)).length : 0,
    nextDueDate: j.status === 'active' ? open[0]?.dueDate ?? null : null,
  }
}

function detailOf(user: User, access: HrAccess, j: Tenant<JourneyRecord>): JourneyDetail {
  const e = employeeOf(j.companyId, j.employeeId)!
  const today = companyDayOf(j.companyId).today
  const blockers = blockersOf(j)
  return {
    ...rowOf(j, e, today),
    items: j.items.map((i) => itemView(user, access, true, j, e, i, today)),
    canManage: access === 'full',
    canFinish: j.status === 'active' && blockers.length === 0,
    finishBlockers: blockers,
  }
}

/* ======================= templates ======================= */

function templateView(t: Tenant<JourneyTemplate>): TemplateView {
  const { companyId: co, items, ...rest } = t
  return {
    ...rest,
    departmentName: deptName(co, t.departmentId),
    items: items.map((i) => ({ ...i, action: i.action ? { ...i.action } : null, ownerUserName: userOf(co, i.ownerUserId)?.name ?? null })),
    activeJourneys: hrJourneys.filter((j) => j.companyId === co && j.templateId === t.id && j.status === 'active').length,
  }
}

function templateOr404(user: User, id: string): Tenant<JourneyTemplate> {
  const t = hrJourneyTemplates.find((x) => x.companyId === tenantOf(user) && x.id === id)
  if (!t) notFound()
  return t!
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

function cleanAction(co: string, raw: unknown, kind: JourneyKind): ItemAction | null {
  if (raw === null || raw === undefined) return null
  const a = raw as Partial<ItemAction>
  if (!ITEM_ACTION_KINDS.includes(a.kind as ItemAction['kind'])) bad('Pick a link action.', 'action')
  const out: ItemAction = { kind: a.kind! }
  if (a.kind === 'assign_asset') {
    if (a.assetCategory && !ASSET_CATEGORIES.includes(a.assetCategory as AssetCategory)) bad('Pick an asset category.', 'action')
    out.assetCategory = (a.assetCategory as AssetCategory) || null
  }
  if (a.kind === 'upload_document') {
    if (!DOCUMENT_TYPES.includes(a.documentType as DocumentType)) bad('Pick the document type to upload.', 'action')
    out.documentType = a.documentType as DocumentType
  }
  if (a.kind === 'enrol_course') {
    if (a.courseId && !hrCourses.some((c) => c.companyId === co && c.id === a.courseId)) bad('Pick a course.', 'action')
    out.courseId = a.courseId || null
  }
  if (a.kind === 'probation_review' && kind !== 'onboarding') bad('A probation review belongs to an onboarding.', 'action')
  return out
}

function cleanOwner(co: string, role: unknown, ownerUserId: unknown): { ownerRole: OwnerRole; ownerUserId: string | null } {
  if (!OWNER_ROLES.includes(role as OwnerRole)) bad('Pick who owns the item.', 'ownerRole')
  const r = role as OwnerRole
  if (r === 'employee' || r === 'manager') return { ownerRole: r, ownerUserId: null }
  if (ownerUserId === null || ownerUserId === undefined || ownerUserId === '') {
    if (r === 'user') bad('Pick the person who does it.', 'ownerUserId')
    return { ownerRole: r, ownerUserId: null }
  }
  if (!activeUserOf(co, String(ownerUserId))) bad('Pick an active user of the company.', 'ownerUserId')
  return { ownerRole: r, ownerUserId: String(ownerUserId) }
}

function cleanTemplateItem(co: string, kind: JourneyKind, raw: Partial<TemplateItemInput>, keepId?: string): TemplateItem {
  const title = str(raw.title, 160)
  if (title.length < 2) bad('Every item needs a title.', 'items')
  const offset = Number(raw.dueOffsetDays ?? 0)
  if (!Number.isInteger(offset) || offset < -365 || offset > 365) bad('The due offset is a whole number of days between −365 and 365.', 'items')
  const anchor = (raw.dueAnchor ?? 'start') as DueAnchor
  if (!DUE_ANCHORS.includes(anchor)) bad('Pick what the due date counts from.', 'items')
  if (anchor === 'probation_end' && kind !== 'onboarding') bad('Only onboarding items can count from the probation end.', 'items')
  return {
    id: keepId ?? nextTemplateItemId(),
    title,
    description: str(raw.description, 1000),
    ...cleanOwner(co, raw.ownerRole, raw.ownerUserId),
    dueOffsetDays: offset,
    dueAnchor: anchor,
    required: raw.required !== false,
    action: cleanAction(co, raw.action, kind),
  }
}

function cleanTemplate(co: string, raw: Partial<TemplateInput>, base: Tenant<JourneyTemplate> | null): Partial<JourneyTemplate> {
  const out: Partial<JourneyTemplate> = {}
  const kind = (raw.kind ?? base?.kind) as JourneyKind
  if (!base) {
    if (!JOURNEY_KINDS.includes(kind)) bad('Pick onboarding or offboarding.', 'kind')
    out.kind = kind
  } else if (raw.kind !== undefined && raw.kind !== base.kind) bad('The kind of a template can’t change.', 'kind')
  if (raw.name !== undefined || !base) {
    const name = str(raw.name, 120)
    if (name.length < 2) bad('Name the template.', 'name')
    if (hrJourneyTemplates.some((t) => t.companyId === co && t.id !== base?.id && t.name.toLowerCase() === name.toLowerCase())) bad(`A template called “${name}” already exists.`, 'name')
    out.name = name
  }
  if (raw.description !== undefined) out.description = str(raw.description, 500)
  if (raw.departmentId !== undefined) {
    if (raw.departmentId && !departments.some((d) => d.companyId === co && d.id === raw.departmentId)) bad('Pick a department.', 'departmentId')
    out.departmentId = raw.departmentId || null
  }
  if (raw.employmentType !== undefined) {
    if (raw.employmentType && !EMPLOYMENT_TYPES.includes(raw.employmentType)) bad('Pick an employment type.', 'employmentType')
    out.employmentType = raw.employmentType || null
  }
  if (raw.active !== undefined) out.active = raw.active !== false
  if (raw.items !== undefined || !base) {
    if (!Array.isArray(raw.items) || raw.items.length === 0) bad('Add at least one item.', 'items')
    if (raw.items!.length > 60) bad('A template holds up to 60 items.', 'items')
    const known = new Set(base?.items.map((i) => i.id) ?? [])
    out.items = raw.items!.map((i) => {
      const id = (i as { id?: unknown }).id
      return cleanTemplateItem(co, kind, i ?? {}, typeof id === 'string' && known.has(id) ? id : undefined)
    })
  }
  return out
}

export async function listTemplates(user: User): Promise<TemplateView[]> {
  assertHrFull(user)
  return delay(templatesOf(tenantOf(user)).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).map(templateView))
}

export async function getTemplate(user: User, id: string): Promise<TemplateView> {
  assertHrFull(user)
  return delay(templateView(templateOr404(user, id)))
}

export async function createTemplate(user: User, raw: Partial<TemplateInput> | null): Promise<TemplateView> {
  assertHrFull(user)
  const co = tenantOf(user)
  const v = cleanTemplate(co, raw ?? {}, null)
  const at = nowIso()
  const t: Tenant<JourneyTemplate> = { companyId: co, id: nextTemplateId(), kind: v.kind!, name: v.name!, description: v.description ?? '', departmentId: v.departmentId ?? null, employmentType: v.employmentType ?? null, active: v.active ?? true, items: v.items!, createdAt: at, updatedAt: at }
  hrJourneyTemplates.push(t)
  return delay(templateView(t))
}

export async function updateTemplate(user: User, id: string, raw: Partial<TemplateInput> | null): Promise<TemplateView> {
  const t = templateOr404(user, id)
  assertHrFull(user)
  Object.assign(t, cleanTemplate(t.companyId, raw ?? {}, t), { updatedAt: nowIso() })
  return delay(templateView(t))
}

/** Running journeys keep their copied items (and the template's name). */
export async function deleteTemplate(user: User, id: string): Promise<{ id: string }> {
  const t = templateOr404(user, id)
  assertHrFull(user)
  hrJourneyTemplates.splice(hrJourneyTemplates.indexOf(t), 1)
  return delay({ id: t.id })
}

export async function journeyOptions(user: User): Promise<JourneyOptions> {
  assertHrFull(user)
  const co = tenantOf(user)
  return delay({
    templates: templatesOf(co).filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    assignees: users.filter((u) => u.companyId === co && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)),
    departments: departments.filter((d) => d.companyId === co && d.active).map((d) => ({ id: d.id, name: d.name })),
    courses: hrCourses.filter((c) => c.companyId === co && c.active).map((c) => ({ id: c.id, title: c.title })),
  })
}

/* ======================= journeys ======================= */

export interface JourneyQuery {
  kind?: string | null
  status?: string | null
  employeeId?: string | null
}

export async function listJourneys(user: User, q: JourneyQuery = {}): Promise<JourneyRow[]> {
  hrAccessOf(user)
  const co = tenantOf(user)
  syncCompany(co)
  runJourneyAlerts(co)
  const ids = visibleEmployeeIds(user)
  const today = companyDayOf(co).today
  const rows = hrJourneys
    .filter((j) => j.companyId === co && ids.has(j.employeeId))
    .filter((j) => !q.kind || j.kind === q.kind)
    .filter((j) => !q.status || j.status === q.status)
    .filter((j) => !q.employeeId || j.employeeId === q.employeeId)
    .map((j) => rowOf(j, employeeOf(co, j.employeeId)!, today))
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.startedAt.localeCompare(a.startedAt))
  return delay(rows)
}

export async function getJourney(user: User, id: string): Promise<JourneyDetail> {
  const { j, access } = visibleJourney(user, id)
  syncJourney(j)
  return delay(detailOf(user, access, j))
}

/** POST /hr/journeys — HR starts one by hand (an onboarding at any time; an offboarding for a leaving employee). */
export async function startJourneyFor(user: User, raw: Partial<StartJourneyInput> | null): Promise<JourneyDetail> {
  assertHrFull(user)
  const co = tenantOf(user)
  const i = raw ?? {}
  if (!JOURNEY_KINDS.includes(i.kind as JourneyKind)) bad('Pick onboarding or offboarding.', 'kind')
  const e = typeof i.employeeId === 'string' ? employeeOf(co, i.employeeId) : undefined
  if (!e) notFound()
  const kind = i.kind as JourneyKind
  if (e!.status === 'terminated' && kind === 'onboarding') bad(`${e!.fullName} has left.`, 'employeeId')
  if (kind === 'offboarding' && !LEAVING.includes(e!.status)) bad('Set the status to Notice period or Left (with the exit date): that starts the offboarding.', 'kind')
  if (runningOf(co, e!.id, kind)) throw new CodedApiError(`${e!.fullName} already has a ${kind} in progress.`, 409, 'journey_exists')
  let template: Tenant<JourneyTemplate> | null
  if (i.templateId) {
    template = hrJourneyTemplates.find((t) => t.companyId === co && t.id === i.templateId) ?? null
    if (!template) notFound()
    if (template!.kind !== kind) bad(`“${template!.name}” is an ${template!.kind} template.`, 'templateId')
  } else template = matchTemplate(templatesOf(co), kind, e!)
  const j = startJourney(co, e!, kind, template, user, false)
  return delay(detailOf(user, 'full', j))
}

function itemOr404(j: JourneyRecord, itemId: string): JourneyItemRecord {
  const item = j.items.find((x) => x.id === itemId)
  if (!item) notFound()
  return item!
}

function assertRunning(j: JourneyRecord): void {
  if (j.status !== 'active') throw new CodedApiError(`This ${j.kind} is ${j.status}.`, 409, 'journey_closed')
}

function cleanAssignee(co: string, v: unknown): string | null {
  if (v === null || v === '') return null
  if (typeof v !== 'string' || !activeUserOf(co, v)) bad('Pick an active user of the company.', 'assigneeUserId')
  return v as string
}

export async function addItem(user: User, journeyId: string, raw: Partial<JourneyItemInput> | null): Promise<JourneyDetail> {
  const { j } = visibleJourney(user, journeyId)
  assertHrFull(user)
  assertRunning(j)
  const e = employeeOf(j.companyId, j.employeeId)!
  const i = raw ?? {}
  const title = str(i.title, 160)
  if (title.length < 2) bad('Give the item a title.', 'title')
  if (!OWNER_ROLES.includes(i.ownerRole as OwnerRole)) bad('Pick who owns the item.', 'ownerRole')
  const role = i.ownerRole as OwnerRole
  let assignee = i.assigneeUserId !== undefined ? cleanAssignee(j.companyId, i.assigneeUserId) : null
  if (i.assigneeUserId === undefined && (role === 'employee' || role === 'manager')) assignee = itemFromTemplate(j.companyId, j.kind, e, { id: '', title, description: '', ownerRole: role, ownerUserId: null, dueOffsetDays: 0, dueAnchor: 'start', required: true, action: null }).assigneeUserId
  if (role === 'user' && !assignee) bad('Pick the person who does it.', 'assigneeUserId')
  if (i.dueDate !== undefined && !isIsoDate(i.dueDate)) bad('Pick a due date.', 'dueDate')
  const offset = Number(i.dueOffsetDays ?? 0)
  if (!Number.isInteger(offset) || Math.abs(offset) > 365) bad('The due offset is a whole number of days between −365 and 365.', 'dueOffsetDays')
  const item: JourneyItemRecord = {
    id: nextJourneyItemId(),
    title,
    description: str(i.description, 1000),
    ownerRole: role,
    assigneeUserId: assignee,
    dueAnchor: 'start',
    dueOffsetDays: offset,
    dueDate: i.dueDate ?? dueDateFor('start', offset, dueCtx(j.companyId, j.kind, e)),
    dueOverridden: i.dueDate !== undefined,
    required: i.required !== false,
    blocking: false,
    action: cleanAction(j.companyId, i.action, j.kind),
    system: null,
    status: 'open',
    doneAt: null,
    doneBy: null,
    doneByName: null,
    detail: null,
    note: '',
    alertMarks: [],
    externalRef: null,
  }
  j.items.push(item)
  syncJourney(j)
  announceAssigned(j, [item], user)
  return delay(detailOf(user, 'full', j))
}

/** PATCH an item — HR full: title, description, owner role, assignee (reassign), due date, required. */
export async function updateItem(user: User, journeyId: string, itemId: string, raw: Partial<JourneyItemInput> | null): Promise<JourneyDetail> {
  const { j } = visibleJourney(user, journeyId)
  const item = itemOr404(j, itemId)
  assertHrFull(user)
  assertRunning(j)
  const i = raw ?? {}
  if (item.system && (i.title !== undefined || i.ownerRole !== undefined || i.required !== undefined || i.action !== undefined)) bad('A system item only takes a due date and an assignee.', 'system')
  if (i.title !== undefined) {
    const title = str(i.title, 160)
    if (title.length < 2) bad('Give the item a title.', 'title')
    item.title = title
  }
  if (i.description !== undefined) item.description = str(i.description, 1000)
  if (i.ownerRole !== undefined) {
    if (!OWNER_ROLES.includes(i.ownerRole)) bad('Pick who owns the item.', 'ownerRole')
    item.ownerRole = i.ownerRole
  }
  if (i.assigneeUserId !== undefined) {
    const next = cleanAssignee(j.companyId, i.assigneeUserId)
    if (next !== item.assigneeUserId) {
      item.assigneeUserId = next
      item.alertMarks = item.alertMarks.filter((m) => !m.startsWith('assigned:'))
    }
  }
  if (item.ownerRole === 'user' && !item.assigneeUserId) bad('Pick the person who does it.', 'assigneeUserId')
  if (i.dueDate !== undefined) {
    if (i.dueDate === null || (i.dueDate as unknown) === '') item.dueOverridden = false
    else {
      if (!isIsoDate(i.dueDate)) bad('Pick a due date.', 'dueDate')
      item.dueDate = i.dueDate
      item.dueOverridden = true
    }
  }
  if (i.required !== undefined) item.required = i.required !== false
  if (i.action !== undefined) item.action = cleanAction(j.companyId, i.action, j.kind)
  syncJourney(j)
  announceAssigned(j, [item], user)
  return delay(detailOf(user, 'full', j))
}

export async function deleteItem(user: User, journeyId: string, itemId: string): Promise<JourneyDetail> {
  const { j } = visibleJourney(user, journeyId)
  const item = itemOr404(j, itemId)
  assertHrFull(user)
  assertRunning(j)
  if (item.system) bad('System items can’t be removed: they follow the assets, the login and the final settlement.', 'system')
  j.items.splice(j.items.indexOf(item), 1)
  return delay(detailOf(user, 'full', j))
}

/**
 * The journey + item the caller may act on: in their HR scope, or (any role) an item assigned to them.
 * Everything else answers 404 like a missing id.
 */
function actionable(user: User, journeyId: string, itemId: string) {
  const co = tenantOf(user)
  const access = accessOrNull(user)
  const visibleIds = access ? visibleEmployeeIds(user) : new Set<string>()
  const j = hrJourneys.find((x) => x.companyId === co && x.id === journeyId)
  const item = j?.items.find((x) => x.id === itemId)
  if (!j || !item) notFound()
  const visible = visibleIds.has(j!.employeeId)
  if (!visible && item!.assigneeUserId !== user.id) notFound()
  const e = employeeOf(co, j!.employeeId)
  if (!e) notFound()
  return { j: j!, item: item!, e: e!, access, visible }
}

function resultFor(user: User, access: HrAccess | null, visible: boolean, j: Tenant<JourneyRecord>, e: Tenant<Employee>, item: JourneyItemRecord): JourneyDetail | MyJourneyTask {
  if (visible && access) return detailOf(user, access, j)
  return { journeyId: j.id, journeyKind: j.kind, employeeId: e.id, employeeName: e.fullName, self: e.userId === user.id, item: itemView(user, access, visible, j, e, item, companyDayOf(j.companyId).today) }
}

/** POST …/complete { note } — answers the journey detail (or, for an assignee outside the scope, their task). */
export async function completeItem(user: User, journeyId: string, itemId: string, raw: { note?: unknown } | null): Promise<JourneyDetail | MyJourneyTask> {
  const { j, item, e, access, visible } = actionable(user, journeyId, itemId)
  syncJourney(j)
  if (item.system) bad('This item completes by itself from its source (assets, login, final settlement).', 'system')
  assertRunning(j)
  if (!canTick(user, access, visible, j, e, item)) throw new ApiError('You can only complete the items that are yours.', 403)
  if (item.status !== 'done') Object.assign(item, { status: 'done', doneAt: nowIso(), doneBy: user.id, doneByName: user.name, detail: item.detail })
  if (raw?.note !== undefined) item.note = str(raw.note, 1000)
  return delay(resultFor(user, access, visible, j, e, item))
}

export async function reopenItem(user: User, journeyId: string, itemId: string): Promise<JourneyDetail | MyJourneyTask> {
  const { j, item, e, access, visible } = actionable(user, journeyId, itemId)
  if (item.system) bad('This item follows its source (assets, login, final settlement).', 'system')
  assertRunning(j)
  if (!canTick(user, access, visible, j, e, item)) throw new ApiError('You can only reopen the items that are yours.', 403)
  Object.assign(item, { status: 'open', doneAt: null, doneBy: null, doneByName: null, detail: null })
  return delay(resultFor(user, access, visible, j, e, item))
}

/** POST /hr/journeys/:id/activate — HR: every required onboarding item done → the employee becomes active. */
export async function activateFromJourney(user: User, journeyId: string): Promise<JourneyDetail> {
  const { j } = visibleJourney(user, journeyId)
  assertHrFull(user)
  if (j.kind !== 'onboarding') bad('Finish an offboarding with “Complete offboarding” (POST /hr/employees/:id/offboarding/complete).', 'kind')
  assertRunning(j)
  syncJourney(j)
  const blockers = blockersOf(j)
  if (blockers.length) throw new CodedApiError(`Finish the required items first: ${blockers.join(', ')}.`, 422, 'items_open', { items: blockers })
  const e = employeeOf(j.companyId, j.employeeId)!
  const at = nowIso()
  if (e.status === 'onboarding') {
    e.status = 'active'
    e.updatedAt = at
    logHr(e.companyId, e.id, user, 'status', `Status changed: ${EMPLOYMENT_STATUS_LABEL.onboarding} → ${EMPLOYMENT_STATUS_LABEL.active} (onboarding completed)`, at)
  } else logHr(e.companyId, e.id, user, 'journey', 'Onboarding checklist completed', at)
  j.status = 'completed'
  j.completedAt = at
  j.completedBy = user.id
  announceCompleted(j, e, at)
  return delay(detailOf(user, 'full', j))
}

export async function cancelJourney(user: User, journeyId: string): Promise<JourneyDetail> {
  const { j } = visibleJourney(user, journeyId)
  assertHrFull(user)
  assertRunning(j)
  const e = employeeOf(j.companyId, j.employeeId)!
  if (j.kind === 'offboarding' && LEAVING.includes(e.status)) bad('The employee is still leaving: set the status back to Active to cancel the offboarding.', 'status')
  j.status = 'cancelled'
  j.cancelledAt = nowIso()
  logHr(e.companyId, e.id, user, 'journey', `${JOURNEY_KIND_LABEL[j.kind]} checklist cancelled`)
  return delay(detailOf(user, 'full', j))
}

/** GET /hr/journeys/my-tasks — any role: items assigned to the caller in running journeys (open first). */
export async function myTasks(user: User): Promise<MyJourneyTask[]> {
  const co = tenantOf(user)
  syncCompany(co)
  runJourneyAlerts(co)
  const access = accessOrNull(user)
  const visibleIds = access ? visibleEmployeeIds(user) : new Set<string>()
  const today = companyDayOf(co).today
  const out: MyJourneyTask[] = []
  for (const j of hrJourneys) {
    if (j.companyId !== co || j.status !== 'active') continue
    const e = employeeOf(co, j.employeeId)
    if (!e) continue
    for (const item of j.items) {
      if (item.assigneeUserId !== user.id || item.status === 'skipped' || item.system) continue
      out.push({ journeyId: j.id, journeyKind: j.kind, employeeId: e.id, employeeName: e.fullName, self: e.userId === user.id, item: itemView(user, access, visibleIds.has(e.id), j, e, item, today) })
    }
  }
  return delay(out.sort((a, b) => Number(a.item.status === 'done') - Number(b.item.status === 'done') || a.item.dueDate.localeCompare(b.item.dueDate)))
}

