import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type { HrAccess } from '@/modules/hr/peopleTypes'
import { ApiError } from '@/shared/lib/apiError'
import { departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { employeeForUser, employeesOf, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrActivity, nextHrId } from '@/shared/mocks/data/hrPeople'
import { NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'

/**
 * Who sees which employee in HR › Employees, Employee contracts and Company assets (PERMISSION_MATRIX `hr`):
 *   full    Company Admin, Management, HR Manager: every employee of the company; the only writers
 *   team    Department Head: their own record + employees of the departments they head (and the
 *           sub-departments) + their direct reports (employees.manager_id)
 *   own     Employee: their own record (employees.user_id = the caller)
 *   hidden  everyone else: 403
 * The company always comes from the session. A record outside the caller's scope answers 404 like a missing one.
 */

export const HR_FORBIDDEN = 'HR is for HR, managers and employees. Ask your HR team for access.'
export const HR_MANAGE_ONLY = 'Only HR (Company Admin, Management or HR Manager) can change employee records.'

export function hrAccessOf(user: User): HrAccess {
  const scope = scopeOf(user.role, 'hr')
  if (scope === 'full') return 'full'
  if (scope === 'team') return 'team'
  if (scope === 'own') return 'own'
  throw new ApiError(HR_FORBIDDEN, 403)
}

export function assertHrFull(user: User): void {
  if (hrAccessOf(user) !== 'full') throw new ApiError(HR_MANAGE_ONLY, 403)
}

/** The employees the caller may see (throws 403 for roles without HR). */
export function visibleEmployees(user: User): Tenant<Employee>[] {
  const access = hrAccessOf(user)
  const co = tenantOf(user)
  const all = employeesOf(co)
  if (access === 'full') return all
  const me = employeeForUser(co, user.id)
  if (access === 'own') return me ? [me] : []
  const headed = departments.filter((d) => d.companyId === co && d.active && d.headId === user.id)
  const deptIds = new Set(headed.flatMap((d) => departmentSubtree(d.id, departments.filter((x) => x.companyId === co))))
  return all.filter((e) => e.id === me?.id || (e.departmentId !== null && deptIds.has(e.departmentId)) || (!!me && e.managerId === me.id))
}

export function visibleEmployeeIds(user: User): Set<string> {
  return new Set(visibleEmployees(user).map((e) => e.id))
}

/** An employee the caller may see, or 404 (another company's id answers exactly like a missing one). */
export function visibleEmployee(user: User, id: string): Tenant<Employee> {
  const e = visibleEmployees(user).find((x) => x.id === id)
  if (!e) throw new ApiError(NOT_FOUND, 404)
  return e
}

/** An employee of the caller's company (for HR-full writes), or 404. */
export function companyEmployee(companyId: string, id: unknown): Tenant<Employee> | undefined {
  return typeof id === 'string' ? hrEmployees.find((e) => e.companyId === companyId && e.id === id) : undefined
}

/** True when the caller is the employee (own record: pay is visible to them). */
export function isSelf(user: User, employee: Employee): boolean {
  return !!employee.userId && employee.userId === user.id
}

export function employeeName(companyId: string, id: string | null): string | null {
  if (!id) return null
  return hrEmployees.find((e) => e.companyId === companyId && e.id === id)?.fullName ?? null
}

/** Active users of the company whose HR scope is full (alert recipients). */
export function hrFullUsers(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId && u.active && scopeOf(u.role, 'hr') === 'full')
}

/** The employee's manager as an active user of the same company (alert recipient), if any. */
export function managerUserOf(companyId: string, employee: Employee): User | undefined {
  const manager = employee.managerId ? hrEmployees.find((e) => e.companyId === companyId && e.id === employee.managerId) : undefined
  return manager?.userId ? users.find((u) => u.id === manager.userId && u.companyId === companyId && u.active) : undefined
}

export type HrActor = Pick<User, 'id' | 'name'> | null

/** Appends to the employee's Activity tab. */
export function logHr(companyId: string, employeeId: string, actor: HrActor, action: string, summary: string, at = new Date().toISOString()): void {
  hrActivity.push({ companyId, id: nextHrId('HACT-', hrActivity), employeeId, at, actorId: actor?.id ?? null, actorName: actor?.name ?? 'System', action, summary })
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))
