import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership, companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { callApi } from './helpers'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Accounts & finance › ledger core and setup — TABLE-DRIVEN FROM PERMISSION_MATRIX (`accounting` column;
 * docs/API.md › Finance › Ledger & settings):
 *   full    settings, chart, journal, reports, overview: read and write; the lock date only for Company Admin and
 *           Accountant (Management → 403 lock_date_forbidden)
 *   view    (Sales Manager) every read (settings, chart, journal, entry, ledger, trial balance, overview); writes 403
 *   hidden  403 everywhere
 * Every role × both companies; the plan gate (module `accounting` removed through a platform override → 403
 * module_not_in_plan); foreign ids; a spoofed company; numbers recomputed from the company's own data.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const LOCKERS: readonly Role[] = ['Company Admin', 'Accountant']

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
        id: `u-fin-${co}-${slug}`,
        companyId: co,
        name: `Finance ${role} ${co}`,
        email: `fin-${slug}@${co}.test`,
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
const manual = (co: Co, memo = 'Role probe') => ({
  date: today(co),
  memo,
  lines: [
    { account_id: 'ACC-6800', debit: 3, credit: 0 },
    { account_id: 'ACC-1120', debit: 0, credit: 3 },
  ],
})

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
        const entry = financeJournal.find((e) => e.companyId === co)!
        const reads: string[] = [
          '/finance/settings',
          '/finance/accounts',
          '/finance/accounts/ACC-1120/ledger',
          '/finance/journal',
          `/finance/journal/${entry.id}`,
          '/finance/reports/trial-balance',
          '/finance/overview',
          '/finance/exchange-rates/lookup?currency=USD',
        ]
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        const writes: [string, string, unknown?][] = [
          ['GET', '/finance/journal/dimensions'],
          ['PATCH', '/finance/settings', { payment_terms_days: 14 }],
          ['POST', '/finance/exchange-rates', { currency: 'CHF', rate: 4.2, effective_date: '2026-09-01' }],
          ['POST', '/finance/accounts', { code: '6975', name: 'Role probe', type: 'expense', parent_id: 'ACC-6000' }],
          ['PATCH', '/finance/accounts/ACC-6200', { description: 'Office and warehouse rent' }],
          ['POST', '/finance/journal', manual(co)],
          ['POST', '/finance/opening-balances', { date: today(co), lines: [{ account_id: 'ACC-1520', debit: 10, credit: 0 }] }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(scope === 'full' ? 200 : 403)
        }
        const lock = await call(u, 'PUT', '/finance/settings/lock-date', { lock_date: '2025-12-31', reason: 'Probe' })
        expect(lock.status, `${role} lock date`).toBe(scope === 'full' && LOCKERS.includes(roleOf(u)) ? 200 : 403)
        if (scope === 'full' && !LOCKERS.includes(roleOf(u))) expect(lock.body.code).toBe('lock_date_forbidden')
        if (scope !== 'hidden') {
          const s = await call(u, 'GET', '/finance/settings')
          expect(s.body.can_edit).toBe(scope === 'full')
          expect(s.body.can_move_lock_date).toBe(scope === 'full' && LOCKERS.includes(roleOf(u)))
        }
      })
    }
  }
})

describe('plan gate', () => {
  it('without the accounting module every role answers 403 module_not_in_plan; the other company still answers', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'accounting', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    for (const role of ROLES) {
      const r = await call(userFor('co_crest', role), 'GET', '/finance/overview')
      expect(r.status, role).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_apex', 'Accountant'), 'GET', '/finance/overview')).status).toBe(200)
  })
})

describe('ids of the other company behave like missing ids; spoofed company fields are ignored', () => {
  const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
  const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
  const entryOf = (co: Co) => financeJournal.find((e) => e.companyId === co && e.sourceType === 'manual' && e.status === 'posted' && !e.reversalOf)!
  const rateOf = (co: Co) => financeSettings.get(co).exchangeRates[0].id
  const cases: { name: string; id: (co: Co) => string; send: (co: Co, id: string) => Promise<{ status: number; body: unknown }> }[] = [
    { name: 'journal entry', id: (co) => entryOf(co).id, send: (co, id) => call(admin(co), 'GET', `/finance/journal/${id}`) },
    { name: 'reverse entry', id: (co) => entryOf(co).id, send: (co, id) => call(admin(co), 'POST', `/finance/journal/${id}/reverse`, { date: today(co) }) },
    { name: 'exchange rate', id: rateOf, send: (co, id) => call(admin(co), 'DELETE', `/finance/exchange-rates/${id}`) },
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

  it('a spoofed company id in a manual entry, an account and the lock date lands in the caller’s company only', async () => {
    const r = await call(admin('co_crest'), 'POST', '/finance/journal', { ...manual('co_crest', 'Spoof'), company_id: 'co_apex', companyId: 'co_apex' })
    expect(r.status).toBe(200)
    expect(financeJournal.find((e) => e.id === r.body.id)?.companyId).toBe('co_crest')
    const a = await call(admin('co_apex'), 'POST', '/finance/accounts', { code: '6976', name: 'Spoof', type: 'expense', company_id: 'co_crest' })
    expect(a.status).toBe(200)
    expect(financeAccounts.find((x) => x.id === a.body.id)?.companyId).toBe('co_apex')
    const crestLock = financeSettings.get('co_crest').lockDate
    expect((await call(admin('co_apex'), 'PUT', '/finance/settings/lock-date', { lock_date: '2026-01-31', company_id: 'co_crest' })).status).toBe(200)
    expect(financeSettings.get('co_apex').lockDate).toBe('2026-01-31')
    expect(financeSettings.get('co_crest').lockDate).toBe(crestLock)
  })
})

describe('numbers equal an own recomputation', () => {
  for (const co of COMPANIES) {
    it(`${co}: journal, trial balance and overview hold the company's own data only`, async () => {
      const a = users.find((u) => u.id === ADMIN[co])!
      runFinanceHooks(co) // the first finance access seeds collections (payments post to the journal)
      const mine = financeJournal.filter((e) => e.companyId === co)
      const list = await call(a, 'GET', '/finance/journal')
      expect((list.body as { id: string }[]).map((x) => x.id).sort()).toEqual(mine.map((e) => e.id).sort())
      const tb = await call(a, 'GET', '/finance/reports/trial-balance')
      const dr = mine.flatMap((e) => e.lines).reduce((s, l) => s + l.debit, 0)
      const cr = mine.flatMap((e) => e.lines).reduce((s, l) => s + l.credit, 0)
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
      expect(tb.body.balanced).toBe(true)
      expect(tb.body.totals.debit).toBe(tb.body.totals.credit)
      const bank = mine.flatMap((e) => e.lines).filter((l) => l.accountId === 'ACC-1120').reduce((s, l) => s + l.debit - l.credit, 0)
      const row = (tb.body.rows as { account_id: string; debit: number; credit: number }[]).find((r) => r.account_id === 'ACC-1120')!
      expect(row.debit - row.credit).toBeCloseTo(bank, 2)
      const ov = await call(a, 'GET', '/finance/overview')
      expect((ov.body.cash as { account_id: string; balance: number }[]).find((c) => c.account_id === 'ACC-1120')!.balance).toBeCloseTo(bank, 2)
      expect(ov.body.currency).toBe(co === 'co_apex' ? 'AED' : 'SAR')
    })
  }
})
