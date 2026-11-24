import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { finTaxSettings, finVatReturns } from '@/shared/mocks/data/financeTax'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { ensureReturns, updateTaxSettings } from '@/shared/mocks/services/financeTax'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Tax (VAT returns, corporate tax, zakat) — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting`):
 *   full    (Company Admin, Management, Accountant) reads, files / pays returns, changes settings and adjustments
 *   view    (Sales Manager) reads every return and estimate; writes 403
 *   hidden  everything 403
 * Every role × both companies (Apex: FTA VAT 201 + corporate tax; Crest: ZATCA + zakat); the plan gate; a draft
 * return's output / input VAT recomputed from the ledger's VAT accounts.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }

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
      const user: User = { id: `u-fintax-${co}-${slug}`, companyId: co, name: `Tax ${role} ${co}`, email: `fintax-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
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
const todayOf = (co: Co) => companyDayOf(co).today

describe('the accounting column only uses handled scopes', () => {
  it('every role’s accounting scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].accounting)
  })
})

describe('tax: scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        runFinanceHooks(co)
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        // The seed files every return whose deadline has passed: when no ended period is still a draft (Apex's last
        // quarter after its deadline), the company files monthly so the last ended month is one.
        if (!ensureReturns(co).some((r) => r.to < todayOf(co) && r.status === 'draft')) updateTaxSettings(users.find((x) => x.id === ADMIN[co])! as User, { vatFrequency: 'monthly' })
        const rows = ensureReturns(co)
        const ended = rows.find((r) => r.to < todayOf(co) && r.status === 'draft')!
        const reads = ['/finance/tax/settings', '/finance/vat-returns', `/finance/vat-returns/${ended.id}`, `/finance/vat-returns/${ended.id}/boxes/1`, co === 'co_apex' ? '/finance/tax/corporate-tax' : '/finance/tax/zakat']
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        // The other country's estimate is not applicable (409) for anyone who can read.
        const wrong = await call(u, 'GET', co === 'co_apex' ? '/finance/tax/zakat' : '/finance/tax/corporate-tax')
        expect(wrong.status).toBe(scope === 'hidden' ? 403 : 409)
        if (scope !== 'hidden') {
          const d = await call(u, 'GET', `/finance/vat-returns/${ended.id}`)
          expect(d.body.layout).toBe(co === 'co_apex' ? 'uae_vat201' : 'ksa_zatca')
          expect(d.body.can.file).toBe(scope === 'full')
        }
        const writes: [string, string, unknown][] = [
          ['PATCH', '/finance/tax/settings', { vat_frequency: finTaxSettings.get(co).vatFrequency }],
          ['PUT', '/finance/tax/adjustments', { kind: co === 'co_apex' ? 'corporate_tax' : 'zakat', lines: [{ label: 'Role test', amount: 1 }] }],
          ['POST', `/finance/vat-returns/${ended.id}/file`, { filing_reference: 'ROLE-TEST-1' }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'full' ? 200 : 403)
        }
        if (scope === 'full') {
          const filed = finVatReturns.find((r) => r.id === ended.id)!
          expect(filed.status).toBe('filed')
          if ((filed.snapshot?.totals.payable ?? 0) > 0) expect((await call(u, 'POST', `/finance/vat-returns/${ended.id}/pay`, {})).status).toBe(200)
        }
      })
    }
  }
})

describe('tax: tenant boundary and numbers', () => {
  it('a foreign return id answers 404 like a missing one; nothing of the other company changes', async () => {
    runFinanceHooks('co_apex')
    runFinanceHooks('co_crest')
    const crestReturn = ensureReturns('co_crest')[0]
    const before = JSON.stringify(finVatReturns.filter((r) => r.companyId === 'co_crest'))
    const admin = users.find((u) => u.id === ADMIN.co_apex)!
    for (const [m, p] of [['GET', `/finance/vat-returns/${crestReturn.id}`], ['GET', `/finance/vat-returns/${crestReturn.id}/boxes/1`], ['POST', `/finance/vat-returns/${crestReturn.id}/file`]] as const) {
      const foreign = await call(admin, m, p, { filing_reference: 'SPOOF-123' })
      const missing = await call(admin, m, p.replace(crestReturn.id, 'VATR-404404'), { filing_reference: 'SPOOF-123' })
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(missing.body)
    }
    expect(JSON.stringify(finVatReturns.filter((r) => r.companyId === 'co_crest'))).toBe(before)
  })

  it('a draft return’s output / input VAT equals the ledger movement of the VAT accounts in the period (both companies)', async () => {
    for (const co of COMPANIES) {
      runFinanceHooks(co)
      const admin = users.find((u) => u.id === ADMIN[co])!
      const list = await call(admin, 'GET', '/finance/vat-returns')
      for (const row of list.body.filter((r: { status: string }) => r.status === 'draft')) {
        const d = await call(admin, 'GET', `/finance/vat-returns/${row.id}`)
        const out = financeAccounts.find((a) => a.companyId === co && a.systemRole === 'vat_output')!.id
        const inp = financeAccounts.find((a) => a.companyId === co && a.systemRole === 'vat_input')!.id
        let o = 0
        let i = 0
        for (const e of financeJournal) {
          if (e.companyId !== co || e.date < row.from || e.date > row.to || e.sourceType === 'vat_return') continue
          for (const l of e.lines) {
            if (l.accountId === out) o += l.credit - l.debit
            if (l.accountId === inp) i += l.debit - l.credit
          }
        }
        expect(d.body.totals.output_vat, `${co} ${row.label} output`).toBeCloseTo(o, 2)
        // Input VAT counted = recoverable lines only = the VAT input account's movement.
        expect(d.body.totals.input_vat, `${co} ${row.label} input`).toBeCloseTo(i, 2)
      }
    }
  })

  it('plan gate: accounting off → 403 module_not_in_plan for tax, budgets and the forecast (even a department head)', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const admin = users.find((u) => u.id === ADMIN.co_crest)!
    const head = users.find((u) => u.id === 'u106')!
    for (const [u, p] of [[admin, '/finance/vat-returns'], [admin, '/finance/tax/zakat'], [admin, '/finance/forecast'], [admin, '/finance/budgets'], [head, '/finance/budgets']] as const) {
      const r = await call(u, 'GET', p)
      expect(r.status, p).toBe(403)
      expect(r.body.code, p).toBe('module_not_in_plan')
    }
    expect((await call(users.find((u) => u.id === ADMIN.co_apex)!, 'GET', '/finance/vat-returns')).status).toBe(200)
  })
})
