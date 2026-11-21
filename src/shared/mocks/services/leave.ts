import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type {
  BalanceRow,
  CalendarConflict,
  CalendarEntry,
  DecisionInput,
  HolidayInput,
  LeaveApproval,
  LeaveBalance,
  LeaveCalendar,
  LeavePreview,
  LeaveRequest,
  LeaveRequestInput,
  LeaveSettings,
  LeaveType,
  LeaveTypeInput,
  LeaveTypesView,
  MyLeave,
  PublicHoliday,
} from '@/modules/hr/time/types'
import { LEAVE_CODES, LEAVE_STATUSES } from '@/modules/hr/time/types'
import { accruedDays, carriedDays, entitledDays, leaveDayCount, MONTH_RE, monthDates, r2, rangesOverlap, workingDates } from '@/modules/hr/time/calc'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { employeeById, employeesOf } from '@/shared/mocks/data/hrEmployees'
import {
  DEFAULT_CONFLICT_PCT,
  headApproverIds,
  hrApproverIds,
  hrHolidays,
  hrLeaveRequests,
  hrLeaveSettings,
  hrLeaveTypes,
  nextId,
  type ApprovalRecord,
  type LeaveRequestRecord,
} from '@/shared/mocks/data/hrTime'
import type { Tenant } from '@/shared/mocks/tenant'
import {
  conflict,
  departmentName,
  employeeRef,
  forbidden,
  hrCtx,
  invalid,
  isFull,
  notFound,
  requireFull,
  requireManage,
  requireSelf,
  str,
  teamEmployeeIds,
  visibleEmployee,
  visibleEmployees,
  type HrCtx,
} from './hrTimeAccess'
import { holidayMap } from './attendance'

/**
 * HR › Leave (docs/API.md › HR › Leave, Public holidays). Two-step approval from the spec: the
 * employee's manager / department head first, then HR (full scope). Balances are computed (accrual
 * from the hire date in company-local dates, carry-over, used = approved, pending = in approval).
 * Approved leave marks the attendance days as on_leave (services/attendance.ts reads the requests).
 */

export const LEAVE_LINK = '/hr/leave'
const ACTIVE: LeaveRequestRecord['status'][] = ['pending_head', 'pending_hr', 'approved']

const typesOf = (co: string) => hrLeaveTypes.filter((t) => t.companyId === co)
const plainType = (t: Tenant<LeaveType>): LeaveType => {
  const { companyId: _c, ...rest } = t // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}
const nameOf = (co: string, userId: string | null) => (userId ? (users.find((u) => u.id === userId && u.companyId === co)?.name ?? '') : '')

export function settingsOf(co: string): Tenant<LeaveSettings> {
  let s = hrLeaveSettings.find((x) => x.companyId === co)
  if (!s) {
    s = { companyId: co, conflictThresholdPct: DEFAULT_CONFLICT_PCT }
    hrLeaveSettings.push(s)
  }
  return s
}

/* ---------------- Balances ---------------- */

const yearOf = (iso: string) => Number(iso.slice(0, 4))

export function balanceOf(ctx: HrCtx, emp: Pick<Employee, 'id' | 'hireDate'>, type: Tenant<LeaveType>, year: number, exceptRequestId?: string): LeaveBalance {
  const reqs = hrLeaveRequests.filter((r) => r.companyId === ctx.co && r.employeeId === emp.id && r.leaveTypeId === type.id && r.id !== exceptRequestId)
  const sum = (y: number, statuses: LeaveRequestRecord['status'][]) => r2(reqs.filter((r) => yearOf(r.startDate) === y && statuses.includes(r.status)).reduce((s, r) => s + r.days, 0))
  const asOf = ctx.today
  const accrued = yearOf(asOf) > year ? accruedDays(type, emp.hireDate, year, `${year}-12-31`) : accruedDays(type, emp.hireDate, year, asOf)
  const carried = carriedDays(type, emp.hireDate, year, sum(year - 1, ['approved']))
  const used = sum(year, ['approved'])
  const pending = sum(year, ['pending_head', 'pending_hr'])
  return {
    employeeId: emp.id,
    leaveTypeId: type.id,
    leaveTypeName: type.name,
    code: type.code,
    year,
    entitledDays: entitledDays(type.daysPerYear, emp.hireDate, year),
    accruedDays: accrued,
    carriedDays: carried,
    usedDays: used,
    pendingDays: pending,
    remainingDays: r2(accrued + carried - used - pending),
    allowNegative: type.allowNegative || !type.isPaid,
  }
}

function balancesOf(ctx: HrCtx, emp: Tenant<Employee>, year: number): LeaveBalance[] {
  return typesOf(ctx.co)
    .filter((t) => t.isActive && (!t.gender || !emp.gender || t.gender === emp.gender))
    .map((t) => balanceOf(ctx, emp, t, year))
}

function yearParam(ctx: HrCtx, year: unknown): number {
  const n = Number(year)
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : yearOf(ctx.today)
}

/** GET /hr/leave/balances?year=&employee_id= (full / team). */
export async function listBalances(user: User, q: { year?: unknown; employeeId?: unknown }): Promise<BalanceRow[]> {
  const ctx = hrCtx(user)
  requireManage(ctx)
  const year = yearParam(ctx, q.year)
  return delay(
    visibleEmployees(ctx)
      .filter((e) => e.status !== 'terminated' && (!q.employeeId || e.id === q.employeeId))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((e) => ({ employee: employeeRef(e), balances: balancesOf(ctx, e, year) })),
  )
}

/* ---------------- Requests: view ---------------- */

const hrStepApprovers = (ctx: HrCtx, r: LeaveRequestRecord) => {
  const emp = employeeById(ctx.co, r.employeeId)
  return hrApproverIds(ctx.co).filter((id) => id !== emp?.userId)
}
const approversOf = (ctx: HrCtx, r: LeaveRequestRecord, a: ApprovalRecord) => (a.step === 'hr' ? hrStepApprovers(ctx, r) : a.approverIds)

function currentStep(r: LeaveRequestRecord): ApprovalRecord | undefined {
  if (r.status === 'pending_head') return r.approvals.find((a) => a.step === 'department_head' && a.decision === 'pending')
  if (r.status === 'pending_hr') return r.approvals.find((a) => a.step === 'hr' && a.decision === 'pending')
  return undefined
}

function canDecide(ctx: HrCtx, r: LeaveRequestRecord): boolean {
  const step = currentStep(r)
  return !!step && approversOf(ctx, r, step).includes(ctx.user.id)
}

function canCancel(ctx: HrCtx, r: LeaveRequestRecord): boolean {
  if (!ACTIVE.includes(r.status)) return false
  if (isFull(ctx)) return true
  return !!ctx.self && r.employeeId === ctx.self.id && ctx.today < r.startDate
}

function canSee(ctx: HrCtx, r: Tenant<LeaveRequestRecord>): boolean {
  if (r.companyId !== ctx.co) return false
  if (ctx.self && r.employeeId === ctx.self.id) return true
  if (isFull(ctx)) return true
  if (ctx.scope === 'team' && teamEmployeeIds(ctx).has(r.employeeId)) return true
  // Approver inbox: the step-1 approvers named on the request.
  return r.approvals.some((a) => a.step === 'department_head' && a.approverIds.includes(ctx.user.id))
}

function toRequest(ctx: HrCtx, r: Tenant<LeaveRequestRecord>): LeaveRequest {
  const emp = employeeById(ctx.co, r.employeeId)
  const type = typesOf(ctx.co).find((t) => t.id === r.leaveTypeId)
  const { companyId: _c, approvals, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...rest,
    employeeName: emp?.fullName ?? '',
    departmentId: emp?.departmentId ?? null,
    leaveTypeName: type?.name ?? 'Leave',
    color: type?.color ?? '#71717a',
    approvals: approvals.map((a): LeaveApproval => {
      const ids = a.decision === 'pending' ? approversOf(ctx, r, a) : a.approverIds
      return { ...a, approverIds: ids, approverNames: ids.map((id) => nameOf(ctx.co, id)), decidedByName: a.decidedBy ? nameOf(ctx.co, a.decidedBy) : null }
    }),
    canDecide: canDecide(ctx, r),
    canCancel: canCancel(ctx, r),
  }
}

/** GET /hr/leave/requests?status=&employee_id=&view=mine|approvals|all */
export async function listLeaveRequests(user: User, q: { status?: unknown; employeeId?: unknown; view?: unknown }): Promise<LeaveRequest[]> {
  const ctx = hrCtx(user)
  const status = typeof q.status === 'string' && (LEAVE_STATUSES as string[]).includes(q.status) ? q.status : null
  return delay(
    hrLeaveRequests
      .filter((r) => canSee(ctx, r))
      .filter((r) => !status || r.status === status)
      .filter((r) => !q.employeeId || r.employeeId === q.employeeId)
      .filter((r) => (q.view === 'mine' ? !!ctx.self && r.employeeId === ctx.self.id : q.view === 'approvals' ? canDecide(ctx, r) : true))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map((r) => toRequest(ctx, r)),
  )
}

function visibleRequest(ctx: HrCtx, id: string): Tenant<LeaveRequestRecord> {
  const r = hrLeaveRequests.find((x) => x.id === id && canSee(ctx, x))
  if (!r) throw notFound()
  return r
}

/** GET /hr/leave/requests/:id */
export async function getLeaveRequest(user: User, id: string): Promise<LeaveRequest> {
  const ctx = hrCtx(user)
  return delay(toRequest(ctx, visibleRequest(ctx, id)))
}

/** GET /hr/leave/me?year= — my balances, requests and the request form's types (self-service). */
export async function getMyLeave(user: User, year?: unknown): Promise<MyLeave> {
  const ctx = hrCtx(user)
  const emp = requireSelf(ctx)
  const y = yearParam(ctx, year)
  return delay({
    employee: employeeRef(emp),
    year: y,
    timezone: ctx.timezone,
    today: ctx.today,
    balances: balancesOf(ctx, emp, y),
    requests: hrLeaveRequests
      .filter((r) => r.companyId === ctx.co && r.employeeId === emp.id)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((r) => toRequest(ctx, r)),
    types: typesOf(ctx.co)
      .filter((t) => t.isActive && (!t.gender || !emp.gender || t.gender === emp.gender))
      .map(plainType),
  })
}

/* ---------------- Requests: validation (preview = create without writing) ---------------- */

interface Checked {
  emp: Tenant<Employee>
  type: Tenant<LeaveType>
  startDate: string
  endDate: string
  halfDay: 'am' | 'pm' | null
  preview: LeavePreview
}

function check(ctx: HrCtx, input: LeaveRequestInput | null): Checked {
  const own = !input?.employeeId || (ctx.self && input.employeeId === ctx.self.id)
  let emp: Tenant<Employee>
  if (own) emp = requireSelf(ctx)
  else {
    requireFull(ctx)
    emp = visibleEmployee(ctx, String(input!.employeeId))
    if (emp.status === 'terminated') throw invalid('The employee has left.', 'employee_inactive')
  }
  const type = typesOf(ctx.co).find((t) => t.id === input?.leaveTypeId)
  if (!type) throw notFound()
  if (!type.isActive) throw invalid('This leave type is turned off.', 'type_inactive')
  const startDate = input?.startDate
  const endDate = input?.endDate || startDate
  if (!isRealIsoDate(startDate) || !isRealIsoDate(endDate)) throw invalid('Pick valid dates.', 'invalid_date')
  if (endDate < startDate) throw invalid('The end date is before the start date.', 'invalid_range')
  if (daysBetweenIso(startDate, endDate) > 366) throw invalid('A request covers one year at most.', 'invalid_range')
  const halfDay = input?.halfDay === 'am' || input?.halfDay === 'pm' ? input.halfDay : null
  if (halfDay && startDate !== endDate) throw invalid('A half day starts and ends on the same date.', 'invalid_half_day')
  const holidays = holidayMap(ctx.co)
  const { days, dates } = leaveDayCount(startDate, endDate, halfDay, ctx.weekend, holidays)
  const excludedHolidays = [...holidays.entries()].filter(([d]) => d >= startDate && d <= endDate).map(([date, name]) => ({ date, name }))
  const balance = balanceOf(ctx, emp, type, yearOf(startDate))
  const documentRequired = type.documentAfterDays !== null && days > type.documentAfterDays
  const preview: LeavePreview = { days, dates, excludedHolidays, balance, problem: null, documentRequired }
  const problems: [boolean, string, string][] = [
    [days === 0, 'no_working_days', 'There are no working days in this range (weekend and public holidays don’t count).'],
    [!!type.gender && emp.gender !== type.gender, 'gender_restricted', `${type.name} is for ${type.gender} employees only.`],
    [!!own && type.minNoticeDays > 0 && daysBetweenIso(ctx.today, startDate) < type.minNoticeDays, 'notice_too_short', `${type.name} needs ${type.minNoticeDays} days’ notice.`],
    [daysBetweenIso(startDate, ctx.today) > 30, 'past_date', 'Leave can be recorded up to 30 days back.'],
    [
      hrLeaveRequests.some((r) => r.companyId === ctx.co && r.employeeId === emp.id && ACTIVE.includes(r.status) && rangesOverlap(r, { startDate, endDate, halfDay })),
      'overlap',
      'You already have leave requested or approved on these dates.',
    ],
    [type.isPaid && !type.allowNegative && days > balance.remainingDays, 'insufficient_balance', `Not enough ${type.name.toLowerCase()} left: ${balance.remainingDays} days, ${days} asked.`],
    [documentRequired && !str(input?.documentName, 200), 'document_required', `Attach a supporting document for ${type.name.toLowerCase()} longer than ${type.documentAfterDays} days.`],
  ]
  const hit = problems.find(([bad]) => bad)
  if (hit) preview.problem = { code: hit[1], message: hit[2] }
  return { emp, type, startDate, endDate, halfDay, preview }
}

/** POST /hr/leave/requests/preview — working days, balance and the first problem, nothing stored. */
export async function previewLeave(user: User, input: LeaveRequestInput | null): Promise<LeavePreview> {
  const ctx = hrCtx(user)
  return delay(check(ctx, input).preview)
}

const STATUS_FOR: Record<string, number> = { overlap: 409 }

function notify(co: string, ids: string[], title: string, body: string, requestId: string) {
  for (const userId of new Set(ids)) pushNotification({ userId, companyId: co, type: 'hr', title, body, link: `${LEAVE_LINK}?request=${encodeURIComponent(requestId)}` })
}

/** POST /hr/leave/requests — validated like the preview; first step: the manager / head (or HR when there is none). */
export async function createLeaveRequest(user: User, input: LeaveRequestInput | null): Promise<LeaveRequest> {
  const ctx = hrCtx(user)
  const c = check(ctx, input)
  if (c.preview.problem) {
    const { code, message } = c.preview.problem
    if (STATUS_FOR[code] === 409) throw conflict(message, code)
    throw invalid(message, code)
  }
  const heads = headApproverIds(ctx.co, c.emp)
  const approvals: ApprovalRecord[] = []
  if (heads.length) approvals.push({ step: 'department_head', approverIds: heads, decision: 'pending', decidedBy: null, comment: '', decidedAt: null })
  approvals.push({ step: 'hr', approverIds: [], decision: 'pending', decidedBy: null, comment: '', decidedAt: null })
  const row: Tenant<LeaveRequestRecord> = {
    companyId: ctx.co,
    id: nextId('LVR-', hrLeaveRequests),
    employeeId: c.emp.id,
    leaveTypeId: c.type.id,
    startDate: c.startDate,
    endDate: c.endDate,
    halfDay: c.halfDay,
    days: c.preview.days,
    reason: str(input?.reason, 500),
    documentName: str(input?.documentName, 200) || null,
    status: heads.length ? 'pending_head' : 'pending_hr',
    approvals,
    submittedAt: nowIso(),
    submittedBy: user.id,
    cancelledAt: null,
    cancelledBy: null,
  }
  hrLeaveRequests.push(row)
  const range = c.startDate === c.endDate ? c.startDate : `${c.startDate} – ${c.endDate}`
  notify(ctx.co, heads.length ? heads : hrStepApprovers(ctx, row), 'Leave request to approve', `${c.emp.fullName}: ${c.type.name}, ${range} (${row.days} days)`, row.id)
  return delay(toRequest(ctx, row))
}

/* ---------------- Requests: decisions ---------------- */

/** POST /hr/leave/requests/:id/decide { decision, comment } — step 1 manager / head, step 2 HR full. */
export async function decideLeaveRequest(user: User, id: string, input: DecisionInput | null): Promise<LeaveRequest> {
  const ctx = hrCtx(user)
  const r = visibleRequest(ctx, id)
  const step = currentStep(r)
  if (!step) throw conflict('This request isn’t waiting for a decision.', 'not_pending')
  if (!approversOf(ctx, r, step).includes(user.id)) {
    throw forbidden(step.step === 'hr' ? 'This step is for HR.' : 'This step is for the employee’s manager or department head.')
  }
  const decision = input?.decision
  if (decision !== 'approve' && decision !== 'reject') throw invalid('Choose approve or reject.', 'invalid_decision')
  const comment = str(input?.comment, 500)
  if (decision === 'reject' && !comment) throw invalid('Say why the request is rejected.', 'comment_required')
  const emp = employeeById(ctx.co, r.employeeId)
  const type = typesOf(ctx.co).find((t) => t.id === r.leaveTypeId)
  // Re-check the balance at the final approval (other requests may have been approved meanwhile).
  if (decision === 'approve' && step.step === 'hr' && emp && type && type.isPaid && !type.allowNegative) {
    const b = balanceOf(ctx, emp, type, yearOf(r.startDate), r.id)
    if (r.days > b.remainingDays) throw invalid(`Not enough ${type.name.toLowerCase()} left: ${b.remainingDays} days.`, 'insufficient_balance')
  }
  const at = nowIso()
  Object.assign(step, { decision: decision === 'approve' ? 'approved' : 'rejected', decidedBy: user.id, comment, decidedAt: at })
  if (step.step === 'hr') step.approverIds = [user.id]
  const what = `${emp?.fullName ?? ''}: ${type?.name ?? 'Leave'}, ${r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`}`
  const employeeUser = emp?.userId ? [emp.userId] : []
  if (decision === 'reject') {
    r.status = 'rejected'
    notify(ctx.co, employeeUser, 'Leave request rejected', `${what}. ${comment}`, r.id)
  } else if (step.step === 'department_head') {
    r.status = 'pending_hr'
    notify(ctx.co, employeeUser, 'Leave approved by your manager', `${what}. Now waiting for HR.`, r.id)
    notify(ctx.co, hrStepApprovers(ctx, r), 'Leave request to approve (HR)', what, r.id)
  } else {
    r.status = 'approved'
    const head = r.approvals.find((a) => a.step === 'department_head')?.decidedBy
    notify(ctx.co, [...employeeUser, ...(head ? [head] : [])], 'Leave approved', what, r.id)
  }
  recordAudit(user, { action: 'update', entity: 'leave_request', entityId: r.id, summary: `${decision === 'approve' ? 'Approved' : 'Rejected'} (${step.step === 'hr' ? 'HR' : 'manager'}) the leave of ${what}` })
  return delay(toRequest(ctx, r))
}

/** POST /hr/leave/requests/:id/cancel — the employee before the start; HR (full) any time. */
export async function cancelLeaveRequest(user: User, id: string, input: { comment?: unknown } | null): Promise<LeaveRequest> {
  const ctx = hrCtx(user)
  const r = visibleRequest(ctx, id)
  if (!ACTIVE.includes(r.status)) throw conflict('This request is already closed.', 'not_cancellable')
  if (!canCancel(ctx, r)) {
    throw forbidden(ctx.self && r.employeeId === ctx.self.id ? 'The leave has started: ask HR to cancel it.' : 'Only the employee or HR can cancel this request.')
  }
  const pendingApprovers = (() => {
    const step = currentStep(r)
    return step ? approversOf(ctx, r, step) : []
  })()
  r.status = 'cancelled'
  r.cancelledAt = nowIso()
  r.cancelledBy = user.id
  for (const a of r.approvals) if (a.decision === 'pending') a.comment = str(input?.comment, 300)
  const emp = employeeById(ctx.co, r.employeeId)
  const others = [...pendingApprovers, ...(emp?.userId && emp.userId !== user.id ? [emp.userId] : [])].filter((x) => x !== user.id)
  notify(ctx.co, others, 'Leave request cancelled', `${emp?.fullName ?? ''}: ${r.startDate} – ${r.endDate}`, r.id)
  recordAudit(user, { action: 'update', entity: 'leave_request', entityId: r.id, summary: `Cancelled the leave of ${emp?.fullName ?? ''} (${r.startDate} – ${r.endDate})` })
  return delay(toRequest(ctx, r))
}

/* ---------------- Calendar ---------------- */

/** GET /hr/leave/calendar?month= — approved + pending leave (full: all; team: team; else own) and department conflicts. */
export async function getLeaveCalendar(user: User, month?: unknown): Promise<LeaveCalendar> {
  const ctx = hrCtx(user)
  const m = typeof month === 'string' && MONTH_RE.test(month) ? month : ctx.today.slice(0, 7)
  const dates = monthDates(m)
  const first = dates[0]
  const last = dates[dates.length - 1]
  const visible = new Set(visibleEmployees(ctx).map((e) => e.id))
  const holidays = holidayMap(ctx.co)
  const threshold = settingsOf(ctx.co).conflictThresholdPct
  const reqs = hrLeaveRequests.filter((r) => r.companyId === ctx.co && visible.has(r.employeeId) && ACTIVE.includes(r.status) && r.startDate <= last && r.endDate >= first)
  const entries: CalendarEntry[] = reqs
    .map((r) => {
      const emp = employeeById(ctx.co, r.employeeId)
      const type = typesOf(ctx.co).find((t) => t.id === r.leaveTypeId)
      return {
        requestId: r.id,
        employeeId: r.employeeId,
        employeeName: emp?.fullName ?? '',
        departmentId: emp?.departmentId ?? null,
        departmentName: departmentName(ctx.co, emp?.departmentId ?? null),
        leaveTypeName: type?.name ?? 'Leave',
        color: type?.color ?? '#71717a',
        startDate: r.startDate,
        endDate: r.endDate,
        halfDay: r.halfDay,
        status: r.status,
      }
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName))
  const conflicts: CalendarConflict[] = []
  if (ctx.scope === 'full' || ctx.scope === 'team') {
    const people = employeesOf(ctx.co).filter((e) => e.status !== 'terminated' && visible.has(e.id))
    const depts = new Map<string, number>()
    for (const e of people) if (e.departmentId) depts.set(e.departmentId, (depts.get(e.departmentId) ?? 0) + 1)
    for (const date of workingDates(first, last, ctx.weekend, holidays)) {
      for (const [deptId, size] of depts) {
        if (size < 2) continue
        const off = new Set(entries.filter((x) => x.departmentId === deptId && x.startDate <= date && x.endDate >= date).map((x) => x.employeeId)).size
        const pct = Math.round((off / size) * 100)
        if (off > 0 && pct > threshold) conflicts.push({ date, departmentId: deptId, departmentName: departmentName(ctx.co, deptId) ?? '', off, size, pct })
      }
    }
  }
  return delay({
    month: m,
    timezone: ctx.timezone,
    today: ctx.today,
    weekend: [...ctx.weekend],
    holidays: hrHolidays.filter((h) => h.companyId === ctx.co && h.date >= first && h.date <= last).map(plainHoliday),
    entries,
    conflicts,
    thresholdPct: threshold,
  })
}

/* ---------------- Leave types and settings ---------------- */

function typesView(ctx: HrCtx): LeaveTypesView {
  return { types: typesOf(ctx.co).map(plainType), settings: { conflictThresholdPct: settingsOf(ctx.co).conflictThresholdPct }, country: ctx.country }
}

/** GET /hr/leave/types — every company user (the request form needs them). */
export async function listLeaveTypes(user: User): Promise<LeaveTypesView> {
  return delay(typesView(hrCtx(user)))
}

const HEX = /^#[0-9a-fA-F]{6}$/

function validType(input: LeaveTypeInput | null, base: LeaveType | null): Omit<LeaveType, 'id' | 'isDefault'> {
  const name = input?.name !== undefined ? str(input.name, 100) : (base?.name ?? '')
  if (!name) throw invalid('Give the leave type a name.', 'name_required')
  const code = input?.code ?? base?.code ?? 'other'
  if (!LEAVE_CODES.includes(code)) throw invalid('Unknown leave category.', 'invalid_code')
  const num = (v: unknown, fallback: number, max: number, what: string, half = false) => {
    const n = v === undefined ? fallback : Number(v)
    if (!Number.isFinite(n) || n < 0 || n > max || (half ? n * 2 : n) % 1 !== 0) throw invalid(`${what} must be between 0 and ${max}.`, 'invalid_number')
    return n
  }
  const docRaw = input?.documentAfterDays !== undefined ? input.documentAfterDays : (base?.documentAfterDays ?? null)
  const gender = input?.gender !== undefined ? input.gender : (base?.gender ?? null)
  if (gender !== null && gender !== 'male' && gender !== 'female') throw invalid('Gender restriction is male, female or none.', 'invalid_gender')
  const accrual = input?.accrual ?? base?.accrual ?? 'yearly'
  if (accrual !== 'monthly' && accrual !== 'yearly') throw invalid('Accrual is monthly or yearly.', 'invalid_accrual')
  const color = input?.color ?? base?.color ?? '#71717a'
  if (!HEX.test(color)) throw invalid('Colour is a #rrggbb value.', 'invalid_color')
  const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : !!v)
  return {
    code,
    name,
    isPaid: bool(input?.isPaid, base?.isPaid ?? true),
    daysPerYear: num(input?.daysPerYear, base?.daysPerYear ?? 0, 365, 'Days per year', true),
    accrual,
    carryOverMax: num(input?.carryOverMax, base?.carryOverMax ?? 0, 365, 'Carry-over', true),
    documentAfterDays: docRaw === null || (docRaw as unknown) === '' ? null : num(docRaw, 0, 365, 'Document after (days)'),
    minNoticeDays: num(input?.minNoticeDays, base?.minNoticeDays ?? 0, 365, 'Minimum notice'),
    gender,
    allowNegative: bool(input?.allowNegative, base?.allowNegative ?? false),
    isActive: bool(input?.isActive, base?.isActive ?? true),
    color,
  }
}

/** POST /hr/leave/types (full). */
export async function createLeaveType(user: User, input: LeaveTypeInput | null): Promise<LeaveTypesView> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const t = validType(input, null)
  if (typesOf(ctx.co).some((x) => x.name.toLowerCase() === t.name.toLowerCase())) throw conflict('A leave type with this name exists.', 'duplicate_name')
  const row = { companyId: ctx.co, id: nextId('LVT-', hrLeaveTypes), ...t, isDefault: false }
  hrLeaveTypes.push(row)
  recordAudit(user, { action: 'create', entity: 'leave_type', entityId: row.id, summary: `Created the leave type ${row.name}` })
  return delay(typesView(ctx))
}

/** PATCH /hr/leave/types/:id (full). Types are deactivated, never deleted (requests keep pointing at them). */
export async function updateLeaveType(user: User, id: string, input: LeaveTypeInput | null): Promise<LeaveTypesView> {
  const ctx = hrCtx(user)
  const t = typesOf(ctx.co).find((x) => x.id === id)
  if (!t) throw notFound()
  requireFull(ctx)
  const next = validType(input, t)
  if (typesOf(ctx.co).some((x) => x.id !== t.id && x.name.toLowerCase() === next.name.toLowerCase())) throw conflict('A leave type with this name exists.', 'duplicate_name')
  Object.assign(t, next)
  recordAudit(user, { action: 'update', entity: 'leave_type', entityId: t.id, summary: `Updated the leave type ${t.name}` })
  return delay(typesView(ctx))
}

/** PUT /hr/leave/settings { conflict_threshold_pct } (full). */
export async function updateLeaveSettings(user: User, input: { conflictThresholdPct?: unknown } | null): Promise<LeaveTypesView> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const pct = Number(input?.conflictThresholdPct)
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw invalid('The threshold is a whole percentage from 1 to 100.', 'invalid_number')
  settingsOf(ctx.co).conflictThresholdPct = pct
  recordAudit(user, { action: 'update', entity: 'leave_settings', entityId: ctx.co, summary: `Set the leave conflict warning to ${pct}% of a department` })
  return delay(typesView(ctx))
}

/* ---------------- Public holidays ---------------- */

function plainHoliday(h: Tenant<{ id: string; date: string; name: string; isDefault: boolean }>): PublicHoliday {
  return { id: h.id, date: h.date, name: h.name, isDefault: h.isDefault }
}

/** GET /hr/holidays?year= — every company user (working-day counts depend on them). */
export async function listHolidays(user: User, year?: unknown): Promise<PublicHoliday[]> {
  const ctx = hrCtx(user)
  const y = year === undefined || year === null || year === '' ? null : yearParam(ctx, year)
  return delay(
    hrHolidays
      .filter((h) => h.companyId === ctx.co && (y === null || yearOf(h.date) === y))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(plainHoliday),
  )
}

function validHoliday(input: HolidayInput | null, base: PublicHoliday | null) {
  const date = input?.date ?? base?.date
  if (!isRealIsoDate(date)) throw invalid('Pick a valid date.', 'invalid_date')
  const name = input?.name !== undefined ? str(input.name, 100) : (base?.name ?? '')
  if (!name) throw invalid('Give the holiday a name.', 'name_required')
  return { date, name }
}

/** POST /hr/holidays (full). One holiday per date. */
export async function createHoliday(user: User, input: HolidayInput | null): Promise<PublicHoliday> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const h = validHoliday(input, null)
  if (hrHolidays.some((x) => x.companyId === ctx.co && x.date === h.date)) throw conflict('There is already a holiday on this date.', 'duplicate_date')
  const row = { companyId: ctx.co, id: nextId('HOL-', hrHolidays), ...h, isDefault: false }
  hrHolidays.push(row)
  recordAudit(user, { action: 'create', entity: 'holiday', entityId: row.id, summary: `Added the public holiday ${row.name} (${row.date})` })
  return delay(plainHoliday(row))
}

const ownHoliday = (ctx: HrCtx, id: string) => {
  const h = hrHolidays.find((x) => x.companyId === ctx.co && x.id === id)
  if (!h) throw notFound()
  return h
}

/** PATCH /hr/holidays/:id (full). */
export async function updateHoliday(user: User, id: string, input: HolidayInput | null): Promise<PublicHoliday> {
  const ctx = hrCtx(user)
  const h = ownHoliday(ctx, id)
  requireFull(ctx)
  const next = validHoliday(input, h)
  if (hrHolidays.some((x) => x.companyId === ctx.co && x.id !== h.id && x.date === next.date)) throw conflict('There is already a holiday on this date.', 'duplicate_date')
  Object.assign(h, next)
  recordAudit(user, { action: 'update', entity: 'holiday', entityId: h.id, summary: `Updated the public holiday ${h.name} (${h.date})` })
  return delay(plainHoliday(h))
}

/** DELETE /hr/holidays/:id (full). */
export async function deleteHoliday(user: User, id: string): Promise<{ ok: true }> {
  const ctx = hrCtx(user)
  const h = ownHoliday(ctx, id)
  requireFull(ctx)
  hrHolidays.splice(hrHolidays.indexOf(h), 1)
  recordAudit(user, { action: 'delete', entity: 'holiday', entityId: h.id, summary: `Removed the public holiday ${h.name} (${h.date})` })
  return delay({ ok: true as const })
}
