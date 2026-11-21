import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { HUB_CATALOG, hubEntryVisible } from '@/modules/reports/hub/catalog'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { reportsHubPrefs } from '@/shared/mocks/data/reportsHub'
import { isClosedStatus } from '@/shared/mocks/data/lookups'
import { companyModules } from '@/shared/mocks/services/billing'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Reports › Company performance and Reports hub — TABLE-DRIVEN FROM PERMISSION_MATRIX (docs/API.md › Reports):
 *   reports hidden (Employee)            403 on both
 *   financial section                    accounting full / view + plan accounting; otherwise null (hidden, never zeroed)
 *   sales section                        sales not hidden; figures equal the role's visible leads
 *   people section                       hr full / team + plan hr
 *   department scorecard                 reports ≠ own; money columns only with the financial section
 *   hub                                  exactly the catalog entries the role and plan can open; favourites per user
 * Every role × both companies.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const MONEY_KEYS = /revenue|cost|margin|profit|cash|payroll|^ar_|^ap_|dso|roi|budget/

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)
const ytd = (co: Co) => `from=${today(co).slice(0, 4)}-01-01&to=${today(co)}`

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-perf-${co}-${slug}`,
        companyId: co,
        name: `Perf ${role} ${co}`,
        email: `perf-${slug}@${co}.test`,
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
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

function keysIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysIn(x, out))
  return out
}

/** Own recomputation: income of the company in [from, to] (closing entries excluded). */
function revenueIn(co: Co, from: string, to: string): number {
  runFinanceHooks(co)
  const income = new Set(financeAccounts.filter((a) => a.companyId === co && a.type === 'income').map((a) => a.id))
  let s = 0
  for (const e of financeJournal) {
    if (e.companyId !== co || e.date < from || e.date > to || e.sourceType === 'year_end_close') continue
    for (const l of e.lines) if (income.has(l.accountId)) s += l.credit - l.debit
  }
  return Math.round(s * 100) / 100
}

describe('Company performance: sections per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const r = roleOf(u)
        const res = await call(u, 'GET', `/reports/performance?${ytd(co)}`)
        if (scopeOf(r, 'reports') === 'hidden') {
          expect(res.status).toBe(403)
          return
        }
        expect(res.status).toBe(200)
        const d = res.body
        const modules = companyModules(co)
        const financial = scopeOf(r, 'accounting') !== 'hidden' && modules.includes('accounting')
        expect(d.access.financial, 'financial access').toBe(financial)
        expect(d.financial === null, 'financial hidden').toBe(!financial)
        expect(d.sales === null).toBe(scopeOf(r, 'sales') === 'hidden')
        expect(d.delivery === null).toBe(scopeOf(r, 'tasks') === 'hidden')
        const people = ['full', 'team'].includes(scopeOf(r, 'hr')) && modules.includes('hr')
        expect(d.people !== null).toBe(people)
        expect(d.departments === null).toBe(scopeOf(r, 'reports') === 'own')
        if (d.departments) {
          expect(d.departments.financial_columns).toBe(financial)
          if (!financial) {
            expect(d.departments.budget_column).toBe(false)
            for (const row of d.departments.rows) expect([row.revenue, row.cost, row.margin, row.margin_pct, row.budget_variance]).toEqual([null, null, null, null, null])
          }
        }
        if (!financial) {
          // Not zeroed: no money anywhere outside the null section and null scorecard cells.
          const rest = { ...d, financial: undefined, departments: undefined }
          for (const k of keysIn(rest)) expect(k, `key ${k}`).not.toMatch(MONEY_KEYS)
          for (const a of d.alerts) expect(a.id).not.toMatch(/cash|ar-|margin/)
        } else {
          expect(d.financial.revenue).toBeCloseTo(revenueIn(co, `${today(co).slice(0, 4)}-01-01`, today(co)), 2)
        }
        if (d.sales) {
          const open = visibleLeads(u).filter((l) => !isClosedStatus(co, l.status))
          expect(d.sales.pipeline_value).toBe(open.reduce((s, l) => s + l.value, 0))
          expect(d.sales.open_leads).toBe(open.length)
        }
        const text = JSON.stringify(d)
        expect(text).not.toContain(other(co))
      })
    }
  }

  it('without the accounting module even the admin gets no financial section', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const d = (await call(userFor('co_crest', 'Company Admin'), 'GET', '/reports/performance')).body
    expect(d.financial).toBeNull()
    expect(d.access.financial).toBe(false)
    expect(d.departments.financial_columns).toBe(false)
  })

  it('validation: a bad range answers 422', async () => {
    expect((await call(userFor('co_apex', 'Management'), 'GET', '/reports/performance?from=2026-06-01&to=2026-01-01')).status).toBe(422)
  })
})

describe('Reports hub per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const r = roleOf(u)
        const res = await call(u, 'GET', '/reports/hub')
        if (scopeOf(r, 'reports') === 'hidden') {
          expect(res.status).toBe(403)
          expect((await call(u, 'PUT', '/reports/hub/favourites/company-performance')).status).toBe(403)
          return
        }
        expect(res.status).toBe(200)
        const expected = HUB_CATALOG.filter((e) => hubEntryVisible(e, r, companyModules(co))).map((e) => e.id)
        expect(res.body.reports.map((x: { id: string }) => x.id)).toEqual(expected)
        // A report the role can't open is "not found", like an unknown one.
        const hidden = HUB_CATALOG.find((e) => !expected.includes(e.id))
        if (hidden) {
          const a = await call(u, 'PUT', `/reports/hub/favourites/${hidden.id}`)
          const b = await call(u, 'PUT', '/reports/hub/favourites/no-such-report')
          expect([a.status, b.status]).toEqual([404, 404])
          expect(a.body).toEqual(b.body)
        }
        // Finance entries only for accounting roles; HR entries only for hr full / team.
        expect(expected.some((id) => id.startsWith('finance-'))).toBe(scopeOf(r, 'accounting') !== 'hidden')
      })
    }
  }

  it('favourites and recently viewed are per user and per company, and persist', async () => {
    const apex = users.find((u) => u.id === ADMIN.co_apex)!
    const crest = users.find((u) => u.id === ADMIN.co_crest)!
    const manager = userFor('co_apex', 'Management')
    expect((await call(apex, 'PUT', '/reports/hub/favourites/company-performance')).status).toBe(200)
    expect((await call(apex, 'POST', '/reports/hub/recent', { report_id: 'sales-agents', company_id: 'co_crest' })).status).toBe(200)
    const again = (await call(apex, 'GET', '/reports/hub')).body
    expect(again.favourites).toEqual(['company-performance'])
    expect(again.reports.find((x: { id: string }) => x.id === 'company-performance').favourite).toBe(true)
    expect(again.recent[0].report_id).toBe('sales-agents')
    expect((await call(manager, 'GET', '/reports/hub')).body.favourites).toEqual([])
    expect((await call(crest, 'GET', '/reports/hub')).body.favourites).toEqual([])
    expect(reportsHubPrefs.filter((p) => p.companyId === 'co_crest')).toHaveLength(0)
    expect((await call(apex, 'DELETE', '/reports/hub/favourites/company-performance')).body.favourites).toEqual([])
  })
})
