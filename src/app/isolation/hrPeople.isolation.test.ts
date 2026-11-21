import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts } from '@/shared/mocks/data/hrPeople'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * HR › Employees, Employee contracts, Company assets — TABLE-DRIVEN FROM PERMISSION_MATRIX (`hr` column;
 * docs/API.md › HR):
 *   full    every employee / contract / asset of the company; the only writers; reveal; export
 *   team    own record + employees of the departments they head (+ sub-departments) + direct reports; pay hidden
 *   own     their own record; their own pay visible
 *   hidden  403 everywhere
 * Every role × both companies (Crest gets `hr` through a platform module override; without it → 403
 * module_not_in_plan). Plus: foreign ids in bodies behave like missing ones; spoofed company fields are ignored.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function hrOnForCrest(): void {
  moduleOverrides.push({ companyId: 'co_crest', module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
}

/** A user for every role in both companies (with an employee record, like every seeded user). */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-hrp-${co}-${slug}`,
        companyId: co,
        name: `People ${role} ${co}`,
        email: `hrp-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: '',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      addMembership(user.id, co, role)
      createEmployee(co, { fullName: user.name, jobTitle: role, hireDate: '2025-01-01', userId: user.id, nationality: co === 'co_apex' ? 'AE' : 'SA' }, null)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  hrOnForCrest()
  ensureRoleUsers()
})

function userFor(co: Co, role: Role): User {
  return users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
}

const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

/** Independent recomputation of the employees a user may see (the matrix + departments + reporting lines). */
function expectedIds(u: User): string[] | null {
  const scope = scopeOf(roleOf(u), 'hr')
  const all = hrEmployees.filter((e) => e.companyId === u.companyId)
  if (scope === 'hidden') return null
  if (scope === 'full') return all.map((e) => e.id).sort()
  const me = all.find((e) => e.userId === u.id)
  if (scope === 'own') return me ? [me.id] : []
  const deps = departments.filter((d) => d.companyId === u.companyId)
  const headed = new Set(deps.filter((d) => d.active && d.headId === u.id).flatMap((d) => departmentSubtree(d.id, deps)))
  return all.filter((e) => e.id === me?.id || (e.departmentId && headed.has(e.departmentId)) || (me && e.managerId === me.id)).map((e) => e.id).sort()
}

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
        const want = expectedIds(u)
        const list = await call(u, 'GET', '/hr/employees')
        const contracts = await call(u, 'GET', '/hr/contracts')
        const assets = await call(u, 'GET', '/hr/assets')
        const create = await call(u, 'POST', '/hr/employees', { full_name: 'Scope Probe', job_title: 'Probe', hire_date: '2026-01-05', nationality: 'AE' })
        const exportRes = await call(u, 'GET', '/hr/employees/export')
        if (want === null) {
          for (const r of [list, contracts, assets, create, exportRes]) expect(r.status, role).toBe(403)
          return
        }
        expect(list.status).toBe(200)
        expect((list.body as { id: string }[]).map((r) => r.id).sort()).toEqual(want)
        const ids = new Set(want)
        const myContracts = hrContracts.filter((c) => c.companyId === co && ids.has(c.employeeId)).map((c) => c.id).sort()
        expect((contracts.body as { id: string }[]).map((c) => c.id).sort()).toEqual(myContracts)
        const full = scopeOf(roleOf(u), 'hr') === 'full'
        const self = hrEmployees.find((e) => e.companyId === co && e.userId === u.id)
        for (const c of contracts.body as { employee_id: string; salary_visible: boolean; basic_salary: number | null }[]) {
          const visible = full || c.employee_id === self?.id
          expect(c.salary_visible, `${role} pay of ${c.employee_id}`).toBe(visible)
          if (!visible) expect(c.basic_salary).toBeNull()
        }
        const myAssets = hrAssets.filter((a) => a.companyId === co && (full || (a.status === 'assigned' && ids.has(a.assignments[a.assignments.length - 1].employeeId)))).length
        expect((assets.body as unknown[]).length).toBe(myAssets)
        expect(create.status).toBe(full ? 200 : 403)
        expect(exportRes.status).toBe(full ? 200 : 403)
        // Outside the scope: 404 like a missing id; inside: masked numbers, reveal only for full.
        const outside = full ? undefined : hrEmployees.find((e) => e.companyId === co && !ids.has(e.id))
        if (outside) expect((await call(u, 'GET', `/hr/employees/${outside.id}`)).status).toBe(404)
        const inside = await call(u, 'GET', `/hr/employees/${want[0]}`)
        expect(inside.status).toBe(200)
        for (const d of inside.body.documents) {
          expect(d.number_masked).toMatch(/^•+( .{4})?$/)
          expect((await call(u, 'POST', `/hr/documents/${d.id}/reveal`)).status).toBe(full ? 200 : 403)
        }
        expect((await call(u, 'PATCH', `/hr/employees/${want[0]}`, { job_title: 'Changed' })).status).toBe(full ? 200 : 403)
      })
    }
  }
})

describe('plan gate', () => {
  it('Crest (Business, no hr) answers 403 module_not_in_plan to every role; Apex (Enterprise) answers', async () => {
    expect(restoreSnapshot(seed)).toBe(true)
    ensureRoleUsers()
    for (const role of ROLES) {
      const r = await call(userFor('co_crest', role), 'GET', '/hr/employees')
      expect(r.status).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
      expect((await call(userFor('co_crest', role), 'GET', '/hr/assets')).body.code).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_apex', 'HR Manager'), 'GET', '/hr/employees')).status).toBe(200)
  })
})

describe('ids of the other company in a body behave like missing ids; spoofed company fields are ignored', () => {
  const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  const emp = (co: Co) => hrEmployees.find((e) => e.companyId === co && e.userId && e.userId !== ADMIN[co])!
  const stock = (co: Co) => hrAssets.find((a) => a.companyId === co && a.status === 'in_stock')!
  const cases: { name: string; send: (co: Co, id: string) => Promise<{ status: number; body: unknown }>; id: (co: Co) => string }[] = [
    { name: 'contract employee', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', '/hr/contracts', { employee_id: id, type: 'unlimited', start_date: '2027-01-01' }) },
    { name: 'asset assignee', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', `/hr/assets/${stock(co).id}/assign`, { employee_id: id, date: '2026-11-01', condition: 'good' }) },
    { name: 'employee manager', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'PATCH', `/hr/employees/${emp(co).id}`, { manager_id: id }) },
    { name: 'employee department', id: (co) => departments.find((d) => d.companyId === co && d.active)!.id, send: (co, id) => call(admin(co), 'PATCH', `/hr/employees/${emp(co).id}`, { department_id: id }) },
    { name: 'linked user', id: (co) => ADMIN[co], send: (co, id) => call(admin(co), 'POST', `/hr/employees/${hrEmployees.find((e) => e.companyId === co && !e.userId)!.id}/link-user`, { user_id: id }) },
    { name: 'contracts filter', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'GET', `/hr/contracts?employee_id=${id}`) },
  ]
  for (const c of cases) {
    for (const co of COMPANIES) {
      it(`${co}: ${c.name} of ${other(co)}`, async () => {
        const start = takeSnapshot(true)
        const theirs = await c.send(co, c.id(other(co)))
        restoreSnapshot(start)
        const missing = await c.send(co, 'zz-missing')
        expect(theirs.status).toBe(missing.status)
        expect(JSON.stringify(theirs.body).split(c.id(other(co))).join('<id>')).toBe(JSON.stringify(missing.body).split('zz-missing').join('<id>'))
        expect(JSON.stringify(theirs.body)).not.toContain(other(co))
      })
    }
  }

  it('a spoofed company id in a create lands in the caller’s company only', async () => {
    const r = await call(admin('co_crest'), 'POST', '/hr/employees', { full_name: 'Spoof Probe', job_title: 'X', hire_date: '2026-01-05', nationality: 'SA', company_id: 'co_apex', companyId: 'co_apex' })
    expect(r.status).toBe(200)
    expect(hrEmployees.find((e) => e.id === r.body.id)?.companyId).toBe('co_crest')
    expect(r.body.employee_no).toMatch(/^CRS-/)
  })
})
