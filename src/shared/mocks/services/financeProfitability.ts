import type { User } from '@/shared/types'
import type { Account, JournalLine, JournalSourceType } from '@/modules/finance/types'
import type {
  BudgetSource,
  CustomerProfitability,
  CustomerProfitRow,
  DepartmentPnl,
  DepartmentPnlRow,
  EventProfitability,
  EventProfitRow,
  LedgerLineView,
  MonthPoint,
  ProfitExport,
  ProfitMeta,
  ProfitOptions,
  ProfitQuery,
  ProfitSettings,
  ProfitSettingsInput,
  ProfitTotals,
  ProjectProfitability,
  ProjectProfitDetail,
  ProjectProfitRow,
} from '@/modules/finance/profitability/types'
import { PROFIT_REPORTS } from '@/modules/finance/profitability/types'
import {
  MAX_STANDARD_HOURS,
  MIN_STANDARD_HOURS,
  daysInclusive,
  dso,
  eventCosts,
  eventRevenue,
  labourCostOf,
  marginPct,
  monthOf,
  monthsIn,
  naturalAmount,
  perUnit,
  projectMargin,
  r1,
  r2,
  roiPct,
} from '@/modules/finance/profitability/calc'
import { contractCoversMonth, monthlyPay, resolveRange } from '@/modules/hr/reports/calc'
import { departmentSubtree } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers, leads, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { departments } from '@/shared/mocks/data/departments'
import { projects, tasks, timeEntries } from '@/shared/mocks/data/tasks'
import { events, eventBudgetLines } from '@/shared/mocks/data/events'
import { sponsorshipIncomeOf, eventStartDate } from '@/shared/mocks/data/eventSponsors'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { financeAccounts, financeInvoices, financeJournal } from '@/shared/mocks/data/finance'
import { profitSettings, profitSettingsOf } from '@/shared/mocks/data/financeProfitability'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyById } from '@/shared/mocks/data/tenancy'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { financeAccessOf } from './financeLedger'
import { isOverdue } from './financeInvoiceBalance'
import { baseCurrencyOf } from './financeRates'
import { quotationNet } from './financeInvoiceSources'
import { eventBilledCostsOf } from './financePurchasesCore'
import { statsOf } from './events'
import { profitAndLoss } from './financeStatements'
import type { PnlPeriod } from '@/modules/finance/statements/types'

/**
 * Accounts & finance › Profitability (docs/API.md › Finance › Profitability). Read-only analysis over the journal.
 *
 * WHO (PERMISSION_MATRIX `accounting`): full and view read every report; hidden → 403. Labour cost (an allocation from
 * contract pay, see calc.ts) only for accounting FULL — view (Sales Manager) gets `labour_cost: null` and margins before
 * labour. No response ever carries a rate or a cost per employee: labour is aggregated per project / customer / month.
 * Settings (standard hours, alert thresholds) change with accounting full only. Plan gate: `/finance/*` → `accounting`.
 *
 * DIMENSIONS: revenue and costs come from journal lines tagged with project_id / event_id / customer_id /
 * department_id (invoices tag customer, project and event; bills, expenses and claims tag their lines). Reversed
 * entries and their reversals both count, so they cancel (like the trial balance).
 *
 * DEPARTMENT of a line: its department_id; else, for a project-tagged line, the project manager's department
 * (SEAM: until invoices carry a department); else "Unassigned". Projects belong to their manager's department,
 * events to their owner's.
 *
 * A foreign / missing id in a filter (department_id, project_id, event_id, customer_id) or the path answers 404 with
 * the same body.
 */

const notFound = (): never => {
  throw new CodedApiError(NOT_FOUND, 404, 'not_found')
}
const invalid = (message: string, field: string): never => {
  throw new CodedApiError(message, 422, 'validation_failed', { field })
}

const LABOUR_NOTE =
  'Labour is an allocation, not a ledger posting: hours logged on the project’s tasks × the employee’s hourly cost (monthly contract pay ÷ standard hours per month).'

/* ---------------- context ---------------- */

interface Ctx {
  user: User
  co: string
  access: 'full' | 'view'
  labourVisible: boolean
  today: string
  timezone: string
  currency: string
  from: string
  to: string
  standardHours: number
  departmentId: string | null
  /** The department filter's subtree (null = no filter). */
  deptSet: Set<string> | null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const coDepartments = (co: string) => departments.filter((d) => d.companyId === co)
const deptName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? 'Unassigned') : 'Unassigned')
const userDept = (co: string, id: string | null | undefined): string | null => (id ? users.find((u) => u.id === id && u.companyId === co)?.departmentId || null : null)
const userName = (co: string, id: string | null | undefined) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : '—')

function ctxOf(user: User, q: ProfitQuery = {}): Ctx {
  const access = financeAccessOf(user) // 403 for hidden; runs the lazy finance seeds
  const co = tenantOf(user)
  const day = companyDayOf(co)
  const range = resolveRange(day.today, str(q.from), str(q.to))
  if (!range.ok) invalid(range.message, 'from')
  const r = range as { from: string; to: string }
  const deptId = str(q.departmentId) ?? null
  let deptSet: Set<string> | null = null
  if (deptId) {
    if (!coDepartments(co).some((d) => d.id === deptId)) notFound()
    deptSet = new Set(departmentSubtree(deptId, coDepartments(co)))
  }
  return {
    user,
    co,
    access,
    labourVisible: access === 'full',
    today: day.today,
    timezone: companyById(co)?.regional.timezone ?? 'UTC',
    currency: baseCurrencyOf(co),
    from: r.from,
    to: r.to,
    standardHours: profitSettingsOf(co).standardHoursPerMonth,
    departmentId: deptId,
    deptSet,
  }
}

function metaOf(ctx: Ctx): ProfitMeta {
  return {
    from: ctx.from,
    to: ctx.to,
    today: ctx.today,
    timezone: ctx.timezone,
    currency: ctx.currency,
    departmentId: ctx.departmentId,
    departmentName: ctx.departmentId ? deptName(ctx.co, ctx.departmentId) : null,
    labourVisible: ctx.labourVisible,
    standardHoursPerMonth: ctx.standardHours,
    access: ctx.access,
  }
}

const inDept = (ctx: Ctx, id: string | null) => !ctx.deptSet || (id !== null && ctx.deptSet.has(id))

/* ---------------- ledger index ---------------- */

export interface PostedLine {
  date: string
  entryId: string
  entryNumber: string
  sourceType: JournalSourceType
  line: JournalLine
  type: 'income' | 'expense'
  subtype: string
  accountName: string
  /** Natural-side amount (income: credit − debit; expense: debit − credit). */
  amount: number
}

/** Income and expense lines of the company's journal (every entry: a reversal cancels its original). */
export function profitLines(co: string): PostedLine[] {
  const accounts = new Map<string, Tenant<Account>>(financeAccounts.filter((a) => a.companyId === co).map((a) => [a.id, a]))
  const out: PostedLine[] = []
  for (const e of financeJournal) {
    // Year-end closing entries move the year's result to retained earnings: not revenue or cost (as in the P&L).
    if (e.companyId !== co || e.sourceType === 'year_end_close') continue
    for (const l of e.lines) {
      const a = accounts.get(l.accountId)
      if (!a || (a.type !== 'income' && a.type !== 'expense')) continue
      out.push({ date: e.date, entryId: e.id, entryNumber: e.number, sourceType: e.sourceType, line: l, type: a.type, subtype: a.subtype, accountName: a.name, amount: naturalAmount(a.type, l.debit, l.credit) })
    }
  }
  return out
}

const within = (d: string, from: string, to: string) => d >= from && d <= to

/** Revenue, cost of sales, all expenses and payroll expense of the company in [from, to] (base currency). */
/**
 * Revenue (operating + other income), cost of sales, all expenses and net profit from the Financial statements reader
 * (`profitAndLoss`, the same P&L as the statements screen); payroll expense from the journal lines' source.
 */
export function incomeStatementIn(co: string, from: string, to: string, lines: PostedLine[] = profitLines(co)) {
  let payroll = 0
  for (const p of lines) if (within(p.date, from, to) && p.type === 'expense' && p.sourceType === 'payroll') payroll += p.amount
  const pnl = profitAndLoss(co, from, to)
  const revenue = r2(pnl.revenue + pnl.otherIncome)
  const expenses = r2(pnl.costOfSales + pnl.operatingExpenses + pnl.otherExpenses)
  return { revenue, costOfSales: r2(pnl.costOfSales), expenses, payroll: r2(payroll), profit: r2(pnl.netProfit) }
}

/* ---------------- labour allocation ---------------- */

/** Monthly contract pay of the user's employee record in force that month (null = unknown). Never leaves this file. */
function payOf(co: string, userId: string, month: string, cache: Map<string, number | null>): number | null {
  const key = `${userId}|${month}`
  if (cache.has(key)) return cache.get(key)!
  const emp = hrEmployees.find((e) => e.companyId === co && e.userId === userId)
  const c = emp
    ? hrContracts.filter((x) => x.companyId === co && x.employeeId === emp.id && contractCoversMonth(x, month)).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    : undefined
  const pay = c ? monthlyPay(c) : null
  cache.set(key, pay)
  return pay
}

interface LabourRow {
  projectId: string
  month: string
  hours: number
  monthlyPay: number | null
}

/** Time entries of project tasks (the entry's project, else its task's project) in [from, to]. */
function labourRows(co: string, from: string, to: string): LabourRow[] {
  const cache = new Map<string, number | null>()
  const out: LabourRow[] = []
  for (const t of timeEntries) {
    if (t.companyId !== co || !within(t.entryDate, from, to)) continue
    const projectId = t.projectId ?? (t.taskId ? (tasks.find((x) => x.id === t.taskId && x.companyId === co)?.projectId ?? null) : null)
    if (!projectId) continue
    const month = monthOf(t.entryDate)
    out.push({ projectId, month, hours: t.hours, monthlyPay: payOf(co, t.userId, month, cache) })
  }
  return out
}

/* ---------------- projects ---------------- */

function budgetOf(co: string, p: (typeof projects)[number]): { budget: number | null; source: BudgetSource | null } {
  const c = p.contractId ? contracts.find((x) => x.companyId === co && x.id === p.contractId) : undefined
  if (c && c.value > 0) return { budget: r2(c.value), source: 'contract' }
  const q = p.quotationId ? quotations.find((x) => x.companyId === co && x.id === p.quotationId) : undefined
  if (q) {
    const net = quotationNet(q)
    if (net > 0) return { budget: r2(net), source: 'quotation' }
  }
  const l = p.leadId ? leads.find((x) => x.companyId === co && x.id === p.leadId) : undefined
  if (l && l.value > 0) return { budget: r2(l.value), source: 'lead' }
  return { budget: null, source: null }
}

function projectRow(ctx: Ctx, p: (typeof projects)[number], lines: PostedLine[], labour: LabourRow[], allTime: { revenue: number; hours: number }): ProjectProfitRow {
  let revenue = 0
  let direct = 0
  for (const l of lines) {
    if (l.line.projectId !== p.id || !within(l.date, ctx.from, ctx.to)) continue
    if (l.type === 'income') revenue += l.amount
    else direct += l.amount
  }
  const lab = labourCostOf(labour.filter((x) => x.projectId === p.id), ctx.standardHours)
  const labourCost = ctx.labourVisible ? lab.cost : null
  const m = projectMargin(r2(revenue), r2(direct), labourCost)
  const b = budgetOf(ctx.co, p)
  const dept = userDept(ctx.co, p.managerId)
  return {
    projectId: p.id,
    name: p.name,
    customerId: p.customerId,
    customerName: customers.find((c) => c.id === p.customerId && c.companyId === ctx.co)?.name ?? 'Unknown customer',
    managerName: userName(ctx.co, p.managerId),
    departmentId: dept,
    departmentName: deptName(ctx.co, dept),
    status: p.status,
    revenue: r2(revenue),
    directCosts: r2(direct),
    labourHours: lab.hours,
    labourCost,
    unratedHours: lab.unratedHours,
    totalCost: m.totalCost,
    margin: m.margin,
    marginPct: m.marginPct,
    budget: b.budget,
    budgetSource: b.source,
    budgetBilledPct: b.budget ? r2((allTime.revenue / b.budget) * 100) : null,
    estimatedHours: p.estimatedHours,
    loggedHoursAllTime: allTime.hours,
  }
}

function totalsOf(ctx: Ctx, rows: { revenue: number; directCosts: number; labourHours: number; labourCost: number | null }[]): ProfitTotals {
  const revenue = r2(rows.reduce((s, r) => s + r.revenue, 0))
  const directCosts = r2(rows.reduce((s, r) => s + r.directCosts, 0))
  const labourCost = ctx.labourVisible ? r2(rows.reduce((s, r) => s + (r.labourCost ?? 0), 0)) : null
  const m = projectMargin(revenue, directCosts, labourCost)
  return { revenue, directCosts, labourHours: r2(rows.reduce((s, r) => s + r.labourHours, 0)), labourCost, totalCost: m.totalCost, margin: m.margin, marginPct: m.marginPct }
}

function projectRowsOf(ctx: Ctx, lines = profitLines(ctx.co)): ProjectProfitRow[] {
  const labour = labourRows(ctx.co, ctx.from, ctx.to)
  const allRevenue = new Map<string, number>()
  for (const l of lines) if (l.type === 'income' && l.line.projectId) allRevenue.set(l.line.projectId, (allRevenue.get(l.line.projectId) ?? 0) + l.amount)
  const allHours = new Map<string, number>()
  for (const t of timeEntries) if (t.companyId === ctx.co && t.projectId) allHours.set(t.projectId, (allHours.get(t.projectId) ?? 0) + t.hours)
  return projects
    .filter((p) => p.companyId === ctx.co && inDept(ctx, userDept(ctx.co, p.managerId)))
    .map((p) => projectRow(ctx, p, lines, labour, { revenue: r2(allRevenue.get(p.id) ?? 0), hours: r2(allHours.get(p.id) ?? 0) }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
}

/** Project rows for Company performance (negative-margin alert); labour per the caller's access. */
export function projectRowsFor(user: User, from: string, to: string): ProjectProfitRow[] {
  return projectRowsOf(ctxOf(user, { from, to }))
}

export function projectProfitability(user: User, q: ProfitQuery): ProjectProfitability {
  const ctx = ctxOf(user, q)
  const pid = str(q.projectId)
  if (pid && !projects.some((p) => p.companyId === ctx.co && p.id === pid)) notFound()
  const rows = projectRowsOf(ctx).filter((r) => !pid || r.projectId === pid)
  return { meta: metaOf(ctx), rows, totals: totalsOf(ctx, rows), negativeMarginCount: rows.filter((r) => r.margin < 0).length }
}

export function projectProfitDetail(user: User, id: string, q: ProfitQuery): ProjectProfitDetail {
  const ctx = ctxOf(user, { ...q, departmentId: undefined })
  const p = projects.find((x) => x.companyId === ctx.co && x.id === id)
  if (!p) return notFound()
  const lines = profitLines(ctx.co)
  const row = projectRowsOf(ctx, lines).find((r) => r.projectId === p.id)!
  const labour = labourRows(ctx.co, ctx.from, ctx.to).filter((x) => x.projectId === p.id)
  const months: MonthPoint[] = monthsIn(ctx.from, ctx.to, 24).map((month) => {
    let revenue = 0
    let direct = 0
    for (const l of lines) {
      if (l.line.projectId !== p.id || monthOf(l.date) !== month || !within(l.date, ctx.from, ctx.to)) continue
      if (l.type === 'income') revenue += l.amount
      else direct += l.amount
    }
    const lab = labourCostOf(labour.filter((x) => x.month === month), ctx.standardHours)
    const labourCost = ctx.labourVisible ? lab.cost : null
    return { month, revenue: r2(revenue), directCosts: r2(direct), labourHours: lab.hours, labourCost, margin: projectMargin(r2(revenue), r2(direct), labourCost).margin }
  })
  const ledger: LedgerLineView[] = lines
    .filter((l) => l.line.projectId === p.id && within(l.date, ctx.from, ctx.to))
    .sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber.localeCompare(a.entryNumber))
    .map((l) => ({ date: l.date, entryId: l.entryId, entryNumber: l.entryNumber, sourceType: l.sourceType, description: l.line.description, kind: l.type === 'income' ? 'revenue' : 'cost', accountName: l.accountName, amount: r2(l.amount) }))
  return {
    meta: metaOf(ctx),
    project: row,
    months,
    lines: ledger,
    note: ctx.labourVisible ? LABOUR_NOTE : 'Labour cost is visible to Company Admins, Management and Accountants only; margins here are before labour.',
  }
}

/* ---------------- events ---------------- */

const EVENT_NOTE =
  'Revenue = event-tagged income in the ledger + signed / paid sponsor deals not invoiced yet. Costs = event-tagged expenses in the ledger + budget-line actuals not billed through finance (a bill linked to a budget line replaces that line’s actual), so nothing is counted twice.'

function eventRowsOf(ctx: Ctx, lines = profitLines(ctx.co)): EventProfitRow[] {
  return events
    .filter((e) => e.companyId === ctx.co && e.status !== 'cancelled')
    .map((e) => ({ e, start: eventStartDate(e) }))
    .filter(({ e, start }) => within(start, ctx.from, ctx.to) && inDept(ctx, userDept(ctx.co, e.ownerId)))
    .map(({ e, start }): EventProfitRow => {
      let income = 0
      let cost = 0
      for (const l of lines) {
        if (l.line.eventId !== e.id) continue
        if (l.type === 'income') income += l.amount
        else cost += l.amount
      }
      const billed = eventBilledCostsOf(ctx.co, e.id)
      const perLine = new Map(billed.lines.map((b) => [b.budgetLineId, b.billed]))
      const budgetLines = eventBudgetLines.filter((l) => l.companyId === ctx.co && l.eventId === e.id).map((l) => ({ actual: l.actual, billed: perLine.get(l.id) ?? 0 }))
      const costs = eventCosts(r2(cost), budgetLines)
      const rev = eventRevenue(r2(income), e.isOrganizer ? sponsorshipIncomeOf(e).total : 0)
      const stats = statsOf(e)
      return {
        eventId: e.id,
        name: e.name,
        startDate: start,
        status: e.status,
        isOrganizer: e.isOrganizer,
        ledgerRevenue: rev.ledger,
        sponsorshipNotInvoiced: rev.notInvoiced,
        revenue: rev.total,
        ledgerCosts: costs.ledger,
        budgetLineCosts: costs.budgetLines,
        totalCost: costs.total,
        profit: r2(rev.total - costs.total),
        roiPct: roiPct(rev.total, costs.total),
        budget: e.budget,
        attendees: stats.attendees,
        leads: stats.leads,
        dealsWon: stats.dealsWon,
        wonValue: stats.wonValue,
        costPerAttendee: perUnit(costs.total, stats.attendees),
        costPerLead: perUnit(costs.total, stats.leads),
      }
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name))
}

/** Event rows for Company performance (events ROI). */
export function eventRowsFor(user: User, from: string, to: string): EventProfitRow[] {
  return eventRowsOf(ctxOf(user, { from, to }))
}

export function eventProfitability(user: User, q: ProfitQuery): EventProfitability {
  const ctx = ctxOf(user, q)
  const eid = str(q.eventId)
  if (eid && !events.some((e) => e.companyId === ctx.co && e.id === eid)) notFound()
  const rows = eventRowsOf(ctx).filter((r) => !eid || r.eventId === eid)
  const revenue = r2(rows.reduce((s, r) => s + r.revenue, 0))
  const totalCost = r2(rows.reduce((s, r) => s + r.totalCost, 0))
  return { meta: metaOf(ctx), rows, totals: { revenue, totalCost, profit: r2(revenue - totalCost), roiPct: roiPct(revenue, totalCost) }, note: EVENT_NOTE }
}

/* ---------------- customers ---------------- */

const base = (amount: number, rate: number) => r2(amount * (rate || 1))

/** Invoiced in the period, collected on those, outstanding and overdue today (base currency, incl. VAT). */
function receivablesOf(co: string, customerId: string | null, from: string, to: string, today: string) {
  let invoiced = 0
  let collected = 0
  let outstanding = 0
  let overdue = 0
  for (const i of financeInvoices) {
    if (i.companyId !== co || (customerId && i.customerId !== customerId) || i.status === 'draft' || i.status === 'void') continue
    if (i.issueDate && within(i.issueDate, from, to)) {
      invoiced += base(i.total, i.exchangeRate)
      collected += base(i.amountPaid, i.exchangeRate)
    }
    if ((i.status === 'issued' || i.status === 'partially_paid') && i.balanceDue > 0) {
      outstanding += base(i.balanceDue, i.exchangeRate)
      if (isOverdue(i, today)) overdue += base(i.balanceDue, i.exchangeRate)
    }
  }
  return { invoiced: r2(invoiced), collected: r2(collected), outstanding: r2(outstanding), overdue: r2(overdue) }
}

/** Company-wide receivables for Company performance (DSO over the period up to today). */
export function companyReceivables(co: string, from: string, to: string, today: string) {
  const end = to < today ? to : today
  const r = receivablesOf(co, null, from, end, today)
  return { ...r, dso: dso(r.outstanding, r.invoiced, daysInclusive(from, end)) }
}

export function customerProfitability(user: User, q: ProfitQuery): CustomerProfitability {
  const ctx = ctxOf(user, q)
  const cid = str(q.customerId)
  if (cid && !customers.some((c) => c.companyId === ctx.co && c.id === cid)) notFound()
  const lines = profitLines(ctx.co)
  const labour = labourRows(ctx.co, ctx.from, ctx.to)
  const coProjects = projects.filter((p) => p.companyId === ctx.co)
  const end = ctx.to < ctx.today ? ctx.to : ctx.today
  const days = daysInclusive(ctx.from, end)
  const rows: CustomerProfitRow[] = []
  for (const c of customers) {
    if (c.companyId !== ctx.co || (cid && c.id !== cid)) continue
    const own = new Set(coProjects.filter((p) => p.customerId === c.id).map((p) => p.id))
    // Department filter: customers with a project in the department (their projects' managers).
    if (ctx.deptSet && !coProjects.some((p) => p.customerId === c.id && inDept(ctx, userDept(ctx.co, p.managerId)))) continue
    let revenue = 0
    let credits = 0
    let direct = 0
    let lifetime = 0
    for (const l of lines) {
      const mine = l.line.customerId === c.id || (!!l.line.projectId && own.has(l.line.projectId))
      if (!mine) continue
      if (l.type === 'income') {
        lifetime += l.amount
        if (!within(l.date, ctx.from, ctx.to)) continue
        revenue += l.amount
        if (l.sourceType === 'credit_note') credits += -l.amount
      } else if (within(l.date, ctx.from, ctx.to)) direct += l.amount
    }
    const lab = labourCostOf(labour.filter((x) => own.has(x.projectId)), ctx.standardHours)
    const labourCost = ctx.labourVisible ? lab.cost : null
    const m = projectMargin(r2(revenue), r2(direct), labourCost)
    const ar = receivablesOf(ctx.co, c.id, ctx.from, end, ctx.today)
    if (!revenue && !direct && !lab.hours && !ar.invoiced && !ar.outstanding && !lifetime && !own.size) continue
    rows.push({
      customerId: c.id,
      name: c.name,
      revenue: r2(revenue),
      creditNotes: r2(credits),
      directCosts: r2(direct),
      labourHours: lab.hours,
      labourCost,
      grossMargin: m.margin,
      marginPct: m.marginPct,
      invoiced: ar.invoiced,
      collected: ar.collected,
      outstanding: ar.outstanding,
      overdue: ar.overdue,
      dso: dso(ar.outstanding, ar.invoiced, days),
      lifetimeRevenue: r2(lifetime),
      projects: own.size,
    })
  }
  rows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
  const t = totalsOf(ctx, rows)
  const invoiced = r2(rows.reduce((s, r) => s + r.invoiced, 0))
  const outstanding = r2(rows.reduce((s, r) => s + r.outstanding, 0))
  return {
    meta: metaOf(ctx),
    rows,
    totals: { ...t, invoiced, collected: r2(rows.reduce((s, r) => s + r.collected, 0)), outstanding, dso: dso(outstanding, invoiced, days) },
  }
}

/* ---------------- departments ---------------- */

type Acc = { revenue: number; cos: number; opex: number; payroll: number }
const zero = (): Acc => ({ revenue: 0, cos: 0, opex: 0, payroll: 0 })

function rowOf(co: string, k: string, a: Acc): DepartmentPnlRow {
  const totalCost = r2(a.cos + a.opex)
  const profit = r2(a.revenue - totalCost)
  return { departmentId: k || null, name: deptName(co, k || null), revenue: r2(a.revenue), costOfSales: r2(a.cos), operatingExpenses: r2(a.opex), payroll: r2(a.payroll), totalCost, profit, marginPct: marginPct(r2(a.revenue), profit) }
}

/** The department split from the journal lines directly (fallback when the statements reader isn't usable). */
function departmentRowsFromLedger(co: string, from: string, to: string, lines: PostedLine[]): DepartmentPnlRow[] {
  const projectDept = new Map(projects.filter((p) => p.companyId === co).map((p) => [p.id, userDept(co, p.managerId)]))
  const acc = new Map<string, Acc>()
  const keyOf = (l: PostedLine) => l.line.departmentId || (l.line.projectId ? projectDept.get(l.line.projectId) : null) || ''
  for (const l of lines) {
    if (!within(l.date, from, to)) continue
    const k = keyOf(l)
    const row = acc.get(k) ?? zero()
    if (l.type === 'income') row.revenue += l.amount
    else if (l.subtype === 'cost_of_sales') row.cos += l.amount
    else {
      row.opex += l.amount
      if (l.sourceType === 'payroll') row.payroll += l.amount
    }
    acc.set(k, row)
  }
  const keys = [...coDepartments(co).filter((d) => d.active || acc.has(d.id)).map((d) => d.id), ...(acc.has('') ? [''] : [])]
  return keys.map((k) => rowOf(co, k, acc.get(k) ?? zero()))
}

/**
 * Department P&L rows. The explicit department dimension comes from the Financial statements reader
 * (`profitAndLoss(companyId, from, to, { departmentId })`, closing entries excluded, other income / expenses folded
 * into revenue / operating expenses); lines without a department but tagged to a project are added to the project
 * manager's department; "Unassigned" is the company P&L minus every department. Payroll (part of the operating
 * expenses) comes from the journal lines' department. Falls back to the plain journal split if the reader fails.
 */
export function departmentPnlRows(co: string, from: string, to: string, lines: PostedLine[] = profitLines(co)): { rows: DepartmentPnlRow[]; source: 'statements' | 'ledger' } {
  try {
    const fromPnl = (p: PnlPeriod): Acc => ({ revenue: p.revenue + p.otherIncome, cos: p.costOfSales, opex: p.operatingExpenses + p.otherExpenses, payroll: 0 })
    const projectDept = new Map(projects.filter((p) => p.companyId === co).map((p) => [p.id, userDept(co, p.managerId)]))
    const acc = new Map<string, Acc>()
    const depts = coDepartments(co)
    for (const d of depts) acc.set(d.id, fromPnl(profitAndLoss(co, from, to, { departmentId: d.id })))
    for (const l of lines) {
      if (!within(l.date, from, to)) continue
      const explicit = l.line.departmentId || ''
      const viaProject = !explicit && l.line.projectId ? (projectDept.get(l.line.projectId) ?? '') : ''
      const k = explicit || viaProject
      if (!k || !acc.has(k)) continue
      const row = acc.get(k)!
      if (viaProject) {
        if (l.type === 'income') row.revenue += l.amount
        else if (l.subtype === 'cost_of_sales') row.cos += l.amount
        else row.opex += l.amount
      }
      if (l.type === 'expense' && l.sourceType === 'payroll') row.payroll += l.amount
    }
    const company = fromPnl(profitAndLoss(co, from, to))
    const assigned = [...acc.values()].reduce((s, a) => ({ revenue: s.revenue + a.revenue, cos: s.cos + a.cos, opex: s.opex + a.opex, payroll: s.payroll + a.payroll }), zero())
    const unassigned: Acc = { revenue: company.revenue - assigned.revenue, cos: company.cos - assigned.cos, opex: company.opex - assigned.opex, payroll: 0 }
    for (const l of lines) if (within(l.date, from, to) && l.type === 'expense' && l.sourceType === 'payroll' && !acc.has(l.line.departmentId || '')) unassigned.payroll += l.amount
    const nonZero = (a: Acc) => [a.revenue, a.cos, a.opex].some((n) => Math.abs(r2(n)) >= 0.01)
    const rows = depts.filter((d) => d.active || nonZero(acc.get(d.id)!)).map((d) => rowOf(co, d.id, acc.get(d.id)!))
    if (nonZero(unassigned)) rows.push(rowOf(co, '', unassigned))
    return { rows, source: 'statements' }
  } catch {
    return { rows: departmentRowsFromLedger(co, from, to, lines), source: 'ledger' }
  }
}

export function departmentPnl(user: User, q: ProfitQuery): DepartmentPnl {
  const ctx = ctxOf(user, q)
  const split = departmentPnlRows(ctx.co, ctx.from, ctx.to)
  const rows = split.rows.filter((r) => !ctx.deptSet || (r.departmentId !== null && ctx.deptSet.has(r.departmentId)))
  const sum = (k: 'revenue' | 'costOfSales' | 'operatingExpenses' | 'payroll' | 'totalCost' | 'profit') => r2(rows.reduce((s, r) => s + r[k], 0))
  return {
    meta: metaOf(ctx),
    rows,
    totals: { revenue: sum('revenue'), costOfSales: sum('costOfSales'), operatingExpenses: sum('operatingExpenses'), payroll: sum('payroll'), totalCost: sum('totalCost'), profit: sum('profit'), marginPct: marginPct(sum('revenue'), sum('profit')) },
    source: split.source,
    note: 'By the department dimension of each journal line (the same P&L as Financial statements); a line without one but tagged to a project counts for the project manager’s department. Labour is not allocated here (payroll is already in the department’s expenses).',
  }
}

/* ---------------- options / settings ---------------- */

function settingsView(co: string): ProfitSettings {
  const s = profitSettingsOf(co)
  return {
    standardHoursPerMonth: s.standardHoursPerMonth,
    cashAlertThreshold: s.cashAlertThreshold,
    overdueReceivablesAlertPct: s.overdueReceivablesAlertPct,
    updatedAt: s.updatedAt,
    updatedByName: s.updatedBy ? userName(co, s.updatedBy) : null,
  }
}

export function profitOptions(user: User): ProfitOptions {
  const ctx = ctxOf(user)
  return {
    meta: metaOf(ctx),
    settings: settingsView(ctx.co),
    canEditSettings: ctx.access === 'full',
    departments: coDepartments(ctx.co)
      .filter((d) => d.active)
      .map((d) => ({ id: d.id, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    reports: PROFIT_REPORTS,
  }
}

export function updateProfitSettings(user: User, input: ProfitSettingsInput | null): ProfitSettings {
  const ctx = ctxOf(user)
  if (ctx.access !== 'full') throw new CodedApiError('Only Company Admins, Management and Accountants can change profitability settings.', 403, 'forbidden')
  const cur = profitSettingsOf(ctx.co)
  const next = { ...cur }
  const i = input ?? {}
  if (i.standardHoursPerMonth !== undefined) {
    const n = Number(i.standardHoursPerMonth)
    if (!Number.isFinite(n) || n < MIN_STANDARD_HOURS || n > MAX_STANDARD_HOURS) invalid(`Standard hours per month must be between ${MIN_STANDARD_HOURS} and ${MAX_STANDARD_HOURS}.`, 'standard_hours_per_month')
    next.standardHoursPerMonth = Math.round(n * 10) / 10
  }
  if (i.cashAlertThreshold !== undefined) {
    if (i.cashAlertThreshold === null) next.cashAlertThreshold = null
    else {
      const n = Number(i.cashAlertThreshold)
      if (!Number.isFinite(n) || n < 0 || n > 1e12) invalid('The cash alert threshold must be 0 or more.', 'cash_alert_threshold')
      next.cashAlertThreshold = r2(n)
    }
  }
  if (i.overdueReceivablesAlertPct !== undefined) {
    const n = Number(i.overdueReceivablesAlertPct)
    if (!Number.isFinite(n) || n < 0 || n > 100) invalid('The overdue receivables alert must be between 0 and 100%.', 'overdue_receivables_alert_pct')
    next.overdueReceivablesAlertPct = r1(n)
  }
  next.updatedAt = nowIso()
  next.updatedBy = user.id
  const row = profitSettings.find((s) => s.companyId === ctx.co)
  if (row) Object.assign(row, next)
  else profitSettings.push({ companyId: ctx.co, ...next })
  return settingsView(ctx.co)
}


/* ---------------- CSV export ---------------- */

export function exportProfitability(user: User, report: string, q: ProfitQuery): ProfitExport {
  if (!(PROFIT_REPORTS as string[]).includes(report)) {
    financeAccessOf(user)
    return notFound()
  }
  const stamp = (name: string, m: ProfitMeta) => `${name}-${m.from}-to-${m.to}.csv`
  if (report === 'projects') {
    const d = projectProfitability(user, q)
    const lab = d.meta.labourVisible
    return {
      fileName: stamp('project-profitability', d.meta),
      headers: ['Project', 'Customer', 'Department', 'Status', 'Revenue', 'Direct costs', 'Labour hours', ...(lab ? ['Labour cost (allocated)'] : []), 'Total cost', 'Margin', 'Margin %', 'Budget', 'Budget source', 'Billed of budget %'],
      rows: d.rows.map((r) => [r.name, r.customerName, r.departmentName, r.status, r.revenue, r.directCosts, r.labourHours, ...(lab ? [r.labourCost] : []), r.totalCost, r.margin, r.marginPct, r.budget, r.budgetSource, r.budgetBilledPct]),
    }
  }
  if (report === 'events') {
    const d = eventProfitability(user, q)
    return {
      fileName: stamp('event-profitability', d.meta),
      headers: ['Event', 'Start', 'Organizer', 'Ledger revenue', 'Sponsorship not invoiced', 'Revenue', 'Ledger costs', 'Budget-line costs', 'Total cost', 'Profit', 'ROI %', 'Attendees', 'Leads', 'Cost per attendee', 'Cost per lead'],
      rows: d.rows.map((r) => [r.name, r.startDate, r.isOrganizer ? 'Yes' : 'No', r.ledgerRevenue, r.sponsorshipNotInvoiced, r.revenue, r.ledgerCosts, r.budgetLineCosts, r.totalCost, r.profit, r.roiPct, r.attendees, r.leads, r.costPerAttendee, r.costPerLead]),
    }
  }
  if (report === 'customers') {
    const d = customerProfitability(user, q)
    const lab = d.meta.labourVisible
    return {
      fileName: stamp('customer-profitability', d.meta),
      headers: ['Customer', 'Revenue', 'Credit notes', 'Direct costs', ...(lab ? ['Labour cost (allocated)'] : []), 'Gross margin', 'Margin %', 'Invoiced', 'Collected', 'Outstanding', 'Overdue', 'DSO (days)', 'Lifetime revenue', 'Projects'],
      rows: d.rows.map((r) => [r.name, r.revenue, r.creditNotes, r.directCosts, ...(lab ? [r.labourCost] : []), r.grossMargin, r.marginPct, r.invoiced, r.collected, r.outstanding, r.overdue, r.dso, r.lifetimeRevenue, r.projects]),
    }
  }
  const d = departmentPnl(user, q)
  return {
    fileName: stamp('department-pnl', d.meta),
    headers: ['Department', 'Revenue', 'Cost of sales', 'Operating expenses', 'of which payroll', 'Total cost', 'Profit', 'Margin %'],
    rows: d.rows.map((r) => [r.name, r.revenue, r.costOfSales, r.operatingExpenses, r.payroll, r.totalCost, r.profit, r.marginPct]),
  }
}
