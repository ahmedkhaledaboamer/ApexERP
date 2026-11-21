import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrPayAdjustments, hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { createEmployee } from '@/shared/mocks/services/hrEmployees'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * HR › Salary Management — TABLE-DRIVEN FROM PERMISSION_MATRIX (`hr` column; docs/API.md › HR › Salary management):
 *   full    runs, settings, profiles, adjustments, loans, summary, settlements, bank files, reveal; every payslip
 *   team    (Department Head) only their OWN payslips: never the team's pay; everything else 403
 *   own     (Employee) only their own payslips; everything else 403
 *   hidden  403 everywhere (payslips too)
 * Every role × both companies (Crest gets `hr` through a platform module override; without it → 403
 * module_not_in_plan). Plus maker–checker for every pair of HR-full users, foreign ids in bodies, spoofed company.
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

/** A user for every role in both companies (with an employee record). */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-hrpay-${co}-${slug}`,
        companyId: co,
        name: `Payroll ${role} ${co}`,
        email: `hrpay-${slug}@${co}.test`,
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

const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const paidLines = (co: Co) => hrPayrollRuns.filter((r) => r.companyId === co && r.status === 'paid').flatMap((r) => r.lines.filter((l) => l.paidDays > 0))
const paidRun = (co: Co) => hrPayrollRuns.find((r) => r.companyId === co && r.status === 'paid')!
const draftRun = (co: Co) => hrPayrollRuns.find((r) => r.companyId === co && r.status !== 'paid')!
const month = (n: number) => {
  const d = new Date()
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
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
        const full = scope === 'full'
        const self = hrEmployees.find((e) => e.companyId === co && e.userId === u.id)
        const staff = hrEmployees.find((e) => e.companyId === co && e.userId && e.userId !== u.id && e.status === 'active')!
        const fullOnly: [string, string, unknown?][] = [
          ['GET', '/hr/payroll/runs'],
          ['GET', `/hr/payroll/runs/${paidRun(co).id}`],
          ['GET', '/hr/payroll/settings'],
          ['GET', '/hr/payroll/profiles'],
          ['GET', '/hr/payroll/adjustments'],
          ['GET', '/hr/payroll/loans'],
          ['GET', '/hr/payroll/summary'],
          ['GET', '/hr/payroll/settlements'],
          ['POST', `/hr/payroll/profiles/${staff.id}/reveal`],
          ['POST', `/hr/payroll/runs/${paidRun(co).id}/bank-file`, { format: co === 'co_apex' ? 'wps' : 'mudad' }],
          ['POST', '/hr/payroll/adjustments', { employee_id: staff.id, kind: 'bonus', label: 'Probe', amount: 10, month: month(1) }],
          ['POST', `/hr/payroll/runs/${draftRun(co).id}/calculate`],
        ]
        for (const [m, p, b] of fullOnly) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(full ? 200 : 403)
        }
        const slips = await call(u, 'GET', '/hr/payroll/payslips')
        if (scope === 'hidden') {
          expect(slips.status).toBe(403)
          return
        }
        expect(slips.status).toBe(200)
        const want = paidLines(co).filter((l) => full || l.employeeId === self?.id).map((l) => l.id).sort()
        expect((slips.body as { id: string }[]).map((s) => s.id).sort()).toEqual(want)
        // Someone else's payslip: visible to HR full only (404 like a missing one otherwise).
        const others = paidLines(co).find((l) => l.employeeId !== self?.id)!
        expect((await call(u, 'GET', `/hr/payroll/payslips/${others.id}`)).status).toBe(full ? 200 : 404)
        const own = paidLines(co).find((l) => l.employeeId === self?.id)
        if (own) expect((await call(u, 'GET', `/hr/payroll/payslips/${own.id}`)).status).toBe(200)
      })
    }
  }
})

describe('maker–checker (every pair of HR-full users)', () => {
  for (const co of COMPANIES) {
    it(`${co}: whoever calculates can't approve; any other HR-full user can`, async () => {
      const fullUsers = users.filter((u) => u.companyId === co && u.active && scopeOf(roleOf(u), 'hr') === 'full')
      expect(fullUsers.length).toBeGreaterThanOrEqual(2)
      for (const maker of fullUsers) {
        restoreSnapshot(seed)
        hrOnForCrest()
        ensureRoleUsers()
        const run = draftRun(co)
        expect((await call(maker, 'POST', `/hr/payroll/runs/${run.id}/calculate`)).status).toBe(200)
        await call(maker, 'POST', `/hr/payroll/runs/${run.id}/acknowledge`, { all: true })
        const self = await call(maker, 'POST', `/hr/payroll/runs/${run.id}/approve`)
        expect(self.status).toBe(403)
        expect(self.body.code).toBe('maker_checker')
        const checker = fullUsers.find((x) => x.id !== maker.id)!
        expect((await call(checker, 'POST', `/hr/payroll/runs/${run.id}/approve`)).status).toBe(200)
      }
    })
  }
})

describe('plan gate', () => {
  it('Crest (Business, no hr) answers 403 module_not_in_plan to every role; Apex answers', async () => {
    expect(restoreSnapshot(seed)).toBe(true)
    ensureRoleUsers()
    for (const role of ROLES) {
      const r = await call(userFor('co_crest', role), 'GET', '/hr/payroll/payslips')
      expect(r.status).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_apex', 'HR Manager'), 'GET', '/hr/payroll/runs')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; spoofed company fields are ignored', () => {
  const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  const emp = (co: Co) => hrEmployees.find((e) => e.companyId === co && e.userId && e.userId !== ADMIN[co] && e.status === 'active')!
  const cases: { name: string; id: (co: Co) => string; send: (co: Co, id: string) => Promise<{ status: number; body: unknown }> }[] = [
    { name: 'adjustment employee', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', '/hr/payroll/adjustments', { employee_id: id, kind: 'bonus', label: 'X', amount: 1, month: month(1) }) },
    { name: 'loan employee', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', '/hr/payroll/loans', { employee_id: id, principal: 100, installment_amount: 50, start_month: month(1) }) },
    { name: 'payroll profile', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'PATCH', `/hr/payroll/profiles/${id}`, { pay_method: 'cash' }) },
    { name: 'person id reveal', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', `/hr/payroll/profiles/${id}/reveal`) },
    { name: 'run', id: (co) => draftRun(co).id, send: (co, id) => call(admin(co), 'POST', `/hr/payroll/runs/${id}/calculate`) },
    { name: 'bank file', id: (co) => paidRun(co).id, send: (co, id) => call(admin(co), 'POST', `/hr/payroll/runs/${id}/bank-file`, { format: co === 'co_apex' ? 'wps' : 'mudad' }) },
    { name: 'payslip', id: (co) => paidLines(co)[0].id, send: (co, id) => call(admin(co), 'GET', `/hr/payroll/payslips/${id}`) },
    { name: 'settlement preview', id: (co) => emp(co).id, send: (co, id) => call(admin(co), 'POST', '/hr/payroll/settlements/preview', { employee_id: id, reason: 'termination', exit_date: '2026-11-15' }) },
  ]
  for (const c of cases) {
    for (const co of COMPANIES) {
      it(`${co}: ${c.name} of ${other(co)}`, async () => {
        const start = takeSnapshot(true)
        const theirs = await c.send(co, c.id(other(co)))
        restoreSnapshot(start)
        const missing = await c.send(co, 'zz-missing')
        expect(theirs.status).toBe(404)
        expect(theirs.status).toBe(missing.status)
        expect(JSON.stringify(theirs.body).split(c.id(other(co))).join('<id>')).toBe(JSON.stringify(missing.body).split('zz-missing').join('<id>'))
      })
    }
  }

  it('a spoofed company id in a create lands in the caller’s company only', async () => {
    const r = await call(admin('co_crest'), 'POST', '/hr/payroll/adjustments', { employee_id: emp('co_crest').id, kind: 'bonus', label: 'Spoof', amount: 5, month: month(1), company_id: 'co_apex', companyId: 'co_apex' })
    expect(r.status).toBe(200)
    expect(hrPayAdjustments.find((a) => a.id === r.body.id)?.companyId).toBe('co_crest')
    const run = await call(admin('co_apex'), 'POST', '/hr/payroll/runs', { month: month(1), company_id: 'co_crest' })
    expect(run.status).toBe(200)
    expect(hrPayrollRuns.find((x) => x.id === run.body.id)?.companyId).toBe('co_apex')
  })
})
