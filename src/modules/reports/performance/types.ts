import type { Scope } from '@/shared/types'

/**
 * Reports › Company performance (docs/API.md › Reports › Company performance). One management payload; each section is
 * `null` when the caller's role (or the plan) doesn't include it — hidden, never zeroed:
 *   financial   accounting full / view (Company Admin, Management, Accountant, Sales Manager) + plan `accounting`
 *   sales       sales column not hidden (figures in the caller's sales scope)
 *   delivery    tasks column (projects and tasks in the caller's tasks scope)
 *   people      hr full / team + plan `hr` (headcount, turnover, open positions; never pay)
 *   departments reports scope other than own (the department scorecard; money columns only with `financial`)
 */

export interface PerformanceQuery {
  from?: string
  to?: string
}

export interface PerformanceMonth {
  /** yyyy-MM */
  month: string
  revenue: number
  expenses: number
  /** Cash and bank at the month end (or today for the current month). */
  cash: number
}

export interface FinancialKpis {
  currency: string
  revenue: number
  revenueLy: number
  revenueChangePct: number | null
  revenueMtd: number
  revenueMtdLy: number
  revenueYtd: number
  revenueYtdLy: number
  costOfSales: number
  grossMarginPct: number | null
  expenses: number
  netProfit: number
  netProfitYtd: number
  cashBalance: number
  arOutstanding: number
  arOverdue: number
  arOverduePct: number | null
  dso: number | null
  apOpen: number
  apOverdue: number
  apDueThisWeek: number
  payrollCost: number
  payrollCostPct: number | null
  eventsRevenue: number
  eventsCost: number
  eventsRoiPct: number | null
  months: PerformanceMonth[]
}

export interface StageCount {
  status: string
  label: string
  count: number
  value: number
}

export interface SalesKpis {
  scope: Scope
  pipelineValue: number
  openLeads: number
  won: number
  lost: number
  wonValue: number
  winRate: number | null
  leadsThisMonth: number
  leadsLastMonth: number
  leadsInPeriod: number
  byStage: StageCount[]
}

export interface TaskMonth {
  month: string
  created: number
  completed: number
}

export interface DeliveryKpis {
  scope: Scope
  activeProjects: number
  openTasks: number
  overdueTasks: number
  /** Tasks completed ÷ tasks due in the period, %. */
  completionRatePct: number | null
  months: TaskMonth[]
}

export interface PeopleKpis {
  headcount: number
  joiners: number
  leavers: number
  turnoverPct: number | null
  openPositions: number
}

export interface ScorecardRow {
  departmentId: string
  name: string
  headcount: number
  overdueTasks: number
  revenue: number | null
  cost: number | null
  margin: number | null
  marginPct: number | null
  /** Actual − budget for the period (positive = over budget); null until a budgets API exists. */
  budgetVariance: number | null
}

export interface Scorecard {
  rows: ScorecardRow[]
  financialColumns: boolean
  budgetColumn: boolean
}

export type AlertSeverity = 'danger' | 'warning' | 'info'

export interface PerformanceAlert {
  id: string
  severity: AlertSeverity
  title: string
  detail: string
  link: string | null
}

export interface CompanyPerformance {
  from: string
  to: string
  today: string
  timezone: string
  asOf: string
  generatedAt: string
  access: { financial: boolean; sales: boolean; delivery: boolean; people: boolean; departments: boolean }
  financial: FinancialKpis | null
  sales: SalesKpis | null
  delivery: DeliveryKpis | null
  people: PeopleKpis | null
  departments: Scorecard | null
  alerts: PerformanceAlert[]
}
