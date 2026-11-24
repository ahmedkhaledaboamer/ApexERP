import { afterEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { auditLog } from '@/shared/mocks/data/audit'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { r2, sumByAccount } from '@/modules/finance/ledger/calc'
import { addDays, addMonths, fiscalYearLabel, fiscalYearOf } from '@/modules/finance/statements/calc'
import { runFinanceHooks } from './ledger'
import * as fin from './financeLedger'
import * as st from './financeStatements'
// Every store registered before the snapshot.
import '@/shared/mocks/handlers'

/** Financial statements and year-end close on the full seeded books of both companies (journal only). */

const snap = takeSnapshot(true)
afterEach(() => restoreSnapshot(snap))

const u = (id: string) => users.find((x) => x.id === id)! as User
const omar = () => u('u1') // Apex Company Admin
const layla = () => u('u2') // Apex Management
const karim = () => u('u3') // Apex Sales Manager
const rashid = () => u('u8') // Apex Accountant
const faisal = () => u('u101') // Crest Company Admin
const today = (co: string) => companyDayOf(co).today
const COS = [APEX_ID, CREST_ID] as const
const adminOf = (co: string) => (co === APEX_ID ? omar() : faisal())

/** Income − expenses straight from the journal lines (closing entries excluded). */
function journalProfit(co: string, from: string, to: string, keep: (l: { departmentId?: string | null }) => boolean = () => true): number {
  const types = new Map(financeAccounts.filter((a) => a.companyId === co).map((a) => [a.id, a.type]))
  let p = 0
  for (const e of financeJournal) {
    if (e.companyId !== co || e.date < from || e.date > to || e.sourceType === 'year_end_close') continue
    for (const l of e.lines) {
      const t = types.get(l.accountId)
      if ((t === 'income' || t === 'expense') && keep(l)) p += l.credit - l.debit
    }
  }
  return r2(p)
}

describe('statements on the full seeded books', () => {
  for (const co of COS) {
    it(`${co}: the balance sheet balances (A = L + E) at several dates`, () => {
      runFinanceHooks(co)
      for (const asOf of [today(co), '2026-01-01', '2026-03-31', '2026-06-30', '2026-09-30']) {
        const bs = st.balanceSheet(co, asOf)
        expect(bs.difference, asOf).toBe(0)
        expect(bs.balanced, asOf).toBe(true)
        expect(bs.totalAssets).toBe(bs.liabilitiesAndEquity)
      }
      const view = st.getBalanceSheet(adminOf(co), { asOf: today(co), compareTo: '2026-06-30' })
      expect(view.balanced).toBe(true)
      expect(view.columns.map((c) => c.to)).toEqual([today(co), '2026-06-30'])
    })

    it(`${co}: P&L net profit equals the journal; sections add up`, () => {
      runFinanceHooks(co)
      const from = fiscalYearOf(today(co), 1).start
      const p = st.profitAndLoss(co, from, today(co))
      expect(p.netProfit).toBe(journalProfit(co, from, today(co)))
      expect(p.grossProfit).toBe(r2(p.revenue - p.costOfSales))
      expect(p.operatingProfit).toBe(r2(p.grossProfit - p.operatingExpenses))
      expect(p.netProfit).toBe(r2(p.operatingProfit + p.otherIncome - p.otherExpenses))
      expect(p.revenue).toBeGreaterThan(0)
      // Current-year earnings on the balance sheet = the YTD P&L.
      expect(st.balanceSheet(co, today(co)).currentYearEarnings).toBe(p.netProfit)
    })

    it(`${co}: the YTD cash flow reconciles to the change in cash and bank`, () => {
      runFinanceHooks(co)
      const from = fiscalYearOf(today(co), 1).start
      const cf = st.cashFlow(co, from, today(co))
      expect(cf.check).toBe(0)
      expect(cf.reconciles).toBe(true)
      const overview = fin.getFinanceOverview(adminOf(co))
      expect(cf.closingCash).toBeCloseTo(overview.cashTotal, 2)
      for (const [f, t] of [['2026-04-01', '2026-06-30'], ['2026-10-01', today(co)]]) expect(st.cashFlow(co, f, t).check, `${f}..${t}`).toBe(0)
      expect(cf.operating.adjustments.some((l) => l.code === '1590')).toBe(true) // depreciation added back
    })
  }

  it('department filter: the P&L equals the department’s journal lines; unknown / foreign ids match nothing', () => {
    runFinanceHooks(APEX_ID)
    const from = '2026-01-01'
    const to = today(APEX_ID)
    const deptLines = financeJournal.filter((e) => e.companyId === APEX_ID).flatMap((e) => e.lines.map((l) => l.departmentId)).filter((d): d is string => !!d)
    const dept = deptLines.sort((a, b) => deptLines.filter((x) => x === b).length - deptLines.filter((x) => x === a).length)[0]
    const p = st.getProfitAndLoss(rashid(), { period: 'custom', from, to, departmentId: dept })
    expect(p.totals.netProfit[0]).toBe(journalProfit(APEX_ID, from, to, (l) => l.departmentId === dept))
    expect(p.dimNames.department).toBeTruthy()
    const crestDept = financeJournal.find((e) => e.companyId === CREST_ID && e.lines.some((l) => l.departmentId))!.lines.find((l) => l.departmentId)!.departmentId!
    const foreign = st.getProfitAndLoss(rashid(), { period: 'custom', from, to, departmentId: crestDept })
    expect(foreign.totals.netProfit).toEqual([0])
    expect(foreign.dimNames.department).toBeNull()
  })

  it('comparisons and the monthly view', () => {
    const p = st.getProfitAndLoss(rashid(), { period: 'month', date: '2026-10-15', compare: 'previous_period,last_year' })
    expect(p.columns.map((c) => [c.key, c.from, c.to])).toEqual([
      ['current', '2026-10-01', '2026-10-31'],
      ['previous_period', '2026-09-01', '2026-09-30'],
      ['last_year', '2025-10-01', '2025-10-31'],
    ])
    expect(p.totals.netProfit[0]).toBe(journalProfit(APEX_ID, '2026-10-01', '2026-10-31'))
    expect(p.totals.netProfit[1]).toBe(journalProfit(APEX_ID, '2026-09-01', '2026-09-30'))
    const m = st.getProfitAndLoss(rashid(), { view: 'monthly', period: 'fiscal_year' })
    expect(m.columns).toHaveLength(13)
    expect(m.columns[12].key).toBe('total')
    expect(m.totals.netProfit[12]).toBe(r2(m.totals.netProfit.slice(0, 12).reduce((s, x) => s + x, 0)))
  })

  it('general ledger: opening + movements = closing per account; trial balance comparatives balance', () => {
    const gl = st.getGeneralLedger(rashid(), { from: '2026-06-01', to: '2026-09-30' })
    expect(gl.accounts.length).toBeGreaterThan(5)
    for (const a of gl.accounts) {
      const dr = a.account.type === 'asset' || a.account.type === 'expense'
      expect(a.closingBalance, a.account.code).toBeCloseTo(a.openingBalance + (dr ? a.totals.debit - a.totals.credit : a.totals.credit - a.totals.debit), 2)
    }
    const bank = st.getGeneralLedger(rashid(), { from: '2026-06-01', to: '2026-09-30', accountFrom: '1120', accountTo: '1120' })
    expect(bank.accounts.map((a) => a.account.code)).toEqual(['1120'])
    const tb = st.getTrialBalanceComparative(rashid(), { asOf: today(APEX_ID), compareTo: '2026-06-30' })
    expect(tb.balanced).toEqual([true, true])
  })

  it('Sales Manager reads every statement; hidden roles get 403', () => {
    expect(st.getProfitAndLoss(karim()).columns).toHaveLength(1)
    expect(st.getStatementsMeta(karim()).canClose).toBe(false)
    const agent = users.find((x) => x.companyId === APEX_ID && x.role === 'Sales Agent')!
    expect(() => st.getBalanceSheet(agent)).toThrow(expect.objectContaining({ status: 403 }))
  })
})

describe('year-end close (a fiscal year starting this month: not January in general)', () => {
  // The seed is relative to today: with the year starting this month, the previous fiscal year ended last month.
  const T = companyDayOf(APEX_ID).today
  const startMonth = Number(T.slice(5, 7))
  const fyEnd = addDays(`${T.slice(0, 7)}-01`, -1)
  const fyStart = addMonths(addDays(fyEnd, 1), -12)
  const prevEnd = addDays(fyStart, -1)
  const nextStart = addDays(fyEnd, 1)
  const toNovember = () => fin.updateFinanceSettings(rashid(), { fiscalYearStartMonth: startMonth })

  it('previews, closes (closing entry + lock date, audited), keeps the closed year’s P&L', () => {
    toNovember()
    runFinanceHooks(APEX_ID)
    const preview = st.previewYearEnd(rashid(), { fiscalYearEnd: fyEnd })
    expect(preview.start).toBe(fyStart)
    expect(preview.label).toBe(fiscalYearLabel(fyStart, fyEnd))
    expect(preview.canClose).toBe(true)
    expect(preview.totals.debit).toBe(preview.totals.credit)
    expect(preview.netProfit).toBe(journalProfit(APEX_ID, fyStart, fyEnd))
    expect(preview.lines.find((l) => l.code === '3200')).toBeTruthy()
    expect(st.previewYearEnd(rashid()).end).toBe(fyEnd) // default: the ended open year

    const res = st.closeYear(rashid(), { fiscalYearEnd: fyEnd, note: 'Audited accounts' })
    expect(res.lockDate).toBe(fyEnd)
    expect(financeSettings.get(APEX_ID).lockDate).toBe(fyEnd)
    const entry = financeJournal.find((e) => e.id === res.close.entryId)!
    expect(entry.sourceType).toBe('year_end_close')
    expect(entry.date).toBe(fyEnd)
    // Every income / expense account is zero at the year end; retained earnings holds the result.
    const sums = sumByAccount(financeJournal.filter((e) => e.companyId === APEX_ID), { to: fyEnd })
    for (const a of financeAccounts.filter((x) => x.companyId === APEX_ID && (x.type === 'income' || x.type === 'expense'))) {
      const s = sums.get(a.id)
      expect(s ? r2(s.debit - s.credit) : 0, a.code).toBe(0)
    }
    // The closed year's P&L still shows its activity; the balance sheet still balances.
    expect(st.profitAndLoss(APEX_ID, fyStart, fyEnd).netProfit).toBe(preview.netProfit)
    const bs = st.balanceSheet(APEX_ID, today(APEX_ID))
    expect(bs.balanced).toBe(true)
    expect(bs.priorYearsEarnings).toBe(0)
    expect(bs.currentYearEarnings).toBe(journalProfit(APEX_ID, nextStart, today(APEX_ID)))
    expect(st.balanceSheet(APEX_ID, fyEnd).currentYearEarnings).toBe(0)
    expect(st.cashFlow(APEX_ID, fyStart, today(APEX_ID)).check).toBe(0)
    // Postings into the closed year are refused; the lock-date change and the close are audited.
    expect(() => fin.createManualJournal(rashid(), { date: addDays(fyEnd, -16), memo: 'Late', lines: [{ accountId: 'ACC-6800', debit: 1, credit: 0 }, { accountId: 'ACC-1120', debit: 0, credit: 1 }] })).toThrow(expect.objectContaining({ status: 423 }))
    expect(auditLog.some((a) => a.companyId === APEX_ID && a.entity === 'finance_lock_date' && a.summary.includes('Year-end close'))).toBe(true)
    expect(auditLog.some((a) => a.companyId === APEX_ID && a.entity === 'year_end_close' && a.entityId === res.close.id)).toBe(true)
    // The year list shows it closed; a second close is refused.
    const y = st.getYearEnd(rashid()).years.find((x) => x.end === fyEnd)!
    expect(y.status).toBe('closed')
    expect(y.canReopen).toBe(false) // Accountant
    expect(st.getYearEnd(omar()).years.find((x) => x.end === fyEnd)!.canReopen).toBe(true)
    expect(() => st.closeYear(rashid(), { fiscalYearEnd: fyEnd })).toThrow(expect.objectContaining({ status: 409, code: 'already_closed' }))
    // Crest is untouched.
    expect(financeJournal.some((e) => e.companyId === CREST_ID && e.sourceType === 'year_end_close')).toBe(false)
    expect(financeSettings.get(CREST_ID).lockDate).toBe('2025-12-31')
  })

  it('re-open: Company Admin only, with a reason; reverses the entry and restores the lock date; can close again', () => {
    toNovember()
    const res = st.closeYear(omar(), { fiscalYearEnd: fyEnd })
    expect(() => st.reopenYear(rashid(), res.close.id, { reason: 'Adjust' })).toThrow(expect.objectContaining({ status: 403, code: 'reopen_forbidden' }))
    expect(() => st.reopenYear(omar(), res.close.id, { reason: '' })).toThrow(expect.objectContaining({ status: 422 }))
    expect(() => st.reopenYear(omar(), 'YEC-missing', { reason: 'x' })).toThrow(expect.objectContaining({ status: 404 }))
    const back = st.reopenYear(omar(), res.close.id, { reason: 'Auditor adjustment' })
    expect(back.close.status).toBe('reopened')
    expect(back.lockDate).toBeNull() // Apex had no lock before
    const orig = financeJournal.find((e) => e.id === res.close.entryId)!
    expect(orig.status).toBe('reversed')
    const rev = financeJournal.find((e) => e.id === back.close.reversalEntryId)!
    expect(rev.date).toBe(fyEnd)
    expect(rev.sourceType).toBe('year_end_close')
    expect(auditLog.some((a) => a.entity === 'year_end_close' && a.summary.includes('Auditor adjustment'))).toBe(true)
    expect(st.balanceSheet(APEX_ID, fyEnd).currentYearEarnings).toBe(journalProfit(APEX_ID, fyStart, fyEnd))
    expect(() => st.reopenYear(omar(), res.close.id, { reason: 'again' })).toThrow(expect.objectContaining({ status: 409 }))
    // A posting into the re-opened year works, then the year closes again with it.
    fin.createManualJournal(rashid(), { date: addDays(fyEnd, -11), memo: 'Audit adjustment', lines: [{ accountId: 'ACC-6700', debit: 1000, credit: 0 }, { accountId: 'ACC-2600', debit: 0, credit: 1000 }] })
    const again = st.closeYear(rashid(), { fiscalYearEnd: fyEnd })
    expect(again.close.netProfit).toBe(r2(res.close.netProfit - 1000))
    expect(st.getYearEnd(omar()).history.map((h) => h.status)).toEqual(['closed', 'reopened'])
  })

  it('refusals: role, year not ended, not a fiscal year end, earlier open year, locked year', () => {
    expect(() => st.closeYear(layla(), { fiscalYearEnd: '2025-12-31' })).toThrow(expect.objectContaining({ status: 403, code: 'year_end_forbidden' }))
    expect(() => st.closeYear(karim(), { fiscalYearEnd: '2025-12-31' })).toThrow(expect.objectContaining({ status: 403, code: 'forbidden' }))
    expect(() => st.closeYear(rashid(), { fiscalYearEnd: fiscalYearOf(T, 1).end })).toThrow(expect.objectContaining({ status: 409, code: 'year_not_ended' }))
    expect(() => st.closeYear(rashid(), { fiscalYearEnd: '2026-06-30' })).toThrow(expect.objectContaining({ status: 422, code: 'invalid_fiscal_year' }))
    expect(st.previewYearEnd(layla(), { fiscalYearEnd: '2025-12-31' }).canClose).toBe(false)
    toNovember()
    // Activity in the previous fiscal year (Nov 2024 – Oct 2025) must be closed first.
    fin.createManualJournal(rashid(), { date: addDays(prevEnd, -120), memo: 'Old bank fee', lines: [{ accountId: 'ACC-6800', debit: 20, credit: 0 }, { accountId: 'ACC-1120', debit: 0, credit: 20 }] })
    expect(() => st.closeYear(rashid(), { fiscalYearEnd: fyEnd })).toThrow(expect.objectContaining({ status: 409, code: 'earlier_year_open' }))
    st.closeYear(rashid(), { fiscalYearEnd: prevEnd })
    expect(financeSettings.get(APEX_ID).lockDate).toBe(prevEnd)
    // Books locked past the year end: move the lock date first.
    fin.setLockDate(rashid(), { lockDate: nextStart, reason: 'Monthly lock' })
    expect(() => st.closeYear(rashid(), { fiscalYearEnd: fyEnd })).toThrow(expect.objectContaining({ status: 423, code: 'period_locked' }))
    // The earlier closed year can be re-opened (no later year is closed).
    const later = st.getYearEnd(omar()).years.find((y) => y.end === prevEnd)!
    expect(later.canReopen).toBe(true)
  })

  it('Crest (locked through 2025, January year): nothing to close yet, the current year is in progress', () => {
    const y = st.getYearEnd(faisal())
    expect(y.years[0].status).toBe('in_progress')
    expect(y.years[0].canClose).toBe(false)
    expect(y.lockDate).toBe('2025-12-31')
    expect(st.previewYearEnd(faisal()).canClose).toBe(false)
  })
})
