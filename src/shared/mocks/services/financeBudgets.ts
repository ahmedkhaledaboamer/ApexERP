import type { User } from '@/shared/types'
import type {
  BudgetCreateInput,
  BudgetDetail,
  BudgetLine,
  BudgetLineInput,
  BudgetRow,
  BudgetVsActual,
  BvaDepartment,
  BvaRow,
  CopyActualsInput,
  SpreadPattern,
} from '@/modules/finance/planning/types'
import { copyWithAdjustment, levelReached, pctOf, r2, spreadAnnual, statusOf, variance } from '@/modules/finance/planning/calc'
import { fiscalMonths, fiscalYearOf, fiscalYearRange } from '@/modules/finance/tax/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { finBudgets, type BudgetLineRecord, type BudgetRecord } from '@/shared/mocks/data/financeBudgets'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { nextId, runFinanceHooks } from './ledger'
import { financeSettingsOf, FINANCE_MANAGE_ONLY } from './financeLedger'
import { baseCurrencyOf } from './financeRates'

/**
 * Accounts & finance › Budgets (docs/API.md › Finance › Budgets).
 *
 * WHO. `accounting` full (Company Admin, Management, Accountant): create, edit (drafts), copy actuals, delete drafts;
 * approve / reopen: Management and Company Admin only (`403 approve_forbidden` for an Accountant). view (Sales
 * Manager): reads every budget and budget vs actual. DEPARTMENT HEADS (the `headId` of an active department, any
 * role — no accounting access needed): read budgets and budget vs actual of THEIR OWN department(s) only (other lines
 * are never served; another department in the filter → 404). Everyone else → 403. Plan gate `/finance/*` →
 * `accounting`.
 *
 * Actuals come from the journal: lines carrying the department, on the budget's income / expense accounts (expense:
 * debit − credit; income: credit − debit), by entry month; year-end closing entries are left out.
 *
 * ALERTS (stored, once only, type `finance`): when a department's expense actuals reach 90 % / 100 % of the current
 * month's or the year-to-date budget of the approved budget, its head and the Accountants (Company Admins when the
 * company has none) are notified. The check runs on budget reads and on the bell's tick (GET /alerts).
 */

const bad = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 422, code, details)
}
const conflict = (message: string, code: string, details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 409, code, details)
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}

export const BUDGET_FORBIDDEN = 'Budgets are for Company Admins, Management, Accountants and department heads.'
const APPROVERS = new Set(['Company Admin', 'Management'])

interface Access {
  co: string
  scope: 'full' | 'view' | 'dept'
  deptIds: string[]
}

/** Departments the user heads (active ones of their company). */
export function headedDepartments(user: User): string[] {
  const co = tenantOf(user)
  return departments.filter((d) => d.companyId === co && d.headId === user.id && d.active !== false).map((d) => d.id)
}

export function budgetAccessOf(user: User): Access {
  const co = tenantOf(user)
  const s = scopeOf(user.role, 'accounting')
  if (s !== 'hidden') {
    runFinanceHooks(co)
    return { co, scope: s === 'full' ? 'full' : 'view', deptIds: [] }
  }
  const deptIds = headedDepartments(user)
  if (!deptIds.length) throw new CodedApiError(BUDGET_FORBIDDEN, 403, 'forbidden')
  runFinanceHooks(co)
  return { co, scope: 'dept', deptIds }
}
function writer(user: User): string {
  const a = budgetAccessOf(user)
  if (a.scope !== 'full') throw new CodedApiError(FINANCE_MANAGE_ONLY, 403, 'forbidden')
  return a.co
}

/* ---------------- helpers ---------------- */

const todayOf = (co: string) => companyDayOf(co).today
const startMonthOf = (co: string) => financeSettingsOf(co).fiscalYearStartMonth
const userName = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : 'System')
const deptName = (co: string, id: string) => departments.find((d) => d.companyId === co && d.id === id)?.name ?? 'Former department'
const accountOf = (co: string, id: string) => financeAccounts.find((a) => a.companyId === co && a.id === id)
const budgetsOf = (co: string) => finBudgets.filter((b) => b.companyId === co)
const sum = (xs: readonly number[]) => r2(xs.reduce((s, x) => s + x, 0))
const visibleLines = (a: Access, b: BudgetRecord) => (a.scope === 'dept' ? b.lines.filter((l) => a.deptIds.includes(l.departmentId)) : b.lines)
const typeOf = (co: string, accountId: string): 'income' | 'expense' => (accountOf(co, accountId)?.type === 'income' ? 'income' : 'expense')

function budgetOf(co: string, id: string): Tenant<BudgetRecord> {
  return finBudgets.find((b) => b.companyId === co && b.id === id) ?? notFound()
}

/** Actuals by department × account × month (yyyy-MM) for a date range (natural side of income / expense accounts). */
export function actualsOf(co: string, from: string, to: string): Map<string, number> {
  const types = new Map(financeAccounts.filter((a) => a.companyId === co && (a.type === 'income' || a.type === 'expense')).map((a) => [a.id, a.type]))
  const out = new Map<string, number>()
  for (const e of financeJournal) {
    if (e.companyId !== co || e.date < from || e.date > to || e.sourceType === 'year_end_close') continue
    for (const l of e.lines) {
      const t = types.get(l.accountId)
      if (!t) continue
      const k = `${l.departmentId ?? ''}|${l.accountId}|${e.date.slice(0, 7)}`
      out.set(k, r2((out.get(k) ?? 0) + (t === 'expense' ? l.debit - l.credit : l.credit - l.debit)))
    }
  }
  return out
}
const monthsOfActuals = (act: Map<string, number>, dept: string, account: string, months: string[]) => months.map((m) => act.get(`${dept}|${account}|${m}`) ?? 0)

function rangeOf(co: string, year: number) {
  return { ...fiscalYearRange(year, startMonthOf(co)), months: fiscalMonths(year, startMonthOf(co)) }
}

function rowOf(a: Access, b: BudgetRecord): BudgetRow {
  const { from, to } = rangeOf(a.co, b.fiscalYear)
  const lines = visibleLines(a, b)
  const total = (t: 'income' | 'expense') => sum(lines.filter((l) => typeOf(a.co, l.accountId) === t).map((l) => sum(l.months)))
  return {
    id: b.id,
    fiscalYear: b.fiscalYear,
    name: b.name,
    status: b.status,
    from,
    to,
    currency: baseCurrencyOf(a.co),
    expenseTotal: total('expense'),
    revenueTotal: total('income'),
    lineCount: lines.length,
    departmentCount: new Set(lines.map((l) => l.departmentId)).size,
    approvedByName: b.approvedBy ? userName(a.co, b.approvedBy) : null,
    approvedAt: b.approvedAt,
    departmentScoped: a.scope === 'dept',
    updatedAt: b.updatedAt,
  }
}

function lineView(co: string, l: BudgetLineRecord): BudgetLine {
  const acc = accountOf(co, l.accountId)
  return {
    id: l.id,
    departmentId: l.departmentId,
    departmentName: deptName(co, l.departmentId),
    accountId: l.accountId,
    accountCode: acc?.code ?? '',
    accountName: acc?.name ?? 'Former account',
    accountType: acc?.type === 'income' ? 'income' : 'expense',
    months: [...l.months],
    annual: sum(l.months),
  }
}

function detailOf(user: User, a: Access, b: BudgetRecord): BudgetDetail {
  const co = a.co
  const lines = visibleLines(a, b)
    .map((l) => lineView(co, l))
    .sort((x, y) => x.departmentName.localeCompare(y.departmentName) || x.accountCode.localeCompare(y.accountCode))
  const full = a.scope === 'full'
  const approver = full && APPROVERS.has(user.role)
  const depts = departments.filter((d) => d.companyId === co && d.active !== false && (a.scope !== 'dept' || a.deptIds.includes(d.id)))
  return {
    ...rowOf(a, b),
    months: rangeOf(co, b.fiscalYear).months,
    lines,
    departments: depts.map((d) => ({ id: d.id, name: d.name })).sort((x, y) => x.name.localeCompare(y.name)),
    accounts: full
      ? financeAccounts
          .filter((x) => x.companyId === co && x.active && !x.isHeader && (x.type === 'income' || x.type === 'expense'))
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((x) => ({ id: x.id, code: x.code, name: x.name, type: x.type as 'income' | 'expense' }))
      : [],
    history: (a.scope === 'dept' ? [] : b.history).map((h) => ({ at: h.at, byName: userName(co, h.by), action: h.action, summary: h.summary })),
    can: { edit: full && b.status === 'draft', approve: approver && b.status === 'draft' && b.lines.length > 0, reopen: approver && b.status === 'approved', delete: full && b.status === 'draft' },
  }
}

/* ---------------- validation ---------------- */

function deptIn(co: string, id: unknown): string {
  const d = typeof id === 'string' ? departments.find((x) => x.companyId === co && x.id === id) : undefined
  return d ? d.id : bad('Choose a department of the company.', 'invalid_department', { field: 'department_id' })
}
function budgetAccountIn(co: string, id: unknown): string {
  const acc = typeof id === 'string' ? accountOf(co, id) : undefined
  if (!acc || !acc.active || acc.isHeader || (acc.type !== 'income' && acc.type !== 'expense')) bad('Choose an active income or expense account of the company.', 'invalid_account', { field: 'account_id' })
  return acc!.id
}
const num = (v: unknown, field: string, min: number, max: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return bad(`${field} must be a number between ${min} and ${max}.`, 'validation_failed', { field })
  return n
}
const PATTERNS: SpreadPattern[] = ['even', 'front_loaded', 'back_loaded', 'last_year']

function yearIn(co: string, raw: unknown, field = 'fiscal_year'): number {
  const cur = fiscalYearOf(todayOf(co), startMonthOf(co))
  const y = num(raw, field, 2000, 2100)
  if (!Number.isInteger(y) || y < cur - 5 || y > cur + 2) bad(`Choose a fiscal year between ${cur - 5} and ${cur + 2}.`, 'validation_failed', { field })
  return y
}

const hist = (b: BudgetRecord, by: string | null, action: string, summary: string) => {
  b.history.push({ at: nowIso(), by, action, summary })
  b.updatedAt = nowIso()
}

/** Last year's (or any year's) actual lines by department × account, × (1 + pct). */
function actualLines(co: string, year: number, pct: number, deptFilter: string | null): BudgetLineRecord[] {
  const { from, to, months } = rangeOf(co, year)
  const act = actualsOf(co, from, to)
  const pairs = new Set<string>()
  for (const k of act.keys()) {
    const [dept, account] = k.split('|')
    if (!dept) continue
    if (deptFilter && dept !== deptFilter) continue
    if (!departments.some((d) => d.companyId === co && d.id === dept && d.active !== false)) continue
    const acc = accountOf(co, account)
    if (!acc || !acc.active || acc.isHeader) continue
    pairs.add(`${dept}|${account}`)
  }
  const out: BudgetLineRecord[] = []
  for (const p of [...pairs].sort()) {
    const [dept, account] = p.split('|')
    const m = copyWithAdjustment(monthsOfActuals(act, dept, account, months), pct)
    if (sum(m) > 0) out.push({ id: nextId('budgetLine', 'BL'), departmentId: dept, accountId: account, months: m })
  }
  return out
}

/* ---------------- endpoints ---------------- */

/** GET /finance/budgets */
export function listBudgets(user: User): BudgetRow[] {
  const a = budgetAccessOf(user)
  runBudgetAlerts(a.co)
  return budgetsOf(a.co)
    .sort((x, y) => y.fiscalYear - x.fiscalYear)
    .map((b) => rowOf(a, b))
}

/** GET /finance/budgets/:id */
export function getBudget(user: User, id: string): BudgetDetail {
  const a = budgetAccessOf(user)
  return detailOf(user, a, budgetOf(a.co, id))
}

/** POST /finance/budgets */
export function createBudget(user: User, input: Partial<BudgetCreateInput> | null): BudgetDetail {
  const co = writer(user)
  const year = yearIn(co, input?.fiscalYear)
  if (budgetsOf(co).some((b) => b.fiscalYear === year)) conflict(`There is already a budget for ${year}.`, 'duplicate_budget', { fiscal_year: year })
  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : `Operating budget ${year}`
  let lines: BudgetLineRecord[] = []
  if (input?.copyFromYear !== undefined && input.copyFromYear !== null && input.copyFromYear !== ('' as unknown)) {
    const from = yearIn(co, input.copyFromYear, 'copy_from_year')
    const pct = input.adjustPct === undefined || input.adjustPct === null ? 0 : num(input.adjustPct, 'adjust_pct', -100, 500)
    lines = actualLines(co, from, pct, null)
  }
  const at = nowIso()
  const b: Tenant<BudgetRecord> = { companyId: co, id: nextId('budget', 'BUD'), fiscalYear: year, name, status: 'draft', lines, approvedBy: null, approvedAt: null, alertMarks: [], history: [], createdBy: user.id, createdAt: at, updatedAt: at }
  hist(b, user.id, 'created', lines.length ? `Created from ${input?.copyFromYear} actuals (${lines.length} lines)` : 'Created')
  finBudgets.push(b)
  recordAudit(user, { action: 'create', entity: 'budget', entityId: b.id, summary: `Created the budget ${name}` })
  return detailOf(user, budgetAccessOf(user), b)
}

function draftOf(co: string, id: string): Tenant<BudgetRecord> {
  const b = budgetOf(co, id)
  if (b.status !== 'draft') conflict('This budget is approved and locked. Ask Management to reopen it first.', 'budget_locked')
  return b
}

/** PUT /finance/budgets/:id/lines — upserts lines by department × account (all-zero months remove the line). */
export function putBudgetLines(user: User, id: string, input: { lines?: unknown } | null): BudgetDetail {
  const co = writer(user)
  const b = draftOf(co, id)
  const raw = input?.lines
  if (!Array.isArray(raw) || !raw.length || raw.length > 500) bad('Send `lines` (1–500 department × account lines).', 'validation_failed', { field: 'lines' })
  const months = rangeOf(co, b.fiscalYear - 1).months
  let lastYear: Map<string, number> | null = null
  const parsed = (raw as Partial<BudgetLineInput>[]).map((l, i) => {
    const departmentId = deptIn(co, l?.departmentId)
    const accountId = budgetAccountIn(co, l?.accountId)
    let m: number[]
    if (l.months !== undefined && l.months !== null) {
      if (!Array.isArray(l.months) || l.months.length !== 12) bad(`Line ${i + 1}: send 12 monthly amounts.`, 'validation_failed', { field: 'months' })
      m = (l.months as unknown[]).map((x) => r2(num(x, 'months', 0, 1e10)))
    } else {
      const annual = num(l.annual, 'annual', 0, 1e11)
      const pattern = (l.pattern ?? 'even') as SpreadPattern
      if (!PATTERNS.includes(pattern)) bad('The spread is even, front_loaded, back_loaded or last_year.', 'validation_failed', { field: 'pattern' })
      if (pattern === 'last_year' && !lastYear) {
        const r = rangeOf(co, b.fiscalYear - 1)
        lastYear = actualsOf(co, r.from, r.to)
      }
      m = spreadAnnual(annual, pattern, pattern === 'last_year' ? monthsOfActuals(lastYear!, departmentId, accountId, months) : undefined)
    }
    return { departmentId, accountId, months: m }
  })
  for (const p of parsed) {
    const i = b.lines.findIndex((l) => l.departmentId === p.departmentId && l.accountId === p.accountId)
    if (sum(p.months) === 0) {
      if (i >= 0) b.lines.splice(i, 1)
    } else if (i >= 0) b.lines[i].months = p.months
    else b.lines.push({ id: nextId('budgetLine', 'BL'), ...p })
  }
  hist(b, user.id, 'edited', `${parsed.length} line${parsed.length === 1 ? '' : 's'} updated`)
  return detailOf(user, budgetAccessOf(user), b)
}

/** POST /finance/budgets/:id/copy-actuals — replaces the lines (or one department's) with a year's actuals ± %. */
export function copyBudgetActuals(user: User, id: string, input: Partial<CopyActualsInput> | null): BudgetDetail {
  const co = writer(user)
  const b = draftOf(co, id)
  const year = yearIn(co, input?.fromYear, 'from_year')
  const pct = input?.adjustPct === undefined || input.adjustPct === null ? 0 : num(input.adjustPct, 'adjust_pct', -100, 500)
  const dept = input?.departmentId ? deptIn(co, input.departmentId) : null
  const lines = actualLines(co, year, pct, dept)
  b.lines = [...b.lines.filter((l) => dept !== null && l.departmentId !== dept), ...lines]
  hist(b, user.id, 'copied', `Copied ${year} actuals ${pct >= 0 ? '+' : ''}${pct} %${dept ? ` for ${deptName(co, dept)}` : ''} (${lines.length} lines)`)
  return detailOf(user, budgetAccessOf(user), b)
}

function assertApprover(user: User): string {
  const co = writer(user)
  if (!APPROVERS.has(user.role)) throw new CodedApiError('Only Management or a Company Admin can approve or reopen a budget.', 403, 'approve_forbidden')
  return co
}

/** POST /finance/budgets/:id/approve — Management / Company Admin; locks the budget. */
export function approveBudget(user: User, id: string): BudgetDetail {
  const co = assertApprover(user)
  const b = draftOf(co, id)
  if (!b.lines.length) bad('Add at least one line before approving.', 'empty_budget')
  b.status = 'approved'
  b.approvedBy = user.id
  b.approvedAt = nowIso()
  hist(b, user.id, 'approved', 'Approved and locked')
  recordAudit(user, { action: 'update', entity: 'budget', entityId: b.id, summary: `Approved the budget ${b.name}` })
  runBudgetAlerts(co)
  return detailOf(user, budgetAccessOf(user), b)
}

/** POST /finance/budgets/:id/reopen — back to draft for changes. */
export function reopenBudget(user: User, id: string): BudgetDetail {
  const co = assertApprover(user)
  const b = budgetOf(co, id)
  if (b.status !== 'approved') conflict('Only an approved budget can be reopened.', 'not_approved')
  b.status = 'draft'
  b.approvedBy = null
  b.approvedAt = null
  hist(b, user.id, 'reopened', 'Reopened for changes')
  recordAudit(user, { action: 'update', entity: 'budget', entityId: b.id, summary: `Reopened the budget ${b.name}` })
  return detailOf(user, budgetAccessOf(user), b)
}

/** DELETE /finance/budgets/:id — drafts only. */
export function deleteBudget(user: User, id: string): { id: string } {
  const co = writer(user)
  const b = budgetOf(co, id)
  if (b.status !== 'draft') conflict('An approved budget can’t be deleted. Reopen it first.', 'not_draft')
  finBudgets.splice(finBudgets.indexOf(b), 1)
  recordAudit(user, { action: 'delete', entity: 'budget', entityId: b.id, summary: `Deleted the budget ${b.name}` })
  return { id: b.id }
}

/* ---------------- budget vs actual ---------------- */

function bva(co: string, b: BudgetRecord, lines: BudgetLineRecord[], deptSet: Set<string> | null, monthRaw: string | null, deptFilter: string | null, scoped: boolean): BudgetVsActual {
  const { from, to, months } = rangeOf(co, b.fiscalYear)
  const today = todayOf(co)
  let mi = monthRaw ? months.indexOf(monthRaw) : -1
  if (monthRaw && mi < 0) bad('Choose a month of the budget’s fiscal year.', 'validation_failed', { field: 'month' })
  if (mi < 0) mi = today < from ? 0 : today > to ? 11 : Math.max(0, months.indexOf(today.slice(0, 7)))
  const act = actualsOf(co, from, to)
  const allowed = (dept: string) => (!deptSet || deptSet.has(dept)) && (!deptFilter || dept === deptFilter)
  const pairs = new Map<string, number[]>()
  for (const l of lines) if (allowed(l.departmentId)) pairs.set(`${l.departmentId}|${l.accountId}`, l.months)
  let unassigned = 0
  for (const [k, v] of act) {
    const [dept, account, ym] = k.split('|')
    if (!dept) {
      if (typeOf(co, account) === 'expense' && months.indexOf(ym) <= mi) unassigned += v
      continue
    }
    if (!allowed(dept) || pairs.has(`${dept}|${account}`)) continue
    if (!departments.some((d) => d.companyId === co && d.id === dept)) continue
    pairs.set(`${dept}|${account}`, Array(12).fill(0))
  }
  const rows: BvaRow[] = [...pairs].map(([k, budget]) => {
    const [dept, account] = k.split('|')
    const acc = accountOf(co, account)
    const type = acc?.type === 'income' ? 'income' : 'expense'
    const actual = monthsOfActuals(act, dept, account, months)
    const ytdBudget = sum(budget.slice(0, mi + 1))
    const ytdActual = sum(actual.slice(0, mi + 1))
    const v = variance(type, ytdBudget, ytdActual)
    return {
      departmentId: dept,
      departmentName: deptName(co, dept),
      accountId: account,
      accountCode: acc?.code ?? '',
      accountName: acc?.name ?? 'Former account',
      accountType: type,
      budget: [...budget],
      actual,
      monthBudget: budget[mi],
      monthActual: actual[mi],
      ytdBudget,
      ytdActual,
      annualBudget: sum(budget),
      variance: v,
      variancePct: ytdBudget > 0 ? r2((v / ytdBudget) * 100) : null,
      usedPct: pctOf(ytdActual, ytdBudget),
      monthVariance: variance(type, budget[mi], actual[mi]),
      monthUsedPct: pctOf(actual[mi], budget[mi]),
    }
  })
  rows.sort((x, y) => x.departmentName.localeCompare(y.departmentName) || x.accountType.localeCompare(y.accountType) || x.accountCode.localeCompare(y.accountCode))
  const byDept = new Map<string, BvaDepartment>()
  for (const r of rows) {
    if (r.accountType !== 'expense') continue
    const d = byDept.get(r.departmentId) ?? { departmentId: r.departmentId, departmentName: r.departmentName, monthBudget: 0, monthActual: 0, monthPct: null, ytdBudget: 0, ytdActual: 0, ytdPct: null, status: 'ok' as const }
    d.monthBudget = r2(d.monthBudget + r.monthBudget)
    d.monthActual = r2(d.monthActual + r.monthActual)
    d.ytdBudget = r2(d.ytdBudget + r.ytdBudget)
    d.ytdActual = r2(d.ytdActual + r.ytdActual)
    byDept.set(r.departmentId, d)
  }
  const depts = [...byDept.values()].map((d) => {
    const monthPct = pctOf(d.monthActual, d.monthBudget)
    const ytdPct = pctOf(d.ytdActual, d.ytdBudget)
    const worst = Math.max(monthPct ?? 0, ytdPct ?? 0)
    return { ...d, monthPct, ytdPct, status: statusOf(monthPct === null && ytdPct === null ? null : worst) }
  })
  const exp = rows.filter((r) => r.accountType === 'expense')
  const inc = rows.filter((r) => r.accountType === 'income')
  return {
    budgetId: b.id,
    fiscalYear: b.fiscalYear,
    status: b.status,
    currency: baseCurrencyOf(co),
    months,
    month: months[mi],
    monthIndex: mi,
    departmentId: deptFilter,
    departmentScoped: scoped,
    departments: depts,
    rows,
    totals: {
      expenseBudget: sum(exp.map((r) => r.ytdBudget)),
      expenseActual: sum(exp.map((r) => r.ytdActual)),
      incomeBudget: sum(inc.map((r) => r.ytdBudget)),
      incomeActual: sum(inc.map((r) => r.ytdActual)),
      monthExpenseBudget: sum(exp.map((r) => r.monthBudget)),
      monthExpenseActual: sum(exp.map((r) => r.monthActual)),
    },
    unassignedExpenseYtd: scoped ? 0 : r2(unassigned),
  }
}

/** GET /finance/budgets/:id/vs-actual?department_id=&month=yyyy-MM */
export function getBudgetVsActual(user: User, id: string, q: { departmentId?: string | null; month?: string | null } = {}): BudgetVsActual {
  const a = budgetAccessOf(user)
  const b = budgetOf(a.co, id)
  runBudgetAlerts(a.co)
  let dept: string | null = null
  if (q.departmentId) {
    const d = departments.find((x) => x.companyId === a.co && x.id === q.departmentId)
    // A department the caller may not see answers like a missing one.
    if (!d || (a.scope === 'dept' && !a.deptIds.includes(d.id))) notFound()
    dept = d!.id
  }
  const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : q.month ? bad('Enter the month as yyyy-MM.', 'validation_failed', { field: 'month' }) : null
  return bva(a.co, b, b.lines, a.scope === 'dept' ? new Set(a.deptIds) : null, month, dept, a.scope === 'dept')
}

/* ---------------- alerts ---------------- */

function recipients(co: string, headId: string | null): string[] {
  const active = users.filter((u) => u.companyId === co && u.active !== false)
  const acc = active.filter((u) => u.role === 'Accountant').map((u) => u.id)
  const fallback = acc.length ? acc : active.filter((u) => u.role === 'Company Admin').map((u) => u.id)
  const head = headId && active.some((u) => u.id === headId) ? [headId] : []
  return [...new Set([...head, ...fallback])]
}

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

/**
 * Stores the 90 % / 100 % notices of the current fiscal year's approved budget (once per department, level and month —
 * year to date once per level and year). Returns the notifications sent (for tests).
 */
export function runBudgetAlerts(co: string): { departmentId: string; kind: 'month' | 'ytd'; level: 90 | 100 }[] {
  const today = todayOf(co)
  const year = fiscalYearOf(today, startMonthOf(co))
  const b = finBudgets.find((x) => x.companyId === co && x.fiscalYear === year && x.status === 'approved')
  if (!b) return []
  const { from, months } = rangeOf(co, year)
  const mi = months.indexOf(today.slice(0, 7))
  if (mi < 0) return []
  const act = actualsOf(co, from, today)
  const sent: { departmentId: string; kind: 'month' | 'ytd'; level: 90 | 100 }[] = []
  const deptIds = [...new Set(b.lines.map((l) => l.departmentId))]
  for (const deptId of deptIds) {
    const dept = departments.find((d) => d.companyId === co && d.id === deptId)
    if (!dept || dept.active === false) continue
    const expLines = b.lines.filter((l) => l.departmentId === deptId && typeOf(co, l.accountId) === 'expense')
    const budgetMonth = sum(expLines.map((l) => l.months[mi]))
    const budgetYtd = sum(expLines.map((l) => sum(l.months.slice(0, mi + 1))))
    let actualMonth = 0
    let actualYtd = 0
    for (const [k, v] of act) {
      const [d, account, ym] = k.split('|')
      if (d !== deptId || typeOf(co, account) !== 'expense') continue
      const i = months.indexOf(ym)
      if (i < 0 || i > mi) continue
      actualYtd += v
      if (i === mi) actualMonth += v
    }
    const checks: { kind: 'month' | 'ytd'; actual: number; budget: number; key: (lvl: number) => string; what: string }[] = [
      { kind: 'month', actual: r2(actualMonth), budget: budgetMonth, key: (lvl) => `${deptId}:month:${lvl}:${months[mi]}`, what: `its ${MONTH_LONG[Number(months[mi].slice(5, 7)) - 1]} budget` },
      { kind: 'ytd', actual: r2(actualYtd), budget: budgetYtd, key: (lvl) => `${deptId}:ytd:${lvl}:${year}`, what: `its year-to-date budget` },
    ]
    for (const c of checks) {
      const level = levelReached(c.actual, c.budget)
      if (!level) continue
      const fresh = ([90, 100] as const).filter((l) => l <= level && !b.alertMarks.includes(c.key(l)))
      if (!fresh.length) continue
      for (const l of fresh) b.alertMarks.push(c.key(l))
      const pct = Math.round((c.actual / c.budget) * 100)
      const cur = baseCurrencyOf(co)
      const title = `${dept.name} has used ${pct}% of ${c.what}`
      const body = `${cur} ${money(c.actual)} spent of ${cur} ${money(c.budget)} budgeted (${b.name}).`
      const link = `/finance/planning?tab=vs-actual&budget=${encodeURIComponent(b.id)}&department=${encodeURIComponent(deptId)}&month=${months[mi]}`
      for (const userId of recipients(co, dept.headId ?? null)) pushNotification({ companyId: co, userId, type: 'finance', title, body, link, at: nowIso() })
      sent.push({ departmentId: deptId, kind: c.kind, level })
    }
  }
  return sent
}
