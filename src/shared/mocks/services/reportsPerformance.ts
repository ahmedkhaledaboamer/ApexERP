import type { User } from '@/shared/types'
import type {
  CompanyPerformance,
  DeliveryKpis,
  FinancialKpis,
  PeopleKpis,
  PerformanceAlert,
  PerformanceQuery,
  SalesKpis,
  Scorecard,
  TaskMonth,
} from '@/modules/reports/performance/types'
import { changePct, grossMarginPct, payrollCostPct, roiPct, sameRangeLastYear, sharePct, toDatePeriods, winRate } from '@/modules/reports/performance/calc'
import { monthsIn, r2 } from '@/modules/finance/profitability/calc'
import { monthEnd } from '@/modules/hr/reports/calc'
import { monthRange } from '@/modules/finance/ledger/calc'
import { nowIso } from '@/shared/mocks/clock'
import { departmentSubtree, scopeOf } from '@/shared/lib/permissions'
import { zonedParts } from '@/shared/lib/zonedTime'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { isClosedStatus, isLostStatus, isWonStatus } from '@/shared/mocks/data/lookups'
import { orderedStatuses } from '@/shared/mocks/lookupChecks'
import { profitSettingsOf } from '@/shared/mocks/data/financeProfitability'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyById } from '@/shared/mocks/data/tenancy'
import { overdueTasks, projectsVisibleTo, tasksVisibleTo } from '@/shared/mocks/selectors/tasks'
import { CodedApiError, tenantOf } from '@/shared/mocks/tenant'
import { resolveRange } from '@/modules/hr/reports/calc'
import { companyModules } from './billing'
import { visibleLeads } from './leads'
import { balancesByAccount, financeAccessOf, financeSettingsOf, getFinanceOverview } from './financeLedger'
import { payablesOverview } from './financePurchasesCore'
import { companyReceivables, departmentPnlRows, eventRowsFor, incomeStatementIn, profitLines, projectRowsFor } from './financeProfitability'
import { overviewReport } from './hrReports'
import { actualsOf } from './financeBudgets'
import { finBudgets } from '@/shared/mocks/data/financeBudgets'
import { financeAccounts } from '@/shared/mocks/data/finance'
import { fiscalMonths } from '@/modules/finance/tax/calc'

/**
 * Reports › Company performance (docs/API.md › Reports › Company performance). GET /reports/performance?from=&to=
 * (company-local yyyy-MM-dd; default this year up to today). Every number is computed over the caller's company and
 * the caller's scopes; a section the role can't see is `null` (hidden, never zeroed):
 *
 *   reports hidden (Employee)                          → 403
 *   financial    accounting full / view + plan accounting (Company Admin, Management, Accountant, Sales Manager)
 *   sales        sales not hidden (own / team / view / full scope of the leads, like the dashboard — no synthetic baseline)
 *   delivery     tasks not hidden (projects and tasks in the tasks scope)
 *   people       hr full / team + plan hr (HR overview figures; never pay)
 *   departments  reports scope ≠ own: full / finance / hr → every active department; team / marketing → the departments
 *                they head (+ sub-departments; their own department when they head none). Revenue / cost / margin
 *                columns only with `financial`; overdue tasks counted from the caller's visible tasks.
 * Budget variance (financial only): expense actual − approved budget per department for the months of the period
 * (`budgetVarianceOf`, over the Budgets store); `budget_column: false` when no approved budget covers the period.
 */

const FORBIDDEN = 'Company performance isn’t part of your role.'

type Day = string

function localDay(iso: string | null | undefined, tz: string): Day | null {
  return iso ? zonedParts(iso, tz).date : null
}
const within = (d: string | null, from: string, to: string): d is string => !!d && d >= from && d <= to

interface Ctx {
  user: User
  co: string
  today: string
  timezone: string
  from: string
  to: string
  asOf: string
  modules: string[]
}

function ctxOf(user: User, q: PerformanceQuery): Ctx {
  if (scopeOf(user.role, 'reports') === 'hidden') throw new CodedApiError(FORBIDDEN, 403, 'forbidden')
  const co = tenantOf(user)
  const day = companyDayOf(co)
  const from = typeof q.from === 'string' && q.from ? q.from : `${day.today.slice(0, 4)}-01-01`
  const to = typeof q.to === 'string' && q.to ? q.to : day.today
  const range = resolveRange(day.today, from, to)
  if (!range.ok) throw new CodedApiError(range.message, 422, 'validation_failed', { field: 'from' })
  return { user, co, today: day.today, timezone: companyById(co)?.regional.timezone ?? 'UTC', from: range.from, to: range.to, asOf: range.to < day.today ? range.to : day.today, modules: companyModules(co) }
}

/* ---------------- financial ---------------- */

function financialOf(ctx: Ctx): FinancialKpis {
  const { user, co } = ctx
  financeAccessOf(user) // runs the lazy finance seeds
  const lines = profitLines(co)
  const cur = incomeStatementIn(co, ctx.from, ctx.to, lines)
  const lyRange = sameRangeLastYear(ctx.from, ctx.to)
  const ly = incomeStatementIn(co, lyRange.from, lyRange.to, lines)
  const p = toDatePeriods(ctx.asOf, financeSettingsOf(co).fiscalYearStartMonth)
  const at = (r: { from: string; to: string }) => incomeStatementIn(co, r.from, r.to, lines)
  const overview = getFinanceOverview(user)
  const cashIds = overview.cash.map((c) => c.accountId)
  const cashAt = (day: string) => {
    const b = balancesByAccount(co, day)
    return r2(cashIds.reduce((s, id) => s + (b.get(id) ?? 0), 0))
  }
  const ar = companyReceivables(co, ctx.from, ctx.to, ctx.today)
  const ap = payablesOverview(co)
  const events = eventRowsFor(user, ctx.from, ctx.to)
  const eventsRevenue = r2(events.reduce((s, e) => s + e.revenue, 0))
  const eventsCost = r2(events.reduce((s, e) => s + e.totalCost, 0))
  // The 12 months ending with the as-of month (cash at each month end; the current month up to as-of).
  const months = monthsIn(monthRange(ctx.asOf, -11).from, ctx.asOf, 12).map((month) => {
    const end = monthEnd(month) < ctx.asOf ? monthEnd(month) : ctx.asOf
    const s = incomeStatementIn(co, `${month}-01`, end, lines)
    return { month, revenue: s.revenue, expenses: s.expenses, cash: cashAt(end) }
  })
  return {
    currency: overview.currency,
    revenue: cur.revenue,
    revenueLy: ly.revenue,
    revenueChangePct: changePct(cur.revenue, ly.revenue),
    revenueMtd: at(p.mtd).revenue,
    revenueMtdLy: at(p.mtdLy).revenue,
    revenueYtd: at(p.ytd).revenue,
    revenueYtdLy: at(p.ytdLy).revenue,
    costOfSales: cur.costOfSales,
    grossMarginPct: grossMarginPct(cur.revenue, cur.costOfSales),
    expenses: cur.expenses,
    netProfit: cur.profit,
    netProfitYtd: at(p.ytd).profit,
    cashBalance: cashAt(ctx.asOf),
    arOutstanding: ar.outstanding,
    arOverdue: ar.overdue,
    arOverduePct: sharePct(ar.overdue, ar.outstanding),
    dso: ar.dso,
    apOpen: ap.openBase,
    apOverdue: ap.overdueBase,
    apDueThisWeek: ap.dueThisWeekBase,
    payrollCost: cur.payroll,
    payrollCostPct: payrollCostPct(cur.payroll, cur.revenue),
    eventsRevenue,
    eventsCost,
    eventsRoiPct: roiPct(eventsRevenue, eventsCost),
    months,
  }
}

/* ---------------- sales ---------------- */

function salesOf(ctx: Ctx): SalesKpis {
  const { user, co, timezone: tz } = ctx
  const list = visibleLeads(user)
  const open = list.filter((l) => !isClosedStatus(co, l.status))
  const closedIn = (pred: (s: string) => boolean) => list.filter((l) => pred(l.status) && within(localDay(l.stageChangedAt, tz), ctx.from, ctx.to))
  const won = closedIn((s) => isWonStatus(co, s))
  const lost = closedIn((s) => isLostStatus(co, s))
  const month = ctx.today.slice(0, 7)
  const prevMonth = monthRange(ctx.today, -1).month
  const created = (m: string) => list.filter((l) => localDay(l.createdAt, tz)?.startsWith(m)).length
  const byStage = orderedStatuses(co)
    .map((s) => {
      const rows = open.filter((l) => l.status === s.key)
      return { status: s.key, label: s.label, count: rows.length, value: rows.reduce((t, l) => t + l.value, 0) }
    })
    .filter((s) => s.count > 0)
  return {
    scope: scopeOf(user.role, 'sales'),
    pipelineValue: open.reduce((s, l) => s + l.value, 0),
    openLeads: open.length,
    won: won.length,
    lost: lost.length,
    wonValue: won.reduce((s, l) => s + l.value, 0),
    winRate: winRate(won.length, lost.length),
    leadsThisMonth: created(month),
    leadsLastMonth: created(prevMonth),
    leadsInPeriod: list.filter((l) => within(localDay(l.createdAt, tz), ctx.from, ctx.to)).length,
    byStage,
  }
}

/* ---------------- delivery ---------------- */

function deliveryOf(ctx: Ctx): DeliveryKpis {
  const { user, timezone: tz } = ctx
  const visible = tasksVisibleTo(user)
  const dueIn = visible.filter((t) => t.status !== 'cancelled' && within(t.dueDate, ctx.from, ctx.asOf))
  const months: TaskMonth[] = monthsIn(ctx.from, ctx.asOf, 12).map((month) => ({
    month,
    created: visible.filter((t) => localDay(t.createdAt, tz)?.startsWith(month)).length,
    completed: visible.filter((t) => t.status === 'done' && localDay(t.completedAt, tz)?.startsWith(month)).length,
  }))
  return {
    scope: scopeOf(user.role, 'tasks'),
    activeProjects: projectsVisibleTo(user).filter((p) => p.status === 'active').length,
    openTasks: visible.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
    overdueTasks: overdueTasks(user).length,
    completionRatePct: sharePct(dueIn.filter((t) => t.status === 'done').length, dueIn.length),
    months,
  }
}

/* ---------------- people ---------------- */

function peopleOf(ctx: Ctx): PeopleKpis | null {
  try {
    const o = overviewReport(ctx.user, { from: ctx.from, to: ctx.to })
    return { headcount: o.headcount, joiners: o.joiners, leavers: o.leavers, turnoverPct: o.turnoverPct, openPositions: o.openPositions }
  } catch {
    return null
  }
}

/* ---------------- department scorecard ---------------- */

function scorecardDepartments(ctx: Ctx): string[] {
  const all = departments.filter((d) => d.companyId === ctx.co)
  const scope = scopeOf(ctx.user.role, 'reports')
  if (scope === 'full' || scope === 'finance' || scope === 'hr') return all.filter((d) => d.active).map((d) => d.id)
  const headed = all.filter((d) => d.active && d.headId === ctx.user.id).flatMap((d) => departmentSubtree(d.id, all))
  const ids = new Set(headed.length ? headed : ctx.user.departmentId ? [ctx.user.departmentId] : [])
  return all.filter((d) => ids.has(d.id)).map((d) => d.id)
}

/**
 * SEAM(budgets): expense budget variance per department for the months of [from, as-of] from the APPROVED budgets
 * (Accounts & finance › Budgets store): actual − budget, positive = over budget. Null (column off) when no approved
 * budget covers the period.
 */
export function budgetVarianceOf(co: string, from: string, asOf: string): Map<string, number> | null {
  const startMonth = financeSettingsOf(co).fiscalYearStartMonth
  const first = from.slice(0, 7)
  const last = asOf.slice(0, 7)
  const budget = new Map<string, number>()
  const expense = new Set(financeAccounts.filter((a) => a.companyId === co && a.type === 'expense').map((a) => a.id))
  let covered = false
  for (const b of finBudgets) {
    if (b.companyId !== co || b.status !== 'approved') continue
    const months = fiscalMonths(b.fiscalYear, startMonth)
    months.forEach((m, i) => {
      if (m < first || m > last) return
      covered = true
      for (const l of b.lines) if (expense.has(l.accountId)) budget.set(l.departmentId, (budget.get(l.departmentId) ?? 0) + (l.months[i] ?? 0))
    })
  }
  if (!covered) return null
  const actual = actualsOf(co, `${first}-01`, asOf)
  const spent = new Map<string, number>()
  for (const [k, v] of actual) {
    const [dept, account] = k.split('|')
    if (dept && expense.has(account)) spent.set(dept, (spent.get(dept) ?? 0) + v)
  }
  const out = new Map<string, number>()
  for (const dept of new Set([...budget.keys(), ...spent.keys()])) out.set(dept, r2((spent.get(dept) ?? 0) - (budget.get(dept) ?? 0)))
  return out
}

function scorecardOf(ctx: Ctx, financial: boolean): Scorecard {
  const ids = scorecardDepartments(ctx)
  const late = overdueTasks(ctx.user)
  const deptOfUser = new Map(users.filter((u) => u.companyId === ctx.co).map((u) => [u.id, u.departmentId || null]))
  const pnl = financial ? new Map(departmentPnlRows(ctx.co, ctx.from, ctx.to).rows.map((r) => [r.departmentId, r])) : null
  let variance: Map<string, number> | null = null
  if (financial) {
    try {
      variance = budgetVarianceOf(ctx.co, ctx.from, ctx.asOf)
    } catch {
      variance = null
    }
  }
  const rows = ids.map((id) => {
    const d = departments.find((x) => x.id === id && x.companyId === ctx.co)!
    const p = pnl?.get(id)
    return {
      departmentId: id,
      name: d.name,
      headcount: users.filter((u) => u.companyId === ctx.co && u.active !== false && u.departmentId === id).length,
      overdueTasks: late.filter((t) => deptOfUser.get(t.ownerId) === id).length,
      revenue: p ? p.revenue : null,
      cost: p ? p.totalCost : null,
      margin: p ? p.profit : null,
      marginPct: p ? p.marginPct : null,
      budgetVariance: variance ? (variance.get(id) ?? 0) : null,
    }
  })
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { rows, financialColumns: financial, budgetColumn: variance !== null }
}

/* ---------------- alerts ---------------- */

function alertsOf(ctx: Ctx, f: FinancialKpis | null, d: DeliveryKpis | null, card: Scorecard | null): PerformanceAlert[] {
  const out: PerformanceAlert[] = []
  if (f && card?.budgetColumn) {
    const over = card.rows.filter((r) => (r.budgetVariance ?? 0) > 0)
    if (over.length) {
      out.push({
        id: 'departments-over-budget',
        severity: 'warning',
        title: `${over.length} department${over.length === 1 ? '' : 's'} over budget`,
        detail: over.map((r) => `${r.name} (+${f.currency} ${r.budgetVariance!.toLocaleString('en-US')})`).join(', '),
        link: '/finance/planning',
      })
    }
  }
  if (f) {
    const s = profitSettingsOf(ctx.co)
    const full = f.months.slice(0, -1).slice(-3)
    const avgExpenses = full.length ? r2(full.reduce((t, m) => t + m.expenses, 0) / full.length) : 0
    const threshold = s.cashAlertThreshold ?? avgExpenses
    if (threshold > 0 && f.cashBalance < threshold) {
      out.push({
        id: 'cash-low',
        severity: 'danger',
        title: 'Cash below the alert level',
        detail: `Cash and bank ${f.currency} ${f.cashBalance.toLocaleString('en-US')} is below ${f.currency} ${threshold.toLocaleString('en-US')}${s.cashAlertThreshold === null ? ' (3 months’ average expenses)' : ''}.`,
        link: '/finance/banking',
      })
    }
    if (f.arOverduePct !== null && f.arOverduePct > s.overdueReceivablesAlertPct) {
      out.push({
        id: 'ar-overdue',
        severity: 'warning',
        title: 'Overdue receivables are high',
        detail: `${f.arOverduePct}% of open receivables are overdue (alert above ${s.overdueReceivablesAlertPct}%): ${f.currency} ${f.arOverdue.toLocaleString('en-US')}.`,
        link: '/finance/receivables',
      })
    }
    const negative = projectRowsFor(ctx.user, ctx.from, ctx.to).filter((p) => p.margin < 0)
    if (negative.length) {
      out.push({
        id: 'projects-negative-margin',
        severity: 'warning',
        title: `${negative.length} project${negative.length === 1 ? '' : 's'} with a negative margin`,
        detail: negative.slice(0, 3).map((p) => p.name).join(', ') + (negative.length > 3 ? ` and ${negative.length - 3} more` : ''),
        link: '/finance/profitability',
      })
    }
  }
  if (d && d.overdueTasks > 0) {
    out.push({ id: 'tasks-overdue', severity: 'info', title: `${d.overdueTasks} overdue task${d.overdueTasks === 1 ? '' : 's'}`, detail: 'Open tasks past their due date in your scope.', link: '/tasks/list' })
  }
  return out
}

/* ---------------- endpoint ---------------- */

export function getCompanyPerformance(user: User, q: PerformanceQuery): CompanyPerformance {
  const ctx = ctxOf(user, q)
  const role = user.role
  const access = {
    financial: scopeOf(role, 'accounting') !== 'hidden' && ctx.modules.includes('accounting'),
    sales: scopeOf(role, 'sales') !== 'hidden',
    delivery: scopeOf(role, 'tasks') !== 'hidden',
    people: ['full', 'team'].includes(scopeOf(role, 'hr')) && ctx.modules.includes('hr'),
    departments: scopeOf(role, 'reports') !== 'own',
  }
  const financial = access.financial ? financialOf(ctx) : null
  const delivery = access.delivery ? deliveryOf(ctx) : null
  const people = access.people ? peopleOf(ctx) : null
  const departmentsCard = access.departments ? scorecardOf(ctx, access.financial) : null
  return {
    from: ctx.from,
    to: ctx.to,
    today: ctx.today,
    timezone: ctx.timezone,
    asOf: ctx.asOf,
    generatedAt: nowIso(),
    access: { ...access, people: access.people && people !== null },
    financial,
    sales: access.sales ? salesOf(ctx) : null,
    delivery,
    people,
    departments: departmentsCard,
    alerts: alertsOf(ctx, financial, delivery, departmentsCard),
  }
}
