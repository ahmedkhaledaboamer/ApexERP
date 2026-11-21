import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { finBankAccounts, finBankReconciliations, finBankTransfers } from '@/shared/mocks/data/financeBanking'
import { finCommissionPlans, finCommissionStatements } from '@/shared/mocks/data/financeCommissions'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { generateFor } from '@/shared/mocks/services/financeCommissions'
import { todayOf } from '@/shared/mocks/services/financeCollectionsCore'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Banking, Payroll posting and Commissions — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting`):
 *   full    (Company Admin, Management, Accountant) reads and writes banking; manages commission plans; generates
 *   view    (Sales Manager) reads banking (writes 403); reads plans; sees the team's statements and approves step 1
 *   hidden  banking and plans → 403; commission statements: their own only (Sales Agents: "My commissions")
 * Every role × both companies; the plan gate (accounting off → 403 module_not_in_plan, even "My commissions").
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
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
      const user: User = { id: `u-finbank-${co}-${slug}`, companyId: co, name: `Banking ${role} ${co}`, email: `finbank-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
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

describe('the accounting column only uses handled scopes', () => {
  it('every role’s accounting scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].accounting)
  })
})

describe('banking and payroll posting: scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].accounting})`, async () => {
        runFinanceHooks(co)
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const main = finBankAccounts.find((b) => b.companyId === co && b.ledgerAccountId === 'ACC-1120')!
        const other = finBankAccounts.find((b) => b.companyId === co && b.id !== main.id && b.kind !== 'cash' && b.currency === main.currency)!
        const rec = finBankReconciliations.find((r) => r.companyId === co)!
        const run = hrPayrollRuns.find((r) => r.companyId === co)!
        const reads: string[] = [
          '/finance/bank-accounts',
          `/finance/bank-accounts/${main.id}`,
          `/finance/bank-accounts/${main.id}/statements`,
          `/finance/bank-accounts/${main.id}/reconcile`,
          '/finance/bank-reconciliations',
          `/finance/bank-reconciliations/${rec.id}`,
          '/finance/bank-transfers',
          '/finance/bank-rules',
          '/finance/payroll-postings',
          `/finance/payroll-postings/${run.id}`,
        ]
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        const writes: [string, string, unknown][] = [
          ['POST', '/finance/bank-transfers', { from_bank_account_id: main.id, to_bank_account_id: other.id, amount_from: 1 }],
          ['POST', '/finance/bank-rules', { contains: 'role test', account_id: 'ACC-6800' }],
          ['PATCH', `/finance/bank-accounts/${other.id}`, { notes: 'Role test' }],
          ['POST', `/finance/bank-accounts/${other.id}/statements/preview`, { csv: 'Date,Description,Amount\n2026-11-01,X,-1' }],
          ['POST', `/finance/bank-accounts/${main.id}/reveal`, {}],
          ['POST', `/finance/bank-accounts/${main.id}/auto-match`, {}],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'full' ? 200 : 403)
        }
        // Masked everywhere but the reveal.
        const list = await call(userFor(co, 'Company Admin'), 'GET', '/finance/bank-accounts')
        expect(JSON.stringify(list.body)).not.toContain(main.iban)
      })
    }
  }
})

describe('commissions: plans, statements, maker–checker (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role}: plan gate, own / team / all statements`, async () => {
        runFinanceHooks(co)
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'accounting')
        const plans = await call(u, 'GET', '/finance/commission-plans')
        expect(plans.status, `${role} plans`).toBe(scope === 'full' || roleOf(u) === 'Sales Manager' ? 200 : 403)
        const plan = finCommissionPlans.find((p) => p.companyId === co)!
        const edit = await call(u, 'PATCH', `/finance/commission-plans/${plan.id}`, { cap_per_month: 12345 })
        expect(edit.status, `${role} edit plan`).toBe(['Company Admin', 'Management', 'Accountant'].includes(roleOf(u)) ? 200 : 403)
        const list = await call(u, 'GET', '/finance/commission-statements')
        expect(list.status).toBe(200)
        const ids = (list.body as { user_id: string }[]).map((s) => s.user_id)
        if (scope === 'full') expect(ids.length).toBe(finCommissionStatements.filter((s) => s.companyId === co).length)
        else if (roleOf(u) === 'Sales Agent' || roleOf(u) === 'Employee') expect(ids.every((id) => id === u.id), role).toBe(true)
        const mine = await call(u, 'GET', '/finance/commissions/mine')
        expect(mine.status).toBe(200)
        expect((mine.body.statements as { user_id: string }[]).every((s) => s.user_id === u.id)).toBe(true)
        const gen = await call(u, 'POST', '/finance/commission-statements/generate', { month: todayOf(co).slice(0, 7) })
        expect(gen.status, `${role} generate`).toBe(scope === 'full' ? 200 : 403)
      })
    }

    it(`${co}: a rep sees only their own statements; another rep's answers 404; the Sales Manager then an Accountant approve`, async () => {
      runFinanceHooks(co)
      const reps = users.filter((u) => u.companyId === co && u.role === 'Sales Agent')
      const [a, b] = reps
      const sa = generateFor(co, ADMIN[co], a, todayOf(co).slice(0, 7), { includeEmpty: true })!
      const sb = generateFor(co, ADMIN[co], b, todayOf(co).slice(0, 7), { includeEmpty: true })!
      expect((await call(a, 'GET', `/finance/commission-statements/${sa.id}`)).status).toBe(200)
      expect((await call(a, 'GET', `/finance/commission-statements/${sb.id}`)).status).toBe(404)
      expect((await call(a, 'POST', `/finance/commission-statements/${sa.id}/approve`)).status).toBe(403)
      const accountant = userFor(co, 'Accountant')
      expect((await call(accountant, 'POST', `/finance/commission-statements/${sa.id}/approve`)).status).toBe(403)
      const sm = userFor(co, 'Sales Manager')
      expect((await call(sm, 'POST', `/finance/commission-statements/${sa.id}/approve`)).body.status).toBe('pending_accountant')
      expect((await call(sm, 'POST', `/finance/commission-statements/${sa.id}/approve`)).status).toBe(403)
      const done = await call(accountant, 'POST', `/finance/commission-statements/${sa.id}/approve`)
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      expect(done.body.status).toBe('approved')
    })
  }
})

describe('plan gate', () => {
  it('without the accounting module banking, payroll posting and commissions answer 403 module_not_in_plan', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const admin = users.find((u) => u.id === ADMIN.co_crest)!
    const rep = users.find((u) => u.companyId === 'co_crest' && u.role === 'Sales Agent')!
    for (const [u, p] of [[admin, '/finance/bank-accounts'], [admin, '/finance/payroll-postings'], [admin, '/finance/commission-plans'], [rep, '/finance/commissions/mine']] as const) {
      const r = await call(u, 'GET', p)
      expect(r.status, p).toBe(403)
      expect(r.body.code, p).toBe('module_not_in_plan')
    }
    expect((await call(users.find((u) => u.id === ADMIN.co_apex)!, 'GET', '/finance/bank-accounts')).status).toBe(200)
    expect(finBankTransfers.some((t) => t.companyId === 'co_apex')).toBe(true)
  })
})
