import type { AccountType, CurrencyCode } from '@/modules/finance/types'
import type { AccountLedger, DimensionOption } from '@/modules/finance/ledger/types'

/**
 * Accounts & finance › Financial statements and year-end close (docs/API.md › Finance › Financial statements,
 * Year-end close). Every number is read from the journal only (never from documents), in the company's base currency.
 * Closing entries (source type `year_end_close`) never count in a P&L, so a closed year still shows its activity.
 */

/* ---------------- shared ---------------- */

/** Report dimensions (journal line fields). A filter keeps only the lines carrying every given value. */
export interface StatementDims {
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  customerId?: string | null
}

export type PeriodKind = 'month' | 'quarter' | 'ytd' | 'fiscal_year' | 'custom'
export type CompareKind = 'previous_period' | 'last_year'

export interface StatementColumn {
  /** `current`, `previous_period`, `last_year`, a month `yyyy-MM`, or `total`. */
  key: string
  label: string
  from: string | null
  to: string
}

/** Printed letterhead (legal name + tax number, never the workspace name). */
export interface StatementLetterhead {
  legalName: string
  name: string
  logoUrl: string | null
  monogram: string
  addressLines: string[]
  taxLabel: string
  taxNumber: string
}

/** GET /finance/statements/meta — page setup: letterhead, fiscal year, pickers (view roles included). */
export interface StatementsMeta {
  currency: CurrencyCode
  today: string
  fiscalYearStartMonth: number
  fiscalYearStart: string
  lockDate: string | null
  letterhead: StatementLetterhead
  accounts: { id: string; code: string; name: string; type: AccountType; isHeader: boolean }[]
  departments: DimensionOption[]
  projects: DimensionOption[]
  events: DimensionOption[]
  customers: DimensionOption[]
  canClose: boolean
  canReopen: boolean
}

/* ---------------- profit and loss ---------------- */

export type PnlSectionId = 'revenue' | 'cost_of_sales' | 'operating_expenses' | 'other_income' | 'other_expenses'

export interface PnlLine {
  accountId: string
  code: string
  name: string
  amount: number
}
export interface PnlSection {
  id: PnlSectionId
  label: string
  total: number
  lines: PnlLine[]
}

/** One period of a P&L (the reusable shape: `profitAndLoss(companyId, from, to, dims?)`). */
export interface PnlPeriod {
  from: string
  to: string
  sections: PnlSection[]
  revenue: number
  costOfSales: number
  grossProfit: number
  operatingExpenses: number
  operatingProfit: number
  otherIncome: number
  otherExpenses: number
  netProfit: number
}

export interface PnlStatementLine {
  accountId: string
  code: string
  name: string
  amounts: number[]
}
export interface PnlStatementSection {
  id: PnlSectionId
  label: string
  lines: PnlStatementLine[]
  totals: number[]
}
export interface PnlTotals {
  revenue: number[]
  costOfSales: number[]
  grossProfit: number[]
  operatingExpenses: number[]
  operatingProfit: number[]
  otherIncome: number[]
  otherExpenses: number[]
  netProfit: number[]
}

/** GET /finance/statements/profit-and-loss — one or more columns (comparisons, or 12 months + total). */
export interface ProfitAndLossStatement {
  currency: CurrencyCode
  view: 'period' | 'monthly'
  period: PeriodKind
  columns: StatementColumn[]
  sections: PnlStatementSection[]
  totals: PnlTotals
  dims: Required<StatementDims>
  /** Names of the filtered dimension values (null when no filter or unknown). */
  dimNames: { department: string | null; project: string | null; event: string | null; customer: string | null }
}

/* ---------------- balance sheet ---------------- */

export type BsSectionId = 'current_assets' | 'fixed_assets' | 'other_assets' | 'current_liabilities' | 'non_current_liabilities' | 'equity'
export type BsGroup = 'assets' | 'liabilities' | 'equity'
export type BsLineKind = 'account' | 'current_year_earnings' | 'prior_years_earnings'

export interface BsLine {
  kind: BsLineKind
  accountId: string | null
  code: string
  name: string
  amount: number
}
export interface BsSection {
  id: BsSectionId
  group: BsGroup
  label: string
  lines: BsLine[]
  total: number
}

/** One date of a balance sheet (the reusable shape: `balanceSheet(companyId, asOf)`). */
export interface BalanceSheetPeriod {
  asOf: string
  fiscalYearStart: string
  sections: BsSection[]
  totalAssets: number
  totalLiabilities: number
  /** Equity accounts + unclosed earnings (current year and, when not closed, prior years). */
  totalEquity: number
  currentYearEarnings: number
  priorYearsEarnings: number
  liabilitiesAndEquity: number
  /** Assets − (liabilities + equity); 0 for balanced books. */
  difference: number
  balanced: boolean
}

export interface BsStatementLine {
  key: string
  kind: BsLineKind
  accountId: string | null
  code: string
  name: string
  amounts: number[]
}
export interface BsStatementSection {
  id: BsSectionId
  group: BsGroup
  label: string
  lines: BsStatementLine[]
  totals: number[]
}

/** GET /finance/statements/balance-sheet */
export interface BalanceSheetStatement {
  currency: CurrencyCode
  columns: StatementColumn[]
  sections: BsStatementSection[]
  totals: { assets: number[]; liabilities: number[]; equity: number[]; liabilitiesAndEquity: number[]; difference: number[] }
  balanced: boolean
}

/* ---------------- cash flow ---------------- */

export type CashFlowLineKind = 'adjustment' | 'working_capital' | 'investing' | 'financing'
export interface CashFlowLine {
  kind: CashFlowLineKind
  accountId: string
  code: string
  name: string
  /** Cash effect: positive = cash in. */
  amount: number
}

/** GET /finance/statements/cash-flow (indirect method; the reusable shape: `cashFlow(companyId, from, to)`). */
export interface CashFlowStatement {
  currency: CurrencyCode
  from: string
  to: string
  operating: { netProfit: number; adjustments: CashFlowLine[]; workingCapital: CashFlowLine[]; total: number }
  investing: { lines: CashFlowLine[]; total: number }
  financing: { lines: CashFlowLine[]; total: number }
  netChange: number
  openingCash: number
  closingCash: number
  /** netChange − (closingCash − openingCash): 0 when the statement reconciles. */
  check: number
  reconciles: boolean
  cashAccounts: { accountId: string; code: string; name: string; opening: number; closing: number }[]
}

/* ---------------- general ledger, trial balance ---------------- */

/** GET /finance/statements/general-ledger */
export interface GeneralLedgerReport {
  currency: CurrencyCode
  from: string
  to: string
  accounts: AccountLedger[]
  totals: { debit: number; credit: number }
  excludeClosing: boolean
}

export interface TbCompareRow {
  accountId: string
  code: string
  name: string
  type: AccountType
  debit: number[]
  credit: number[]
}
/** GET /finance/statements/trial-balance — the trial balance with comparative dates. */
export interface TrialBalanceComparative {
  currency: CurrencyCode
  columns: StatementColumn[]
  rows: TbCompareRow[]
  totals: { debit: number[]; credit: number[] }
  balanced: boolean[]
}

/* ---------------- year-end close ---------------- */

export interface ClosingLine {
  accountId: string
  code: string
  name: string
  type: AccountType
  debit: number
  credit: number
}

export interface FiscalYearRow {
  start: string
  end: string
  label: string
  /** `in_progress`: has not ended yet. */
  status: 'open' | 'closed' | 'in_progress'
  netProfit: number
  closeId: string | null
  closedAt: string | null
  closedByName: string | null
  entryId: string | null
  entryNumber: string | null
  canClose: boolean
  closeBlockedReason: string | null
  canReopen: boolean
  reopenBlockedReason: string | null
}

export interface YearEndCloseRow {
  id: string
  fiscalYearStart: string
  fiscalYearEnd: string
  status: 'closed' | 'reopened'
  netProfit: number
  entryId: string | null
  entryNumber: string | null
  reversalEntryId: string | null
  reversalEntryNumber: string | null
  previousLockDate: string | null
  note: string
  closedAt: string
  closedByName: string
  reopenedAt: string | null
  reopenedByName: string | null
  reopenReason: string | null
}

/** GET /finance/year-end */
export interface YearEndOverview {
  currency: CurrencyCode
  today: string
  fiscalYearStartMonth: number
  lockDate: string | null
  retainedEarnings: { accountId: string; code: string; name: string } | null
  years: FiscalYearRow[]
  history: YearEndCloseRow[]
  canClose: boolean
  canReopen: boolean
}

/** GET /finance/year-end/preview?fiscal_year_end= */
export interface YearEndPreview {
  currency: CurrencyCode
  start: string
  end: string
  label: string
  retainedEarnings: { accountId: string; code: string; name: string } | null
  lines: ClosingLine[]
  totals: { debit: number; credit: number }
  netProfit: number
  lockDate: string | null
  /** The lock date after the close (the year's last day, unless the books are already locked later). */
  newLockDate: string | null
  canClose: boolean
  blockedReason: string | null
}

export interface YearEndCloseInput {
  fiscalYearEnd: string
  note?: string
}

export interface YearEndCloseResult {
  close: YearEndCloseRow
  lockDate: string | null
}
