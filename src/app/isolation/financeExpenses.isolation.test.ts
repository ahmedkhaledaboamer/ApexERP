import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { employeeForUser, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { finExpenseCategories, finExpenseClaims, finExpenses, finPettyFunds } from '@/shared/mocks/data/financeExpenses'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Expenses, employee expense claims, petty cash — TABLE-DRIVEN FROM PERMISSION_MATRIX
 * (`accounting` column; docs/API.md › Finance › Expenses):
 *   company expenses   full: every read and write · view (Sales Manager): reads, writes 403 · hidden: 403
 *   expense claims     EVERY role: own claims (create / submit), the meta, categories and policy; `view=all` shows
 *                      every claim to accounting full only; a department head sees and acts on their team's claims
 *   petty cash         accounting full: every fund; a custodian: their own fund only; everyone else: none
 * Every role × both companies; plan gate (module `accounting` removed → 403 module_not_in_plan); foreign ids 404.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
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
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role && employeeForUser(co, u.id))) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const at = new Date().toISOString()
      const user: User = { id: `u-fexp-${co}-${slug}`, companyId: co, name: `Expenses ${role} ${co}`, email: `fexp-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: at }
      users.push(user)
      addMembership(user.id, co, role)
      hrEmployees.push({ companyId: co, id: `EMP-${user.id}`, userId: user.id, employeeNo: `ISO-${slug}`, fullName: user.name, jobTitle: role, departmentId: null, managerId: null, email: user.email, mobile: '', nationality: 'AE', gender: 'female', dateOfBirth: '1990-01-01', hireDate: '2024-01-01', employmentType: 'full_time', status: 'active', exitDate: null, createdAt: at, updatedAt: at } as (typeof hrEmployees)[number])
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})

const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role && employeeForUser(co, x.id))!
const byId = (id: string) => users.find((u) => u.id === id)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => rows.find((r) => r.companyId === co && pred(r))!
const today = () => new Date().toISOString().slice(0, 10)
const cat = (co: Co) => own(finExpenseCategories, co, (c) => c.active).id
const expenseBody = (co: Co) => ({ date: today(), payee_name: 'Role probe', category_id: cat(co), amount: 20, payment_method: 'card', paid_from_account_id: 'ACC-1120' })
const claimBody = (co: Co) => ({ title: 'Role probe', lines: [{ date: today(), category_id: cat(co), description: 'Taxi', merchant: 'Taxi', amount: 30 }] })

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
        const exp = own(finExpenses, co)
        // Company expenses: full / view read, hidden 403.
        for (const p of ['/finance/expenses', `/finance/expenses/${exp.id}`, '/finance/expenses/meta']) {
          expect((await call(u, 'GET', p)).status, `${role} GET ${p}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        const created = await call(u, 'POST', '/finance/expenses', expenseBody(co))
        expect(created.status, `${role} POST expense`).toBe(scope === 'full' ? 200 : 403)
        expect((await call(u, 'POST', '/finance/expense-categories', { name: `Role ${role}`, account_id: 'ACC-6550' })).status).toBe(scope === 'full' ? 200 : 403)
        expect((await call(u, 'PATCH', '/finance/expense-policy', { claim_max_age_days: 60 })).status).toBe(scope === 'full' ? 200 : 403)
        // Claims, categories, policy: every role.
        for (const p of ['/finance/expense-claims', '/finance/expense-claims/meta', '/finance/expense-categories', '/finance/expense-policy', '/finance/petty-cash/funds', '/finance/petty-cash/meta']) {
          expect((await call(u, 'GET', p)).status, `${role} GET ${p}`).toBe(200)
        }
        const claim = await call(u, 'POST', '/finance/expense-claims', claimBody(co))
        expect(claim.status, `${role} POST claim: ${JSON.stringify(claim.body).slice(0, 200)}`).toBe(200)
        expect((await call(u, 'POST', `/finance/expense-claims/${claim.body.id}/submit`)).status).toBe(200)
        const all = (await call(u, 'GET', '/finance/expense-claims?view=all')).body as { id: string; is_mine: boolean }[]
        if (scope === 'full') expect(all.length).toBe(finExpenseClaims.filter((c) => c.companyId === co && (c.status !== 'draft' || c.requesterId === u.id)).length + finExpenseClaims.filter((c) => c.companyId === co && c.status === 'draft' && c.requesterId !== u.id).length)
        else expect(all.length).toBeLessThan(finExpenseClaims.filter((c) => c.companyId === co).length)
        const mine = (await call(u, 'GET', '/finance/expense-claims')).body as { is_mine: boolean }[]
        expect(mine.every((c) => c.is_mine)).toBe(true)
        // Reimbursing: accounting full only.
        const approved = own(finExpenseClaims, co, (c) => c.status === 'approved')
        const r = await call(u, 'POST', `/finance/expense-claims/${approved.id}/reimburse`, { method: 'payment', account_id: 'ACC-1120' })
        // Not full: 404 when the claim isn't visible to them, 403 when it is (own / team).
        if (scope === 'full') expect(r.status, `${role} reimburse`).toBe(200)
        else expect([403, 404], `${role} reimburse`).toContain(r.status)
        // Petty cash: full sees every fund; others only a fund they hold.
        const funds = (await call(u, 'GET', '/finance/petty-cash/funds')).body as { id: string; is_mine: boolean }[]
        if (scope === 'full') expect(funds.length).toBe(finPettyFunds.filter((f) => f.companyId === co).length)
        else expect(funds.every((f) => f.is_mine)).toBe(true)
        expect((await call(u, 'POST', `/finance/petty-cash/funds/${own(finPettyFunds, co).id}/top-up`, { amount: 1, from_account_id: 'ACC-1120' })).status).toBe(scope === 'full' ? 200 : 403)
      })
    }
  }
})

describe('employees, department heads and custodians', () => {
  it('Apex: an employee sees only their own claims; the department head sees and approves their team’s; another head can’t', async () => {
    const yusuf = byId('u14') // Delivery, head u10
    const c = await call(yusuf, 'POST', '/finance/expense-claims', claimBody('co_apex'))
    await call(yusuf, 'POST', `/finance/expense-claims/${c.body.id}/submit`)
    const others = finExpenseClaims.filter((x) => x.companyId === 'co_apex' && x.requesterId !== 'u14')
    for (const o of others.slice(0, 3)) expect((await call(yusuf, 'GET', `/finance/expense-claims/${o.id}`)).status).toBe(404)
    const head = byId('u10')
    const inbox = (await call(head, 'GET', '/finance/expense-claims?view=approvals')).body as { id: string }[]
    expect(inbox.map((x) => x.id)).toContain(c.body.id)
    expect((await call(byId('u3'), 'GET', `/finance/expense-claims/${c.body.id}`)).status).toBe(404)
    expect((await call(byId('u3'), 'POST', `/finance/expense-claims/${c.body.id}/approve`)).status).toBe(404)
    expect((await call(yusuf, 'POST', `/finance/expense-claims/${c.body.id}/approve`)).status).toBe(403)
    const ok = await call(head, 'POST', `/finance/expense-claims/${c.body.id}/approve`)
    expect(ok.status).toBe(200)
    expect(ok.body.steps[0].status).toBe('approved')
  })

  it('Crest: a custodian sees and records on their own fund only; replenishing it is someone else’s job', async () => {
    const huda = byId('u107')
    const list = (await call(huda, 'GET', '/finance/petty-cash/funds')).body as { id: string; name: string }[]
    expect(list).toHaveLength(1)
    const otherFund = own(finPettyFunds, 'co_crest', (f) => f.id !== list[0].id)
    expect((await call(huda, 'GET', `/finance/petty-cash/funds/${otherFund.id}`)).status).toBe(404)
    const rec = await call(huda, 'POST', `/finance/petty-cash/funds/${list[0].id}/expenses`, { category_id: cat('co_crest'), payee_name: 'Shop', amount: 12, description: 'Tape' })
    expect(rec.status).toBe(200)
    expect((await call(huda, 'POST', `/finance/petty-cash/funds/${list[0].id}/replenish`, { from_account_id: 'ACC-1120' })).status).toBe(403)
    expect((await call(byId('u102'), 'POST', `/finance/petty-cash/funds/${list[0].id}/replenish`, { from_account_id: 'ACC-1120' })).status).toBe(200)
  })
})

describe('plan gate', () => {
  it('without the accounting module every role answers 403 module_not_in_plan (claims too); the other company still answers', async () => {
    moduleOverrides.push({ companyId: 'co_apex', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      for (const p of ['/finance/expenses', '/finance/expense-claims']) {
        const r = await call(userFor('co_apex', role), 'GET', p)
        expect(r.status, `${role} ${p}`).toBe(403)
        expect(r.body.code).toBe('module_not_in_plan')
      }
    }
    expect((await call(userFor('co_crest', 'Employee'), 'GET', '/finance/expense-claims')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; a spoofed company is ignored', () => {
  const admin = (co: Co) => byId(co === 'co_apex' ? 'u1' : 'u101')
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  for (const co of COMPANIES) {
    it(`${co}: foreign expense / claim / fund ids → 404 like missing`, async () => {
      const them = other(co)
      const pairs: [string, string][] = [
        [`/finance/expenses/${own(finExpenses, them).id}`, '/finance/expenses/EXP-0'],
        [`/finance/expense-claims/${own(finExpenseClaims, them, (c) => c.status !== 'draft').id}`, '/finance/expense-claims/ECL-0'],
        [`/finance/petty-cash/funds/${own(finPettyFunds, them).id}`, '/finance/petty-cash/funds/PCF-0'],
      ]
      for (const [foreign, missing] of pairs) {
        const a = await call(admin(co), 'GET', foreign)
        const b = await call(admin(co), 'GET', missing)
        expect(a.status).toBe(404)
        expect(a.body).toEqual(b.body)
      }
    })
    it(`${co}: company_id in the body is ignored`, async () => {
      const before = finExpenses.filter((e) => e.companyId === other(co)).length
      const r = await call(admin(co), 'POST', '/finance/expenses', { ...expenseBody(co), company_id: other(co), companyId: other(co) })
      expect(r.status).toBe(200)
      expect(finExpenses.find((e) => e.id === r.body.id)!.companyId).toBe(co)
      expect(finExpenses.filter((e) => e.companyId === other(co)).length).toBe(before)
    })
  }
})
