import type { Employee } from '@/modules/hr/types'
import { inAudience } from '@/modules/hr/compliance/rules'
import { departmentSubtree } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { activeMembershipOf } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrPolicies, hrPolicyAcks, type PolicyRecord } from '@/shared/mocks/data/hrCompliance'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Who a policy addresses and who acknowledged it: data-only helpers shared by services/hrCompliance.ts and the
 * onboarding journey's `acknowledge_policies` link action (services/hrJourney.ts), kept apart to avoid import cycles.
 */

export const activeUserOf = (co: string, id: string | null | undefined) => (id ? users.find((u) => u.id === id && u.companyId === co && u.active) : undefined)

function roleOfEmployee(co: string, e: Employee): string | null {
  const u = activeUserOf(co, e.userId)
  return u ? (activeMembershipOf(u.id)?.role ?? u.role) : null
}

/** Employees a policy addresses: not terminated, with an active login (they acknowledge in My HR), in the audience. */
export function audienceOf(co: string, p: Pick<PolicyRecord, 'audience'>): Tenant<Employee>[] {
  const coDepts = departments.filter((d) => d.companyId === co)
  const tree = (id: string) => departmentSubtree(id, coDepts)
  return employeesOf(co).filter((e) => e.status !== 'terminated' && !!activeUserOf(co, e.userId) && inAudience(p.audience, { departmentId: e.departmentId, role: roleOfEmployee(co, e) }, tree))
}

export const ackOf = (co: string, policyId: string, employeeId: string, version: number) =>
  hrPolicyAcks.find((a) => a.companyId === co && a.policyId === policyId && a.employeeId === employeeId && a.version === version)

export const latestAckOf = (co: string, policyId: string, employeeId: string) =>
  hrPolicyAcks.filter((a) => a.companyId === co && a.policyId === policyId && a.employeeId === employeeId).sort((a, b) => b.version - a.version)[0]

/** Published policies addressing this employee. */
export function policiesFor(co: string, e: Pick<Employee, 'id'>): Tenant<PolicyRecord>[] {
  return hrPolicies.filter((p) => p.companyId === co && p.status === 'published' && p.version > 0 && audienceOf(co, p).some((x) => x.id === e.id))
}

/** Onboarding link action: every policy addressed to the employee is acknowledged at its current version (null = not yet / none). */
export function policiesAcknowledgedNote(co: string, e: Pick<Employee, 'id'>): string | null {
  const mine = policiesFor(co, e)
  if (!mine.length) return null
  return mine.every((p) => ackOf(co, p.id, e.id, p.version)) ? `Acknowledged ${mine.length} polic${mine.length === 1 ? 'y' : 'ies'}` : null
}
