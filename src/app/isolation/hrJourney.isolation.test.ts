import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrJourneys, type JourneyRecord } from '@/shared/mocks/data/hrJourney'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * HR › Onboarding & offboarding — TABLE-DRIVEN FROM PERMISSION_MATRIX (`hr` column; docs/API.md › HR ›
 * Onboarding & offboarding), every role × both companies (Crest gets `hr` through a platform module override):
 *   full    every journey; templates; ticks any (non-system) item
 *   team    journeys of their HR scope; ticks the Manager items of those (not their own journey's)
 *   own     their own journeys; ticks their own Employee items
 *   hidden  403 on journeys / templates
 *   any     GET /hr/journeys/my-tasks and ticking an item ASSIGNED to them (assignee inbox); anything else outside
 *           the scope answers 404 like a missing id, inside the scope but not theirs 403.
 * Scenario per company: a joiner with a login in the Department Head's department (manager = the head) and a
 * joiner in Sales (manager = the Sales Manager, whose hr scope is hidden).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const HEAD_DEPT: Record<Co, { dept: string; head: string; sales: string; salesManager: string }> = {
  co_apex: { dept: 'd-delivery', head: 'u10', sales: 'd-sales', salesManager: 'u3' },
  co_crest: { dept: 'c2-ops', head: 'u106', sales: 'c2-sales', salesManager: 'u103' },
}

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function addUser(co: Co, id: string, role: Role, name: string, departmentId = ''): User {
  const user: User = { id, companyId: co, name, email: `${id}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId, active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
  users.push(user)
  addMembership(user.id, co, role)
  return user
}

/** A user for every role in both companies (with an employee record, like every seeded user). */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const u = addUser(co, `u-jr-${co}-${slug}`, role, `Journey ${role} ${co}`)
      createEmployee(co, { fullName: u.name, jobTitle: role, hireDate: '2025-01-01', userId: u.id, nationality: co === 'co_apex' ? 'AE' : 'SA' }, null)
    }
  }
}

interface Scenario {
  joiner: User
  team: JourneyRecord
  sales: JourneyRecord
}
const scenario = {} as Record<Co, Scenario>

function hire(co: Co, name: string, dept: string, managerUser: string, userId: string | null): JourneyRecord {
  const e = createEmployee(co, { fullName: name, jobTitle: 'New joiner', hireDate: '2026-12-01', departmentId: dept, managerId: `EMP-${managerUser}`, status: 'onboarding', userId, nationality: co === 'co_apex' ? 'IN' : 'SA' }, null)
  return hrJourneys.find((j) => j.employeeId === e.id && j.status === 'active')!
}

beforeEach(() => {
  restoreSnapshot(seed)
  moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
  ensureRoleUsers()
  for (const co of COMPANIES) {
    const h = HEAD_DEPT[co]
    const joiner = addUser(co, `u-jr-${co}-joiner`, 'Employee', `Joiner ${co}`, h.dept)
    scenario[co] = { joiner, team: hire(co, joiner.name, h.dept, h.head, joiner.id), sales: hire(co, `Sales joiner ${co}`, h.sales, h.salesManager, null) }
  }
})

function userFor(co: Co, role: Role): User {
  // The Department Head of the scenario's department / an Employee who isn't the joiner.
  if (role === 'Department Head') return users.find((u) => u.id === HEAD_DEPT[co].head)!
  return users.find((x) => x.companyId === co && x.active && roleOf(x) === role && x.id !== scenario[co]?.joiner.id)!
}

const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

/** Independent recomputation of the employees a user may see (the matrix + departments + reporting lines). */
function visibleIds(u: User): Set<string> | null {
  const scope = scopeOf(roleOf(u), 'hr')
  const all = hrEmployees.filter((e) => e.companyId === u.companyId)
  if (scope === 'hidden') return null
  if (scope === 'full') return new Set(all.map((e) => e.id))
  const me = all.find((e) => e.userId === u.id)
  if (scope === 'own') return new Set(me ? [me.id] : [])
  const deps = departments.filter((d) => d.companyId === u.companyId)
  const headed = new Set(deps.filter((d) => d.active && d.headId === u.id).flatMap((d) => departmentSubtree(d.id, deps)))
  return new Set(all.filter((e) => e.id === me?.id || (e.departmentId && headed.has(e.departmentId)) || (me && e.managerId === me.id)).map((e) => e.id))
}

const itemOf = (j: JourneyRecord, role: string) => j.items.find((i) => i.ownerRole === role && i.status === 'open' && !i.system)!

describe('the hr column only uses handled scopes', () => {
  it('every role’s hr scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].hr)
  })
})

describe('scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].hr})`, async () => {
        const u = userFor(co, role)
        const ids = visibleIds(u)
        const scope = scopeOf(roleOf(u), 'hr')
        const { team, sales } = scenario[co]
        const list = await call(u, 'GET', '/hr/journeys')
        const templates = await call(u, 'GET', '/hr/journeys/templates')
        const mine = await call(u, 'GET', '/hr/journeys/my-tasks')
        // The assignee inbox answers every role, with only the caller's items.
        expect(mine.status).toBe(200)
        const expectedMine = hrJourneys.filter((j) => j.companyId === co && j.status === 'active').flatMap((j) => j.items.filter((i) => i.assigneeUserId === u.id && i.status !== 'skipped' && !i.system).map((i) => i.id)).sort()
        expect((mine.body as { item: { id: string } }[]).map((t) => t.item.id).sort()).toEqual(expectedMine)
        expect(templates.status).toBe(scope === 'full' ? 200 : 403)
        expect((await call(u, 'POST', '/hr/journeys', { employee_id: sales.employeeId, kind: 'onboarding' })).status).toBe(scope === 'full' ? 409 : 403)
        if (ids === null) {
          expect(list.status).toBe(403)
          expect((await call(u, 'GET', `/hr/journeys/${team.id}`)).status).toBe(403)
        } else {
          expect(list.status).toBe(200)
          const want = hrJourneys.filter((j) => j.companyId === co && ids.has(j.employeeId)).map((j) => j.id).sort()
          expect((list.body as { id: string }[]).map((r) => r.id).sort()).toEqual(want)
          for (const j of [team, sales]) expect((await call(u, 'GET', `/hr/journeys/${j.id}`)).status, j.id).toBe(ids.has(j.employeeId) ? 200 : 404)
        }
        // Ticking: the joiner's Employee / Manager / HR items, and the Sales joiner's Manager item.
        const tick = (j: JourneyRecord, role: string) => call(u, 'POST', `/hr/journeys/${j.id}/items/${itemOf(j, role).id}/complete`)
        const inTeam = !!ids?.has(team.employeeId)
        const expectFor = (j: JourneyRecord, ownerRole: string): number => {
          const item = itemOf(j, ownerRole)
          if (item.assigneeUserId === u.id) return 200
          const visible = !!ids?.has(j.employeeId)
          if (!visible) return 404
          if (scope === 'full') return 200
          if (ownerRole === 'manager' && scope === 'team') return 200
          return 403
        }
        const want = { emp: expectFor(team, 'employee'), mgr: expectFor(team, 'manager'), hr: expectFor(team, 'hr'), sales: expectFor(sales, 'manager') }
        const got = { emp: (await tick(team, 'employee')).status, mgr: (await tick(team, 'manager')).status, hr: (await tick(team, 'hr')).status, sales: (await tick(sales, 'manager')).status }
        expect(got, `${role} in team: ${inTeam}`).toEqual(want)
        // HR-only actions.
        expect((await call(u, 'POST', `/hr/journeys/${team.id}/items`, { title: 'Probe', owner_role: 'hr' })).status).toBe(scope === 'full' ? 200 : ids?.has(team.employeeId) ? 403 : ids ? 404 : 403)
      })
    }
  }
})

describe('the joiner and the hidden-scope manager', () => {
  for (const co of COMPANIES) {
    it(`${co}: the joiner ticks only their own Employee items; sees only their journey`, async () => {
      const { joiner, team, sales } = scenario[co]
      const empItems = team.items.filter((i) => i.ownerRole === 'employee')
      expect(empItems.length).toBeGreaterThan(0)
      for (const i of empItems) expect((await call(joiner, 'POST', `/hr/journeys/${team.id}/items/${i.id}/complete`)).status).toBe(200)
      expect((await call(joiner, 'POST', `/hr/journeys/${team.id}/items/${itemOf(team, 'manager').id}/complete`)).status).toBe(403)
      expect((await call(joiner, 'POST', `/hr/journeys/${team.id}/items/${itemOf(team, 'hr').id}/complete`)).status).toBe(403)
      expect((await call(joiner, 'POST', `/hr/journeys/${team.id}/activate`)).status).toBe(403)
      expect((await call(joiner, 'GET', `/hr/journeys/${sales.id}`)).status).toBe(404)
      expect(((await call(joiner, 'GET', '/hr/journeys')).body as { id: string }[]).map((r) => r.id)).toEqual([team.id])
      const tasks = (await call(joiner, 'GET', '/hr/journeys/my-tasks')).body as { self: boolean; item: { status: string; can_complete: boolean } }[]
      expect(tasks.length).toBe(empItems.length)
      expect(tasks.every((t) => t.self && t.item.status === 'done')).toBe(true)
    })

    it(`${co}: the Sales Manager (hr hidden) ticks the Manager items assigned to them, nothing else`, async () => {
      const { sales } = scenario[co]
      const sm = users.find((u) => u.id === HEAD_DEPT[co].salesManager)!
      expect(scopeOf(roleOf(sm), 'hr')).toBe('hidden')
      const tasks = (await call(sm, 'GET', '/hr/journeys/my-tasks')).body as { journey_id: string; item: { id: string; can_complete: boolean } }[]
      expect(tasks.length).toBeGreaterThan(0)
      expect(tasks.every((t) => t.journey_id === sales.id && t.item.can_complete)).toBe(true)
      const r = await call(sm, 'POST', `/hr/journeys/${sales.id}/items/${tasks[0].item.id}/complete`)
      expect(r.status).toBe(200)
      expect(r.body.item.status).toBe('done')
      expect((await call(sm, 'POST', `/hr/journeys/${sales.id}/items/${itemOf(sales, 'hr').id}/complete`)).status).toBe(404)
      expect((await call(sm, 'GET', `/hr/journeys/${sales.id}`)).status).toBe(403)
    })
  }
})

describe('plan gate and cross-company', () => {
  it('Crest without the hr module: 403 module_not_in_plan for every role, the inbox included', async () => {
    expect(restoreSnapshot(seed)).toBe(true)
    ensureRoleUsers()
    for (const role of ROLES) {
      const u = users.find((x) => x.companyId === 'co_crest' && x.active && roleOf(x) === role)!
      for (const path of ['/hr/journeys', '/hr/journeys/my-tasks']) {
        const r = await call(u, 'GET', path)
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('module_not_in_plan')
      }
    }
  })

  it('another company’s journey / item id answers 404 like a missing one; a spoofed company is ignored', async () => {
    const admin = users.find((u) => u.id === 'u1')!
    const crest = scenario.co_crest.team
    const missing = await call(admin, 'GET', '/hr/journeys/JRN-zz')
    const theirs = await call(admin, 'GET', `/hr/journeys/${crest.id}`)
    expect(theirs.status).toBe(404)
    expect(theirs.body).toEqual(missing.body)
    const apex = scenario.co_apex.team
    expect((await call(admin, 'POST', `/hr/journeys/${apex.id}/items/${crest.items[0].id}/complete`)).status).toBe(404)
    expect((await call(admin, 'POST', `/hr/journeys/${crest.id}/items/${crest.items[0].id}/complete`)).status).toBe(404)
    const spoof = await call(users.find((u) => u.id === 'u101')!, 'POST', '/hr/journeys/templates', { kind: 'onboarding', name: 'Spoof', company_id: 'co_apex', companyId: 'co_apex', items: [{ title: 'Step', owner_role: 'hr', due_offset_days: 0 }] })
    expect(spoof.status).toBe(200)
    expect((await call(admin, 'GET', '/hr/journeys/templates')).body.some((t: { name: string }) => t.name === 'Spoof')).toBe(false)
  })
})
