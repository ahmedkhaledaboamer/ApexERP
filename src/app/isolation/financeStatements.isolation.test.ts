import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { finYearEndCloses } from '@/shared/mocks/data/financeStatements'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { addDays } from '@/modules/finance/statements/calc'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { closeYear } from '@/shared/mocks/services/financeStatements'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › Financial statements and year-end close — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting`
 * column; docs/API.md › Finance › Financial statements, Year-end close):
 *   full    every statement; closing a year only for Company Admin and Accountant (Management → 403
 *           year_end_forbidden: closing moves the lock date); re-opening only for Company Admin (→ 403 reopen_forbidden)
 *   view    (Sales Manager) every statement and the year-end list / preview; close and re-open 403
 *   hidden  403 everywhere
 * Every role × both companies; the plan gate; a foreign close id; a spoofed company; numbers recomputed from the
 * company's own journal.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const CLOSERS: readonly Role[] = ['Company Admin', 'Accountant']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const today = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)

/** A user for every role in both companies. */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-fst-${co}-${slug}`,
        companyId: co,
        name: `Statements ${role} ${co}`,
        email: `fst-${slug}@${co}.test`,
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
const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
/** Fiscal year starting this month: the previous one ended last month and can be closed. */
function closable(co: Co): string {
  financeSettings.get(co).fiscalYearStartMonth = Number(today(co).slice(5, 7))
  return addDays(`${today(co).slice(0, 7)}-01`, -1)
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
        const r0 = roleOf(u)
        const scope = scopeOf(r0, 'accounting')
        const end = closable(co)
        const reads = [
          '/finance/statements/meta',
          '/finance/statements/profit-and-loss?period=ytd&compare=previous_period,last_year',
          '/finance/statements/profit-and-loss?view=monthly',
          `/finance/statements/balance-sheet?compare_to=${end}`,
          '/finance/statements/cash-flow?period=ytd',
          '/finance/statements/general-ledger',
          `/finance/statements/trial-balance?compare_to=${end}`,
          '/finance/year-end',
          `/finance/year-end/preview?fiscal_year_end=${end}`,
        ]
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        if (scope !== 'hidden') {
          const meta = await call(u, 'GET', '/finance/statements/meta')
          expect(meta.body.can_close).toBe(scope === 'full' && CLOSERS.includes(r0))
          expect(meta.body.can_reopen).toBe(scope === 'full' && r0 === 'Company Admin')
        }
        const close = await call(u, 'POST', '/finance/year-end/close', { fiscal_year_end: end })
        const mayClose = scope === 'full' && CLOSERS.includes(r0)
        expect(close.status, `${role} close: ${JSON.stringify(close.body).slice(0, 200)}`).toBe(mayClose ? 200 : 403)
        if (scope === 'full' && !mayClose) expect(close.body.code).toBe('year_end_forbidden')
        if (mayClose) expect(financeSettings.get(co).lockDate).toBe(end)

        // Re-open: a close made by the admin; only a Company Admin may re-open it.
        restoreSnapshot(seed)
        ensureRoleUsers()
        closable(co)
        const rec = closeYear(admin(co), { fiscalYearEnd: end })
        const reopen = await call(u, 'POST', `/finance/year-end/closes/${rec.close.id}/reopen`, { reason: 'Role probe' })
        expect(reopen.status, `${role} reopen: ${JSON.stringify(reopen.body).slice(0, 200)}`).toBe(scope === 'full' && r0 === 'Company Admin' ? 200 : 403)
        if (scope === 'full' && r0 !== 'Company Admin') expect(reopen.body.code).toBe('reopen_forbidden')
      })
    }
  }
})

describe('plan gate', () => {
  it('without the accounting module every role answers 403 module_not_in_plan; the other company still answers', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      for (const p of ['/finance/statements/profit-and-loss', '/finance/year-end']) {
        const r = await call(userFor('co_crest', role), 'GET', p)
        expect(r.status, `${role} ${p}`).toBe(403)
        expect(r.body.code).toBe('module_not_in_plan')
      }
    }
    expect((await call(userFor('co_apex', 'Accountant'), 'GET', '/finance/statements/balance-sheet')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; spoofed company fields are ignored', () => {
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  for (const co of COMPANIES) {
    it(`${co}: re-opening a close of ${other(co)} answers like a missing close`, async () => {
      closable(other(co))
      const theirId = closeYear(admin(other(co)), { fiscalYearEnd: closable(other(co)) }).close.id
      const start = takeSnapshot(true)
      const theirs = await call(admin(co), 'POST', `/finance/year-end/closes/${theirId}/reopen`, { reason: 'Probe' })
      restoreSnapshot(start)
      const missing = await call(admin(co), 'POST', '/finance/year-end/closes/YEC-missing/reopen', { reason: 'Probe' })
      expect(theirs.status).toBe(404)
      expect(theirs.status).toBe(missing.status)
      expect(JSON.stringify(theirs.body).split(theirId).join('<id>')).toBe(JSON.stringify(missing.body).split('YEC-missing').join('<id>'))
      expect(finYearEndCloses.find((c) => c.id === theirId)?.status).toBe('closed')
    })
  }

  it('a spoofed company id on a close lands in the caller’s company only', async () => {
    const end = closable('co_crest')
    closable('co_apex')
    const apexLock = financeSettings.get('co_apex').lockDate
    const r = await call(admin('co_crest'), 'POST', '/finance/year-end/close', { fiscal_year_end: end, company_id: 'co_apex', companyId: 'co_apex' })
    expect(r.status).toBe(200)
    expect(finYearEndCloses.find((c) => c.id === r.body.close.id)?.companyId).toBe('co_crest')
    expect(financeJournal.some((e) => e.companyId === 'co_apex' && e.sourceType === 'year_end_close')).toBe(false)
    expect(financeSettings.get('co_apex').lockDate).toBe(apexLock)
    expect(financeSettings.get('co_crest').lockDate).toBe(end)
  })
})

describe('numbers equal an own recomputation', () => {
  for (const co of COMPANIES) {
    it(`${co}: P&L, balance sheet and cash flow come from the company's own journal`, async () => {
      const a = admin(co)
      runFinanceHooks(co)
      const from = `${today(co).slice(0, 4)}-01-01`
      const types = new Map(financeAccounts.filter((x) => x.companyId === co).map((x) => [x.id, x.type]))
      const profit = financeJournal
        .filter((e) => e.companyId === co && e.date >= from && e.date <= today(co))
        .flatMap((e) => e.lines)
        .reduce((s, l) => s + (types.get(l.accountId) === 'income' || types.get(l.accountId) === 'expense' ? l.credit - l.debit : 0), 0)
      const pnl = await call(a, 'GET', `/finance/statements/profit-and-loss?period=custom&from=${from}&to=${today(co)}`)
      expect(pnl.body.totals.net_profit[0]).toBeCloseTo(profit, 2)
      expect(pnl.body.currency).toBe(co === 'co_apex' ? 'AED' : 'SAR')
      const bs = await call(a, 'GET', '/finance/statements/balance-sheet')
      expect(bs.body.balanced).toBe(true)
      expect(bs.body.totals.difference).toEqual([0])
      const cf = await call(a, 'GET', `/finance/statements/cash-flow?from=${from}&to=${today(co)}`)
      expect(cf.body.check).toBe(0)
      const bank = financeJournal.filter((e) => e.companyId === co).flatMap((e) => e.lines).filter((l) => l.accountId === 'ACC-1120').reduce((s, l) => s + l.debit - l.credit, 0)
      expect((cf.body.cash_accounts as { account_id: string; closing: number }[]).find((c) => c.account_id === 'ACC-1120')!.closing).toBeCloseTo(bank, 2)
    })
  }
})
