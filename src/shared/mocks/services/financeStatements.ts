import type { User } from '@/shared/types'
import type { Account } from '@/modules/finance/types'
import type {
  BalanceSheetPeriod,
  BalanceSheetStatement,
  CashFlowStatement,
  CompareKind,
  FiscalYearRow,
  GeneralLedgerReport,
  PeriodKind,
  PnlPeriod,
  ProfitAndLossStatement,
  StatementColumn,
  StatementDims,
  StatementsMeta,
  TrialBalanceComparative,
  YearEndCloseInput,
  YearEndCloseResult,
  YearEndCloseRow,
  YearEndOverview,
  YearEndPreview,
} from '@/modules/finance/statements/types'
import {
  CLOSING_SOURCE,
  addDays,
  addMonths,
  balanceSheetOf,
  cashFlowOf,
  closingLinesOf,
  combineBalanceSheets,
  combinePnl,
  comparisonRange,
  dateLabel,
  fiscalYearLabel,
  fiscalYearOf,
  generalLedgerOf,
  monthsEnding,
  periodRange,
  profitAndLossOf,
  rangeLabel,
  sumPnl,
  trialBalanceCompare,
} from '@/modules/finance/statements/calc'
import { descendantsOf, isIsoDate, r2 } from '@/modules/finance/ledger/calc'
import { addressLinesOf, issuerFor } from '@/modules/quotations/lib/company'
import { ApiError } from '@/shared/lib/apiError'
import { nowIso } from '@/shared/mocks/clock'
import { customers, users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { projects } from '@/shared/mocks/data/tasks'
import { events } from '@/shared/mocks/data/events'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { finYearEndCloses, type YearEndCloseRecord } from '@/shared/mocks/data/financeStatements'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { nextId, postJournal, reverseJournal, runFinanceHooks } from './ledger'
import { FINANCE_MANAGE_ONLY, financeAccessOf, registerJournalSource, setLockDate } from './financeLedger'
import { baseCurrencyOf } from './financeRates'

/**
 * Accounts & finance › Financial statements and year-end close (docs/API.md › Finance › Financial statements,
 * Year-end close). Statements come ONLY from the journal (every finance section posts there).
 *
 * WHO (PERMISSION_MATRIX `accounting`): full (Company Admin, Management, Accountant) and view (Sales Manager) read every
 * statement; hidden → 403. Closing a year moves the lock date, so it is for Company Admin and Accountant (Management:
 * 403 `year_end_forbidden`, Sales Manager: 403 `forbidden`); re-opening a closed year is Company Admin only, with a
 * reason (403 `reopen_forbidden`). Plan gate: `/finance/*` → module `accounting`. The company comes from the session;
 * a foreign close id answers 404 like a missing one; a foreign dimension / account id in a filter matches nothing
 * (the same answer as a missing id).
 *
 * Reusable store readers for other sections (profitability, company performance): `profitAndLoss`, `balanceSheet`,
 * `cashFlow` below.
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

const CLOSE_ROLES = new Set(['Company Admin', 'Accountant'])
const REOPEN_ROLE = 'Company Admin'

function viewer(user: User): string {
  financeAccessOf(user)
  return tenantOf(user)
}
function fullUser(user: User): string {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError(FINANCE_MANAGE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}

const accountsOf = (co: string) => financeAccounts.filter((a) => a.companyId === co)
const entriesOf = (co: string) => financeJournal.filter((e) => e.companyId === co)
const todayOf = (co: string) => companyDayOf(co).today
const startMonthOf = (co: string) => financeSettings.get(co).fiscalYearStartMonth
const userName = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : 'System')
const entryNumber = (co: string, id: string | null) => (id ? (financeJournal.find((e) => e.companyId === co && e.id === id)?.number ?? null) : null)
const retainedEarningsOf = (co: string): Tenant<Account> | undefined => accountsOf(co).find((a) => a.systemRole === 'retained_earnings' && a.active && !a.isHeader)

/* ================= reusable store readers ================= */

/** P&L of a company over [from, to] (closing entries excluded), optionally for one department / project / event / customer. */
export function profitAndLoss(companyId: string, from: string, to: string, dims?: StatementDims): PnlPeriod {
  runFinanceHooks(companyId)
  return profitAndLossOf(accountsOf(companyId), entriesOf(companyId), from, to, dims)
}

/** Balance sheet of a company as of a date (equity includes the unclosed earnings, so it always balances). */
export function balanceSheet(companyId: string, asOf: string): BalanceSheetPeriod {
  runFinanceHooks(companyId)
  return balanceSheetOf(accountsOf(companyId), entriesOf(companyId), asOf, startMonthOf(companyId))
}

/** Indirect-method cash flow of a company over [from, to]; `check` is 0 when it reconciles to the cash accounts. */
export function cashFlow(companyId: string, from: string, to: string): CashFlowStatement {
  runFinanceHooks(companyId)
  return cashFlowOf(accountsOf(companyId), entriesOf(companyId), from, to, baseCurrencyOf(companyId))
}

/* ================= query parsing ================= */

export interface StatementQuery {
  period?: string | null
  date?: string | null
  from?: string | null
  to?: string | null
  compare?: string | null
  view?: string | null
  asOf?: string | null
  compareTo?: string | null
  accountId?: string | null
  accountFrom?: string | null
  accountTo?: string | null
  excludeClosing?: string | null
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  customerId?: string | null
}

const PERIODS: PeriodKind[] = ['month', 'quarter', 'ytd', 'fiscal_year', 'custom']
const dateParam = (v: string | null | undefined, field: string): string | null => {
  if (v === undefined || v === null || v === '') return null
  if (!isIsoDate(v)) bad(`Enter ${field.replace(/_/g, ' ')} as yyyy-MM-dd.`, 'validation_failed', { field })
  return v
}

/** The statement range: a period kind around `date` (default today), or a custom from / to. */
function rangeOf(co: string, q: StatementQuery, defaultPeriod: PeriodKind): { from: string; to: string; period: PeriodKind } {
  const period = PERIODS.includes(q.period as PeriodKind) ? (q.period as PeriodKind) : q.from || q.to ? 'custom' : defaultPeriod
  if (period === 'custom') {
    const from = dateParam(q.from, 'from')
    const to = dateParam(q.to, 'to') ?? todayOf(co)
    if (!from) return bad('A custom period needs `from` (yyyy-MM-dd).', 'validation_failed', { field: 'from' })
    if (from > to) bad('`from` must be on or before `to`.', 'validation_failed', { field: 'from' })
    if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 10) bad('Choose a period of at most ten years.', 'validation_failed', { field: 'from' })
    return { from, to, period }
  }
  const anchor = dateParam(q.date, 'date') ?? todayOf(co)
  return { ...periodRange(period, anchor, startMonthOf(co))!, period }
}

function dimsOf(q: StatementQuery): Required<StatementDims> {
  const v = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
  return { departmentId: v(q.departmentId), projectId: v(q.projectId), eventId: v(q.eventId), customerId: v(q.customerId) }
}
function nameIn<T extends { companyId: string; id: string; name: string }>(co: string, rows: readonly T[], id: string | null): string | null {
  return id ? (rows.find((r) => r.companyId === co && r.id === id)?.name ?? null) : null
}

/* ================= meta ================= */

/** GET /finance/statements/meta */
export function getStatementsMeta(user: User): StatementsMeta {
  const co = viewer(user)
  const company = companyById(co) ?? null
  const issuer = issuerFor(company)
  const s = financeSettings.get(co)
  const today = todayOf(co)
  const pick = <T extends { companyId: string; id: string; name: string }>(rows: readonly T[], keep: (r: T) => boolean = () => true) =>
    rows.filter((r) => r.companyId === co && keep(r)).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
  const full = financeAccessOf(user) === 'full'
  return {
    currency: baseCurrencyOf(co),
    today,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    fiscalYearStart: fiscalYearOf(today, s.fiscalYearStartMonth).start,
    lockDate: s.lockDate,
    letterhead: {
      legalName: s.legalNameEn || issuer.legalName,
      name: issuer.name,
      logoUrl: company?.branding.logoUrl ?? null,
      monogram: company?.branding.monogram ?? '',
      addressLines: company ? addressLinesOf(company.profile) : [],
      taxLabel: issuer.taxLabel,
      taxNumber: s.vatNumber || issuer.taxNumber,
    },
    accounts: [...accountsOf(co)].sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isHeader: a.isHeader })),
    departments: pick(departments),
    projects: pick(projects),
    events: pick(events),
    customers: pick(customers),
    canClose: full && CLOSE_ROLES.has(user.role),
    canReopen: full && user.role === REOPEN_ROLE,
  }
}

/* ================= profit and loss ================= */

/**
 * GET /finance/statements/profit-and-loss?period=month|quarter|ytd|fiscal_year|custom&date=&from=&to=
 *   &compare=previous_period,last_year&view=period|monthly&department_id=&project_id=&event_id=&customer_id=
 */
export function getProfitAndLoss(user: User, q: StatementQuery = {}): ProfitAndLossStatement {
  const co = viewer(user)
  const { from, to, period } = rangeOf(co, q, 'ytd')
  const dims = dimsOf(q)
  const accounts = accountsOf(co)
  const entries = entriesOf(co)
  const fyMonth = startMonthOf(co)
  const columns: StatementColumn[] = []
  const periods: PnlPeriod[] = []
  const view = q.view === 'monthly' ? 'monthly' : 'period'
  if (view === 'monthly') {
    for (const m of monthsEnding(to, 12)) {
      columns.push({ key: m.month, label: rangeLabel(m.from, m.to), from: m.from, to: m.to })
      periods.push(profitAndLossOf(accounts, entries, m.from, m.to, dims))
    }
    columns.push({ key: 'total', label: 'Total', from: columns[0].from, to: columns[columns.length - 1].to })
    periods.push(sumPnl(periods))
  } else {
    columns.push({ key: 'current', label: rangeLabel(from, to, fyMonth), from, to })
    periods.push(profitAndLossOf(accounts, entries, from, to, dims))
    const wanted = new Set((q.compare ?? '').split(',').map((s) => s.trim()))
    for (const kind of ['previous_period', 'last_year'] as CompareKind[]) {
      if (!wanted.has(kind)) continue
      const r = comparisonRange(from, to, kind)
      columns.push({ key: kind, label: rangeLabel(r.from, r.to, fyMonth), from: r.from, to: r.to })
      periods.push(profitAndLossOf(accounts, entries, r.from, r.to, dims))
    }
  }
  const { sections, totals } = combinePnl(periods)
  const dimNames = {
    department: nameIn(co, departments, dims.departmentId),
    project: nameIn(co, projects, dims.projectId),
    event: nameIn(co, events, dims.eventId),
    customer: nameIn(co, customers, dims.customerId),
  }
  return {
    currency: baseCurrencyOf(co),
    view,
    period,
    columns,
    sections,
    totals,
    // An id that isn't the company's matched nothing; it isn't echoed (same answer as a missing id).
    dims: {
      departmentId: dimNames.department ? dims.departmentId : null,
      projectId: dimNames.project ? dims.projectId : null,
      eventId: dimNames.event ? dims.eventId : null,
      customerId: dimNames.customer ? dims.customerId : null,
    },
    dimNames,
  }
}

/* ================= balance sheet, trial balance ================= */

function asOfColumns(co: string, q: StatementQuery): StatementColumn[] {
  const asOf = dateParam(q.asOf, 'as_of') ?? todayOf(co)
  const cols: StatementColumn[] = [{ key: 'current', label: dateLabel(asOf), from: null, to: asOf }]
  const cmp = dateParam(q.compareTo, 'compare_to')
  if (cmp) cols.push({ key: 'compare', label: dateLabel(cmp), from: null, to: cmp })
  return cols
}

/** GET /finance/statements/balance-sheet?as_of=&compare_to= */
export function getBalanceSheet(user: User, q: StatementQuery = {}): BalanceSheetStatement {
  const co = viewer(user)
  const cols = asOfColumns(co, q)
  const accounts = accountsOf(co)
  const entries = entriesOf(co)
  const fyMonth = startMonthOf(co)
  return combineBalanceSheets(cols.map((c) => balanceSheetOf(accounts, entries, c.to, fyMonth)), baseCurrencyOf(co), cols)
}

/** GET /finance/statements/trial-balance?as_of=&compare_to= */
export function getTrialBalanceComparative(user: User, q: StatementQuery = {}): TrialBalanceComparative {
  const co = viewer(user)
  return trialBalanceCompare(accountsOf(co), entriesOf(co), asOfColumns(co, q), baseCurrencyOf(co))
}

/* ================= cash flow ================= */

/** GET /finance/statements/cash-flow?period=&date=&from=&to= */
export function getCashFlow(user: User, q: StatementQuery = {}): CashFlowStatement {
  const co = viewer(user)
  const { from, to } = rangeOf(co, q, 'ytd')
  return cashFlowOf(accountsOf(co), entriesOf(co), from, to, baseCurrencyOf(co))
}

/* ================= general ledger ================= */

/**
 * GET /finance/statements/general-ledger?from=&to=&account_id=&account_from=&account_to=&exclude_closing=true
 *   &department_id=&project_id=&event_id=&customer_id= — default period: the fiscal year to date.
 */
export function getGeneralLedger(user: User, q: StatementQuery = {}): GeneralLedgerReport {
  const co = viewer(user)
  const { from, to } = rangeOf(co, { ...q, period: q.period ?? (q.from || q.to ? 'custom' : 'ytd') }, 'ytd')
  const all = accountsOf(co)
  let ids: Set<string> | null = null
  if (q.accountId) {
    const acc = all.find((a) => a.id === q.accountId)
    ids = new Set(acc ? (acc.isHeader ? descendantsOf(acc.id, all) : [acc.id]) : [])
  }
  const lo = (q.accountFrom ?? '').trim()
  const hi = (q.accountTo ?? '').trim()
  if (lo || hi) {
    const inRange = all.filter((a) => (!lo || a.code >= lo) && (!hi || a.code <= hi)).map((a) => a.id)
    ids = new Set(ids ? inRange.filter((id) => ids!.has(id)) : inRange)
  }
  const excludeClosing = q.excludeClosing === 'true'
  const accounts = generalLedgerOf(all, entriesOf(co), from, to, baseCurrencyOf(co), { accountIds: ids, dims: dimsOf(q), excludeClosing })
  return {
    currency: baseCurrencyOf(co),
    from,
    to,
    accounts,
    totals: { debit: r2(accounts.reduce((t, a) => t + a.totals.debit, 0)), credit: r2(accounts.reduce((t, a) => t + a.totals.credit, 0)) },
    excludeClosing,
  }
}

/* ================= year-end close ================= */

const activeCloseOf = (co: string, end: string) => finYearEndCloses.find((c) => c.companyId === co && c.fiscalYearEnd === end && c.status === 'closed')

/** Fiscal years from the one holding the first journal entry to the current one (oldest first). */
function fiscalYears(co: string): { start: string; end: string }[] {
  const startMonth = startMonthOf(co)
  const today = todayOf(co)
  const first = entriesOf(co).reduce((m, e) => (e.date < m ? e.date : m), today)
  const out: { start: string; end: string }[] = []
  let fy = fiscalYearOf(first, startMonth)
  const last = fiscalYearOf(today, startMonth).start
  while (fy.start <= last && out.length < 50) {
    out.push(fy)
    fy = fiscalYearOf(addMonths(fy.start, 12), startMonth)
  }
  return out
}

interface Block {
  status: number
  code: string
  message: string
}

/** Why the year can't be closed now (null = it can). */
function closeBlock(co: string, roleBlock: Block | null, start: string, end: string): Block | null {
  const label = fiscalYearLabel(start, end)
  if (roleBlock) return roleBlock
  if (end > todayOf(co)) return { status: 409, code: 'year_not_ended', message: `${label} ends on ${end}. Close it after its last day.` }
  if (activeCloseOf(co, end)) return { status: 409, code: 'already_closed', message: `${label} is already closed.` }
  const re = retainedEarningsOf(co)
  if (!re) return { status: 409, code: 'missing_system_account', message: 'The chart of accounts has no active retained earnings account.' }
  const accounts = accountsOf(co)
  const entries = entriesOf(co)
  for (const fy of fiscalYears(co)) {
    if (fy.end >= end) break
    if (activeCloseOf(co, fy.end)) continue
    if (closingLinesOf(accounts, entries, fy.start, fy.end, re).lines.length) {
      return { status: 409, code: 'earlier_year_open', message: `Close ${fiscalYearLabel(fy.start, fy.end)} first.` }
    }
  }
  const lock = financeSettings.get(co).lockDate
  if (lock && lock >= end && closingLinesOf(accounts, entries, start, end, re).lines.length) {
    return { status: 423, code: 'period_locked', message: `The books are locked up to ${lock}. Move the lock date before ${end} to post the closing entry.` }
  }
  return null
}

/** The caller's role reason not to close (null = may close). */
function closeRoleBlock(user: User): Block | null {
  const full = financeAccessOf(user) === 'full'
  if (full && CLOSE_ROLES.has(user.role)) return null
  return { status: 403, code: full ? 'year_end_forbidden' : 'forbidden', message: 'Only a Company Admin or an Accountant can close a fiscal year (it moves the lock date).' }
}

function reopenBlock(co: string, mayReopen: boolean, rec: YearEndCloseRecord): string | null {
  if (!mayReopen) return 'Only a Company Admin can re-open a closed year.'
  if (finYearEndCloses.some((c) => c.companyId === co && c.status === 'closed' && c.fiscalYearEnd > rec.fiscalYearEnd)) return 'Re-open the later closed year first.'
  return null
}

function closeRow(co: string, r: YearEndCloseRecord): YearEndCloseRow {
  return {
    id: r.id,
    fiscalYearStart: r.fiscalYearStart,
    fiscalYearEnd: r.fiscalYearEnd,
    status: r.status,
    netProfit: r.netProfit,
    entryId: r.journalEntryId,
    entryNumber: entryNumber(co, r.journalEntryId),
    reversalEntryId: r.reversalEntryId,
    reversalEntryNumber: entryNumber(co, r.reversalEntryId),
    previousLockDate: r.previousLockDate,
    note: r.note,
    closedAt: r.closedAt,
    closedByName: userName(co, r.closedBy),
    reopenedAt: r.reopenedAt,
    reopenedByName: r.reopenedBy ? userName(co, r.reopenedBy) : null,
    reopenReason: r.reopenReason,
  }
}

const reView = (a: Account | undefined) => (a ? { accountId: a.id, code: a.code, name: a.name } : null)

/** GET /finance/year-end — fiscal years (newest first) with their close status, and the close history. */
export function getYearEnd(user: User): YearEndOverview {
  const co = viewer(user)
  const accounts = accountsOf(co)
  const entries = entriesOf(co)
  const today = todayOf(co)
  const full = financeAccessOf(user) === 'full'
  const roleBlock = closeRoleBlock(user)
  const mayReopen = full && user.role === REOPEN_ROLE
  const years: FiscalYearRow[] = fiscalYears(co)
    .map((fy) => {
      const rec = activeCloseOf(co, fy.end)
      const block = rec ? null : closeBlock(co, roleBlock, fy.start, fy.end)
      const reopen = rec ? reopenBlock(co, mayReopen, rec) : 'Not closed.'
      return {
        start: fy.start,
        end: fy.end,
        label: fiscalYearLabel(fy.start, fy.end),
        status: rec ? 'closed' : fy.end > today ? 'in_progress' : 'open',
        netProfit: profitAndLossOf(accounts, entries, fy.start, fy.end).netProfit,
        closeId: rec?.id ?? null,
        closedAt: rec?.closedAt ?? null,
        closedByName: rec ? userName(co, rec.closedBy) : null,
        entryId: rec?.journalEntryId ?? null,
        entryNumber: rec ? entryNumber(co, rec.journalEntryId) : null,
        canClose: !rec && !block,
        closeBlockedReason: rec ? 'Already closed.' : (block?.message ?? null),
        canReopen: !!rec && !reopen,
        reopenBlockedReason: reopen,
      } satisfies FiscalYearRow
    })
    .reverse()
  const s = financeSettings.get(co)
  return {
    currency: baseCurrencyOf(co),
    today,
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    lockDate: s.lockDate,
    retainedEarnings: reView(retainedEarningsOf(co)),
    years,
    history: finYearEndCloses
      .filter((c) => c.companyId === co)
      .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
      .map((c) => closeRow(co, c)),
    canClose: !roleBlock,
    canReopen: mayReopen,
  }
}

/** The fiscal year ending on `end` (422 when `end` isn't a fiscal year end for the company's start month). */
function yearEndingOn(co: string, end: unknown): { start: string; end: string } {
  if (!isIsoDate(end)) return bad('Send `fiscal_year_end` (yyyy-MM-dd, the last day of a fiscal year).', 'validation_failed', { field: 'fiscal_year_end' })
  const fy = fiscalYearOf(end, startMonthOf(co))
  if (fy.end !== end) bad(`${end} isn’t the last day of a fiscal year (the fiscal year starts in month ${startMonthOf(co)}).`, 'invalid_fiscal_year', { field: 'fiscal_year_end' })
  return fy
}

/** Default preview year: the oldest ended year still open with activity, else the latest ended year, else the current one. */
function defaultYear(co: string): { start: string; end: string } {
  const today = todayOf(co)
  const re = retainedEarningsOf(co)
  const ys = fiscalYears(co)
  const ended = ys.filter((y) => y.end <= today && !activeCloseOf(co, y.end))
  const withActivity = re ? ended.find((y) => closingLinesOf(accountsOf(co), entriesOf(co), y.start, y.end, re).lines.length) : undefined
  return withActivity ?? ended[ended.length - 1] ?? ys[ys.length - 1] ?? fiscalYearOf(today, startMonthOf(co))
}

/** GET /finance/year-end/preview?fiscal_year_end= — the closing entry that a close would post. */
export function previewYearEnd(user: User, q: { fiscalYearEnd?: string | null } = {}): YearEndPreview {
  const co = viewer(user)
  const fy = q.fiscalYearEnd ? yearEndingOn(co, q.fiscalYearEnd) : defaultYear(co)
  const re = retainedEarningsOf(co)
  const rec = activeCloseOf(co, fy.end)
  const cl = re ? closingLinesOf(accountsOf(co), entriesOf(co), fy.start, fy.end, re) : { lines: [], netProfit: profitAndLossOf(accountsOf(co), entriesOf(co), fy.start, fy.end).netProfit, totals: { debit: 0, credit: 0 } }
  const block = rec ? { message: `${fiscalYearLabel(fy.start, fy.end)} is already closed.` } : closeBlock(co, closeRoleBlock(user), fy.start, fy.end)
  const lock = financeSettings.get(co).lockDate
  return {
    currency: baseCurrencyOf(co),
    start: fy.start,
    end: fy.end,
    label: fiscalYearLabel(fy.start, fy.end),
    retainedEarnings: reView(re),
    lines: cl.lines,
    totals: cl.totals,
    netProfit: cl.netProfit,
    lockDate: lock,
    newLockDate: lock && lock >= fy.end ? lock : fy.end,
    canClose: !block,
    blockedReason: block?.message ?? null,
  }
}

/**
 * POST /finance/year-end/close `{ fiscal_year_end, note? }` (Company Admin, Accountant): posts the closing entry (every
 * income / expense account to zero, the result to retained earnings) dated the year's last day with source type
 * `year_end_close`, then sets the lock date to that day through the audited lock-date service.
 */
export function closeYear(user: User, input: Partial<YearEndCloseInput> | null): YearEndCloseResult {
  const co = fullUser(user)
  if (!CLOSE_ROLES.has(user.role)) throw new CodedApiError('Only a Company Admin or an Accountant can close a fiscal year (it moves the lock date).', 403, 'year_end_forbidden')
  const fy = yearEndingOn(co, input?.fiscalYearEnd)
  const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 300) : ''
  const block = closeBlock(co, null, fy.start, fy.end)
  if (block) throw new CodedApiError(block.message, block.status, block.code)
  const re = retainedEarningsOf(co)!
  const label = fiscalYearLabel(fy.start, fy.end)
  const cl = closingLinesOf(accountsOf(co), entriesOf(co), fy.start, fy.end, re)
  const settings = financeSettings.get(co)
  const previousLockDate = settings.lockDate
  const id = nextId('yearEndClose', 'YEC')
  const entry = cl.lines.length
    ? postJournal(co, {
        date: fy.end,
        memo: `Year-end close ${label}: income and expenses to ${re.name.toLowerCase()}`,
        sourceType: CLOSING_SOURCE,
        sourceId: id,
        lines: cl.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.accountId === re.id ? `Result of ${label}` : 'Year-end close' })),
        createdBy: user.id,
      })
    : null
  const rec: Tenant<YearEndCloseRecord> = {
    companyId: co,
    id,
    fiscalYearStart: fy.start,
    fiscalYearEnd: fy.end,
    status: 'closed',
    netProfit: cl.netProfit,
    journalEntryId: entry?.id ?? null,
    previousLockDate,
    note,
    closedAt: nowIso(),
    closedBy: user.id,
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: null,
    reversalEntryId: null,
  }
  finYearEndCloses.push(rec)
  if (!previousLockDate || previousLockDate < fy.end) setLockDate(user, { lockDate: fy.end, reason: `Year-end close ${label}${note ? ` — ${note}` : ''}` })
  recordAudit(user, {
    action: 'create',
    entity: 'year_end_close',
    entityId: id,
    summary: `Closed ${label}: net ${cl.netProfit >= 0 ? 'profit' : 'loss'} ${Math.abs(cl.netProfit).toFixed(2)} to retained earnings${entry ? ` (${entry.number})` : ''}`,
  })
  return { close: closeRow(co, rec), lockDate: financeSettings.get(co).lockDate }
}

/**
 * POST /finance/year-end/closes/:id/reopen `{ reason }` (Company Admin): restores the lock date from before the close
 * (audited) and reverses the closing entry (dated the year's last day). Only the latest closed year re-opens.
 */
export function reopenYear(user: User, id: string, input: { reason?: unknown } | null): YearEndCloseResult {
  const co = fullUser(user)
  const rec = finYearEndCloses.find((c) => c.companyId === co && c.id === id) ?? notFound()
  if (user.role !== REOPEN_ROLE) throw new CodedApiError('Only a Company Admin can re-open a closed year.', 403, 'reopen_forbidden')
  if (rec.status !== 'closed') conflict('This close was already re-opened.', 'already_reopened')
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  if (!reason) bad('Give the reason for re-opening the year (it goes to the audit log).', 'validation_failed', { field: 'reason' })
  if (reason.length > 300) bad('The reason is too long (max 300 characters).', 'validation_failed', { field: 'reason' })
  const blocked = reopenBlock(co, true, rec)
  if (blocked) conflict(blocked, 'later_year_closed')
  const label = fiscalYearLabel(rec.fiscalYearStart, rec.fiscalYearEnd)
  const lock = financeSettings.get(co).lockDate
  if (lock && lock >= rec.fiscalYearEnd) {
    const prev = rec.previousLockDate
    const target = prev === null || prev < rec.fiscalYearEnd ? prev : addDays(rec.fiscalYearStart, -1)
    setLockDate(user, { lockDate: target, reason: `Re-opened ${label} — ${reason}` })
  }
  let reversal: string | null = null
  const entry = rec.journalEntryId ? financeJournal.find((e) => e.companyId === co && e.id === rec.journalEntryId) : undefined
  if (entry && entry.status !== 'reversed') reversal = reverseJournal(co, entry.id, rec.fiscalYearEnd, `Re-open ${label}: reversal of the year-end close ${entry.number}`, user.id).id
  rec.status = 'reopened'
  rec.reopenedAt = nowIso()
  rec.reopenedBy = user.id
  rec.reopenReason = reason
  rec.reversalEntryId = reversal
  recordAudit(user, { action: 'update', entity: 'year_end_close', entityId: rec.id, summary: `Re-opened ${label} — ${reason}`, changes: [{ field: 'status', from: 'closed', to: 'reopened' }] })
  return { close: closeRow(co, rec), lockDate: financeSettings.get(co).lockDate }
}

/* The journal shows a closing entry's source as the close (number + link to the Year-end tab). */
registerJournalSource(CLOSING_SOURCE, (co, sourceId) => {
  const rec = finYearEndCloses.find((c) => c.companyId === co && c.id === sourceId)
  return rec ? { number: `${fiscalYearLabel(rec.fiscalYearStart, rec.fiscalYearEnd)} close`, link: '/finance/statements?tab=year-end' } : null
})
