import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { contractCoversMonth, monthlyPay } from '@/modules/hr/reports/calc'
import { DEFAULT_STANDARD_HOURS } from '@/modules/finance/profitability/calc'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { projects, timeEntries } from '@/shared/mocks/data/tasks'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { profitSettings } from '@/shared/mocks/data/financeProfitability'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Profitability — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting` column; docs/API.md › Finance ›
 * Profitability):
 *   full    every report incl. the labour allocation; edits the settings (standard hours, alert thresholds)
 *   view    every report, labour cost null everywhere (margins before labour); settings 403
 *   hidden  403 everywhere
 * Every role × both companies. Plan gate: without `accounting` every role gets 403 module_not_in_plan. No response ever
 * carries a rate, a salary or a cost per employee (labour is aggregated per project / customer / month).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const READS = ['options', 'projects', 'events', 'customers', 'departments', 'projects/export', 'events/export', 'customers/export', 'departments/export'] as const

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)
const range = (co: Co) => `from=${today(co).slice(0, 4)}-01-01&to=${today(co).slice(0, 4)}-12-31`

/** A user for every role in both companies. */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-prf-${co}-${slug}`,
        companyId: co,
        name: `Profit ${role} ${co}`,
        email: `prf-${slug}@${co}.test`,
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
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})

const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const admin = (co: Co) => users.find((x) => x.id === ADMIN[co])!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

function keysIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysIn(x, out))
  return out
}
/** Every value of a key anywhere in a JSON value. */
function valuesOf(v: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) v.forEach((x) => valuesOf(x, key, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === key && out.push(x), valuesOf(x, key, out))
  return out
}

/** Own recomputation: labour cost of a project this year (time entries × monthly pay ÷ standard hours). */
function expectedLabour(co: Co, projectId: string, std = DEFAULT_STANDARD_HOURS): number {
  const y = today(co).slice(0, 4)
  let cost = 0
  for (const t of timeEntries) {
    if (t.companyId !== co || t.projectId !== projectId || !t.entryDate.startsWith(y)) continue
    const emp = hrEmployees.find((e) => e.companyId === co && e.userId === t.userId)
    const month = t.entryDate.slice(0, 7)
    const c = emp ? hrContracts.filter((x) => x.companyId === co && x.employeeId === emp.id && contractCoversMonth(x, month)).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] : undefined
    if (c) cost += (t.hours * monthlyPay(c)) / std
  }
  return Math.round(cost * 100) / 100
}

/** Own recomputation: income tagged with the project this year. */
function expectedRevenue(co: Co, projectId: string): number {
  runFinanceHooks(co)
  const y = today(co).slice(0, 4)
  const income = new Set(financeAccounts.filter((a) => a.companyId === co && a.type === 'income').map((a) => a.id))
  let s = 0
  for (const e of financeJournal) {
    if (e.companyId !== co || !e.date.startsWith(y) || e.sourceType === 'year_end_close') continue
    for (const l of e.lines) if (income.has(l.accountId) && l.projectId === projectId) s += l.credit - l.debit
  }
  return Math.round(s * 100) / 100
}

describe('the accounting column only uses handled scopes', () => {
  it('every role’s accounting scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].accounting)
  })
})

describe('scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const project = projects.find((p) => p.companyId === co)!
        const settings = await call(u, 'PUT', '/finance/profitability/settings', { standard_hours_per_month: 170 })
        const detail = await call(u, 'GET', `/finance/profitability/projects/${project.id}?${range(co)}`)
        if (scope === 'hidden') {
          expect(settings.status).toBe(403)
          expect(detail.status).toBe(403)
          for (const r of READS) expect((await call(u, 'GET', `/finance/profitability/${r}?${range(co)}`)).status, `${role} ${r}`).toBe(403)
          return
        }
        expect(settings.status).toBe(scope === 'full' ? 200 : 403)
        expect(detail.status).toBe(200)
        const bodies = [detail.body]
        for (const r of READS) {
          const res = await call(u, 'GET', `/finance/profitability/${r}?${range(co)}`)
          expect(res.status, `${role} ${r}`).toBe(200)
          bodies.push(res.body)
        }
        const text = JSON.stringify(bodies)
        expect(text).not.toContain(other(co))
        for (const p of projects.filter((x) => x.companyId === other(co))) expect(text).not.toContain(`"${p.id}"`)
        // Never a rate, a salary or a per-employee cost.
        for (const k of keysIn(bodies)) expect(k, `key ${k}`).not.toMatch(/salary|hourly|rate$|employee|allowance|basic|monthly_pay/)
        expect(text).not.toMatch(/Hourly|Salary|Employee/)
        const options = bodies[1]
        expect(options.meta.labour_visible).toBe(scope === 'full')
        expect(options.can_edit_settings).toBe(scope === 'full')
        const labour = valuesOf(bodies, 'labour_cost')
        expect(labour.length).toBeGreaterThan(0)
        if (scope === 'view') {
          expect(labour.every((v) => v === null), 'view: labour hidden').toBe(true)
          for (const exp of bodies.filter((b) => b && Array.isArray(b.headers))) expect((exp.headers as string[]).join('|')).not.toMatch(/Labour cost/)
        } else {
          expect(labour.every((v) => typeof v === 'number')).toBe(true)
        }
      })
    }
  }
})

describe('the numbers equal an own recomputation', () => {
  for (const co of COMPANIES) {
    it(`${co}: revenue per project from the journal, labour from time entries × contract pay ÷ standard hours`, async () => {
      const a = admin(co)
      const res = await call(a, 'GET', `/finance/profitability/projects?${range(co)}`)
      expect(res.status).toBe(200)
      expect(res.body.rows).toHaveLength(projects.filter((p) => p.companyId === co).length)
      let anyRevenue = false
      let anyLabour = false
      for (const row of res.body.rows) {
        const rev = expectedRevenue(co, row.project_id)
        expect(row.revenue, row.project_id).toBeCloseTo(rev, 2)
        expect(row.labour_cost, row.project_id).toBeCloseTo(expectedLabour(co, row.project_id), 2)
        expect(row.margin).toBeCloseTo(row.revenue - row.direct_costs - row.labour_cost, 2)
        anyRevenue ||= rev > 0
        anyLabour ||= row.labour_cost > 0
      }
      expect(anyRevenue, 'a seeded invoice bills a project').toBe(true)
      expect(anyLabour, 'seeded time entries carry labour').toBe(true)

      // Standard hours per month change the allocation; another company is untouched (spoofed company ignored).
      const before = (await call(admin(other(co)), 'GET', `/finance/profitability/options`)).body.settings
      const put = await call(a, 'PUT', '/finance/profitability/settings', { standard_hours_per_month: 160, company_id: other(co), companyId: other(co) })
      expect(put.status).toBe(200)
      expect(put.body.standard_hours_per_month).toBe(160)
      expect(profitSettings.filter((s) => s.companyId === other(co))).toHaveLength(0)
      expect((await call(admin(other(co)), 'GET', `/finance/profitability/options`)).body.settings).toEqual(before)
      const after = await call(a, 'GET', `/finance/profitability/projects?${range(co)}`)
      for (const row of after.body.rows) expect(row.labour_cost, row.project_id).toBeCloseTo(expectedLabour(co, row.project_id, 160), 2)
    })

    it(`${co}: a foreign or missing project / filter answers 404 with the same body`, async () => {
      const a = admin(co)
      const foreign = projects.find((p) => p.companyId === other(co))!
      const x = await call(a, 'GET', `/finance/profitability/projects/${foreign.id}`)
      const y = await call(a, 'GET', '/finance/profitability/projects/PRJ-nope')
      expect([x.status, y.status]).toEqual([404, 404])
      expect(x.body).toEqual(y.body)
      const f = await call(a, 'GET', `/finance/profitability/customers?customer_id=${foreign.customerId}`)
      expect(f.status).toBe(404)
      expect((await call(a, 'GET', '/finance/profitability/salaries/export')).status).toBe(404)
      expect((await call(a, 'GET', '/finance/profitability/projects?from=2026-05-01&to=2026-04-01')).status).toBe(422)
      expect((await call(a, 'PUT', '/finance/profitability/settings', { standard_hours_per_month: 5 })).status).toBe(422)
    })
  }
})

describe('plan gate', () => {
  it('without accounting every role answers 403 module_not_in_plan; with it the admin answers', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      const r = await call(userFor('co_crest', role), 'GET', '/finance/profitability/projects')
      expect(r.status, role).toBe(403)
      expect(r.body.code, role).toBe('module_not_in_plan')
    }
    expect((await call(admin('co_apex'), 'GET', '/finance/profitability/projects')).status).toBe(200)
  })
})
