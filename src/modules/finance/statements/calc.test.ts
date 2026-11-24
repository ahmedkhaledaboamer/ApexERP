import { describe, expect, it } from 'vitest'
import type { Account, JournalEntry, JournalLine, JournalSourceType } from '@/modules/finance/types'
import {
  addMonths,
  balanceSheetOf,
  cashFlowOf,
  closingLinesOf,
  combinePnl,
  comparisonRange,
  fiscalYearLabel,
  fiscalYearOf,
  generalLedgerOf,
  monthsEnding,
  pctChange,
  periodRange,
  profitAndLossOf,
  rangeLabel,
  sumPnl,
  trialBalanceCompare,
} from './calc'

/** Pure statement math on a small hand-made chart and journal. */

type A = Pick<Account, 'id' | 'code' | 'name' | 'type' | 'subtype' | 'parentId' | 'isHeader' | 'systemRole'>
const acc = (code: string, name: string, type: Account['type'], subtype: string, parent: string | null = null, role: Account['systemRole'] = null, header = false): A => ({
  id: `ACC-${code}`, code, name, type, subtype, parentId: parent ? `ACC-${parent}` : null, isHeader: header, systemRole: role,
})
const CHART: A[] = [
  acc('1100', 'Cash and bank', 'asset', 'current_asset', null, null, true),
  acc('1110', 'Cash', 'asset', 'current_asset', '1100', 'cash'),
  acc('1120', 'Bank', 'asset', 'current_asset', '1100', 'bank_default'),
  acc('1200', 'Receivables', 'asset', 'current_asset', null, 'accounts_receivable'),
  acc('1400', 'Prepaid', 'asset', 'current_asset'),
  acc('1510', 'Equipment', 'asset', 'fixed_asset'),
  acc('1590', 'Accumulated depreciation', 'asset', 'fixed_asset'),
  acc('2100', 'Payables', 'liability', 'current_liability', null, 'accounts_payable'),
  acc('2200', 'VAT payable', 'liability', 'current_liability', null, 'vat_output'),
  acc('2500', 'End-of-service benefits provision', 'liability', 'non_current_liability'),
  acc('2800', 'Bank loan', 'liability', 'non_current_liability'),
  acc('3100', 'Share capital', 'equity', 'equity'),
  acc('3200', 'Retained earnings', 'equity', 'equity', null, 'retained_earnings'),
  acc('4100', 'Sales', 'income', 'operating_income'),
  acc('4900', 'Interest income', 'income', 'other_income'),
  acc('5100', 'Direct costs', 'expense', 'cost_of_sales'),
  acc('6100', 'Salaries', 'expense', 'operating_expense'),
  acc('6120', 'End-of-service benefits', 'expense', 'operating_expense'),
  acc('6850', 'Depreciation', 'expense', 'operating_expense'),
  acc('6900', 'FX loss', 'expense', 'other_expense'),
]
const RE = CHART.find((a) => a.code === '3200')!

let n = 0
const l = (code: string, debit: number, credit: number, dims: Partial<JournalLine> = {}): JournalLine => ({ accountId: `ACC-${code}`, debit, credit, description: '', ...dims })
const e = (date: string, lines: JournalLine[], sourceType: JournalSourceType = 'manual'): JournalEntry => ({
  id: `JE-${++n}`, number: `JV-${n}`, date, memo: `Entry ${n}`, sourceType, sourceId: null, lines, status: 'posted', reversalOf: null, reversedBy: null, createdBy: null, createdAt: `${date}T08:00:00.000Z`,
})

/** FY 2025 and 2026 (calendar years). */
const BOOKS: JournalEntry[] = [
  e('2025-01-01', [l('1120', 100000, 0), l('3100', 0, 100000)], 'opening_balance'),
  e('2025-03-10', [l('1200', 10500, 0), l('4100', 0, 10000, { departmentId: 'd-a', customerId: 'c-1' }), l('2200', 0, 500)]),
  e('2025-04-02', [l('1120', 10500, 0), l('1200', 0, 10500)]),
  e('2025-06-30', [l('6100', 4000, 0, { departmentId: 'd-a' }), l('1120', 0, 4000)]),
  e('2026-01-15', [l('1200', 21000, 0), l('4100', 0, 20000, { departmentId: 'd-a', projectId: 'p-1' }), l('2200', 0, 1000)]),
  e('2026-02-01', [l('5100', 6000, 0, { departmentId: 'd-a', projectId: 'p-1' }), l('2100', 0, 6000)]),
  e('2026-02-20', [l('6100', 3000, 0, { departmentId: 'd-b' }), l('1120', 0, 3000)]),
  e('2026-03-01', [l('1510', 12000, 0), l('1120', 0, 12000)]),
  e('2026-03-31', [l('6850', 500, 0), l('1590', 0, 500)]),
  e('2026-03-31', [l('6120', 800, 0), l('2500', 0, 800)]),
  e('2026-04-10', [l('1120', 15000, 0), l('1200', 0, 15000)]),
  e('2026-04-11', [l('1400', 1200, 0), l('1120', 0, 1200)]),
  e('2026-04-20', [l('1120', 25000, 0), l('2800', 0, 25000)]),
  e('2026-05-05', [l('1120', 300, 0), l('4900', 0, 300)]),
  e('2026-05-06', [l('6900', 50, 0), l('1110', 0, 50)]),
  e('2026-05-07', [l('2100', 2500, 0), l('1120', 0, 2500)]),
]

describe('dates and periods', () => {
  it('adds months keeping month ends and clamping days', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-02-28', 1)).toBe('2026-03-31')
    expect(addMonths('2026-03-15', -12)).toBe('2025-03-15')
    expect(addMonths('2024-02-29', -12)).toBe('2023-02-28')
  })
  it('fiscal years for January and non-January starts', () => {
    expect(fiscalYearOf('2026-11-21', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(fiscalYearOf('2026-11-21', 4)).toEqual({ start: '2026-04-01', end: '2027-03-31' })
    expect(fiscalYearOf('2026-02-10', 4)).toEqual({ start: '2025-04-01', end: '2026-03-31' })
    expect(fiscalYearLabel('2025-04-01', '2026-03-31')).toBe('FY 2025/26')
    expect(fiscalYearLabel('2026-01-01', '2026-12-31')).toBe('FY 2026')
  })
  it('period ranges: month, fiscal quarter, YTD, fiscal year', () => {
    expect(periodRange('month', '2026-11-21', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('quarter', '2026-11-21', 1)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('quarter', '2026-11-21', 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('quarter', '2026-05-02', 4)).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(periodRange('quarter', '2026-02-02', 2)).toEqual({ from: '2026-02-01', to: '2026-04-30' })
    expect(periodRange('ytd', '2026-11-21', 7)).toEqual({ from: '2026-07-01', to: '2026-11-21' })
    expect(periodRange('fiscal_year', '2026-11-21', 7)).toEqual({ from: '2026-07-01', to: '2027-06-30' })
    expect(periodRange('custom', '2026-11-21', 1)).toBeNull()
  })
  it('comparison ranges: previous period (months or days) and same period last year', () => {
    expect(comparisonRange('2026-11-01', '2026-11-30', 'previous_period')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(comparisonRange('2026-10-01', '2026-12-31', 'previous_period')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(comparisonRange('2026-03-01', '2026-03-31', 'previous_period')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(comparisonRange('2026-11-10', '2026-11-19', 'previous_period')).toEqual({ from: '2026-10-31', to: '2026-11-09' })
    expect(comparisonRange('2026-01-01', '2026-11-21', 'last_year')).toEqual({ from: '2025-01-01', to: '2025-11-21' })
    expect(comparisonRange('2026-02-01', '2026-02-28', 'last_year')).toEqual({ from: '2025-02-01', to: '2025-02-28' })
  })
  it('12 months ending with a month; labels; percent change', () => {
    const ms = monthsEnding('2026-11-21')
    expect(ms).toHaveLength(12)
    expect(ms[0]).toEqual({ from: '2025-12-01', to: '2025-12-31', month: '2025-12' })
    expect(ms[11]).toEqual({ from: '2026-11-01', to: '2026-11-30', month: '2026-11' })
    expect(rangeLabel('2026-11-01', '2026-11-30')).toBe('Nov 2026')
    expect(rangeLabel('2026-10-01', '2026-12-31')).toBe('Oct – Dec 2026')
    expect(rangeLabel('2026-01-01', '2026-12-31', 1)).toBe('FY 2026')
    expect(rangeLabel('2026-01-01', '2026-11-21')).toBe('1 Jan – 21 Nov 2026')
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, -100)).toBe(150)
    expect(pctChange(10, 0)).toBeNull()
  })
})

describe('profit and loss', () => {
  it('sections: revenue − cost of sales = gross; − opex = operating; ± other = net', () => {
    const p = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-12-31')
    expect(p.revenue).toBe(20000)
    expect(p.costOfSales).toBe(6000)
    expect(p.grossProfit).toBe(14000)
    expect(p.operatingExpenses).toBe(4300) // salaries 3000, EOSB 800, depreciation 500
    expect(p.operatingProfit).toBe(9700)
    expect(p.otherIncome).toBe(300)
    expect(p.otherExpenses).toBe(50)
    expect(p.netProfit).toBe(9950)
    expect(p.sections.map((s) => s.id)).toEqual(['revenue', 'cost_of_sales', 'operating_expenses', 'other_income', 'other_expenses'])
    expect(p.sections[2].lines.map((x) => x.code)).toEqual(['6100', '6120', '6850'])
  })
  it('comparison columns line up by account; the monthly total equals the period', () => {
    const cur = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-06-30')
    const ly = profitAndLossOf(CHART, BOOKS, '2025-01-01', '2025-06-30')
    const c = combinePnl([cur, ly])
    const sales = c.sections[0].lines.find((x) => x.code === '4100')!
    expect(sales.amounts).toEqual([20000, 10000])
    const cos = c.sections[1].lines.find((x) => x.code === '5100')!
    expect(cos.amounts).toEqual([6000, 0])
    expect(c.totals.netProfit).toEqual([cur.netProfit, 6000])
    const months = monthsEnding('2026-06-30', 6).map((m) => profitAndLossOf(CHART, BOOKS, m.from, m.to))
    const total = sumPnl(months)
    expect(total.netProfit).toBe(cur.netProfit)
    expect(total.sections[2].total).toBe(cur.operatingExpenses)
  })
  it('dimension filters keep only the matching lines (AND across dimensions)', () => {
    const a = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-12-31', { departmentId: 'd-a' })
    expect(a.revenue).toBe(20000)
    expect(a.costOfSales).toBe(6000)
    expect(a.operatingExpenses).toBe(0)
    const b = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-12-31', { departmentId: 'd-b' })
    expect(b.netProfit).toBe(-3000)
    const both = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-12-31', { departmentId: 'd-a', projectId: 'p-1' })
    expect(both.grossProfit).toBe(14000)
    const none = profitAndLossOf(CHART, BOOKS, '2026-01-01', '2026-12-31', { customerId: 'unknown' })
    expect(none.netProfit).toBe(0)
    expect(none.sections.every((s) => s.lines.length === 0)).toBe(true)
  })
})

describe('balance sheet', () => {
  it('Assets = Liabilities + Equity with current-year and unclosed prior-year earnings', () => {
    const bs = balanceSheetOf(CHART, BOOKS, '2026-06-30', 1)
    expect(bs.balanced).toBe(true)
    expect(bs.difference).toBe(0)
    expect(bs.currentYearEarnings).toBe(9950)
    expect(bs.priorYearsEarnings).toBe(6000) // 2025 not closed
    const fixed = bs.sections.find((s) => s.id === 'fixed_assets')!
    expect(fixed.lines.map((x) => [x.code, x.amount])).toEqual([['1510', 12000], ['1590', -500]])
    expect(fixed.total).toBe(11500)
    expect(bs.sections.find((s) => s.id === 'non_current_liabilities')!.total).toBe(25800)
    expect(bs.totalAssets).toBe(bs.liabilitiesAndEquity)
  })
  it('after a year-end close the year’s result sits in retained earnings', () => {
    const cl = closingLinesOf(CHART, BOOKS, '2025-01-01', '2025-12-31', RE)
    expect(cl.netProfit).toBe(6000)
    expect(cl.totals.debit).toBe(cl.totals.credit)
    expect(cl.lines.find((x) => x.code === '3200')).toMatchObject({ debit: 0, credit: 6000 })
    const closing = e('2025-12-31', cl.lines.map((x) => l(x.code, x.debit, x.credit)), 'year_end_close')
    const books = [...BOOKS, closing]
    const atYearEnd = balanceSheetOf(CHART, books, '2025-12-31', 1)
    expect(atYearEnd.balanced).toBe(true)
    expect(atYearEnd.currentYearEarnings).toBe(0)
    expect(atYearEnd.sections.find((s) => s.id === 'equity')!.lines.find((x) => x.code === '3200')!.amount).toBe(6000)
    const later = balanceSheetOf(CHART, books, '2026-06-30', 1)
    expect(later.priorYearsEarnings).toBe(0)
    expect(later.balanced).toBe(true)
    // The closed year's P&L still shows its activity (closing entries are excluded).
    expect(profitAndLossOf(CHART, books, '2025-01-01', '2025-12-31').netProfit).toBe(6000)
    // Closing lines ignore closing entries (a re-close after a re-open proposes the same entry; the service refuses a double close).
    expect(closingLinesOf(CHART, books, '2025-01-01', '2025-12-31', RE).lines).toEqual(cl.lines)
  })
  it('a fiscal year starting in April splits current and prior earnings at April 1', () => {
    const bs = balanceSheetOf(CHART, BOOKS, '2026-06-30', 4)
    expect(bs.fiscalYearStart).toBe('2026-04-01')
    // FY 2026/27 to June: interest 300 − FX 50.
    expect(bs.currentYearEarnings).toBe(250)
    expect(bs.priorYearsEarnings).toBe(15700)
    expect(bs.balanced).toBe(true)
  })
})

describe('cash flow (indirect)', () => {
  it('reconciles to the change in cash and bank; opening balances are brought forward', () => {
    const cf = cashFlowOf(CHART, BOOKS, '2026-01-01', '2026-06-30', 'AED')
    expect(cf.operating.netProfit).toBe(9950)
    expect(cf.operating.adjustments.map((x) => [x.code, x.amount])).toEqual([['1590', 500], ['2500', 800]])
    // AR −6000 (21000 billed − 15000 collected), prepaid −1200, AP +3500, VAT +1000.
    expect(Object.fromEntries(cf.operating.workingCapital.map((x) => [x.code, x.amount]))).toEqual({ '1200': -6000, '1400': -1200, '2100': 3500, '2200': 1000 })
    expect(cf.investing.lines.map((x) => [x.code, x.amount])).toEqual([['1510', -12000]])
    expect(cf.financing.lines.map((x) => [x.code, x.amount])).toEqual([['2800', 25000]])
    expect(cf.openingCash).toBe(106500)
    expect(cf.closingCash).toBe(128050)
    expect(cf.netChange).toBe(21550)
    expect(cf.check).toBe(0)
    expect(cf.reconciles).toBe(true)
  })
  it('the opening-balance entry inside the period counts in the opening cash, not in financing', () => {
    const cf = cashFlowOf(CHART, BOOKS, '2025-01-01', '2025-12-31', 'AED')
    expect(cf.financing.lines).toHaveLength(0)
    expect(cf.openingCash).toBe(100000)
    expect(cf.netChange).toBe(6500)
    expect(cf.reconciles).toBe(true)
  })
})

describe('general ledger and trial balance', () => {
  it('per account opening, lines and closing; account and dimension filters', () => {
    const gl = generalLedgerOf(CHART, BOOKS, '2026-01-01', '2026-06-30', 'AED')
    const bank = gl.find((a) => a.account.code === '1120')!
    expect(bank.openingBalance).toBe(106500)
    expect(bank.closingBalance).toBe(128100)
    expect(gl.find((a) => a.account.code === '6100')!.openingBalance).toBe(4000)
    const only = generalLedgerOf(CHART, BOOKS, '2026-01-01', '2026-06-30', 'AED', { accountIds: new Set(['ACC-4100']), dims: { departmentId: 'd-a' } })
    expect(only).toHaveLength(1)
    expect(only[0].openingBalance).toBe(10000)
    expect(only[0].rows.map((r) => r.credit)).toEqual([20000])
  })
  it('trial balance comparatives: both columns balanced, rows union', () => {
    const tb = trialBalanceCompare(CHART, BOOKS, [{ key: 'current', label: '', from: null, to: '2026-06-30' }, { key: 'compare', label: '', from: null, to: '2025-12-31' }], 'AED')
    expect(tb.balanced).toEqual([true, true])
    expect(tb.rows.find((r) => r.code === '2800')).toMatchObject({ credit: [25000, 0] })
    expect(tb.totals.debit[0]).toBe(tb.totals.credit[0])
  })
})
