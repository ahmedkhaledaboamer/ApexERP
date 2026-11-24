import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/shared/types'
import type { ForecastItem } from '@/modules/finance/planning/types'
import { agingBucketOf, bucketize, copyWithAdjustment, expected, expectedInvoiceDate, levelReached, lowestOf, monthRanges, spreadAnnual, statusOf, variance, weekRanges } from '@/modules/finance/planning/calc'
import { customers, users } from '@/shared/mocks/db'
import { finBudgets } from '@/shared/mocks/data/financeBudgets'
import { notifications } from '@/shared/mocks/data/tasks'
import { invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { finCustomerCredit, finPdcs } from '@/shared/mocks/data/financeCollections'
import { hrPayrollRuns, hrPaySettings } from '@/shared/mocks/data/hrPayroll'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import '@/shared/mocks/handlers'
import { postJournal, runFinanceHooks } from './ledger'
import * as b from './financeBudgets'
import * as f from './financeForecast'
import { fixtureInvoice } from './financeCollections.fixtures'
import { addDays } from './financeCollectionsCore'

/** Accounts & finance › Budgets (spread, copy, approval, budget vs actual, department heads, alerts) and the cash-flow forecast. */

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const APEX = 'co_apex'
const today = (co: string) => companyDayOf(co).today
const year = (co: string) => Number(today(co).slice(0, 4))

/** An expense posting with a department, dated `date`. */
function spend(co: string, dept: string, account: string, amount: number, date = today(co)) {
  return postJournal(co, { date, memo: 'Test spend', sourceType: 'manual', sourceId: null, createdBy: null, lines: [{ accountId: account, debit: amount, credit: 0, description: 'Spend', departmentId: dept }, { accountId: 'ACC-1120', debit: 0, credit: amount, description: 'Bank' }] })
}

describe('budget rules (pure)', () => {
  it('spreads an annual amount evenly or by pattern, always adding up', () => {
    const even = spreadAnnual(1000)
    expect(even.slice(0, 11).every((m) => m === 83.33)).toBe(true)
    expect(even[11]).toBe(83.37)
    expect(even.reduce((s, m) => s + m, 0)).toBeCloseTo(1000, 2)
    const front = spreadAnnual(7800, 'front_loaded')
    expect(front[0]).toBe(1200)
    expect(front[11]).toBe(100)
    const profile = [0, 0, 0, 0, 0, 0, 0, 0, 100, 100, 200, 0]
    expect(spreadAnnual(800, 'last_year', profile)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 200, 200, 400, 0])
    expect(spreadAnnual(1200, 'last_year', Array(12).fill(0))).toEqual(Array(12).fill(100))
  })
  it('copies actuals ± %, variance sign by account type, alert levels', () => {
    expect(copyWithAdjustment([100, 0, 50.5], 10)).toEqual([110, 0, 55.55])
    expect(copyWithAdjustment([100], -20)).toEqual([80])
    expect(variance('expense', 1000, 1200)).toBe(-200)
    expect(variance('income', 1000, 1200)).toBe(200)
    expect(levelReached(89, 100)).toBeNull()
    expect(levelReached(90, 100)).toBe(90)
    expect(levelReached(100, 100)).toBe(100)
    expect(levelReached(50, 0)).toBeNull()
    expect(statusOf(95)).toBe('warning')
    expect(statusOf(101)).toBe('over')
  })
})

describe('budgets', () => {
  it('create with a copy of actuals ± %, edit lines, approval by Management only, locked after approval', () => {
    const acc = u('u8')
    const next = year(APEX) + 1
    spend(APEX, 'd-marketing', 'ACC-6400', 1000)
    const d = b.createBudget(acc, { fiscalYear: next, copyFromYear: year(APEX), adjustPct: 10 })
    expect(d.status).toBe('draft')
    const mk = d.lines.find((l) => l.departmentId === 'd-marketing' && l.accountCode === '6400')!
    const mi = Number(today(APEX).slice(5, 7)) - 1
    expect(mk.months[mi]).toBeGreaterThanOrEqual(1100)
    expect(() => b.createBudget(acc, { fiscalYear: next })).toThrow(/already a budget/)
    const edited = b.putBudgetLines(acc, d.id, { lines: [{ departmentId: 'd-sales', accountId: 'ACC-6500', annual: 12000, pattern: 'even' }, { departmentId: 'd-marketing', accountId: 'ACC-6400', months: Array(12).fill(0) }] })
    expect(edited.lines.find((l) => l.departmentId === 'd-sales' && l.accountCode === '6500')!.months).toEqual(Array(12).fill(1000))
    expect(edited.lines.some((l) => l.departmentId === 'd-marketing' && l.accountCode === '6400')).toBe(false)
    expect(() => b.putBudgetLines(acc, d.id, { lines: [{ departmentId: 'c2-ops', accountId: 'ACC-6500', annual: 1 }] })).toThrow(/department of the company/)
    expect(() => b.putBudgetLines(acc, d.id, { lines: [{ departmentId: 'd-sales', accountId: 'ACC-1120', annual: 1 }] })).toThrow(/income or expense/)
    expect(() => b.approveBudget(acc, d.id)).toThrow(/Only Management/)
    const ok = b.approveBudget(u('u2'), d.id)
    expect(ok).toMatchObject({ status: 'approved', approvedByName: 'Layla Mansour' })
    expect(() => b.putBudgetLines(acc, d.id, { lines: [{ departmentId: 'd-sales', accountId: 'ACC-6500', annual: 1 }] })).toThrow(/locked/)
    expect(() => b.deleteBudget(acc, d.id)).toThrow(/can’t be deleted/)
    b.reopenBudget(u('u2'), d.id)
    expect(b.deleteBudget(acc, d.id)).toEqual({ id: d.id })
  })

  it('budget vs actual: month and YTD per department × account with variance and %', () => {
    const acc = u('u8')
    const bud = finBudgets.find((x) => x.companyId === APEX && x.fiscalYear === year(APEX))!
    spend(APEX, 'd-marketing', 'ACC-6600', 2500)
    const r = b.getBudgetVsActual(acc, bud.id, { departmentId: 'd-marketing' })
    const row = r.rows.find((x) => x.accountCode === '6600')!
    expect(row.monthBudget).toBe(3000)
    expect(row.monthActual).toBeGreaterThanOrEqual(2500)
    expect(row.monthVariance).toBe(Math.round((3000 - row.monthActual) * 100) / 100)
    expect(row.ytdBudget).toBe(3000 * (r.monthIndex + 1))
    expect(row.variance).toBeCloseTo(row.ytdBudget - row.ytdActual, 2)
    expect(r.rows.every((x) => x.departmentId === 'd-marketing')).toBe(true)
    // An unbudgeted account with actuals shows with budget 0.
    spend(APEX, 'd-marketing', 'ACC-6800', 50)
    const r2 = b.getBudgetVsActual(acc, bud.id, { departmentId: 'd-marketing' })
    expect(r2.rows.find((x) => x.accountCode === '6800')).toMatchObject({ monthBudget: 0, usedPct: null })
  })

  it('department heads see their own department only; others are refused', () => {
    const head = u('u10') // Department Head of Delivery (accounting hidden)
    const bud = finBudgets.find((x) => x.companyId === APEX && x.fiscalYear === year(APEX))!
    const list = b.listBudgets(head)
    expect(list.find((x) => x.id === bud.id)!.departmentScoped).toBe(true)
    const d = b.getBudget(head, bud.id)
    expect(d.lines.length).toBeGreaterThan(0)
    expect(d.lines.every((l) => l.departmentId === 'd-delivery')).toBe(true)
    expect(d.accounts).toEqual([])
    expect(d.can).toEqual({ edit: false, approve: false, reopen: false, delete: false })
    const v = b.getBudgetVsActual(head, bud.id)
    expect(v.rows.every((x) => x.departmentId === 'd-delivery')).toBe(true)
    expect(v.unassignedExpenseYtd).toBe(0)
    expect(() => b.getBudgetVsActual(head, bud.id, { departmentId: 'd-sales' })).toThrow('Not found')
    expect(() => b.putBudgetLines(head, bud.id, { lines: [] })).toThrow(/Only/)
    // Marketing Manager heads Marketing; an employee heads nothing.
    expect(b.getBudget(u('u7'), bud.id).lines.every((l) => l.departmentId === 'd-marketing')).toBe(true)
    expect(() => b.listBudgets(u('u11'))).toThrow(/department heads/)
    // Sales Manager (accounting view) sees everything.
    expect(new Set(b.getBudget(u('u3'), bud.id).lines.map((l) => l.departmentId)).size).toBeGreaterThan(1)
  })

  it('alerts: 90 % then 100 % of the month’s budget, once each, to the head and the accountants', () => {
    const bud = finBudgets.find((x) => x.companyId === APEX && x.fiscalYear === year(APEX))!
    const mi = Number(today(APEX).slice(5, 7)) - 1
    const itBudget = bud.lines.filter((l) => l.departmentId === 'd-it').reduce((s, l) => s + l.months[mi], 0)
    const actualNow = b.getBudgetVsActual(u('u8'), bud.id, { departmentId: 'd-it' }).departments[0]?.monthActual ?? 0
    const before = notifications.length
    spend(APEX, 'd-it', 'ACC-6600', Math.max(1, Math.ceil(itBudget * 0.92 - actualNow)))
    const sent = b.runBudgetAlerts(APEX).filter((s) => s.departmentId === 'd-it' && s.kind === 'month')
    expect(sent).toEqual([{ departmentId: 'd-it', kind: 'month', level: 90 }])
    const fresh = notifications.slice(0, notifications.length - before).filter((n) => n.title.startsWith('IT has used'))
    expect(new Set(fresh.map((n) => n.userId))).toEqual(new Set(['u1', 'u8']))
    expect(fresh.every((n) => n.type === 'finance' && n.companyId === APEX && n.link.includes('department=d-it'))).toBe(true)
    expect(b.runBudgetAlerts(APEX).filter((s) => s.departmentId === 'd-it' && s.kind === 'month')).toEqual([])
    spend(APEX, 'd-it', 'ACC-6600', Math.ceil(itBudget * 0.1))
    expect(b.runBudgetAlerts(APEX).filter((s) => s.departmentId === 'd-it' && s.kind === 'month')).toEqual([{ departmentId: 'd-it', kind: 'month', level: 100 }])
    expect(bud.alertMarks.filter((m) => m.startsWith('d-it:month'))).toHaveLength(2)
    // Crest is untouched.
    expect(finBudgets.find((x) => x.companyId === 'co_crest')!.alertMarks).toEqual([])
  })
})

describe('cash-flow forecast (pure)', () => {
  it('aging buckets and expected dates', () => {
    const t0 = '2026-11-21'
    expect(agingBucketOf('2026-11-30', t0)).toBe('current')
    expect(agingBucketOf('2026-11-21', t0)).toBe('current')
    expect(agingBucketOf('2026-11-20', t0)).toBe('d1_30')
    expect(agingBucketOf('2026-10-07', t0)).toBe('d31_60')
    expect(agingBucketOf('2026-09-01', t0)).toBe('d61_90')
    expect(agingBucketOf('2026-01-01', t0)).toBe('d90_plus')
    expect(expectedInvoiceDate('2026-12-05', t0)).toBe('2026-12-05')
    expect(expectedInvoiceDate('2026-10-07', t0)).toBe('2026-12-05')
    expect(expected(1000, 70, 0)).toBe(700)
    expect(expected(-1000, 100, 10)).toBe(-1100)
  })
  it('buckets: 13 weeks, 6 months, running balance and the lowest week', () => {
    const t0 = '2026-11-21'
    const weeks = weekRanges(t0)
    expect(weeks).toHaveLength(13)
    expect(weeks[0]).toMatchObject({ from: '2026-11-21', to: '2026-11-27' })
    expect(monthRanges(t0)[0]).toMatchObject({ key: '2026-11', from: '2026-11-21', to: '2026-11-30' })
    expect(monthRanges(t0)[5].key).toBe('2027-04')
    const item = (date: string, amount: number): ForecastItem => ({ id: date, date, category: amount > 0 ? 'receivables' : 'bills', label: '', ref: null, link: null, amount, gross: amount, probability: 100 })
    const bk = bucketize(1000, [item('2026-11-22', 500), item('2026-11-29', -2000), item('2026-12-10', 300)], weeks)
    expect(bk.slice(0, 4).map((x) => x.closing)).toEqual([1500, -500, -200, -200])
    expect(lowestOf(bk).key).toBe('W2')
  })
})

describe('cash-flow forecast', () => {
  afterEach(() => vi.useRealTimers())

  it('collection probability by aging bucket; PDC 100 % or 70 % after a bounce; held cheques not counted twice', () => {
    runFinanceHooks(APEX)
    const t0 = today(APEX)
    const cust = customers.find((c) => c.companyId === APEX && !finCustomerCredit.some((x) => x.companyId === APEX && x.customerId === c.id && x.bouncedCheques > 0))!
    const overdue = fixtureInvoice(APEX, { customerId: cust.id, total: 10000, issueDate: addDays(t0, -80), dueDate: addDays(t0, -45) })
    const fresh = fixtureInvoice(APEX, { customerId: cust.id, total: 5000, issueDate: t0, dueDate: addDays(t0, 20) })
    finPdcs.push({ companyId: APEX, id: 'PDC-T1', chequeNo: '000777', bankName: 'Test', customerId: cust.id, receivedDate: t0, dueDate: addDays(t0, 10), amount: 2000, currency: 'AED', exchangeRate: 1, allocations: [{ invoiceId: fresh.id, invoiceNumber: fresh.number, amount: 2000 }], status: 'received', depositAccountId: null, depositedDate: null, clearedDate: null, bouncedDate: null, bounceReason: null, bounceFee: 0, paymentId: null, notes: '', journalEntryIds: [], dueNotifiedAt: null, createdBy: 'u8', createdAt: t0 })
    let items = f.forecastItems(APEX, t0, addDays(t0, 200))
    expect(items.find((i) => i.id === `inv:${overdue.id}`)).toMatchObject({ probability: 70, gross: 10000, amount: 7000, date: addDays(t0, 14) })
    expect(items.find((i) => i.id === `inv:${fresh.id}`)).toMatchObject({ probability: 95, gross: 3000, date: addDays(t0, 20) })
    expect(items.find((i) => i.id === 'pdc:PDC-T1')).toMatchObject({ probability: 100, amount: 2000, date: addDays(t0, 10) })
    const credit = finCustomerCredit.find((c) => c.companyId === APEX && c.customerId === cust.id)
    if (credit) credit.bouncedCheques = 1
    else finCustomerCredit.push({ companyId: APEX, customerId: cust.id, creditLimit: null, creditHold: false, dunningPaused: false, bouncedCheques: 1, lastBounceDate: t0, updatedAt: t0 })
    items = f.forecastItems(APEX, t0, addDays(t0, 200))
    expect(items.find((i) => i.id === 'pdc:PDC-T1')).toMatchObject({ probability: 70, amount: 1400 })
    expect(invoiceRecords.some((i) => i.id === fresh.id)).toBe(true)
  })

  it('payroll on the pay day (company timezone): last run net + social insurance; lowest-balance week', () => {
    // 20:30 UTC on 28 Nov 2026 is already 29 Nov in Dubai: the 28th pay day has passed for Apex.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-28T20:30:00Z'))
    runFinanceHooks(APEX)
    const fc = f.getCashForecast(u('u8'))
    expect(fc.today).toBe('2026-11-29')
    const pay = hrPaySettings.find((p) => p.companyId === APEX)?.payDay ?? 28
    const last = hrPayrollRuns.filter((r) => r.companyId === APEX && r.lines.length).sort((a, c) => c.month.localeCompare(a.month))[0]
    const payroll = fc.items.filter((i) => i.category === 'payroll')
    expect(payroll.some((i) => i.date === '2026-11-28')).toBe(false)
    const dec = payroll.filter((i) => i.date === `2026-12-${String(pay).padStart(2, '0')}`)
    expect(dec).toHaveLength(2)
    const net = Math.round(last.lines.reduce((s, l) => s + l.net, 0) * 100) / 100
    expect(dec.find((i) => i.id.startsWith('pay:'))!.amount).toBe(-net)
    expect(fc.weeks).toHaveLength(13)
    expect(fc.months).toHaveLength(6)
    const lowest = fc.weeks.reduce((m, w) => Math.min(m, w.closing), Infinity)
    expect(fc.lowestWeek.closing).toBe(lowest)
    expect(fc.weeks[0].opening).toBe(fc.openingCash)
  })

  it('settings and manual lines (full only); scenario % applies to inflows', () => {
    const acc = u('u8')
    const t0 = today(APEX)
    const before = f.getCashForecast(acc)
    const fc = f.addForecastLine(acc, { label: 'New office deposit', date: addDays(t0, 3), amount: -40000, recurrence: 'once' })
    const line = fc.settings.lines.find((l) => l.label === 'New office deposit')!
    expect(fc.weeks[0].closing).toBeCloseTo(before.weeks[0].closing - 40000, 2)
    const scen = f.putForecastSettings(acc, { inflowAdjustPct: -50 })
    const inv = scen.items.find((i) => i.category === 'receivables')
    if (inv) expect(inv.amount).toBeCloseTo(inv.gross * (inv.probability / 100) * 0.5, 1)
    expect(() => f.putForecastSettings(u('u3'), { inflowAdjustPct: 5 })).toThrow(/Only/)
    expect(f.deleteForecastLine(acc, line.id).settings.lines.some((l) => l.id === line.id)).toBe(false)
    expect(() => f.deleteForecastLine(acc, 'FCL-404')).toThrow('Not found')
  })
})
