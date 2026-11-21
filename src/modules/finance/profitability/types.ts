import type { JournalSourceType } from '@/modules/finance/types'

/**
 * Accounts & finance › Profitability (docs/API.md › Finance › Profitability). Every amount is in the company's base
 * currency, from the journal (the books are the source of truth) plus one allocation that is NOT a ledger posting:
 * labour = hours logged on a project's tasks × the employee's hourly cost (monthly contract pay ÷ standard hours).
 *
 * WHO: accounting full (Company Admin, Management, Accountant) sees everything incl. labour cost; accounting view
 * (Sales Manager) sees revenue and direct costs, never labour cost (`labourCost: null`, margins before labour,
 * `meta.labourVisible: false`). Labour is only ever aggregated (per project, customer, month) — never a rate or a
 * cost per employee.
 */

export type ProfitReport = 'projects' | 'events' | 'customers' | 'departments'
export const PROFIT_REPORTS: ProfitReport[] = ['projects', 'events', 'customers', 'departments']
export const PROFIT_REPORT_LABEL: Record<ProfitReport, string> = {
  projects: 'Projects',
  events: 'Events',
  customers: 'Customers',
  departments: 'Department P&L',
}

/** Query of every report: company-local yyyy-MM-dd (default: this calendar year) + optional filters. */
export interface ProfitQuery {
  from?: string
  to?: string
  departmentId?: string
  projectId?: string
  eventId?: string
  customerId?: string
}

export interface ProfitMeta {
  from: string
  to: string
  today: string
  timezone: string
  currency: string
  departmentId: string | null
  departmentName: string | null
  /** Accounting full: labour cost is included in costs and margins. */
  labourVisible: boolean
  standardHoursPerMonth: number
  access: 'full' | 'view'
}

export interface ProfitSettings {
  /** Standard working hours per month (hourly cost = monthly contract pay ÷ this). Default 176. */
  standardHoursPerMonth: number
  /** Company performance alert: cash and bank below this amount (null = 3 months' average monthly expenses). */
  cashAlertThreshold: number | null
  /** Company performance alert: overdue receivables above this share of all open receivables (%). Default 30. */
  overdueReceivablesAlertPct: number
  updatedAt: string | null
  updatedByName: string | null
}

export type ProfitSettingsInput = Partial<Pick<ProfitSettings, 'standardHoursPerMonth' | 'cashAlertThreshold' | 'overdueReceivablesAlertPct'>>

export interface ProfitOptions {
  meta: ProfitMeta
  settings: ProfitSettings
  canEditSettings: boolean
  departments: { id: string; name: string }[]
  reports: ProfitReport[]
}

export interface ProfitTotals {
  revenue: number
  directCosts: number
  labourHours: number
  labourCost: number | null
  totalCost: number
  margin: number
  marginPct: number | null
}

/* ---------------- projects ---------------- */

export type BudgetSource = 'contract' | 'quotation' | 'lead'

export interface ProjectProfitRow {
  projectId: string
  name: string
  customerId: string
  customerName: string
  managerName: string
  departmentId: string | null
  departmentName: string
  status: string
  revenue: number
  directCosts: number
  labourHours: number
  /** Null when the caller may not see labour cost. */
  labourCost: number | null
  /** Hours logged by people without an employee record or a contract in force (no cost allocated). */
  unratedHours: number
  totalCost: number
  margin: number
  marginPct: number | null
  /** Project value: the contract's value, else the quotation's net, else the won deal's value. */
  budget: number | null
  budgetSource: BudgetSource | null
  /** Revenue (whole life of the project) ÷ budget, %. */
  budgetBilledPct: number | null
  estimatedHours: number
  loggedHoursAllTime: number
}

export interface ProjectProfitability {
  meta: ProfitMeta
  rows: ProjectProfitRow[]
  totals: ProfitTotals
  negativeMarginCount: number
}

export interface MonthPoint {
  /** yyyy-MM */
  month: string
  revenue: number
  directCosts: number
  labourHours: number
  labourCost: number | null
  margin: number
}

export interface LedgerLineView {
  date: string
  entryId: string
  entryNumber: string
  sourceType: JournalSourceType
  description: string
  kind: 'revenue' | 'cost'
  accountName: string
  amount: number
}

export interface ProjectProfitDetail {
  meta: ProfitMeta
  project: ProjectProfitRow
  months: MonthPoint[]
  lines: LedgerLineView[]
  note: string
}

/* ---------------- events ---------------- */

export interface EventProfitRow {
  eventId: string
  name: string
  startDate: string
  status: string
  isOrganizer: boolean
  /** Event-tagged income in the ledger (ticket and sponsor invoices). */
  ledgerRevenue: number
  /** Signed / paid sponsor deals not (yet) invoiced through finance: max(0, sponsorship − ledger revenue). */
  sponsorshipNotInvoiced: number
  revenue: number
  /** Event-tagged expenses in the ledger (bills, expenses, claims). */
  ledgerCosts: number
  /** Budget-line actuals not billed through finance: Σ max(0, line actual − bills linked to that line). */
  budgetLineCosts: number
  totalCost: number
  profit: number
  /** (revenue − cost) ÷ cost, %. */
  roiPct: number | null
  budget: number | null
  attendees: number
  leads: number
  dealsWon: number
  wonValue: number
  costPerAttendee: number | null
  costPerLead: number | null
}

export interface EventProfitability {
  meta: ProfitMeta
  rows: EventProfitRow[]
  totals: { revenue: number; totalCost: number; profit: number; roiPct: number | null }
  note: string
}

/* ---------------- customers ---------------- */

export interface CustomerProfitRow {
  customerId: string
  name: string
  /** Net income in the period (credit notes already deducted). */
  revenue: number
  creditNotes: number
  directCosts: number
  labourHours: number
  labourCost: number | null
  grossMargin: number
  marginPct: number | null
  /** Invoices issued in the period (incl. VAT). */
  invoiced: number
  /** Paid on those invoices. */
  collected: number
  /** Open balance of all the customer's invoices, today. */
  outstanding: number
  overdue: number
  /** Days sales outstanding = outstanding ÷ invoiced in the period × days in the period. */
  dso: number | null
  lifetimeRevenue: number
  projects: number
}

export interface CustomerProfitability {
  meta: ProfitMeta
  rows: CustomerProfitRow[]
  totals: ProfitTotals & { invoiced: number; collected: number; outstanding: number; dso: number | null }
}

/* ---------------- departments ---------------- */

export interface DepartmentPnlRow {
  departmentId: string | null
  name: string
  revenue: number
  costOfSales: number
  operatingExpenses: number
  /** Part of the operating expenses posted by payroll. */
  payroll: number
  totalCost: number
  profit: number
  marginPct: number | null
}

export interface DepartmentPnl {
  meta: ProfitMeta
  rows: DepartmentPnlRow[]
  totals: Omit<DepartmentPnlRow, 'departmentId' | 'name'>
  source: 'ledger' | 'statements'
  note: string
}

export interface ProfitExport {
  fileName: string
  headers: string[]
  rows: (string | number | null)[][]
}
