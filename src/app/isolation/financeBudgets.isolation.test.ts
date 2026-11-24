import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { finBudgets } from '@/shared/mocks/data/financeBudgets'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Budgets and Cash-flow forecast — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting`) plus the
 * department-head rule:
 *   full    (Company Admin, Management, Accountant) reads and edits budgets; approve / reopen: Company Admin and
 *           Management only (Accountant → 403 approve_forbidden); reads and edits the forecast
 *   view    (Sales Manager) reads every budget, budget vs actual and the forecast; writes 403
 *   hidden  forecast 403; budgets 403 — UNLESS the user heads a department: then their own department's lines and
 *           budget vs actual only (another department → 404), no writes
 * Every role × both companies, plus the seeded heads (Apex: Delivery u10 Department Head, Marketing u7 Marketing
 * Manager, HR u9 HR Manager; Crest: Operations u106).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = { id: `u-finbud-${co}-${slug}`, companyId: co, name: `Budget ${role} ${co}`, email: `finbud-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}
beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})
const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const byId = (id: string) => users.find((x) => x.id === id)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const headed = (co: Co, u: User) => departments.filter((d) => d.companyId === co && d.headId === u.id && d.active !== false).map((d) => d.id)
const seededBudget = (co: Co) => finBudgets.find((b) => b.companyId === co && b.status === 'approved')!

describe('budgets and forecast: scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        runFinanceHooks(co)
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const heads = headed(co, u)
        const bud = seededBudget(co)
        const canRead = scope !== 'hidden' || heads.length > 0
        for (const p of ['/finance/budgets', `/finance/budgets/${bud.id}`, `/finance/budgets/${bud.id}/vs-actual`]) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(canRead ? 200 : 403)
        }
        if (scope === 'hidden' && heads.length) {
          const d = await call(u, 'GET', `/finance/budgets/${bud.id}`)
          expect(d.body.lines.every((l: { department_id: string }) => heads.includes(l.department_id))).toBe(true)
        }
        const fc = await call(u, 'GET', '/finance/forecast')
        expect(fc.status, `${role} forecast`).toBe(scope === 'hidden' ? 403 : 200)
        const writes: [string, string, unknown][] = [
          ['POST', '/finance/budgets', { fiscal_year: bud.fiscalYear + 1 }],
          ['PUT', '/finance/forecast/settings', { inflow_adjust_pct: 0 }],
          ['POST', '/finance/forecast/lines', { label: 'Role test', date: fc.status === 200 ? fc.body.today : new Date().toISOString().slice(0, 10), amount: -1 }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'full' ? 200 : 403)
        }
        // Approve / reopen: Company Admin and Management only.
        const reopen = await call(u, 'POST', `/finance/budgets/${bud.id}/reopen`)
        const approver = scope === 'full' && (roleOf(u) === 'Company Admin' || roleOf(u) === 'Management')
        expect(reopen.status, `${role} reopen`).toBe(approver ? 200 : 403)
        if (scope === 'full' && !approver) expect(reopen.body.code).toBe('approve_forbidden')
      })
    }
  }
})

describe('department heads see their own department only', () => {
  const cases: [Co, string, string][] = [
    ['co_apex', 'u10', 'd-delivery'],
    ['co_apex', 'u7', 'd-marketing'],
    ['co_apex', 'u9', 'd-hr'],
    ['co_crest', 'u106', 'c2-ops'],
  ]
  for (const [co, id, dept] of cases) {
    it(`${co} · ${id} heads ${dept}`, async () => {
      runFinanceHooks(co)
      const u = byId(id)
      expect(scopeOf(roleOf(u), 'accounting')).toBe('hidden')
      const bud = seededBudget(co)
      const list = await call(u, 'GET', '/finance/budgets')
      expect(list.status).toBe(200)
      expect(list.body.every((b: { department_scoped: boolean }) => b.department_scoped)).toBe(true)
      const d = await call(u, 'GET', `/finance/budgets/${bud.id}`)
      expect(d.body.lines.length).toBeGreaterThan(0)
      expect(new Set(d.body.lines.map((l: { department_id: string }) => l.department_id))).toEqual(new Set([dept]))
      expect(d.body.departments.map((x: { id: string }) => x.id)).toEqual([dept])
      expect(d.body.history).toEqual([])
      const v = await call(u, 'GET', `/finance/budgets/${bud.id}/vs-actual`)
      expect(v.body.rows.every((r: { department_id: string }) => r.department_id === dept)).toBe(true)
      expect(v.body.departments.every((r: { department_id: string }) => r.department_id === dept)).toBe(true)
      // Their own department as a filter works; another department answers like a missing one.
      expect((await call(u, 'GET', `/finance/budgets/${bud.id}/vs-actual?department_id=${dept}`)).status).toBe(200)
      const otherDept = departments.find((x) => x.companyId === co && x.id !== dept)!.id
      const other = await call(u, 'GET', `/finance/budgets/${bud.id}/vs-actual?department_id=${otherDept}`)
      const missing = await call(u, 'GET', `/finance/budgets/${bud.id}/vs-actual?department_id=d-missing`)
      expect(other.status).toBe(404)
      expect(other.body).toEqual(missing.body)
      // No writes, no forecast, nothing of the other company.
      expect((await call(u, 'PUT', `/finance/budgets/${bud.id}/lines`, { lines: [{ department_id: dept, account_id: 'ACC-6600', annual: 1 }] })).status).toBe(403)
      expect((await call(u, 'GET', '/finance/forecast')).status).toBe(403)
      const foreign = finBudgets.find((b) => b.companyId !== co)!
      expect((await call(u, 'GET', `/finance/budgets/${foreign.id}`)).status).toBe(404)
    })
  }

  it('an employee who heads nothing is refused (403)', async () => {
    const r = await call(byId('u11'), 'GET', '/finance/budgets')
    expect(r.status).toBe(403)
  })
})
