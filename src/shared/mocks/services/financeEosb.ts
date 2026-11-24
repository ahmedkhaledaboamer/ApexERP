import type { User } from '@/shared/types'
import type { JournalLine } from '@/modules/finance/types'
import type { EosbProvisionReport, EosbRunResult } from '@/modules/finance/banking/types'
import { gratuity } from '@/modules/hr/payroll/calc'
import { isLocked, monthRange } from '@/modules/finance/ledger/calc'
import { nowIso } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { departments } from '@/shared/mocks/data/departments'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { finEosbPeriods, finEosbUses, type EosbPeriodRecord, type EosbRowRecord } from '@/shared/mocks/data/financeEosb'
import { hrEmployees, employeeById } from '@/shared/mocks/data/hrEmployees'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { onFinanceAccess, postJournal, round2 } from './ledger'
import { financeAccessOf, financeSettingsOf } from './financeLedger'
import { baseCurrencyOf } from './financeRates'
import { payContract, settingsFor } from './hrPayroll'
import { setEosbSettlementHooks } from './financePayrollGl'
import { onLifecycleTick } from './billing'

/**
 * Accounts & finance › End-of-service benefits provision (docs/API.md › Finance › EOSB provision; DB-ALIGNMENT F-B5).
 *
 * POLICY (replaces "expensed at settlement"): every month the company accrues each employee's end-of-service gratuity
 * so the 2500 provision always equals what it would owe if every contract ended that day.
 *   target(employee, month end) = the HR gratuity calculator (modules/hr/payroll/calc.ts `gratuity`, UAE Decree-Law
 *       33/2021 or KSA Labor Law art. 84) with the current contract's basic / housing, from the hire date to the month
 *       end, on the employer-termination basis (no KSA resignation factor; UAE: nothing before one year of service).
 *   monthly charge = Σ (target − the employee's provision so far): Dr 6120 End-of-service benefits per department
 *       (a negative department total is credited back) / Cr 2500 End-of-service benefits provision. One company-level
 *       entry per month, dated the month end, source `payroll` (`EOSB-yyyy-MM`).
 *   opening (first year only) = the targets at the day before the fiscal year: Dr 3300 Opening balance equity /
 *       Cr 2500, dated the fiscal year start (the provision carried in from before the books started).
 *   final settlement paid (services/financePayrollGl.ts) = Dr 2500 the employee's provision (used) and only the
 *       difference gratuity − provision to 6120 (a credit when the provision was larger).
 *
 * Idempotent per month (one record per company and month, whatever posts it): the finance-access hook and the lifecycle
 * tick accrue the LAST CLOSED month (the month before the company's today), catching up missing months in order; an
 * accountant may run a month by hand. A month inside the lock date is recorded `skipped_locked`, never shifted.
 * Contractors are left out (no gratuity). Employees who left (exit date on or before the month end) or whose settlement
 * consumed the provision are not accrued any more.
 */

const ACC = { eosb: 'ACC-6120', provision: 'ACC-2500', obe: 'ACC-3300' } as const
const todayOf = (co: string) => companyDayOf(co).today
const lastClosedMonth = (co: string) => monthRange(todayOf(co), -1).month
const monthEnd = (ym: string) => monthRange(`${ym}-01`).to
const prevDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const addMonth = (ym: string) => monthRange(`${ym}-01`, 1).month

const hasChart = (co: string) => [ACC.eosb, ACC.provision, ACC.obe].every((id) => financeAccounts.some((a) => a.companyId === co && a.id === id && a.active && !a.isHeader))
const periodsOf = (co: string) => finEosbPeriods.filter((p) => p.companyId === co)

/** The employee's provision after every period / use dated on or before `date` (all when omitted). */
export function provisionOf(co: string, employeeId: string, date?: string): number {
  let n = 0
  for (const p of periodsOf(co)) if (p.status === 'posted' && (!date || p.date <= date)) for (const r of p.rows) if (r.employeeId === employeeId) n += r.charge
  for (const u of finEosbUses) if (u.companyId === co && u.employeeId === employeeId && (!date || u.date <= date)) n -= u.amount
  return round2(n)
}

const usedUp = (co: string, employeeId: string) => finEosbUses.some((u) => u.companyId === co && u.employeeId === employeeId)

/** The gratuity the employee would be owed if the contract ended on `date` (0 before one year in the UAE / no contract). */
export function eosbTarget(co: string, employeeId: string, date: string): number {
  const e = employeeById(co, employeeId)
  if (!e || !e.hireDate || e.hireDate > date) return 0
  const c = payContract(co, e.id)
  if (!c) return 0
  const s = settingsFor(co)
  return gratuity({ country: s.country, reason: 'termination', basic: c.basicSalary, housing: c.housingAllowance, startDate: e.hireDate, endDate: date, basis: s.gratuityBasis }).amount
}

/** Employees accrued at `date`: hired, not a contractor, not gone, provision not consumed by a settlement. */
function accruedEmployees(co: string, date: string) {
  return hrEmployees.filter(
    (e) =>
      e.companyId === co &&
      !!e.hireDate &&
      e.hireDate <= date &&
      e.employmentType !== 'contractor' &&
      !(e.exitDate && e.exitDate <= date) &&
      !(e.status === 'terminated' && !e.exitDate) &&
      !usedUp(co, e.id),
  )
}

function linesFor(rows: EosbRowRecord[], kind: EosbPeriodRecord['kind']): JournalLine[] {
  const total = round2(rows.reduce((s, r) => s + r.charge, 0))
  if (kind === 'opening') {
    return total > 0
      ? [
          { accountId: ACC.obe, debit: total, credit: 0, description: 'End-of-service provision brought forward' },
          { accountId: ACC.provision, debit: 0, credit: total, description: 'End-of-service provision (opening)' },
        ]
      : []
  }
  const byDept = new Map<string, number>()
  for (const r of rows) byDept.set(r.departmentId ?? '', round2((byDept.get(r.departmentId ?? '') ?? 0) + r.charge))
  const lines: JournalLine[] = []
  for (const [dept, amount] of byDept) {
    if (!amount) continue
    lines.push({ accountId: ACC.eosb, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, description: amount > 0 ? 'End-of-service provision for the month' : 'End-of-service provision released', departmentId: dept || null })
  }
  if (total) lines.push({ accountId: ACC.provision, debit: total < 0 ? -total : 0, credit: total > 0 ? total : 0, description: 'End-of-service benefits provision' })
  return lines
}

const monthName = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Accrues one period (no check that it isn't recorded yet: the callers do). */
function accruePeriod(co: string, kind: EosbPeriodRecord['kind'], month: string, by: string | null): Tenant<EosbPeriodRecord> {
  const date = kind === 'opening' ? `${month}-01` : monthEnd(month)
  const asOf = kind === 'opening' ? prevDay(date) : date
  const rows: EosbRowRecord[] = accruedEmployees(co, asOf)
    .map((e) => {
      const target = eosbTarget(co, e.id, asOf)
      return { employeeId: e.id, departmentId: e.departmentId ?? null, target, charge: round2(target - provisionOf(co, e.id)) }
    })
    .filter((r) => r.target !== 0 || r.charge !== 0)
  const rec: Tenant<EosbPeriodRecord> = { companyId: co, kind, month, date, status: 'nothing', entryId: null, rows, note: null, postedAt: nowIso(), postedBy: by }
  const lines = linesFor(rows, kind)
  if (isLocked(financeSettingsOf(co).lockDate, date)) {
    rec.status = 'skipped_locked'
    rec.note = `${date} is inside the locked period: not posted.`
  } else if (lines.length >= 2) {
    const e = postJournal(co, {
      date,
      memo: kind === 'opening' ? `End-of-service provision brought forward at ${date}` : `End-of-service benefits provision — ${monthName(month)}`,
      sourceType: kind === 'opening' ? 'opening_balance' : 'payroll',
      sourceId: kind === 'opening' ? `EOSB-OPEN-${month.slice(0, 4)}` : `EOSB-${month}`,
      lines,
      createdBy: by,
    })
    rec.entryId = e.id
    rec.status = 'posted'
  }
  finEosbPeriods.push(rec)
  return rec
}

/** Accrues every missing month up to `through` (and the opening on the first run). Returns the periods posted now. */
export function accrueEosbThrough(co: string, through: string, by: string | null = null): Tenant<EosbPeriodRecord>[] {
  if (!hasChart(co)) return []
  const out: Tenant<EosbPeriodRecord>[] = []
  let periods = periodsOf(co)
  if (!periods.length) {
    // First run: the provision starts with the fiscal year of the month to accrue.
    out.push(accruePeriod(co, 'opening', `${through.slice(0, 4)}-01`, by))
    periods = periodsOf(co)
  }
  const done = new Set(periods.filter((p) => p.kind === 'month').map((p) => p.month))
  const first = periods.find((p) => p.kind === 'opening')?.month ?? `${through.slice(0, 4)}-01`
  for (let m = first; m <= through; m = addMonth(m)) {
    if (done.has(m)) continue
    out.push(accruePeriod(co, 'month', m, by))
  }
  return out
}

/* ---------------- settlement (financePayrollGl) ---------------- */

setEosbSettlementHooks({
  provision: (co, employeeId) => {
    try {
      accrueEosbThrough(co, lastClosedMonth(co))
    } catch (e) {
      console.error('[eosb] accrual before settlement failed', e)
    }
    return Math.max(0, provisionOf(co, employeeId))
  },
  used: (co, f, amount, date) => {
    finEosbUses.push({ companyId: co, employeeId: f.employeeId, settlementId: f.id, date, amount, gratuity: f.gratuity.amount })
  },
})

/* ---------------- API ---------------- */

const bad = (message: string, code = 'validation_failed'): never => {
  throw new CodedApiError(message, 422, code)
}

function report(user: User, co: string, year: string): EosbProvisionReport {
  const full = financeAccessOf(user) === 'full'
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const periods = periodsOf(co).filter((p) => p.status === 'posted')
  const ids = new Set<string>()
  for (const p of periodsOf(co)) for (const r of p.rows) ids.add(r.employeeId)
  for (const u of finEosbUses) if (u.companyId === co) ids.add(u.employeeId)
  const rows = [...ids].map((employeeId) => {
    let opening = 0
    let charge = 0
    let used = 0
    for (const p of periods) {
      const r = p.rows.find((x) => x.employeeId === employeeId)
      if (!r) continue
      if (p.date < from || (p.kind === 'opening' && p.date <= to)) opening += p.date <= to ? r.charge : 0
      else if (p.date <= to) charge += r.charge
    }
    for (const u of finEosbUses) {
      if (u.companyId !== co || u.employeeId !== employeeId) continue
      if (u.date < from) opening -= u.amount
      else if (u.date <= to) used += u.amount
    }
    const e = employeeById(co, employeeId)
    return {
      employeeId,
      employeeName: e?.fullName ?? employeeId,
      departmentName: departments.find((d) => d.companyId === co && d.id === e?.departmentId)?.name ?? '',
      opening: round2(opening),
      charge: round2(charge),
      used: round2(used),
      closing: round2(opening + charge - used),
    }
  })
  rows.sort((a, b) => b.closing - a.closing || a.employeeName.localeCompare(b.employeeName))
  const sum = (k: 'opening' | 'charge' | 'used' | 'closing') => round2(rows.reduce((s, r) => s + r[k], 0))
  const ledger = round2(
    financeJournal
      .filter((e) => e.companyId === co && e.date <= to)
      .flatMap((e) => e.lines)
      .filter((l) => l.accountId === ACC.provision)
      .reduce((s, l) => s + l.credit - l.debit, 0),
  )
  const months = periodsOf(co)
    .filter((p) => p.kind === 'month' && p.month.startsWith(year))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((p) => ({
      month: p.month,
      status: p.status,
      entryId: p.entryId,
      entryNumber: p.entryId ? (financeJournal.find((e) => e.companyId === co && e.id === p.entryId)?.number ?? null) : null,
      charge: round2(p.rows.reduce((s, r) => s + r.charge, 0)),
      employees: p.rows.length,
      note: p.note,
    }))
  return {
    year,
    baseCurrency: baseCurrencyOf(co),
    lastClosedMonth: lastClosedMonth(co),
    months,
    totals: { opening: sum('opening'), charge: sum('charge'), used: sum('used'), closing: sum('closing') },
    ledgerBalance: ledger,
    // Per-employee amounts are payroll data: accounting full only (Sales Manager reads the company totals).
    rows: full ? rows : null,
    canRun: full,
  }
}

/** GET /finance/eosb-provision?year= — accounting full / view (rows: full only). */
export function getEosbProvision(user: User, q: { year?: string | null } = {}): EosbProvisionReport {
  financeAccessOf(user)
  const co = tenantOf(user)
  const year = q.year ?? todayOf(co).slice(0, 4)
  if (!/^\d{4}$/.test(year)) bad('year is yyyy.', 'invalid_year')
  return report(user, co, year)
}

/** POST /finance/eosb-provision/run { month } — accounting full: accrues the month (and any missing month before it). */
export function runEosbProvision(user: User, input: { month?: unknown } | null): EosbRunResult {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError('Only Company Admins, Management and Accountants can change the books.', 403, 'forbidden')
  const co = tenantOf(user)
  const month = typeof input?.month === 'string' && input.month ? input.month : lastClosedMonth(co)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad('month is yyyy-MM.', 'invalid_month')
  if (month > lastClosedMonth(co)) bad(`Only a closed month can be accrued (up to ${lastClosedMonth(co)}).`, 'month_not_closed')
  if (!hasChart(co)) throw new CodedApiError('The chart of accounts has no 2500 / 6120 accounts.', 409, 'missing_system_account')
  const first = periodsOf(co).find((p) => p.kind === 'opening')?.month
  if (first && month < first) bad(`The provision starts in ${first}.`, 'before_start')
  const existing = periodsOf(co).find((p) => p.kind === 'month' && p.month === month)
  const posted = existing ? [] : accrueEosbThrough(co, month, user.id)
  if (posted.length) recordAudit(user, { action: 'create', entity: 'eosb_provision', entityId: month, summary: `Accrued the end-of-service provision through ${monthName(month)} (${posted.length} period${posted.length === 1 ? '' : 's'})` })
  return { month, alreadyPosted: !!existing, report: report(user, co, month.slice(0, 4)) }
}

/* ---------------- wiring ---------------- */

onFinanceAccess('eosb-provision', (co) => {
  try {
    accrueEosbThrough(co, lastClosedMonth(co))
  } catch (e) {
    console.error('[eosb] finance hook failed', e)
  }
})

// Month end: the next closed month, once the provision is running for the company (first run: finance access).
onLifecycleTick('finance.eosb-provision', (co) => {
  if (!periodsOf(co).length) return
  try {
    accrueEosbThrough(co, lastClosedMonth(co))
  } catch (e) {
    console.error('[eosb] lifecycle tick failed', e)
  }
})
