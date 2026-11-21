import type { Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type { EmployeeRef } from '@/modules/hr/time/types'
import { departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { now } from '@/shared/mocks/clock'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { employeeForUser, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { ensureHrTime, headApproverIds } from '@/shared/mocks/data/hrTime'
import { companyTeamIds } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'

/**
 * Who sees what in HR › Attendance and Leave (matrix `hr` column):
 *   full  (Company Admin, Management, HR Manager) every employee of the company
 *   team  (Department Head) the employees of the departments they head (+ sub-departments) and their reports
 *   own   (Employee) themselves
 *   hidden (everyone else) nothing of other people.
 * SELF-SERVICE: every user who has an active employee record may clock in / out, ask for attendance
 * corrections and request / cancel their own leave, whatever their `hr` scope (a Sales Agent too).
 * APPROVER INBOX: the step-1 approvers of a leave request (the employee's manager / department head)
 * see and decide that request even when their `hr` scope is hidden (a Sales Manager for their agents).
 */

export interface HrCtx {
  user: User
  co: string
  scope: Scope
  /** The caller's own employee record (active), if any. */
  self: Tenant<Employee> | undefined
  timezone: string
  weekend: readonly number[]
  country: string
  now: Date
  today: string
}

export function hrCtx(user: User): HrCtx {
  const co = tenantOf(user)
  const c = companyById(co)
  const timezone = c?.regional.timezone ?? DEFAULT_REGION.timezone
  const at = now()
  const today = todayIsoIn(timezone, at)
  ensureHrTime(co, Number(today.slice(0, 4)))
  const own = employeeForUser(co, user.id)
  return {
    user,
    co,
    scope: scopeOf(user.role, 'hr'),
    self: own && own.status !== 'terminated' ? own : undefined,
    timezone,
    weekend: c?.regional.weekend ?? DEFAULT_REGION.weekend,
    country: c?.regional.country ?? 'AE',
    now: at,
    today,
  }
}

export const forbidden = (message = 'Your role can’t do this in HR.') => new CodedApiError(message, 403, 'forbidden')
export const notFound = () => new CodedApiError(NOT_FOUND, 404, 'not_found')
export const invalid = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}) => new CodedApiError(message, 422, code, details)
export const conflict = (message: string, code: string) => new CodedApiError(message, 409, code)

export const isFull = (ctx: HrCtx) => ctx.scope === 'full'
export const canManage = (ctx: HrCtx) => ctx.scope === 'full' || ctx.scope === 'team'

/** The caller's own employee record, or 403 `no_employee_record` (self-service needs one). */
export function requireSelf(ctx: HrCtx): Tenant<Employee> {
  if (!ctx.self) throw new CodedApiError('You don’t have an active employee record in this company. Ask HR to add you.', 403, 'no_employee_record')
  return ctx.self
}

export function requireFull(ctx: HrCtx): void {
  if (!isFull(ctx)) throw forbidden('Only HR (full access) can do this.')
}

export function requireManage(ctx: HrCtx): void {
  if (!canManage(ctx)) throw forbidden('Your role can’t see other employees’ attendance.')
}

/** Employee ids of the caller's team (team scope): headed departments + sub-departments, reports, themselves. */
export function teamEmployeeIds(ctx: HrCtx): Set<string> {
  const userIds = new Set(companyTeamIds(ctx.user))
  const coDepts = departments.filter((d) => d.companyId === ctx.co)
  const headed = new Set(coDepts.filter((d) => d.active && d.headId === ctx.user.id).flatMap((d) => departmentSubtree(d.id, coDepts)))
  const out = new Set<string>()
  for (const e of employeesOf(ctx.co)) {
    if ((e.userId && userIds.has(e.userId)) || (e.departmentId && headed.has(e.departmentId)) || (ctx.self && e.managerId === ctx.self.id)) out.add(e.id)
  }
  if (ctx.self) out.add(ctx.self.id)
  return out
}

/** Employees whose attendance / balances the caller may see (by scope; self only for own / hidden). */
export function visibleEmployees(ctx: HrCtx): Tenant<Employee>[] {
  const all = employeesOf(ctx.co)
  if (ctx.scope === 'full') return all
  if (ctx.scope === 'team') {
    const team = teamEmployeeIds(ctx)
    return all.filter((e) => team.has(e.id))
  }
  return ctx.self ? [ctx.self] : []
}

/** An employee of the caller's company the caller may see, or 404 (foreign and out-of-scope ids answer alike). */
export function visibleEmployee(ctx: HrCtx, id: string): Tenant<Employee> {
  const e = visibleEmployees(ctx).find((x) => x.id === id)
  if (!e) throw notFound()
  return e
}

/** Is the caller a step-1 approver (manager / department head) of this employee? */
export function isHeadOf(ctx: HrCtx, emp: Pick<Employee, 'userId' | 'managerId' | 'departmentId'>): boolean {
  return headApproverIds(ctx.co, emp).includes(ctx.user.id)
}

export function departmentName(co: string, id: string | null): string | null {
  return id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? null) : null
}

export function employeeRef(e: Tenant<Employee>): EmployeeRef {
  return {
    id: e.id,
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    departmentName: departmentName(e.companyId, e.departmentId),
  }
}

export const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
