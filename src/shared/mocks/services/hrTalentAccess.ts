import type { Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { companyById } from '@/shared/mocks/data/tenancy'
import { empIdForUser, employeeForUser, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertModule } from '@/shared/mocks/services/billing'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'

/**
 * Access rules shared by HR recruitment and training (PERMISSION_MATRIX `hr` column):
 *   full    Company Admin, Management, HR Manager: everything
 *   team    Department Head: their departments (headed + sub-departments) and direct reports
 *   own     Employee: their own records (and interview cards they were invited to)
 *   hidden  everyone else: 403 on every HR endpoint
 * The plan module `hr` is checked centrally for /hr/* (userFrom → 403 module_not_in_plan) and again here.
 */

export const FORBIDDEN_HR = 'HR isn’t available for your role.'

export function hrScopeOf(user: User): Scope {
  return scopeOf(user.role, 'hr')
}

/** Plan module + any HR access; returns the caller's scope. */
export function requireHr(user: User): Scope {
  assertModule(tenantOf(user), 'hr')
  const scope = hrScopeOf(user)
  if (scope === 'hidden') throw new ApiError(FORBIDDEN_HR, 403)
  return scope
}

export function requireHrFull(user: User, what = 'Only HR can do this.'): void {
  if (requireHr(user) !== 'full') throw new ApiError(what, 403)
}

export const isHrFull = (user: User) => hrScopeOf(user) === 'full'

/** Departments the user heads, with their sub-departments (caller's company only). */
export function headedDepartmentIds(user: User): string[] {
  const co = tenantOf(user)
  const own = departments.filter((d) => d.companyId === co)
  return [...new Set(own.filter((d) => d.active && d.headId === user.id).flatMap((d) => departmentSubtree(d.id, own)))]
}

/** Employee ids of the user's team: themselves, direct reports and everyone in the departments they head. */
export function teamEmployeeIds(user: User): Set<string> {
  const co = tenantOf(user)
  const depts = new Set(headedDepartmentIds(user))
  const me = empIdForUser(user.id)
  const ids = new Set<string>()
  for (const e of employeesOf(co)) {
    if (e.id === me || e.managerId === me || (e.departmentId && depts.has(e.departmentId))) ids.add(e.id)
  }
  return ids
}

/** Employee ids the caller may see for HR purposes (training): all (full), team, or own. */
export function visibleEmployeeIds(user: User): Set<string> {
  const scope = requireHr(user)
  const co = tenantOf(user)
  if (scope === 'full' || scope === 'view') return new Set(employeesOf(co).map((e) => e.id))
  if (scope === 'team') return teamEmployeeIds(user)
  const mine = employeeForUser(co, user.id)
  return new Set(mine ? [mine.id] : [])
}

export const companyCurrency = (companyId: string) => companyById(companyId)?.regional.currency ?? 'AED'
export const companyTimezone = (companyId: string) => companyById(companyId)?.regional.timezone ?? 'Asia/Dubai'
export const companyCountry = (companyId: string) => companyById(companyId)?.regional.country ?? 'AE'

export const userOf = (companyId: string, id: string | null | undefined) => (id ? users.find((u) => u.id === id && u.companyId === companyId) : undefined)
export const nameOfUser = (companyId: string, id: string | null | undefined) => userOf(companyId, id)?.name ?? '—'
export const deptName = (companyId: string, id: string | null | undefined) => departments.find((d) => d.companyId === companyId && d.id === id)?.name ?? '—'

/** Active users of the company whose role can see HR (hiring managers, interviewers). */
export function hrPeople(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId && u.active !== false && scopeOf(u.role, 'hr') !== 'hidden')
}

/** HR full users of a company (notification recipients). */
export function hrFullUsers(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId && u.active !== false && scopeOf(u.role, 'hr') === 'full')
}

/* ---------------- Hire (Employees section) ---------------- */

export interface HireInput {
  fullName: string
  email: string
  mobile: string
  jobTitle: string
  departmentId: string | null
  managerId: string | null
  hireDate: string
  employmentType: Employee['employmentType']
}

/**
 * Creates the employee for an accepted offer through the Employees section's createEmployee (status
 * onboarding, no user link: a hire never creates a login).
 */
export function hireEmployee(companyId: string, input: HireInput, actor: User): Tenant<Employee> {
  return createEmployee(companyId, { ...input, nationality: companyCountry(companyId), status: 'onboarding', userId: null }, actor)
}