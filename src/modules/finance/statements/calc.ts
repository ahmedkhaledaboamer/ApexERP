import type { Account, JournalEntry, JournalLine, JournalSourceType } from '@/modules/finance/types'
import { DEBIT_NORMAL } from '@/modules/finance/types'
import { accountLedger, naturalBalance, r2 as round2, trialBalance } from '@/modules/finance/ledger/calc'
import type { AccountLedger } from '@/modules/finance/ledger/types'
import type {
  BalanceSheetPeriod,
  BalanceSheetStatement,
  BsLine,
  BsSection,
  BsSectionId,
  BsStatementSection,
  CashFlowLine,
  CashFlowStatement,
  ClosingLine,
  CompareKind,
  PeriodKind,
  PnlPeriod,
  PnlSection,
  PnlSectionId,
  PnlStatementSection,
  PnlTotals,
  StatementColumn,
  StatementDims,
  TrialBalanceComparative,
} from './types'

/**
 * Financial statements (pure; the mock services, the screens and the tests share it). Inputs are the company's chart
 * and journal; every amount is a base-currency amount (journal lines already are). Rules:
 *   - P&L: income / expense accounts over [from, to], closing entries (`year_end_close`) excluded, so a closed year
 *     still shows its activity. A dimension filter keeps only the lines carrying every given value.
 *   - Balance sheet: every entry up to `asOf`; equity adds the unclosed earnings (current fiscal year and, when not
 *     closed, prior years), so Assets = Liabilities + Equity whenever the journal balances.
 *   - Cash flow (indirect): flows are the period's entries except closing and opening-balance entries (an opening
 *     balance is a brought-forward position, counted in the opening cash). Net change = closing − opening cash.
 */

/** Rounded to cents, never -0. */
const r2 = (n: number): number => round2(n) + 0

export const CLOSING_SOURCE: JournalSourceType = 'year_end_close'
const OPENING_SOURCE: JournalSourceType = 'opening_balance'

type AccountLike = Pick<Account, 'id' | 'code' | 'name' | 'type' | 'subtype' | 'parentId' | 'isHeader' | 'systemRole'>
type EntryLike = Pick<JournalEntry, 'id' | 'number' | 'date' | 'memo' | 'sourceType' | 'lines' | 'createdAt'>

/* ================= dates and periods ================= */

const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const parts = (d: string) => [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))] as const

/** `date` plus `n` months; the day is clamped, and a month-end stays a month-end (2026-02-28 + 1 → 2026-03-31). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date)
  const t = y * 12 + (m - 1) + n
  const ny = Math.floor(t / 12)
  const nm = (t % 12) + 1
  const last = daysIn(ny, nm)
  const day = d === daysIn(y, m) ? last : Math.min(d, last)
  return `${ny}-${pad(nm)}-${pad(day)}`
}

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const isMonthStart = (d: string) => d.slice(8, 10) === '01'
const isMonthEnd = (d: string) => {
  const [y, m, day] = parts(d)
  return day === daysIn(y, m)
}
/** Whole months from `from`'s month to `to`'s month, inclusive. */
export const monthSpan = (from: string, to: string) => (parts(to)[0] - parts(from)[0]) * 12 + (parts(to)[1] - parts(from)[1]) + 1

/** The fiscal year containing `date` (start month 1–12). */
export function fiscalYearOf(date: string, startMonth: number): { start: string; end: string } {
  const [y, m] = parts(date)
  const sy = m >= startMonth ? y : y - 1
  const start = `${sy}-${pad(startMonth)}-01`
  return { start, end: addDays(addMonths(start, 12), -1) }
}

/** "FY 2026" for a calendar year, "FY 2025/26" otherwise. */
export function fiscalYearLabel(start: string, end: string): string {
  return start.slice(0, 4) === end.slice(0, 4) ? `FY ${start.slice(0, 4)}` : `FY ${start.slice(0, 4)}/${end.slice(2, 4)}`
}

/** The range of a period kind around `anchor` (quarters are fiscal quarters). `custom` returns null. */
export function periodRange(kind: PeriodKind, anchor: string, startMonth: number): { from: string; to: string } | null {
  const fy = fiscalYearOf(anchor, startMonth)
  if (kind === 'month') {
    const from = `${anchor.slice(0, 7)}-01`
    return { from, to: addDays(addMonths(from, 1), -1) }
  }
  if (kind === 'quarter') {
    const q = Math.floor((monthSpan(fy.start, anchor) - 1) / 3)
    const from = addMonths(fy.start, q * 3)
    return { from, to: addDays(addMonths(from, 3), -1) }
  }
  if (kind === 'ytd') return { from: fy.start, to: anchor }
  if (kind === 'fiscal_year') return { from: fy.start, to: fy.end }
  return null
}

/**
 * The comparison range: `last_year` = the same dates a year earlier; `previous_period` = the range right before, as
 * many whole months for a month-aligned range, else as many days.
 */
export function comparisonRange(from: string, to: string, kind: CompareKind): { from: string; to: string } {
  if (kind === 'last_year') return { from: addMonths(from, -12), to: addMonths(to, -12) }
  const prevTo = addDays(from, -1)
  if (isMonthStart(from) && isMonthEnd(to)) return { from: addMonths(from, -monthSpan(from, to)), to: prevTo }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  return { from: addDays(prevTo, -days), to: prevTo }
}

/** The 12 months (or `count`) ending with `to`'s month, oldest first. */
export function monthsEnding(to: string, count = 12): { from: string; to: string; month: string }[] {
  const out: { from: string; to: string; month: string }[] = []
  const last = `${to.slice(0, 7)}-01`
  for (let i = count - 1; i >= 0; i--) {
    const from = addMonths(last, -i)
    out.push({ from, to: addDays(addMonths(from, 1), -1), month: from.slice(0, 7) })
  }
  return out
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d: string, year = true) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}${year ? ` ${d.slice(0, 4)}` : ''}`

/** "Nov 2026", "Oct – Dec 2026", "FY 2026" (with `fiscalYearStartMonth`), "1 Jan – 21 Nov 2026". */
export function rangeLabel(from: string, to: string, fiscalYearStartMonth?: number): string {
  if (fiscalYearStartMonth) {
    const fy = fiscalYearOf(from, fiscalYearStartMonth)
    if (fy.start === from && fy.end === to) return fiscalYearLabel(from, to)
  }
  if (isMonthStart(from) && isMonthEnd(to)) {
    const m1 = `${MON[Number(from.slice(5, 7)) - 1]}`
    const m2 = `${MON[Number(to.slice(5, 7)) - 1]} ${to.slice(0, 4)}`
    if (from.slice(0, 7) === to.slice(0, 7)) return m2
    return from.slice(0, 4) === to.slice(0, 4) ? `${m1} – ${m2}` : `${m1} ${from.slice(0, 4)} – ${m2}`
  }
  return from.slice(0, 4) === to.slice(0, 4) ? `${dayLabel(from, false)} – ${dayLabel(to)}` : `${dayLabel(from)} – ${dayLabel(to)}`
}

/** "21 Nov 2026" */
export const dateLabel = (d: string) => dayLabel(d)

/** Percent change from `before` to `now` (null when `before` is 0). */
export function pctChange(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10
}

/* ================= filtering ================= */

const DIM_KEYS = ['departmentId', 'projectId', 'eventId', 'customerId'] as const

export function hasDims(dims: StatementDims | undefined): boolean {
  return !!dims && DIM_KEYS.some((k) => !!dims[k])
}
export function lineMatches(l: Pick<JournalLine, (typeof DIM_KEYS)[number]>, dims: StatementDims | undefined): boolean {
  if (!dims) return true
  return DIM_KEYS.every((k) => !dims[k] || l[k] === dims[k])
}

interface SumOpts {
  from?: string | null
  to?: string | null
  dims?: StatementDims
  excludeSources?: readonly JournalSourceType[]
}
/** Net debit − credit per account (base currency) over the matching entries and lines. */
export function netByAccount(entries: readonly EntryLike[], o: SumOpts = {}): Map<string, number> {
  const out = new Map<string, number>()
  const filter = hasDims(o.dims)
  for (const e of entries) {
    if (o.from && e.date < o.from) continue
    if (o.to && e.date > o.to) continue
    if (o.excludeSources?.includes(e.sourceType)) continue
    for (const l of e.lines) {
      if (filter && !lineMatches(l, o.dims)) continue
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.debit - l.credit)
    }
  }
  for (const [k, v] of out) out.set(k, r2(v))
  return out
}

const byCode = <T extends { code: string }>(a: T, b: T) => a.code.localeCompare(b.code)
const natural = (a: Pick<Account, 'type'>, net: number) => r2(DEBIT_NORMAL[a.type] ? net : -net)

/* ================= profit and loss ================= */

export const PNL_SECTIONS: { id: PnlSectionId; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cost_of_sales', label: 'Cost of sales' },
  { id: 'operating_expenses', label: 'Operating expenses' },
  { id: 'other_income', label: 'Other income' },
  { id: 'other_expenses', label: 'Other expenses' },
]

/** P&L section of an income / expense account (null for balance-sheet accounts). */
export function pnlSectionOf(a: Pick<Account, 'type' | 'subtype'>): PnlSectionId | null {
  if (a.type === 'income') return a.subtype === 'other_income' ? 'other_income' : 'revenue'
  if (a.type === 'expense') return a.subtype === 'cost_of_sales' ? 'cost_of_sales' : a.subtype === 'other_expense' ? 'other_expenses' : 'operating_expenses'
  return null
}

/** One period's P&L: Revenue − Cost of sales = Gross profit; − Operating expenses = Operating profit; ± other = Net profit. */
export function profitAndLossOf(accounts: readonly AccountLike[], entries: readonly EntryLike[], from: string, to: string, dims?: StatementDims): PnlPeriod {
  const net = netByAccount(entries, { from, to, dims, excludeSources: [CLOSING_SOURCE] })
  const sections: PnlSection[] = PNL_SECTIONS.map((s) => ({ ...s, total: 0, lines: [] }))
  for (const a of [...accounts].sort(byCode)) {
    if (a.isHeader) continue
    const id = pnlSectionOf(a)
    if (!id) continue
    const n = net.get(a.id) ?? 0
    if (n === 0) continue
    const sec = sections.find((s) => s.id === id)!
    sec.lines.push({ accountId: a.id, code: a.code, name: a.name, amount: natural(a, n) })
  }
  for (const s of sections) s.total = r2(s.lines.reduce((t, l) => t + l.amount, 0))
  const t = (id: PnlSectionId) => sections.find((s) => s.id === id)!.total
  const grossProfit = r2(t('revenue') - t('cost_of_sales'))
  const operatingProfit = r2(grossProfit - t('operating_expenses'))
  return {
    from,
    to,
    sections,
    revenue: t('revenue'),
    costOfSales: t('cost_of_sales'),
    grossProfit,
    operatingExpenses: t('operating_expenses'),
    operatingProfit,
    otherIncome: t('other_income'),
    otherExpenses: t('other_expenses'),
    netProfit: r2(operatingProfit + t('other_income') - t('other_expenses')),
  }
}

/** Side-by-side columns of several P&L periods (union of accounts, in code order). */
export function combinePnl(periods: readonly PnlPeriod[]): { sections: PnlStatementSection[]; totals: PnlTotals } {
  const sections: PnlStatementSection[] = PNL_SECTIONS.map((s) => {
    const lines = new Map<string, { accountId: string; code: string; name: string; amounts: number[] }>()
    periods.forEach((p, i) => {
      for (const l of p.sections.find((x) => x.id === s.id)!.lines) {
        const row = lines.get(l.accountId) ?? { accountId: l.accountId, code: l.code, name: l.name, amounts: periods.map(() => 0) }
        row.amounts[i] = l.amount
        lines.set(l.accountId, row)
      }
    })
    return { ...s, lines: [...lines.values()].sort(byCode), totals: periods.map((p) => p.sections.find((x) => x.id === s.id)!.total) }
  })
  const col = (k: keyof Omit<PnlPeriod, 'from' | 'to' | 'sections'>) => periods.map((p) => p[k])
  return {
    sections,
    totals: {
      revenue: col('revenue'),
      costOfSales: col('costOfSales'),
      grossProfit: col('grossProfit'),
      operatingExpenses: col('operatingExpenses'),
      operatingProfit: col('operatingProfit'),
      otherIncome: col('otherIncome'),
      otherExpenses: col('otherExpenses'),
      netProfit: col('netProfit'),
    },
  }
}

/** Sum of several periods (the "Total" column of the monthly view). */
export function sumPnl(periods: readonly PnlPeriod[]): PnlPeriod {
  const first = periods[0]
  const sections: PnlSection[] = PNL_SECTIONS.map((s) => {
    const lines = new Map<string, { accountId: string; code: string; name: string; amount: number }>()
    for (const p of periods) {
      for (const l of p.sections.find((x) => x.id === s.id)!.lines) {
        const row = lines.get(l.accountId) ?? { ...l, amount: 0 }
        row.amount = r2(row.amount + l.amount)
        lines.set(l.accountId, row)
      }
    }
    const ls = [...lines.values()].filter((l) => l.amount !== 0).sort(byCode)
    return { ...s, lines: ls, total: r2(ls.reduce((t, l) => t + l.amount, 0)) }
  })
  const sum = (k: 'revenue' | 'costOfSales' | 'grossProfit' | 'operatingExpenses' | 'operatingProfit' | 'otherIncome' | 'otherExpenses' | 'netProfit') => r2(periods.reduce((t, p) => t + p[k], 0))
  return {
    from: first?.from ?? '',
    to: periods[periods.length - 1]?.to ?? '',
    sections,
    revenue: sum('revenue'),
    costOfSales: sum('costOfSales'),
    grossProfit: sum('grossProfit'),
    operatingExpenses: sum('operatingExpenses'),
    operatingProfit: sum('operatingProfit'),
    otherIncome: sum('otherIncome'),
    otherExpenses: sum('otherExpenses'),
    netProfit: sum('netProfit'),
  }
}

/* ================= balance sheet ================= */

const BS_SECTIONS: { id: BsSectionId; group: BsSection['group']; label: string }[] = [
  { id: 'current_assets', group: 'assets', label: 'Current assets' },
  { id: 'fixed_assets', group: 'assets', label: 'Fixed assets' },
  { id: 'other_assets', group: 'assets', label: 'Other assets' },
  { id: 'current_liabilities', group: 'liabilities', label: 'Current liabilities' },
  { id: 'non_current_liabilities', group: 'liabilities', label: 'Non-current liabilities' },
  { id: 'equity', group: 'equity', label: 'Equity' },
]

function bsSectionOf(a: Pick<Account, 'type' | 'subtype'>): BsSectionId | null {
  if (a.type === 'asset') return a.subtype === 'current_asset' ? 'current_assets' : a.subtype === 'fixed_asset' ? 'fixed_assets' : 'other_assets'
  if (a.type === 'liability') return a.subtype === 'non_current_liability' ? 'non_current_liabilities' : 'current_liabilities'
  if (a.type === 'equity') return 'equity'
  return null
}

/** Income − expenses (natural profit) of the net map. */
function profitOf(accounts: readonly AccountLike[], net: Map<string, number>): number {
  let p = 0
  for (const a of accounts) {
    if (a.type !== 'income' && a.type !== 'expense') continue
    p -= net.get(a.id) ?? 0
  }
  return r2(p)
}

/**
 * Balance sheet as of `asOf`: assets (current, fixed incl. accumulated depreciation, other), liabilities (current,
 * non-current), equity accounts plus the unclosed earnings — current fiscal year (to `asOf`, closing entries
 * included, so a closed year shows 0 here and its result in retained earnings) and prior years not closed.
 */
export function balanceSheetOf(accounts: readonly AccountLike[], entries: readonly EntryLike[], asOf: string, fiscalYearStartMonth: number): BalanceSheetPeriod {
  const fyStart = fiscalYearOf(asOf, fiscalYearStartMonth).start
  const net = netByAccount(entries, { to: asOf })
  const sections: BsSection[] = BS_SECTIONS.map((s) => ({ ...s, lines: [], total: 0 }))
  for (const a of [...accounts].sort(byCode)) {
    if (a.isHeader) continue
    const id = bsSectionOf(a)
    if (!id) continue
    const n = net.get(a.id) ?? 0
    if (n === 0) continue
    sections.find((s) => s.id === id)!.lines.push({ kind: 'account', accountId: a.id, code: a.code, name: a.name, amount: natural(a, n) })
  }
  const allTime = profitOf(accounts, net)
  const currentYearEarnings = profitOf(accounts, netByAccount(entries, { from: fyStart, to: asOf }))
  const priorYearsEarnings = r2(allTime - currentYearEarnings)
  const equity = sections.find((s) => s.id === 'equity')!
  const earnings: BsLine[] = []
  if (priorYearsEarnings !== 0) earnings.push({ kind: 'prior_years_earnings', accountId: null, code: '', name: 'Prior years’ earnings (not closed)', amount: priorYearsEarnings })
  earnings.push({ kind: 'current_year_earnings', accountId: null, code: '', name: 'Current-year earnings', amount: currentYearEarnings })
  equity.lines.push(...earnings)
  for (const s of sections) s.total = r2(s.lines.reduce((t, l) => t + l.amount, 0))
  const group = (g: BsSection['group']) => r2(sections.filter((s) => s.group === g).reduce((t, s) => t + s.total, 0))
  const totalAssets = group('assets')
  const totalLiabilities = group('liabilities')
  const totalEquity = group('equity')
  const liabilitiesAndEquity = r2(totalLiabilities + totalEquity)
  const difference = r2(totalAssets - liabilitiesAndEquity)
  return { asOf, fiscalYearStart: fyStart, sections, totalAssets, totalLiabilities, totalEquity, currentYearEarnings, priorYearsEarnings, liabilitiesAndEquity, difference, balanced: difference === 0 }
}

/** Side-by-side balance sheets (e.g. as of a date and a prior date). */
export function combineBalanceSheets(periods: readonly BalanceSheetPeriod[], currency: string, columns: StatementColumn[]): BalanceSheetStatement {
  const sections: BsStatementSection[] = BS_SECTIONS.map((s) => {
    const lines = new Map<string, BsStatementSection['lines'][number]>()
    periods.forEach((p, i) => {
      for (const l of p.sections.find((x) => x.id === s.id)!.lines) {
        const key = l.accountId ?? l.kind
        const row = lines.get(key) ?? { key, kind: l.kind, accountId: l.accountId, code: l.code, name: l.name, amounts: periods.map(() => 0) }
        row.amounts[i] = l.amount
        lines.set(key, row)
      }
    })
    const order = (k: BsStatementSection['lines'][number]) => (k.kind === 'account' ? 0 : k.kind === 'prior_years_earnings' ? 1 : 2)
    return { ...s, lines: [...lines.values()].sort((a, b) => order(a) - order(b) || a.code.localeCompare(b.code)), totals: periods.map((p) => p.sections.find((x) => x.id === s.id)!.total) }
  })
  return {
    currency,
    columns,
    sections,
    totals: {
      assets: periods.map((p) => p.totalAssets),
      liabilities: periods.map((p) => p.totalLiabilities),
      equity: periods.map((p) => p.totalEquity),
      liabilitiesAndEquity: periods.map((p) => p.liabilitiesAndEquity),
      difference: periods.map((p) => p.difference),
    },
    balanced: periods.every((p) => p.balanced),
  }
}

/* ================= cash flow ================= */

const CASH_ROLES = new Set(['cash', 'bank_default', 'undeposited_funds', 'payment_gateway_clearing'])

/** Cash and bank accounts: postable assets under the header of the cash / default bank account, plus the cash roles. */
export function cashAccountIds(accounts: readonly AccountLike[]): Set<string> {
  const parents = new Set(accounts.filter((a) => a.systemRole === 'cash' || a.systemRole === 'bank_default').map((a) => a.parentId).filter((p): p is string => !!p))
  return new Set(accounts.filter((a) => !a.isHeader && a.type === 'asset' && ((a.parentId && parents.has(a.parentId)) || (a.systemRole && CASH_ROLES.has(a.systemRole)))).map((a) => a.id))
}

const DEPRECIATION_RE = /depreciat|amorti[sz]/i
const PROVISION_RE = /end.of.service|gratuity|provision/i

/** Where a balance-sheet account's movement goes in the indirect cash flow. */
export function cashFlowKindOf(a: Pick<Account, 'type' | 'subtype' | 'name'>): CashFlowLine['kind'] | null {
  if (a.type === 'asset') {
    if (a.subtype === 'current_asset') return 'working_capital'
    if (a.subtype === 'fixed_asset') return DEPRECIATION_RE.test(a.name) ? 'adjustment' : 'investing'
    return 'investing'
  }
  if (a.type === 'liability') {
    if (a.subtype === 'non_current_liability') return PROVISION_RE.test(a.name) ? 'adjustment' : 'financing'
    return 'working_capital'
  }
  if (a.type === 'equity') return 'financing'
  return null
}

/**
 * Indirect-method cash flow over [from, to]: net profit, non-cash adjustments (accumulated depreciation, end-of-service
 * provision), working-capital changes (other current assets and current liabilities), investing (fixed and other
 * assets), financing (equity, non-current loans). The check line is 0 when it reconciles to the cash accounts.
 */
export function cashFlowOf(accounts: readonly AccountLike[], entries: readonly EntryLike[], from: string, to: string, currency: string): CashFlowStatement {
  const cash = cashAccountIds(accounts)
  const flows = netByAccount(entries, { from, to, excludeSources: [CLOSING_SOURCE, OPENING_SOURCE] })
  const netProfit = profitOf(accounts, flows)
  const adjustments: CashFlowLine[] = []
  const workingCapital: CashFlowLine[] = []
  const investing: CashFlowLine[] = []
  const financing: CashFlowLine[] = []
  for (const a of [...accounts].sort(byCode)) {
    if (a.isHeader || cash.has(a.id)) continue
    const kind = cashFlowKindOf(a)
    if (!kind) continue
    const n = flows.get(a.id) ?? 0
    if (n === 0) continue
    const line: CashFlowLine = { kind, accountId: a.id, code: a.code, name: a.name, amount: r2(-n) }
    ;({ adjustment: adjustments, working_capital: workingCapital, investing, financing })[kind].push(line)
  }
  const sum = (ls: CashFlowLine[]) => r2(ls.reduce((t, l) => t + l.amount, 0))
  const operatingTotal = r2(netProfit + sum(adjustments) + sum(workingCapital))
  const netChange = r2(operatingTotal + sum(investing) + sum(financing))
  const before = netByAccount(entries, { to: addDays(from, -1) })
  const openingInPeriod = netByAccount(entries.filter((e) => e.sourceType === OPENING_SOURCE), { from, to })
  const after = netByAccount(entries, { to })
  const cashAccounts = accounts
    .filter((a) => cash.has(a.id))
    .sort(byCode)
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, opening: r2((before.get(a.id) ?? 0) + (openingInPeriod.get(a.id) ?? 0)), closing: after.get(a.id) ?? 0 }))
    .filter((c) => c.opening !== 0 || c.closing !== 0)
  const openingCash = r2(cashAccounts.reduce((t, c) => t + c.opening, 0))
  const closingCash = r2(cashAccounts.reduce((t, c) => t + c.closing, 0))
  const check = r2(netChange - (closingCash - openingCash))
  return {
    currency,
    from,
    to,
    operating: { netProfit, adjustments, workingCapital, total: operatingTotal },
    investing: { lines: investing, total: sum(investing) },
    financing: { lines: financing, total: sum(financing) },
    netChange,
    openingCash,
    closingCash,
    check,
    reconciles: check === 0,
    cashAccounts,
  }
}

/* ================= general ledger, trial balance ================= */

/**
 * General ledger over [from, to]: per postable account (optionally only `accountIds`), the opening balance, every line
 * and the closing balance; accounts without opening balance or activity are left out. Dimension filter: lines only.
 */
export function generalLedgerOf(
  accounts: readonly AccountLike[],
  entries: readonly EntryLike[],
  from: string,
  to: string,
  currency: string,
  o: { accountIds?: ReadonlySet<string> | null; dims?: StatementDims; excludeClosing?: boolean } = {},
): AccountLedger[] {
  const filter = hasDims(o.dims)
  const pool = entries
    .filter((e) => !(o.excludeClosing && e.sourceType === CLOSING_SOURCE))
    .map((e) => (filter ? { ...e, lines: e.lines.filter((l) => lineMatches(l, o.dims)) } : e))
  const touched = new Set(pool.flatMap((e) => (e.date <= to ? e.lines.map((l) => l.accountId) : [])))
  const out: AccountLedger[] = []
  for (const a of [...accounts].sort(byCode)) {
    if (a.isHeader || !touched.has(a.id)) continue
    if (o.accountIds && !o.accountIds.has(a.id)) continue
    const led = accountLedger(a, pool, { from, to }, currency)
    if (led.openingBalance === 0 && led.rows.length === 0) continue
    out.push(led)
  }
  return out
}

/** Trial balances side by side (as of each column's date); rows are the union, zero where absent. */
export function trialBalanceCompare(
  accounts: readonly Pick<Account, 'id' | 'code' | 'name' | 'type' | 'isHeader'>[],
  entries: readonly EntryLike[],
  columns: StatementColumn[],
  currency: string,
): TrialBalanceComparative {
  const tbs = columns.map((c) => trialBalance(accounts, entries, c.to, currency))
  const rows = new Map<string, TrialBalanceComparative['rows'][number]>()
  tbs.forEach((tb, i) => {
    for (const r of tb.rows) {
      const row = rows.get(r.accountId) ?? { accountId: r.accountId, code: r.code, name: r.name, type: r.type, debit: columns.map(() => 0), credit: columns.map(() => 0) }
      row.debit[i] = r.debit
      row.credit[i] = r.credit
      rows.set(r.accountId, row)
    }
  })
  return {
    currency,
    columns,
    rows: [...rows.values()].sort(byCode),
    totals: { debit: tbs.map((t) => t.totals.debit), credit: tbs.map((t) => t.totals.credit) },
    balanced: tbs.map((t) => t.balanced),
  }
}

/* ================= year-end close ================= */

/**
 * Closing lines of a fiscal year: every income / expense account's net over [start, end] (closing entries excluded)
 * reversed to zero, the difference to retained earnings. Net profit > 0 → retained earnings credited.
 */
export function closingLinesOf(
  accounts: readonly AccountLike[],
  entries: readonly EntryLike[],
  start: string,
  end: string,
  retainedEarnings: Pick<Account, 'id' | 'code' | 'name' | 'type'>,
): { lines: ClosingLine[]; netProfit: number; totals: { debit: number; credit: number } } {
  const net = netByAccount(entries, { from: start, to: end, excludeSources: [CLOSING_SOURCE] })
  const lines: ClosingLine[] = []
  for (const a of [...accounts].sort(byCode)) {
    if (a.isHeader || (a.type !== 'income' && a.type !== 'expense')) continue
    const n = net.get(a.id) ?? 0
    if (n === 0) continue
    lines.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debit: n < 0 ? -n : 0, credit: n > 0 ? n : 0 })
  }
  const netProfit = profitOf(accounts, net)
  if (lines.length && netProfit !== 0) {
    lines.push({ accountId: retainedEarnings.id, code: retainedEarnings.code, name: retainedEarnings.name, type: retainedEarnings.type, debit: netProfit < 0 ? -netProfit : 0, credit: netProfit > 0 ? netProfit : 0 })
  }
  const debit = r2(lines.reduce((t, l) => t + l.debit, 0))
  const credit = r2(lines.reduce((t, l) => t + l.credit, 0))
  return { lines, netProfit, totals: { debit, credit } }
}

/** Natural-side balance helper re-exported for callers of this module. */
export { naturalBalance }
