import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { contractCoversMonth, employedOn, monthlyPay } from '@/modules/hr/reports/calc'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts, hrDocuments, hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrReportSettings } from '@/shared/mocks/data/hrReports'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * HR › Reports — TABLE-DRIVEN FROM PERMISSION_MATRIX (`hr` column; docs/API.md › HR › HR reports):
 *   full    every report of the whole company, incl. Payroll cost and training spend; edits the targets
 *   team    every report limited to the departments they head (+ sub-departments); never pay (Payroll cost 403,
 *           spend / payroll null); the department filter only accepts those departments (others 404)
 *   own     403 (employees have no reports)
 *   hidden  403
 * Every role × both companies (Crest gets `hr` through a platform module override; without it → 403
 * module_not_in_plan). Exports follow the same scope and never carry document numbers, IBANs or pay.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'team', 'own', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const REPORTS = ['overview', 'headcount', 'turnover', 'nationalisation', 'attendance', 'leave', 'compliance', 'assets', 'recruitment', 'training', 'payroll-cost'] as const
const PAY_REPORTS = ['payroll-cost']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)
const year = (co: Co) => today(co).slice(0, 4)
const range = (co: Co) => `from=${year(co)}-01-01&to=${year(co)}-12-31`

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
        id: `u-hrr-${co}-${slug}`,
        companyId: co,
        name: `Reports ${role} ${co}`,
        email: `hrr-${slug}@${co}.test`,
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

/** Independent recomputation: the departments a Department Head reports on. */
function headedDepts(u: User): Set<string> {
  const deps = departments.filter((d) => d.companyId === u.companyId)
  return new Set(deps.filter((d) => d.active && d.headId === u.id).flatMap((d) => departmentSubtree(d.id, deps)))
}
function expectedHeadcount(u: User, co: Co): number {
  const scope = scopeOf(roleOf(u), 'hr')
  const heads = scope === 'team' ? headedDepts(u) : null
  return hrEmployees.filter((e) => e.companyId === co && employedOn(e, today(co)) && (!heads || (e.departmentId !== null && heads.has(e.departmentId)))).length
}

/** Every key anywhere in a JSON value. */
function keysIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysIn(x, out))
  return out
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
        const scope = scopeOf(roleOf(u), 'hr')
        const options = await call(u, 'GET', '/hr/reports/options')
        const settings = await call(u, 'PUT', '/hr/reports/settings', { nationalisation_target_pct: 20 })
        if (scope === 'hidden' || scope === 'own') {
          expect(options.status, role).toBe(403)
          expect(settings.status, role).toBe(403)
          for (const r of REPORTS) {
            expect((await call(u, 'GET', `/hr/reports/${r}?${range(co)}`)).status, `${role} ${r}`).toBe(403)
            expect((await call(u, 'GET', `/hr/reports/${r}/export?${range(co)}`)).status, `${role} ${r} export`).toBe(403)
          }
          return
        }
        expect(options.status).toBe(200)
        expect(settings.status).toBe(scope === 'full' ? 200 : 403)
        expect(options.body.scope).toBe(scope)
        expect(options.body.reports.includes('payroll-cost')).toBe(scope === 'full')
        for (const r of REPORTS) {
          const res = await call(u, 'GET', `/hr/reports/${r}?${range(co)}`)
          const exp = await call(u, 'GET', `/hr/reports/${r}/export?${range(co)}`)
          const want = scope === 'team' && PAY_REPORTS.includes(r) ? 403 : 200
          expect(res.status, `${role} ${r}`).toBe(want)
          expect(exp.status, `${role} ${r} export`).toBe(want)
          if (want !== 200) continue
          // Nothing of the other company, anywhere.
          const text = JSON.stringify([res.body, exp.body])
          expect(text).not.toContain(other(co))
          for (const e of hrEmployees.filter((x) => x.companyId === other(co))) expect(text, `${r}: ${e.id}`).not.toContain(`"${e.id}"`)
        }
        const head = await call(u, 'GET', `/hr/reports/headcount?${range(co)}`)
        expect(head.body.total).toBe(expectedHeadcount(u, co))
        expect((await call(u, 'GET', `/hr/reports/headcount/export?${range(co)}`)).body.rows).toHaveLength(expectedHeadcount(u, co))
      })
    }
  }
})

describe('Department Head never sees pay and only their departments', () => {
  const heads: Record<Co, string> = { co_apex: 'u10', co_crest: 'u106' }
  for (const co of COMPANIES) {
    it(`${co}: ${heads[co]}`, async () => {
      const u = users.find((x) => x.id === heads[co])!
      expect(scopeOf(roleOf(u), 'hr')).toBe('team')
      const mine = headedDepts(u)
      expect(mine.size).toBeGreaterThan(0)
      const names = new Set(departments.filter((d) => mine.has(d.id)).map((d) => d.name))

      const options = await call(u, 'GET', '/hr/reports/options')
      expect(options.body.departments.map((d: { id: string }) => d.id).sort()).toEqual([...mine].sort())
      expect(options.body.can_edit_settings).toBe(false)

      const head = await call(u, 'GET', `/hr/reports/headcount?${range(co)}`)
      for (const row of head.body.by_department) expect(names.has(row.label), row.label).toBe(true)

      // Pay: no payroll report or export, nothing pay-like anywhere else.
      expect((await call(u, 'GET', `/hr/reports/payroll-cost?${range(co)}`)).status).toBe(403)
      expect((await call(u, 'GET', `/hr/reports/payroll-cost/export?${range(co)}`)).status).toBe(403)
      const overview = await call(u, 'GET', `/hr/reports/overview?${range(co)}`)
      expect(overview.body.monthly_payroll_cost).toBeNull()
      const training = await call(u, 'GET', `/hr/reports/training?${range(co)}`)
      expect([training.body.spend, training.body.year_spend, training.body.budget]).toEqual([null, null, null])
      const salaries = new Set(hrContracts.filter((c) => c.companyId === co).flatMap((c) => [c.basicSalary, monthlyPay(c)]))
      for (const r of REPORTS.filter((x) => !PAY_REPORTS.includes(x))) {
        const body = (await call(u, 'GET', `/hr/reports/${r}?${range(co)}`)).body
        const exp = (await call(u, 'GET', `/hr/reports/${r}/export?${range(co)}`)).body
        for (const k of [...keysIn(body), ...keysIn(exp)]) expect(k, `${r}: key ${k}`).not.toMatch(/salary|iban|allowance|basic/)
        expect(exp.headers.join('|'), r).not.toMatch(/salary|pay|IBAN|allowance/i)
        // No department outside theirs in any department breakdown.
        for (const list of ['by_department']) for (const row of (body[list] ?? []) as { label: string }[]) expect(names.has(row.label), `${r}: ${row.label}`).toBe(true)
      }
      // Payroll-sized numbers never show in the headcount export (salaries are 4–5 digit amounts; a coincidence with
      // a count is impossible at this size).
      const exp = await call(u, 'GET', `/hr/reports/headcount/export?${range(co)}`)
      for (const row of exp.body.rows as (string | number | null)[][]) for (const cell of row) if (typeof cell === 'number') expect(salaries.has(cell)).toBe(false)

      // Another department (theirs or another company's) answers 404 like a missing one.
      const outside = departments.find((d) => d.companyId === co && d.active && !mine.has(d.id))!
      const foreign = departments.find((d) => d.companyId === other(co) && d.active)!
      const a = await call(u, 'GET', `/hr/reports/headcount?${range(co)}&department_id=${outside.id}`)
      const b = await call(u, 'GET', `/hr/reports/headcount?${range(co)}&department_id=${foreign.id}`)
      const c = await call(u, 'GET', `/hr/reports/headcount?${range(co)}&department_id=zz-missing`)
      expect([a.status, b.status, c.status]).toEqual([404, 404, 404])
      expect(a.body).toEqual(c.body)
      expect(b.body).toEqual(c.body)
      // Their own department works.
      const own = [...mine][0]
      expect((await call(u, 'GET', `/hr/reports/headcount?${range(co)}&department_id=${own}`)).status).toBe(200)
      // Targets are HR's.
      expect((await call(u, 'PUT', '/hr/reports/settings', { nationalisation_target_pct: 50 })).status).toBe(403)
    })
  }
})

describe('HR full: the numbers equal an own recomputation', () => {
  for (const co of COMPANIES) {
    it(`${co}: headcount, nationalisation and committed payroll`, async () => {
      const admin = users.find((x) => x.id === ADMIN[co])!
      const country = companyById(co)!.regional.country
      const t = today(co)
      const staff = hrEmployees.filter((e) => e.companyId === co && employedOn(e, t))
      const head = await call(admin, 'GET', `/hr/reports/headcount?${range(co)}`)
      expect(head.body.total).toBe(staff.length)
      expect(head.body.by_department.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(staff.length)

      const nat = await call(admin, 'GET', `/hr/reports/nationalisation?${range(co)}`)
      expect(nat.body.label).toBe(country === 'AE' ? 'Emiratisation' : 'Saudization')
      expect(nat.body.nationals).toBe(staff.filter((e) => e.nationality === country).length)
      expect(nat.body.disclaimer).toMatch(/not an official/i)

      const month = t.slice(0, 7)
      const pay = await call(admin, 'GET', `/hr/reports/payroll-cost?from=${month}-01&to=${month}-28`)
      expect(pay.status).toBe(200)
      const expected = staff.reduce((s, e) => {
        const c = hrContracts.filter((x) => x.companyId === co && x.employeeId === e.id && contractCoversMonth(x, month)).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
        return s + (c ? monthlyPay(c) : 0)
      }, 0)
      expect(pay.body.current_monthly).toBeCloseTo(expected, 2)
      expect(pay.body.source).toBe('contracts')

      // A month with a paid payroll run: gross pay from the run lines (Salary Management), source payroll_runs.
      const paid = hrPayrollRuns.filter((r) => r.companyId === co && r.status === 'paid').sort((x, y) => y.month.localeCompare(x.month))[0]
      const fromRun = await call(admin, 'GET', `/hr/reports/payroll-cost?from=${paid.month}-01&to=${paid.month}-28`)
      expect(fromRun.status).toBe(200)
      expect(fromRun.body.source).toBe('payroll_runs')
      const ids = new Set(hrEmployees.filter((e) => e.companyId === co).map((e) => e.id))
      expect(fromRun.body.current_monthly).toBeCloseTo(paid.lines.filter((l) => ids.has(l.employeeId)).reduce((s, l) => s + l.gross, 0), 2)
    })

    it(`${co}: exports never carry document numbers or IBANs`, async () => {
      const admin = users.find((x) => x.id === ADMIN[co])!
      const secrets = [...hrDocuments.filter((d) => d.companyId === co).map((d) => d.number), ...hrProfiles.filter((p) => p.companyId === co && p.iban).map((p) => p.iban)]
      expect(secrets.length).toBeGreaterThan(0)
      for (const r of REPORTS) {
        const text = JSON.stringify((await call(admin, 'GET', `/hr/reports/${r}/export?${range(co)}`)).body) + JSON.stringify((await call(admin, 'GET', `/hr/reports/${r}?${range(co)}`)).body)
        for (const s of secrets) expect(text, `${r}`).not.toContain(s)
      }
    })
  }
})

describe('settings are per company; spoofed company fields are ignored', () => {
  it('a target set by Crest’s HR (with company_id of Apex) only changes Crest', async () => {
    const crest = users.find((x) => x.id === ADMIN.co_crest)!
    const apex = users.find((x) => x.id === ADMIN.co_apex)!
    const before = (await call(apex, 'GET', `/hr/reports/nationalisation?${range('co_apex')}`)).body.target_pct
    const r = await call(crest, 'PUT', '/hr/reports/settings', { nationalisation_target_pct: 33.3, training_budget: { year: Number(year('co_crest')), amount: 75000 }, company_id: 'co_apex', companyId: 'co_apex' })
    expect(r.status).toBe(200)
    expect(r.body.nationalisation_target_pct).toBe(33.3)
    expect(hrReportSettings.filter((s) => s.companyId === 'co_apex').every((s) => s.nationalisationTargetPct !== 33.3)).toBe(true)
    expect((await call(crest, 'GET', `/hr/reports/nationalisation?${range('co_crest')}`)).body.target_pct).toBe(33.3)
    expect((await call(crest, 'GET', `/hr/reports/training?${range('co_crest')}`)).body.budget).toBe(75000)
    expect((await call(apex, 'GET', `/hr/reports/nationalisation?${range('co_apex')}`)).body.target_pct).toBe(before)
  })
  it('validation: a target outside 0–100, a bad range, an unknown report', async () => {
    const apex = users.find((x) => x.id === ADMIN.co_apex)!
    expect((await call(apex, 'PUT', '/hr/reports/settings', { nationalisation_target_pct: 120 })).status).toBe(422)
    expect((await call(apex, 'GET', '/hr/reports/headcount?from=2026-05-01&to=2026-04-01')).status).toBe(422)
    expect((await call(apex, 'GET', '/hr/reports/salaries/export')).status).toBe(404)
  })
})

describe('plan gate', () => {
  it('Crest (Business, no hr) answers 403 module_not_in_plan to every role; Apex answers', async () => {
    expect(restoreSnapshot(seed)).toBe(true)
    ensureRoleUsers()
    for (const role of ROLES) {
      const r = await call(userFor('co_crest', role), 'GET', '/hr/reports/overview')
      expect(r.status).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_apex', 'HR Manager'), 'GET', '/hr/reports/overview')).status).toBe(200)
  })
})
