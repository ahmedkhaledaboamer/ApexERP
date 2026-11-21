import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrLeaveRequests, hrLeaveTypes } from '@/shared/mocks/data/hrTime'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * HR › Attendance and Leave for EVERY role of PERMISSION_MATRIX in BOTH companies, through the real
 * MSW handlers. Expectations come from the matrix `hr` column at run time:
 *   full → every employee; team → the departments they head (+ sub-departments) and their reports;
 *   own / hidden → nobody else. Boards, sheets and balances: full / team only (403 otherwise).
 * SELF-SERVICE: every role with an employee record can read their attendance, clock in and request
 * leave (a Sales Agent too); without an employee record → 403 no_employee_record.
 * APPROVER INBOX: step-1 approvers also see the requests they must decide.
 * Another company's employee / request → 404 for everyone; a spoofed company is ignored; without the
 * plan module `hr` (Crest's Business plan) → 403 module_not_in_plan.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)

function enableHr(co: Co) {
  if (!moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) {
    moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
  }
}

/** A user (+ membership + employee record) for every role a company has no seeded active user for. */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const mgmt = users.find((u) => u.companyId === co && roleOf(u) === 'Management')!
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)!
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const at = new Date().toISOString()
      const user: User = {
        id: `u-hrt-${co}-${slug}`, companyId: co, name: `HRT ${role} ${co}`, email: `hrt-${slug}@${co}.test`, role, title: role,
        managerId: mgmt.id, mobile: '', departmentId: dept.id, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at,
      }
      users.push(user)
      addMembership(user.id, co, role)
      const emp: Tenant<Employee> = {
        companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `HRT-${slug}`, fullName: user.name, jobTitle: role, departmentId: dept.id,
        managerId: `EMP-${mgmt.id}`, email: user.email, mobile: '', nationality: 'AE', gender: null, dateOfBirth: null, hireDate: '2024-01-01',
        employmentType: 'full_time', status: 'active', exitDate: null, createdAt: at, updatedAt: at,
      }
      hrEmployees.push(emp)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
  enableHr('co_crest')
})

function userFor(co: Co, role: Role): User {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role && hrEmployees.some((e) => e.userId === x.id && e.status !== 'terminated'))
  if (!u) throw new Error(`No ${role} employee in ${co}`)
  return u
}

/** Independent re-statement of the team rule (employees). */
function teamOf(u: User): Set<string> {
  const coDepts = departments.filter((d) => d.companyId === u.companyId)
  const headed = new Set<string>()
  const queue = coDepts.filter((d) => d.active && d.headId === u.id).map((d) => d.id)
  while (queue.length) {
    const id = queue.shift()!
    if (headed.has(id)) continue
    headed.add(id)
    for (const c of coDepts) if (c.active && c.parentId === id) queue.push(c.id)
  }
  const reportUsers = new Set(users.filter((x) => x.companyId === u.companyId && (x.managerId === u.id || (x.departmentId && headed.has(x.departmentId)))).map((x) => x.id))
  return new Set(
    hrEmployees
      .filter((e) => e.companyId === u.companyId && (e.userId === u.id || (e.userId && reportUsers.has(e.userId)) || (e.departmentId && headed.has(e.departmentId)) || e.managerId === `EMP-${u.id}`))
      .map((e) => e.id),
  )
}

function expectedVisible(u: User, scope: Scope): Set<string> {
  const all = hrEmployees.filter((e) => e.companyId === u.companyId)
  if (scope === 'full') return new Set(all.map((e) => e.id))
  if (scope === 'team') return teamOf(u)
  return new Set([`EMP-${u.id}`])
}

const unpaid = (co: Co) => hrLeaveTypes.find((t) => t.companyId === co && t.code === 'unpaid')!.id

describe('HR › Attendance and Leave: every role of the matrix, both companies', () => {
  it('the matrix uses only scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: self-service, scope of others, foreign ids`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(role, 'hr')
        const token = tokenFor(u)
        const manage = scope === 'full' || scope === 'team'

        // Self-service for everyone with an employee record.
        const me = await callApi(token, 'GET', '/hr/attendance/me')
        expect(me.status, `${role} my attendance`).toBe(200)
        expect(me.body.employee.id).toBe(`EMP-${u.id}`)
        const clock = await callApi(token, 'POST', '/hr/attendance/clock-in', { note: 'test' })
        expect([200, 409], `${role} clock-in`).toContain(clock.status)
        const start = addDaysIso(today(co), 60)
        const req = await callApi(token, 'POST', '/hr/leave/requests', { leave_type_id: unpaid(co), start_date: start, end_date: addDaysIso(start, 6), company_id: them })
        expect(req.status, `${role} request leave: ${JSON.stringify(req.body).slice(0, 200)}`).toBe(200)
        expect(hrLeaveRequests.find((r) => r.id === req.body.id)?.companyId).toBe(co)
        expect((await callApi(token, 'GET', '/hr/leave/me')).status).toBe(200)

        // Boards, sheets, balances: full / team only, with exactly the scoped employees.
        const visible = expectedVisible(u, scope)
        const board = await callApi(token, 'GET', '/hr/attendance/today')
        const sheet = await callApi(token, 'GET', '/hr/attendance/sheet')
        const balances = await callApi(token, 'GET', '/hr/leave/balances')
        if (manage) {
          expect(board.status).toBe(200)
          const ids = new Set<string>(sheet.body.rows.map((r: { employee: { id: string } }) => r.employee.id))
          const monthStart = `${today(co).slice(0, 7)}-01`
          const onSheet = (e: Employee | undefined) => !!e && (e.status !== 'terminated' || (e.exitDate !== null && e.exitDate >= monthStart))
          const active = [...visible].filter((id) => onSheet(hrEmployees.find((e) => e.id === id)))
          expect([...ids].sort(), `${role} sheet rows`).toEqual(active.sort())
          expect(balances.status).toBe(200)
        } else {
          expect([board.status, sheet.status, balances.status], role).toEqual([403, 403, 403])
        }

        // Another employee of the same company: 200 only when in scope.
        const other = hrEmployees.find((e) => e.companyId === co && e.userId !== u.id && !visible.has(e.id))
        if (other) expect((await callApi(token, 'GET', `/hr/attendance/employees/${other.id}`)).status, `${role} → ${other.id}`).toBe(404)
        const inScope = [...visible].find((id) => id !== `EMP-${u.id}`)
        if (inScope) expect((await callApi(token, 'GET', `/hr/attendance/employees/${inScope}`)).status).toBe(200)
        // The other company: 404 for everyone.
        const foreign = hrEmployees.find((e) => e.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/attendance/employees/${foreign.id}`)).status).toBe(404)
        const foreignReq = hrLeaveRequests.find((r) => r.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/leave/requests/${foreignReq.id}`)).status).toBe(404)
        expect((await callApi(token, 'POST', `/hr/leave/requests/${foreignReq.id}/cancel`, {})).status).toBe(404)

        // Requests list: own ∪ scoped ∪ approver inbox — nothing else.
        const list = await callApi(token, 'GET', '/hr/leave/requests')
        const got = new Set<string>(list.body.map((r: { id: string }) => r.id))
        const want = new Set(
          hrLeaveRequests
            .filter((r) => r.companyId === co && (visible.has(r.employeeId) || r.approvals.some((a) => a.step === 'department_head' && a.approverIds.includes(u.id))))
            .map((r) => r.id),
        )
        expect([...got].sort(), `${role} visible requests`).toEqual([...want].sort())
      })
    }
  }

  it('a user without an employee record gets 403 no_employee_record for self-service', async () => {
    const u = userFor('co_apex', 'Sales Agent')
    hrEmployees.splice(hrEmployees.findIndex((e) => e.userId === u.id), 1)
    const res = await callApi(tokenFor(u), 'GET', '/hr/attendance/me')
    expect([res.status, res.body.code]).toEqual([403, 'no_employee_record'])
  })

  it('a Sales Agent (hr hidden) requests their own leave but sees nobody else’s', async () => {
    const u = userFor('co_apex', 'Sales Agent')
    const list = await callApi(tokenFor(u), 'GET', '/hr/leave/requests')
    expect(list.body.every((r: { employee_id: string }) => r.employee_id === `EMP-${u.id}`)).toBe(true)
    const cal = await callApi(tokenFor(u), 'GET', '/hr/leave/calendar')
    expect(cal.body.entries.every((e: { employee_id: string }) => e.employee_id === `EMP-${u.id}`)).toBe(true)
  })

  it('plan gate: without the hr module (Crest’s plan, no override) → 403 module_not_in_plan', async () => {
    moduleOverrides.splice(0, moduleOverrides.length, ...moduleOverrides.filter((o) => !(o.companyId === 'co_crest' && o.module === 'hr')))
    for (const path of ['/hr/attendance/me', '/hr/leave/me', '/hr/holidays']) {
      const res = await callApi(tokenFor(userFor('co_crest', 'Company Admin')), 'GET', path)
      expect([res.status, res.body.code], path).toEqual([403, 'module_not_in_plan'])
    }
    expect((await callApi(tokenFor(userFor('co_apex', 'Employee')), 'GET', '/hr/attendance/me')).status).toBe(200)
  })
})
