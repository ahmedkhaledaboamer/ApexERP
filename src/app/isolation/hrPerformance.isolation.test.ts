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
import { hrPerfCycles, hrPerfReviews, hrPerfTemplates } from '@/shared/mocks/data/hrPerformance'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * HR › Performance for EVERY role of PERMISSION_MATRIX in BOTH companies (Crest via a platform module
 * override), through the real MSW handlers. Expectations come from the matrix `hr` column at run time:
 *   own review     every role with an employee record (self-service, a Sales Agent too); results only once
 *                  shared; never the HR calibration note
 *   other reviews  full → all; team → their team; anyone → their direct reports (managerId); nobody → peers
 *   cycles / templates  full only (403 otherwise)
 * Another company's review → 404; spoofed company fields are ignored; without `hr` → 403 module_not_in_plan.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']
const NOTE = 'CALIBRATION-NOTE-PRIVATE'

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

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const mgmt = users.find((u) => u.companyId === co && roleOf(u) === 'Management')!
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)!
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const at = new Date().toISOString()
      const user: User = {
        id: `u-hpf-${co}-${slug}`, companyId: co, name: `HPF ${role} ${co}`, email: `hpf-${slug}@${co}.test`, role, title: role,
        managerId: mgmt.id, mobile: '', departmentId: dept.id, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at,
      }
      users.push(user)
      addMembership(user.id, co, role)
      const emp: Tenant<Employee> = {
        companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `HPF-${slug}`, fullName: user.name, jobTitle: role, departmentId: dept.id,
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

/** Independent re-statement of the team rule (as in hrTime.isolation.test.ts). */
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

const activeUserOfEmp = (co: Co, empId: string | null) => {
  const e = empId ? hrEmployees.find((x) => x.companyId === co && x.id === empId && x.status !== 'terminated') : undefined
  return e?.userId ? users.find((x) => x.id === e.userId && x.companyId === co && x.active) : undefined
}

describe('HR › Performance: every role of the matrix, both companies', () => {
  it('the matrix uses only scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'hr'))
  })

  for (const co of COMPANIES) {
    const them: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: own review, scope of others, results only once shared, never calibration`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(role, 'hr')
        const token = tokenFor(u)
        const me = `EMP-${u.id}`

        const my = await callApi(token, 'GET', '/hr/performance/my')
        expect(my.status, `${role} my`).toBe(200)
        expect(my.body.employee_id).toBe(me)
        expect(my.body.reviews.every((r: { employee_id: string }) => r.employee_id === me)).toBe(true)

        // Cycles and templates: HR full only.
        const cycles = await callApi(token, 'GET', '/hr/performance/cycles')
        const templates = await callApi(token, 'GET', '/hr/performance/templates')
        expect([cycles.status, templates.status], role).toEqual(scope === 'full' ? [200, 200] : [403, 403])

        // Other people's reviews: exactly full → all, team → team, anyone → direct reports.
        const team = scope === 'team' ? teamOf(u) : new Set<string>()
        const want = hrPerfReviews
          .filter((r) => r.companyId === co && r.employeeId !== me && (scope === 'full' || r.managerId === me || team.has(r.employeeId)))
          .map((r) => r.id)
          .sort()
        const list = await callApi(token, 'GET', '/hr/performance/reviews')
        expect(list.status).toBe(200)
        expect(list.body.map((r: { id: string }) => r.id).sort(), `${role} visible reviews`).toEqual(want)
        const peer = hrPerfReviews.find((r) => r.companyId === co && r.employeeId !== me && !want.includes(r.id))
        if (peer) expect((await callApi(token, 'GET', `/hr/performance/reviews/${peer.id}`)).status, `${role} → peer ${peer.employeeId}`).toBe(404)
        const foreign = hrPerfReviews.find((r) => r.companyId === them)!
        expect((await callApi(token, 'GET', `/hr/performance/reviews/${foreign.id}`)).status).toBe(404)
        expect((await callApi(token, 'POST', `/hr/performance/reviews/${foreign.id}/acknowledge`, { comment: 'x' })).status).toBe(404)

        // A one-person cycle for this user, walked by an HR-full colleague (spoofed company ignored).
        const hrUser = users.find((x) => x.companyId === co && x.active && x.id !== u.id && scopeOf(roleOf(x), 'hr') === 'full')!
        const hrToken = tokenFor(hrUser)
        const tpl = hrPerfTemplates.find((t) => t.companyId === co && !t.goalsEnabled && t.selfReview && !t.forProbation)!
        const created = await callApi(hrToken, 'POST', '/hr/performance/cycles', {
          name: `Role check ${role}`, type: 'ad_hoc', template_id: tpl.id, period_start: addDaysIso(today(co), -60), period_end: today(co),
          employee_ids: [me], company_id: them, deadlines: { self_review: addDaysIso(today(co), 5), manager_review: addDaysIso(today(co), 10), calibration: addDaysIso(today(co), 15) },
        })
        expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(200)
        expect(hrPerfCycles.find((c) => c.id === created.body.id)?.companyId).toBe(co)
        const launched = await callApi(hrToken, 'POST', `/hr/performance/cycles/${created.body.id}/launch`)
        const reviewId = launched.body.reviews[0].id as string
        const answers = tpl.sections.flatMap((s) => s.questions).map((q) => ({ question_id: q.id, rating: 4, comment: '' }))
        const self = await callApi(token, 'PUT', `/hr/performance/reviews/${reviewId}/self`, { answers, summary: 'Mine', submit: true })
        expect(self.status, `${role} self-review`).toBe(200)
        await callApi(hrToken, 'POST', `/hr/performance/cycles/${created.body.id}/advance`)
        const reviewer = activeUserOfEmp(co, hrEmployees.find((e) => e.id === me)!.managerId) ?? hrUser
        expect((await callApi(tokenFor(reviewer), 'PUT', `/hr/performance/reviews/${reviewId}/manager`, { answers, summary: 'Manager words', submit: true })).status).toBe(200)
        await callApi(hrToken, 'POST', `/hr/performance/cycles/${created.body.id}/advance`)
        expect((await callApi(hrToken, 'POST', `/hr/performance/reviews/${reviewId}/calibrate`, { rating: 3, note: NOTE })).status).toBe(200)
        // The employee can't calibrate themself.
        expect((await callApi(token, 'POST', `/hr/performance/reviews/${reviewId}/calibrate`, { rating: 5, note: 'mine' })).status).toBe(403)

        const before = await callApi(token, 'GET', `/hr/performance/reviews/${reviewId}`)
        expect(before.status).toBe(200)
        expect([before.body.manager, before.body.final_rating, before.body.scores, before.body.calibration], `${role} before shared`).toEqual([null, null, null, null])
        expect(JSON.stringify(before.body)).not.toContain(NOTE)

        await callApi(hrToken, 'POST', `/hr/performance/cycles/${created.body.id}/advance`)
        const after = await callApi(token, 'GET', `/hr/performance/reviews/${reviewId}`)
        expect([after.body.stage, after.body.final_rating, after.body.manager?.summary, after.body.calibration]).toEqual(['shared', 3, 'Manager words', null])
        expect(JSON.stringify(after.body)).not.toContain(NOTE)
        expect(JSON.stringify((await callApi(token, 'GET', '/hr/performance/my')).body)).not.toContain(NOTE)
        expect((await callApi(token, 'POST', `/hr/performance/reviews/${reviewId}/acknowledge`, { comment: 'ok', company_id: them })).status).toBe(200)
        // The reviewer (unless HR) sees the result but not the note either.
        if (scopeOf(roleOf(reviewer), 'hr') !== 'full') expect(JSON.stringify((await callApi(tokenFor(reviewer), 'GET', `/hr/performance/reviews/${reviewId}`)).body)).not.toContain(NOTE)
      })
    }
  }

  it('a Sales Manager (hr hidden) completes the manager review of their own agents only', async () => {
    const sm = userFor('co_apex', 'Sales Manager')
    const list = await callApi(tokenFor(sm), 'GET', '/hr/performance/reviews')
    expect(list.body.length).toBeGreaterThan(0)
    expect(list.body.every((r: { manager_id: string }) => r.manager_id === `EMP-${sm.id}`)).toBe(true)
  })

  it('plan gate: without the hr module (Crest’s plan, no override) → 403 module_not_in_plan', async () => {
    moduleOverrides.splice(0, moduleOverrides.length, ...moduleOverrides.filter((o) => !(o.companyId === 'co_crest' && o.module === 'hr')))
    for (const path of ['/hr/performance/my', '/hr/performance/reviews', '/hr/performance/cycles']) {
      const res = await callApi(tokenFor(userFor('co_crest', 'Company Admin')), 'GET', path)
      expect([res.status, res.body.code], path).toEqual([403, 'module_not_in_plan'])
    }
  })
})
