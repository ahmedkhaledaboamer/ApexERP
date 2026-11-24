/**
 * Accounts & finance › Budgets & cash-flow forecast (phase 3). UI camelCase; the wire is plain snake_case at any depth
 * (src/shared/api/financeBudgetsMappers.ts). Records are company-scoped; the client never sends company_id.
 *
 * ids: budget `BUD-<n>` (one per company and fiscal year), budget line `BL-<n>`, forecast line `FCL-<n>` — unique
 * across companies.
 */

export type BudgetStatus = 'draft' | 'approved'
export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = { draft: 'Draft', approved: 'Approved (locked)' }

/** How an annual amount is spread over the 12 months. `last_year`: the line's actual monthly profile of last year. */
export type SpreadPattern = 'even' | 'front_loaded' | 'back_loaded' | 'last_year'
export const SPREAD_LABEL: Record<SpreadPattern, string> = { even: 'Evenly', front_loaded: 'Front-loaded', back_loaded: 'Back-loaded', last_year: 'Like last year’s actuals' }

export interface BudgetRow {
  id: string
  fiscalYear: number
  name: string
  status: BudgetStatus
  from: string
  to: string
  currency: string
  expenseTotal: number
  revenueTotal: number
  lineCount: number
  departmentCount: number
  approvedByName: string | null
  approvedAt: string | null
  /** The caller only sees their own department(s) (department head without accounting access). */
  departmentScoped: boolean
  updatedAt: string
}

export interface BudgetLine {
  id: string
  departmentId: string
  departmentName: string
  accountId: string
  accountCode: string
  accountName: string
  accountType: 'income' | 'expense'
  months: number[]
  annual: number
}

export interface BudgetDetail extends BudgetRow {
  months: string[]
  lines: BudgetLine[]
  departments: { id: string; name: string }[]
  /** Postable income / expense accounts (editing; full access only). */
  accounts: { id: string; code: string; name: string; type: 'income' | 'expense' }[]
  history: { at: string; byName: string; action: string; summary: string }[]
  can: { edit: boolean; approve: boolean; reopen: boolean; delete: boolean }
}

export interface BudgetCreateInput {
  fiscalYear: number
  name?: string
  /** Fill from that year's actuals ± `adjustPct`. */
  copyFromYear?: number | null
  adjustPct?: number
}

export interface BudgetLineInput {
  departmentId: string
  accountId: string
  /** 12 monthly amounts (fiscal months); or `annual` + `pattern`. All zero removes the line. */
  months?: number[]
  annual?: number
  pattern?: SpreadPattern
}

export interface CopyActualsInput {
  fromYear: number
  adjustPct?: number
  departmentId?: string | null
}

export interface BvaRow {
  departmentId: string
  departmentName: string
  accountId: string
  accountCode: string
  accountName: string
  accountType: 'income' | 'expense'
  budget: number[]
  actual: number[]
  monthBudget: number
  monthActual: number
  ytdBudget: number
  ytdActual: number
  annualBudget: number
  /** Favourable when positive: expense budget − actual, income actual − budget (YTD). */
  variance: number
  variancePct: number | null
  /** Actual ÷ budget × 100 (YTD); null without a budget. */
  usedPct: number | null
  monthVariance: number
  monthUsedPct: number | null
}

export type BvaStatus = 'ok' | 'warning' | 'over'
export interface BvaDepartment {
  departmentId: string
  departmentName: string
  monthBudget: number
  monthActual: number
  monthPct: number | null
  ytdBudget: number
  ytdActual: number
  ytdPct: number | null
  status: BvaStatus
}

export interface BudgetVsActual {
  budgetId: string
  fiscalYear: number
  status: BudgetStatus
  currency: string
  months: string[]
  month: string
  monthIndex: number
  departmentId: string | null
  departmentScoped: boolean
  departments: BvaDepartment[]
  rows: BvaRow[]
  totals: { expenseBudget: number; expenseActual: number; incomeBudget: number; incomeActual: number; monthExpenseBudget: number; monthExpenseActual: number }
  /** Actuals without a department (not part of any department's budget). */
  unassignedExpenseYtd: number
}

/* ---------------- cash-flow forecast ---------------- */

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
export const AGING_BUCKETS: AgingBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']
export const AGING_LABEL: Record<AgingBucket, string> = { current: 'Not yet due', d1_30: '1–30 days overdue', d31_60: '31–60 days overdue', d61_90: '61–90 days overdue', d90_plus: 'Over 90 days overdue' }

export type ForecastCategory = 'receivables' | 'pdc' | 'recurring' | 'bills' | 'payroll' | 'expenses' | 'vat' | 'manual'
export const FORECAST_CATEGORY_LABEL: Record<ForecastCategory, string> = {
  receivables: 'Open invoices',
  pdc: 'Post-dated cheques',
  recurring: 'Recurring invoices',
  bills: 'Supplier bills',
  payroll: 'Payroll',
  expenses: 'Recurring expenses',
  vat: 'VAT payments',
  manual: 'Manual lines',
}
export const INFLOW_CATEGORIES: ForecastCategory[] = ['receivables', 'pdc', 'recurring']
export const OUTFLOW_CATEGORIES: ForecastCategory[] = ['bills', 'payroll', 'expenses', 'vat']

export interface ForecastItem {
  id: string
  date: string
  category: ForecastCategory
  label: string
  ref: string | null
  link: string | null
  /** Signed expected amount (inflows +, outflows −), after probability and scenario %. */
  amount: number
  /** Signed full amount before probability / scenario. */
  gross: number
  probability: number
}

export interface ForecastBucket {
  key: string
  label: string
  from: string
  to: string
  opening: number
  inflows: number
  outflows: number
  net: number
  closing: number
  byCategory: { category: ForecastCategory; amount: number }[]
}

export interface ForecastLine {
  id: string
  label: string
  date: string
  amount: number
  recurrence: 'once' | 'weekly' | 'monthly'
}

export interface ForecastSettings {
  probabilities: { bucket: AgingBucket; pct: number }[]
  bouncedPdcPct: number
  inflowAdjustPct: number
  outflowAdjustPct: number
  minimumCash: number
  lines: ForecastLine[]
}

export interface CashForecast {
  currency: string
  today: string
  openingCash: number
  cashAccounts: { accountId: string; code: string; name: string; balance: number }[]
  weeks: ForecastBucket[]
  months: ForecastBucket[]
  lowestWeek: { key: string; label: string; closing: number; belowMinimum: boolean; negative: boolean }
  items: ForecastItem[]
  settings: ForecastSettings
  assumptions: string[]
  canEdit: boolean
}

export interface ForecastSettingsInput {
  probabilities?: { bucket: AgingBucket; pct: number }[]
  bouncedPdcPct?: number
  inflowAdjustPct?: number
  outflowAdjustPct?: number
  minimumCash?: number
}
export interface ForecastLineInput {
  label: string
  date: string
  amount: number
  recurrence?: 'once' | 'weekly' | 'monthly'
}
