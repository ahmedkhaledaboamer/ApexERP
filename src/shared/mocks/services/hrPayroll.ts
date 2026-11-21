import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type {
  AdjustmentInput,
  AdjustmentKind,
  BankFile,
  BankFileFormat,
  ExitReason,
  FinalSettlement,
  LineWarning,
  LoanInput,
  PayAdjustment,
  PayCountry,
  PayLine,
  PayLoan,
  PayMethod,
  PayrollProfile,
  PayrollProfileInput,
  PayrollRunDetail,
  PayrollRunRow,
  PayrollSummary,
  PaySettings,
  PaySettingsInput,
  Payslip,
  PayslipRow,
  RunTotals,
  SettlementAdjustment,
  SettlementInput,
  SiBase,
  WarningCode,
} from '@/modules/hr/payroll/types'
import { ADJUSTMENT_KINDS, EXIT_REASONS, PAY_METHODS } from '@/modules/hr/payroll/types'
import {
  MONTH_RE,
  addDays,
  addMonths,
  buildMudadCsv,
  buildSif,
  computeLine,
  daysInMonth,
  defaultSocialInsurance,
  gratuity,
  inclusiveDays,
  installmentDue,
  isNational,
  loanSchedule,
  monthEnd,
  monthLabel,
  monthStart,
  r2,
  sum,
} from '@/modules/hr/payroll/calc'
import { datesBetween, leaveDayCount, workingDates } from '@/modules/hr/time/calc'
import { ApiError } from '@/shared/lib/apiError'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { now as clockNow, nowIso } from '@/shared/mocks/clock'
import { users } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { departments } from '@/shared/mocks/data/departments'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { employeeById, employeesOf, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts, hrDocuments, hrProfiles, maskLast4, nextHrId, type ContractRecord } from '@/shared/mocks/data/hrPeople'
import { ensureHrTime, hrApproverIds, hrAttendance, hrLeaveRequests, hrLeaveTypes, nextId as nextTimeId } from '@/shared/mocks/data/hrTime'
import {
  allLineIds,
  hrFinalSettlements,
  hrPayAdjustments,
  hrPayLoans,
  hrPaySettings,
  hrPayrollProfiles,
  hrPayrollRuns,
  nextPayId,
  type AdjustmentRecord,
  type LoanRecord,
  type PayLineRecord,
  type PaySettingsRecord,
  type PayrollProfileRecord,
  type PayrollRunRecord,
  type SettlementRecord,
} from '@/shared/mocks/data/hrPayroll'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertHrFull, companyEmployee, hrAccessOf, hrFullUsers, logHr } from './hrAccess'
import { daysOf, holidayMap } from './attendance'
import { balanceOf } from './leave'
import type { HrCtx } from './hrTimeAccess'

/**
 * HR › Salary Management (docs/API.md › HR › Salary management). Everything but the payslips is HR FULL only
 * (Company Admin, Management, HR Manager); payslips: HR full sees every paid one, team / own see only their
 * own (a Department Head never sees the team's pay, as in Phase 1); hidden roles 403. The company comes from
 * the session; a foreign id answers 404 like a missing one.
 *
 * RUN LIFECYCLE  draft → calculated → approved → paid (locked). Calculate (or re-calculate) refreshes every line
 * from the live data; approve needs a DIFFERENT HR-full user than the one who calculated (maker–checker) and every
 * warning (no contract, missing IBAN, missing WPS / national id, negative net) resolved by a re-calculation or
 * acknowledged; reopen sends a calculated / approved run back to draft; paid is immutable (corrections are
 * adjustments in a later month). Paying records the loan installments and the paid one-off adjustments, and sends
 * "payslip available" to each employee once.
 *
 * LINE RULES (one line per eligible employee: hired by the month end, not left before the month start)
 *   earnings      the ACTIVE contract's components × paid calendar days ÷ days in the month (joiners / leavers);
 *                 the window is [max(month start, hire, contract start), min(month end, exit, contract end)]
 *   unpaid leave  approved requests of an unpaid leave type (leave_types.is_paid = false), working days inside
 *                 the window (half day 0.5), × daily rate (monthly fixed pay ÷ calendar days of the month)
 *   absence       (pay setting `deduct_absences`) a working day of the employee's shift, inside the window, from
 *                 the employee's FIRST recorded attendance on, up to min(cut-off day, yesterday), with no clock-in,
 *                 no approved leave (any type) and no public holiday — B's attendance.daysOf status `absent`
 *   overtime      (pay setting `overtime_enabled`, off by default) overtime minutes of the same days (attendance
 *                 calc) × basic ÷ days in month ÷ 8 × multiplier
 *   social ins.   employee + employer share of the contributory base (pay settings; nationals vs others)
 *   loans         each active loan's installment from its start month until repaid
 *   adjustments   allowances / bonuses (earnings), deductions; one-off in their month, monthly until `end_month`
 * An employee with a final settlement is left out of runs from the day the settlement starts paying salary.
 */

const bad = (message: string, code = 'validation_failed'): never => {
  throw new CodedApiError(message, 422, code)
}
const conflict = (message: string, code: string): never => {
  throw new CodedApiError(message, 409, code)
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
export const PAYROLL_LINK = '/hr/salary'
export const PAYROLL_ALERT_TYPE = 'hr-payroll'

/**
 * Payroll events for other sections (Accounts & finance posts runs, loans and settlements to the ledger:
 * services/financePayrollGl.ts). Emitted after the state change; a listener must not throw (errors are swallowed so
 * a ledger problem never blocks payroll — the listener re-syncs on the next finance access).
 */
export type PayrollEvent =
  | { type: 'run_approved' | 'run_reopened' | 'run_paid'; companyId: string; runId: string; userId: string }
  | { type: 'loan_created' | 'loan_cancelled'; companyId: string; loanId: string; userId: string }
  | { type: 'settlement_paid'; companyId: string; settlementId: string; userId: string }
const payrollListeners = new Map<string, (e: PayrollEvent) => void>()
export function onPayrollEvent(name: string, listener: (e: PayrollEvent) => void): void {
  payrollListeners.set(name, listener)
}
function emitPayroll(e: PayrollEvent): void {
  for (const fn of payrollListeners.values()) {
    try {
      fn(e)
    } catch {
      /* a listener never blocks payroll */
    }
  }
}

const nameOfUser = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? null) : null)
const deptName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? null) : null)
const strip = <T extends { companyId: string }>(r: T): Omit<T, 'companyId'> => {
  const { companyId: _c, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}

/* ---------------- Company context ---------------- */

function regionOf(co: string) {
  const c = companyById(co)
  const country: PayCountry = c?.regional.country === 'SA' ? 'SA' : 'AE'
  return { country, currency: c?.regional.currency ?? (country === 'SA' ? 'SAR' : 'AED'), timezone: c?.regional.timezone ?? DEFAULT_REGION.timezone, weekend: c?.regional.weekend ?? DEFAULT_REGION.weekend }
}

/** A minimal HR time context for the company (B's attendance / leave helpers), at the mock clock. */
function timeCtx(co: string, today?: string): HrCtx {
  const r = regionOf(co)
  const at = clockNow()
  const t = today ?? todayIsoIn(r.timezone, at)
  ensureHrTime(co, Number(t.slice(0, 4)))
  return { user: null as unknown as User, co, scope: 'full', self: undefined, timezone: r.timezone, weekend: r.weekend, country: r.country, now: at, today: t }
}

const todayOf = (co: string) => todayIsoIn(regionOf(co).timezone, clockNow())

/* ---------------- Settings ---------------- */

export function settingsFor(co: string): Tenant<PaySettingsRecord> {
  let s = hrPaySettings.find((x) => x.companyId === co)
  if (!s) {
    const r = regionOf(co)
    s = {
      companyId: co,
      country: r.country,
      currency: r.currency,
      payDay: 28,
      cutoffDay: 31,
      wpsEmployerId: '',
      wpsRoutingCode: '',
      mudadEstablishmentNo: '',
      socialInsurance: defaultSocialInsurance(r.country),
      deductAbsences: true,
      overtimeEnabled: false,
      overtimeMultiplier: 1.25,
      gratuityBasis: 'basic_housing',
      defaultsConfirmed: false,
      defaultsConfirmedAt: null,
      defaultsConfirmedBy: null,
      updatedAt: nowIso(),
    }
    hrPaySettings.push(s)
  }
  return s
}

function settingsView(s: Tenant<PaySettingsRecord>): PaySettings {
  const { defaultsConfirmedBy, ...rest } = strip(s)
  return { ...rest, socialInsurance: { ...s.socialInsurance }, defaultsConfirmedByName: nameOfUser(s.companyId, defaultsConfirmedBy), countryDefaults: defaultSocialInsurance(s.country) }
}

export async function getPaySettings(user: User): Promise<PaySettings> {
  assertHrFull(user)
  return delay(settingsView(settingsFor(tenantOf(user))))
}

function pct(v: unknown, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 50) bad(`${field} must be a percentage from 0 to 50.`)
  return Math.round(n * 100) / 100
}
function whole(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) bad(`${field} must be a whole number from ${min} to ${max}.`)
  return n
}

export async function updatePaySettings(user: User, input: PaySettingsInput | null): Promise<PaySettings> {
  assertHrFull(user)
  const s = settingsFor(tenantOf(user))
  const i = input ?? {}
  const next: Partial<PaySettingsRecord> = {}
  if (i.payDay !== undefined) next.payDay = whole(i.payDay, 'Pay day', 1, 28)
  if (i.cutoffDay !== undefined) next.cutoffDay = whole(i.cutoffDay, 'Cut-off day', 1, 31)
  if (i.wpsEmployerId !== undefined) {
    const v = String(i.wpsEmployerId ?? '').replace(/\s+/g, '')
    if (v && !/^\d{13}$/.test(v)) bad('The WPS employer id has 13 digits.')
    next.wpsEmployerId = v
  }
  if (i.wpsRoutingCode !== undefined) {
    const v = String(i.wpsRoutingCode ?? '').replace(/\s+/g, '')
    if (v && !/^\d{9}$/.test(v)) bad('The agent / bank routing code has 9 digits.')
    next.wpsRoutingCode = v
  }
  if (i.mudadEstablishmentNo !== undefined) {
    const v = String(i.mudadEstablishmentNo ?? '').trim()
    if (v && !/^[0-9][0-9-]{3,19}$/.test(v)) bad('The Mudad establishment number is digits (e.g. 7-0012345).')
    next.mudadEstablishmentNo = v
  }
  if (i.deductAbsences !== undefined) next.deductAbsences = !!i.deductAbsences
  if (i.overtimeEnabled !== undefined) next.overtimeEnabled = !!i.overtimeEnabled
  if (i.overtimeMultiplier !== undefined) {
    const n = Number(i.overtimeMultiplier)
    if (!Number.isFinite(n) || n < 1 || n > 3) bad('The overtime multiplier is between 1 and 3.')
    next.overtimeMultiplier = Math.round(n * 100) / 100
  }
  if (i.gratuityBasis !== undefined) {
    if (i.gratuityBasis !== 'basic' && i.gratuityBasis !== 'basic_housing') bad('Pick the gratuity wage basis.')
    next.gratuityBasis = i.gratuityBasis
  }
  if (i.socialInsurance) {
    const si = i.socialInsurance
    const cur = { ...s.socialInsurance }
    if (si.nationalEmployeeRate !== undefined) cur.nationalEmployeeRate = pct(si.nationalEmployeeRate, 'The employee rate (nationals)')
    if (si.nationalEmployerRate !== undefined) cur.nationalEmployerRate = pct(si.nationalEmployerRate, 'The employer rate (nationals)')
    if (si.expatEmployeeRate !== undefined) cur.expatEmployeeRate = pct(si.expatEmployeeRate, 'The employee rate (others)')
    if (si.expatEmployerRate !== undefined) cur.expatEmployerRate = pct(si.expatEmployerRate, 'The employer rate (others)')
    if (si.base !== undefined) {
      if (!(['basic_housing', 'basic', 'gross'] as SiBase[]).includes(si.base)) bad('Pick the contributory base.')
      cur.base = si.base
    }
    if (si.cap !== undefined) {
      if (si.cap === null || (si.cap as unknown) === '') cur.cap = null
      else {
        const n = Number(si.cap)
        if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) bad('The cap must be a positive amount (or empty for none).')
        cur.cap = r2(n)
      }
    }
    next.socialInsurance = cur
  }
  const now = nowIso()
  if (i.defaultsConfirmed !== undefined) {
    next.defaultsConfirmed = !!i.defaultsConfirmed
    next.defaultsConfirmedAt = i.defaultsConfirmed ? now : null
    next.defaultsConfirmedBy = i.defaultsConfirmed ? user.id : null
  }
  Object.assign(s, next, { updatedAt: now })
  recordAudit(user, { action: 'update', entity: 'pay_settings', entityId: s.companyId, summary: 'Updated the payroll settings', changes: [] })
  return delay(settingsView(s))
}

/* ---------------- Payroll profiles ---------------- */

function profileFor(co: string, employeeId: string): Tenant<PayrollProfileRecord> {
  let p = hrPayrollProfiles.find((x) => x.companyId === co && x.employeeId === employeeId)
  if (!p) {
    p = { companyId: co, employeeId, payMethod: 'bank', personId: '', bankRoutingCode: '', updatedAt: nowIso() }
    hrPayrollProfiles.push(p)
  }
  return p
}
const peekProfile = (co: string, employeeId: string) => hrPayrollProfiles.find((x) => x.companyId === co && x.employeeId === employeeId)
const bankOf = (co: string, employeeId: string) => hrProfiles.find((p) => p.companyId === co && p.employeeId === employeeId)

/** The contract that pays the employee: the active one, else the latest non-draft one overlapping [from, to]. */
export function payContract(co: string, employeeId: string, from?: string, to?: string): Tenant<ContractRecord> | undefined {
  const own = hrContracts.filter((c) => c.companyId === co && c.employeeId === employeeId && c.status !== 'draft')
  const overlaps = (c: ContractRecord) => (!from || !c.endDate || c.endDate >= from) && (!to || c.startDate <= to)
  return own.find((c) => c.status === 'active' && overlaps(c)) ?? own.filter(overlaps).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
}

function profileIssues(co: string, e: Employee, p: PayrollProfileRecord | undefined): string[] {
  const out: string[] = []
  if (!hrContracts.some((c) => c.companyId === co && c.employeeId === e.id && c.status === 'active')) out.push('no_contract')
  if ((p?.payMethod ?? 'bank') === 'bank') {
    if (!bankOf(co, e.id)?.iban) out.push('no_iban')
    if (!p?.personId) out.push('no_person_id')
  }
  return out
}

function profileView(co: string, e: Tenant<Employee>): PayrollProfile {
  const p = peekProfile(co, e.id)
  const c = hrContracts.find((x) => x.companyId === co && x.employeeId === e.id && x.status === 'active')
  const bank = bankOf(co, e.id)
  return {
    employeeId: e.id,
    employeeName: e.fullName,
    employeeNo: e.employeeNo,
    departmentName: deptName(co, e.departmentId),
    nationality: e.nationality,
    status: e.status,
    payMethod: p?.payMethod ?? 'bank',
    personIdMasked: maskLast4(p?.personId),
    bankRoutingCode: p?.bankRoutingCode ?? '',
    bankName: bank?.bankName ?? '',
    ibanMasked: maskLast4(bank?.iban),
    contractId: c?.id ?? null,
    basicSalary: c?.basicSalary ?? null,
    housingAllowance: c?.housingAllowance ?? null,
    transportAllowance: c?.transportAllowance ?? null,
    otherAllowance: c?.otherAllowance ?? null,
    totalSalary: c ? r2(c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance) : null,
    currency: c?.currency ?? settingsFor(co).currency,
    issues: profileIssues(co, e, p),
  }
}

export async function listPayrollProfiles(user: User): Promise<PayrollProfile[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  return delay(
    employeesOf(co)
      .filter((e) => e.status !== 'terminated' || !!e.exitDate)
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
      .map((e) => profileView(co, e)),
  )
}

function fullEmployee(user: User, id: unknown): Tenant<Employee> {
  assertHrFull(user)
  return companyEmployee(tenantOf(user), id) ?? notFound()
}

export async function updatePayrollProfile(user: User, employeeId: string, input: PayrollProfileInput | null): Promise<PayrollProfile> {
  const co = tenantOf(user)
  hrAccessOf(user)
  const e = companyEmployee(co, employeeId) ?? notFound()
  assertHrFull(user)
  const p = profileFor(co, e.id)
  const i = input ?? {}
  if (i.payMethod !== undefined) {
    if (!PAY_METHODS.includes(i.payMethod)) bad('Pick a pay method.')
    p.payMethod = i.payMethod
  }
  if (i.personId !== undefined) {
    const v = String(i.personId ?? '').replace(/[\s-]/g, '')
    const country = settingsFor(co).country
    if (v && country === 'AE' && !/^\d{14}$/.test(v)) bad('The WPS person id (MOHRE) has 14 digits.')
    if (v && country === 'SA' && !/^[12]\d{9}$/.test(v)) bad('The national id / iqama number has 10 digits and starts with 1 or 2.')
    p.personId = v
  }
  if (i.bankRoutingCode !== undefined) {
    const v = String(i.bankRoutingCode ?? '').replace(/\s+/g, '')
    if (v && !/^\d{9}$/.test(v)) bad('The bank routing code has 9 digits.')
    p.bankRoutingCode = v
  }
  p.updatedAt = nowIso()
  logHr(co, e.id, user, 'payroll', 'Payroll profile updated')
  return delay(profileView(co, e))
}

/** POST /hr/payroll/profiles/:employeeId/reveal — the full WPS person id / national id; HR full; audited. */
export async function revealPersonId(user: User, employeeId: string): Promise<{ employeeId: string; personId: string }> {
  const co = tenantOf(user)
  hrAccessOf(user)
  const e = companyEmployee(co, employeeId) ?? notFound()
  assertHrFull(user)
  const p = peekProfile(co, e.id)
  logHr(co, e.id, user, 'revealed', 'Viewed the full payroll id (WPS / national id)')
  recordAudit(user, { action: 'security', entity: 'payroll_profile', entityId: e.id, summary: `Viewed the payroll id of ${e.fullName}`, changes: [] })
  return delay({ employeeId: e.id, personId: p?.personId ?? '' })
}

/* ---------------- Adjustments ---------------- */

const monthOk = (v: unknown): v is string => typeof v === 'string' && MONTH_RE.test(v)

/** Adjustments of an employee that apply to `month`. */
function adjustmentsFor(co: string, employeeId: string, month: string): Tenant<AdjustmentRecord>[] {
  return hrPayAdjustments.filter(
    (a) => a.companyId === co && a.employeeId === employeeId && (a.recurrence === 'once' ? a.month === month : a.month <= month && (!a.endMonth || a.endMonth >= month)),
  )
}

function adjustmentView(a: Tenant<AdjustmentRecord>): PayAdjustment {
  const { createdBy: _b, ...rest } = strip(a) // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, paidRunIds: [...a.paidRunIds], employeeName: employeeById(a.companyId, a.employeeId)?.fullName ?? 'Unknown', locked: a.recurrence === 'once' && a.paidRunIds.length > 0 }
}

export async function listAdjustments(user: User, q: { month?: unknown; employeeId?: unknown }): Promise<PayAdjustment[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  const month = monthOk(q.month) ? q.month : null
  return delay(
    hrPayAdjustments
      .filter((a) => a.companyId === co)
      .filter((a) => !q.employeeId || a.employeeId === q.employeeId)
      .filter((a) => !month || adjustmentsFor(co, a.employeeId, month).includes(a))
      .sort((a, b) => b.month.localeCompare(a.month) || b.id.localeCompare(a.id))
      .map(adjustmentView),
  )
}

function cleanAdjustment(input: AdjustmentInput, base: AdjustmentRecord | null): Partial<AdjustmentRecord> {
  const out: Partial<AdjustmentRecord> = {}
  if (input.kind !== undefined) {
    if (!ADJUSTMENT_KINDS.includes(input.kind as AdjustmentKind)) bad('Pick allowance, bonus or deduction.')
    out.kind = input.kind
  }
  if (input.label !== undefined) {
    const l = String(input.label ?? '').trim()
    if (!l || l.length > 80) bad('Give the adjustment a label (80 characters max).')
    out.label = l
  }
  if (input.amount !== undefined) {
    const n = Number(input.amount)
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) bad('The amount must be positive.')
    out.amount = r2(n)
  }
  if (input.recurrence !== undefined) {
    if (input.recurrence !== 'once' && input.recurrence !== 'monthly') bad('One-off or monthly?')
    out.recurrence = input.recurrence
  }
  if (input.month !== undefined) {
    if (!monthOk(input.month)) bad('Pick the month (yyyy-MM).')
    out.month = input.month
  }
  if (input.endMonth !== undefined) {
    if (input.endMonth !== null && input.endMonth !== '' && !monthOk(input.endMonth)) bad('The end month is not valid (yyyy-MM).')
    out.endMonth = input.endMonth || null
  }
  if (input.notes !== undefined) out.notes = String(input.notes ?? '').slice(0, 500)
  const merged = { ...(base ?? {}), ...out }
  if (merged.recurrence === 'once') out.endMonth = null
  if (merged.endMonth && merged.month && merged.endMonth < merged.month) bad('The end month is before the start month.')
  return out
}

const latestPaidMonth = (co: string) =>
  hrPayrollRuns
    .filter((r) => r.companyId === co && r.status === 'paid')
    .map((r) => r.month)
    .sort()
    .slice(-1)[0] ?? null

export async function createAdjustment(user: User, input: AdjustmentInput | null): Promise<PayAdjustment> {
  const e = fullEmployee(user, input?.employeeId)
  const co = e.companyId
  const i = input ?? {}
  if (!i.kind || !i.label || i.amount === undefined || !i.month) bad('Kind, label, amount and month are required.')
  const v = cleanAdjustment({ recurrence: 'once', ...i }, null)
  const paid = latestPaidMonth(co)
  if (paid && v.month! <= paid && v.recurrence === 'once') bad(`${monthLabel(paid)} is already paid: put the correction in a later month.`, 'month_paid')
  const a: Tenant<AdjustmentRecord> = {
    companyId: co,
    id: nextPayId('PADJ-', hrPayAdjustments.map((x) => x.id)),
    employeeId: e.id,
    kind: v.kind!,
    label: v.label!,
    amount: v.amount!,
    recurrence: v.recurrence ?? 'once',
    month: v.month!,
    endMonth: v.endMonth ?? null,
    notes: v.notes ?? '',
    paidRunIds: [],
    createdAt: nowIso(),
    createdBy: user.id,
  }
  hrPayAdjustments.push(a)
  logHr(co, e.id, user, 'payroll', `${a.kind === 'deduction' ? 'Deduction' : a.kind === 'bonus' ? 'Bonus' : 'Allowance'} "${a.label}" added (${a.recurrence === 'monthly' ? 'monthly' : 'one-off'} from ${a.month})`)
  return delay(adjustmentView(a))
}

/**
 * An adjustment created by another section (Accounts & finance › Commissions), no HR session needed. Idempotent per
 * `sourceRef`: the existing one is returned (amount / label refreshed while it's unpaid). One-off, in `month` or — when
 * that month is already paid — the month after the latest paid run.
 */
export function upsertSystemAdjustment(
  co: string,
  input: { employeeId: string; kind: AdjustmentKind; label: string; amount: number; month: string; notes?: string; sourceRef: string },
  by: string | null,
): Tenant<AdjustmentRecord> {
  const found = hrPayAdjustments.find((a) => a.companyId === co && a.sourceRef === input.sourceRef)
  if (found) {
    if (!found.paidRunIds.length) Object.assign(found, { label: input.label.slice(0, 80), amount: r2(input.amount) })
    return found
  }
  if (!employeeById(co, input.employeeId)) return notFound()
  const paid = latestPaidMonth(co)
  const month = paid && input.month <= paid ? addMonths(paid, 1) : input.month
  const a: Tenant<AdjustmentRecord> = {
    companyId: co,
    id: nextPayId('PADJ-', hrPayAdjustments.map((x) => x.id)),
    employeeId: input.employeeId,
    kind: input.kind,
    label: input.label.slice(0, 80),
    amount: r2(input.amount),
    recurrence: 'once',
    month,
    endMonth: null,
    notes: (input.notes ?? '').slice(0, 500),
    paidRunIds: [],
    createdAt: nowIso(),
    createdBy: by,
    sourceRef: input.sourceRef,
  }
  hrPayAdjustments.push(a)
  return a
}

function ownAdjustment(user: User, id: string): Tenant<AdjustmentRecord> {
  assertHrFull(user)
  const a = hrPayAdjustments.find((x) => x.companyId === tenantOf(user) && x.id === id) ?? notFound()
  // An expense claim reimbursement belongs to its claim (Accounts & finance › Expenses): HR can't change or remove it.
  if (a.kind === 'reimbursement') conflict('This reimbursement comes from an approved expense claim: Accounts & finance manages it.', 'managed_by_finance')
  return a
}

export async function updateAdjustment(user: User, id: string, input: AdjustmentInput | null): Promise<PayAdjustment> {
  const a = ownAdjustment(user, id)
  const patch = { ...(input ?? {}) }
  delete patch.employeeId
  if (a.paidRunIds.length) {
    // A paid one-off is history; a recurring one can only be stopped (end month) after it has been paid.
    if (a.recurrence === 'once') conflict('This adjustment is in a paid run: add a correction in a later month instead.', 'run_locked')
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined)
    if (keys.some((k) => k !== 'endMonth' && k !== 'notes')) conflict('This monthly adjustment has been paid: you can only set its end month (or add a new one).', 'run_locked')
  }
  Object.assign(a, cleanAdjustment(patch, a))
  return delay(adjustmentView(a))
}

export async function deleteAdjustment(user: User, id: string): Promise<{ id: string }> {
  const a = ownAdjustment(user, id)
  if (a.paidRunIds.length) conflict('This adjustment is in a paid run and stays in the history. Set an end month instead.', 'run_locked')
  hrPayAdjustments.splice(hrPayAdjustments.indexOf(a), 1)
  return delay({ id: a.id })
}

/* ---------------- Loans ---------------- */

const repaidOf = (l: LoanRecord) => sum(l.repayments.map((r) => r.amount))

function loanView(l: Tenant<LoanRecord>): PayLoan {
  const { createdBy: _b, ...rest } = strip(l) // eslint-disable-line @typescript-eslint/no-unused-vars
  const repaid = repaidOf(l)
  return {
    ...rest,
    repayments: l.repayments.map((r) => ({ ...r })),
    employeeName: employeeById(l.companyId, l.employeeId)?.fullName ?? 'Unknown',
    repaid,
    remaining: l.status === 'cancelled' ? 0 : r2(l.principal - repaid),
    schedule: l.status === 'active' ? loanSchedule(l, l.repayments) : l.repayments.map((r) => ({ month: r.month, amount: r.amount, status: 'paid' as const })),
  }
}

export async function listLoans(user: User, q: { employeeId?: unknown; status?: unknown }): Promise<PayLoan[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  return delay(
    hrPayLoans
      .filter((l) => l.companyId === co && (!q.employeeId || l.employeeId === q.employeeId) && (!q.status || l.status === q.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(loanView),
  )
}

export async function createLoan(user: User, input: LoanInput | null): Promise<PayLoan> {
  const e = fullEmployee(user, input?.employeeId)
  const co = e.companyId
  const i = input ?? {}
  const principal = Number(i.principal)
  const installment = Number(i.installmentAmount)
  if (!Number.isFinite(principal) || principal <= 0 || principal > 5_000_000) bad('The amount must be positive.')
  if (!Number.isFinite(installment) || installment <= 0) bad('The monthly installment must be positive.')
  if (installment > principal) bad('The installment can’t be more than the amount.')
  if (!monthOk(i.startMonth)) bad('Pick the first deduction month (yyyy-MM).')
  const paid = latestPaidMonth(co)
  if (paid && i.startMonth! <= paid) bad(`${monthLabel(paid)} is already paid: start the deductions in a later month.`, 'month_paid')
  if (i.kind !== undefined && i.kind !== 'advance' && i.kind !== 'loan') bad('Advance or loan?')
  const l: Tenant<LoanRecord> = {
    companyId: co,
    id: nextPayId('PLN-', hrPayLoans.map((x) => x.id)),
    employeeId: e.id,
    kind: i.kind ?? 'loan',
    principal: r2(principal),
    installmentAmount: r2(installment),
    startMonth: i.startMonth!,
    reason: String(i.reason ?? '').trim().slice(0, 300),
    status: 'active',
    repayments: [],
    createdAt: nowIso(),
    createdBy: user.id,
  }
  hrPayLoans.push(l)
  logHr(co, e.id, user, 'payroll', `${l.kind === 'advance' ? 'Salary advance' : 'Loan'} of ${l.principal} ${settingsFor(co).currency} (${l.installmentAmount} a month from ${l.startMonth})`)
  emitPayroll({ type: 'loan_created', companyId: co, loanId: l.id, userId: user.id })
  return delay(loanView(l))
}

export async function updateLoan(user: User, id: string, input: LoanInput | null): Promise<PayLoan> {
  assertHrFull(user)
  const l = hrPayLoans.find((x) => x.companyId === tenantOf(user) && x.id === id) ?? notFound()
  const i = input ?? {}
  if (l.status !== 'active') conflict('This loan is closed.', 'loan_closed')
  if (i.status !== undefined) {
    if (i.status !== 'cancelled') bad('A loan can only be cancelled here (repayment happens in the payroll runs).')
    if (l.repayments.length) conflict('Part of this loan is repaid: it can’t be cancelled; change the installment instead.', 'loan_repaying')
    l.status = 'cancelled'
    emitPayroll({ type: 'loan_cancelled', companyId: l.companyId, loanId: l.id, userId: user.id })
  }
  if (i.installmentAmount !== undefined) {
    const n = Number(i.installmentAmount)
    if (!Number.isFinite(n) || n <= 0) bad('The monthly installment must be positive.')
    l.installmentAmount = r2(n)
  }
  if (i.reason !== undefined) l.reason = String(i.reason ?? '').trim().slice(0, 300)
  return delay(loanView(l))
}

/* ---------------- The engine ---------------- */

const leaving = (e: Employee) => e.status === 'terminated' || e.status === 'notice'

/** Employees a run of `month` pays: hired by the month end, not gone before it starts, not settled. */
function eligibleEmployees(co: string, month: string): Tenant<Employee>[] {
  const ps = monthStart(month)
  const pe = monthEnd(month)
  return employeesOf(co).filter((e) => {
    if (e.hireDate > pe) return false
    if (e.exitDate && e.exitDate < ps) return false
    if (e.status === 'terminated' && !e.exitDate) return false
    const fs = hrFinalSettlements.find((s) => s.companyId === co && s.employeeId === e.id)
    if (fs && pe >= (fs.unpaidSalaryFrom ?? fs.exitDate)) return false
    return true
  })
}

/** Approved leave of an employee inside [from, to]: working days (half day 0.5), all types and unpaid only. */
function leaveIn(co: string, employeeId: string, from: string, to: string, weekend: readonly number[], holidays: Map<string, string>): { all: number; unpaid: number } {
  let all = 0
  let unpaid = 0
  for (const r of hrLeaveRequests) {
    if (r.companyId !== co || r.employeeId !== employeeId || r.status !== 'approved' || r.endDate < from || r.startDate > to) continue
    const a = r.startDate < from ? from : r.startDate
    const b = r.endDate > to ? to : r.endDate
    const days = leaveDayCount(a, b, r.halfDay, weekend, holidays).days
    all += days
    const type = hrLeaveTypes.find((t) => t.companyId === co && t.id === r.leaveTypeId)
    if (type && !type.isPaid) unpaid += days
  }
  return { all: Math.round(all * 2) / 2, unpaid: Math.round(unpaid * 2) / 2 }
}

function firstAttendance(co: string, employeeId: string): string | null {
  let first: string | null = null
  for (const a of hrAttendance) if (a.companyId === co && a.employeeId === employeeId && (!first || a.workDate < first)) first = a.workDate
  return first
}

const warn = (code: WarningCode, message: string): LineWarning => ({ code, message, acknowledged: false })

/** One line, from live data. `prev` keeps the line id and the acknowledged warnings of a re-calculation. */
function buildLine(co: string, run: PayrollRunRecord, e: Tenant<Employee>, prev: PayLineRecord | undefined, ctx: HrCtx, holidays: Map<string, string>, s: PaySettingsRecord, ids: () => string): PayLineRecord {
  const month = run.month
  const ps = monthStart(month)
  const pe = monthEnd(month)
  const contract = payContract(co, e.id, ps, pe)
  let window: { start: string; end: string } | null = null
  if (contract) {
    const start = [ps, e.hireDate, contract.startDate].sort().slice(-1)[0]
    const end = [pe, e.exitDate ?? pe, contract.endDate ?? pe].sort()[0]
    window = start <= end ? { start, end } : null
  }
  const leave = window ? leaveIn(co, e.id, window.start, window.end, ctx.weekend, holidays) : { all: 0, unpaid: 0 }
  let absence = 0
  let overtimeMinutes = 0
  const yesterday = addDays(ctx.today, -1)
  const cutoff = s.cutoffDay >= daysInMonth(month) ? pe : `${month}-${String(s.cutoffDay).padStart(2, '0')}`
  const tracked = firstAttendance(co, e.id)
  if (window && tracked && (s.deductAbsences || s.overtimeEnabled)) {
    const from = [window.start, tracked].sort().slice(-1)[0]
    const to = [window.end, cutoff, yesterday].sort()[0]
    if (from <= to) {
      const days = daysOf(ctx, e, datesBetween(from, to))
      if (s.deductAbsences) absence = days.filter((d) => d.status === 'absent' && !d.inProgress).length
      if (s.overtimeEnabled) overtimeMinutes = days.reduce((t, d) => t + d.overtimeMinutes, 0)
    }
  }
  const adjustments = window ? adjustmentsFor(co, e.id, month) : []
  const loans = window
    ? hrPayLoans
        .filter((l) => l.companyId === co && l.employeeId === e.id && l.status === 'active')
        .map((l) => ({ l, amount: installmentDue(l, repaidOf(l), month) }))
        .filter((x) => x.amount > 0)
    : []
  const calc = computeLine({
    month,
    window,
    contract: contract ? { basic: contract.basicSalary, housing: contract.housingAllowance, transport: contract.transportAllowance, other: contract.otherAllowance } : null,
    unpaidLeaveDays: leave.unpaid,
    absenceDays: absence,
    overtimeMinutes,
    overtime: { enabled: s.overtimeEnabled, multiplier: s.overtimeMultiplier },
    national: isNational(s.country, e.nationality),
    si: s.socialInsurance,
    adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, amount: a.amount })),
    loans: loans.map(({ l, amount }) => ({ id: l.id, label: l.kind === 'advance' ? 'Salary advance repayment' : 'Loan repayment', amount })),
  })
  const p = peekProfile(co, e.id)
  const payMethod: PayMethod = p?.payMethod ?? 'bank'
  const bank = bankOf(co, e.id)
  const warnings: LineWarning[] = []
  if (!contract) warnings.push(warn('no_contract', `${e.fullName} has no active contract: nothing is paid.`))
  if (payMethod === 'bank' && !bank?.iban) warnings.push(warn('no_iban', `${e.fullName} is paid by bank transfer but has no IBAN.`))
  if (payMethod === 'bank' && !p?.personId) warnings.push(warn('no_person_id', `${e.fullName} has no ${s.country === 'SA' ? 'national id / iqama number' : 'WPS person id'}: the bank file leaves them out.`))
  if (calc.net < 0) warnings.push(warn('negative_net', `The net pay of ${e.fullName} is negative (${calc.net}).`))
  for (const w of warnings) w.acknowledged = !!prev?.warnings.some((x) => x.code === w.code && x.acknowledged)
  return {
    id: prev?.id ?? ids(),
    employeeId: e.id,
    employeeName: e.fullName,
    employeeNo: e.employeeNo,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    departmentName: deptName(co, e.departmentId),
    nationality: e.nationality,
    contractId: contract?.id ?? null,
    payMethod,
    bankName: bank?.bankName ?? '',
    ibanMasked: maskLast4(bank?.iban),
    payStart: window?.start ?? null,
    payEnd: window?.end ?? null,
    daysInMonth: calc.daysInMonth,
    paidDays: calc.paidDays,
    unpaidLeaveDays: leave.unpaid,
    absenceDays: absence,
    leaveDays: leave.all,
    overtimeHours: calc.overtimeHours,
    items: calc.items,
    basic: calc.basic,
    housing: calc.housing,
    gross: calc.gross,
    totalDeductions: calc.totalDeductions,
    net: calc.net,
    employeeSocialInsurance: calc.employeeSocialInsurance,
    employerSocialInsurance: calc.employerSocialInsurance,
    employerCost: calc.employerCost,
    fixedPay: calc.fixedPay,
    variablePay: calc.variablePay,
    warnings,
    adjustmentIds: adjustments.map((a) => a.id),
    loanInstallments: loans.map(({ l, amount }) => ({ loanId: l.id, amount })),
    notifiedAt: null,
  }
}

/** Re-computes every line of the run (keeps line ids and acknowledged warnings). */
function calculateLines(run: Tenant<PayrollRunRecord>, today?: string): void {
  const co = run.companyId
  const s = settingsFor(co)
  const ctx = timeCtx(co, today)
  const holidays = holidayMap(co)
  const prev = new Map(run.lines.map((l) => [l.employeeId, l]))
  const taken = new Set(allLineIds())
  const ids = () => {
    const id = nextPayId('PSL-', taken)
    taken.add(id)
    return id
  }
  run.lines = eligibleEmployees(co, run.month)
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
    .map((e) => buildLine(co, run, e, prev.get(e.id), ctx, holidays, s, ids))
  run.currency = s.currency
}

/* ---------------- Runs ---------------- */

function totalsOf(lines: readonly PayLineRecord[]): RunTotals {
  return {
    headcount: lines.filter((l) => l.paidDays > 0).length,
    gross: sum(lines.map((l) => l.gross)),
    deductions: sum(lines.map((l) => l.totalDeductions)),
    net: sum(lines.map((l) => l.net)),
    employerSocialInsurance: sum(lines.map((l) => l.employerSocialInsurance)),
    employerCost: sum(lines.map((l) => l.employerCost)),
  }
}
const openWarnings = (r: PayrollRunRecord) => r.lines.reduce((n, l) => n + l.warnings.filter((w) => !w.acknowledged).length, 0)

function runRow(r: Tenant<PayrollRunRecord>): PayrollRunRow {
  const co = r.companyId
  return {
    id: r.id,
    month: r.month,
    status: r.status,
    currency: r.currency,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payDate: r.payDate,
    totals: totalsOf(r.lines),
    openWarnings: openWarnings(r),
    calculatedAt: r.calculatedAt,
    calculatedByName: nameOfUser(co, r.calculatedBy),
    approvedAt: r.approvedAt,
    approvedByName: nameOfUser(co, r.approvedBy),
    paidAt: r.paidAt,
    paidByName: nameOfUser(co, r.paidBy),
    createdAt: r.createdAt,
  }
}

function lineView(runId: string, l: PayLineRecord): PayLine {
  const { adjustmentIds: _a, loanInstallments: _l, notifiedAt: _n, ...rest } = l // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, runId, items: l.items.map((i) => ({ ...i })), warnings: l.warnings.map((w) => ({ ...w })) }
}

function approveBlock(user: User, r: PayrollRunRecord): string | null {
  if (r.status !== 'calculated') return r.status === 'draft' ? 'Calculate the run first.' : null
  if (r.calculatedBy === user.id) return 'Maker–checker: the run must be approved by another HR user than the one who calculated it.'
  const open = openWarnings(r)
  if (open) return `${open} warning${open === 1 ? '' : 's'} to resolve or acknowledge first.`
  return null
}

function runDetail(user: User, r: Tenant<PayrollRunRecord>): PayrollRunDetail {
  const blocked = approveBlock(user, r)
  return {
    ...runRow(r),
    lines: r.lines.map((l) => lineView(r.id, l)),
    calculatedBy: r.calculatedBy,
    canCalculate: r.status === 'draft' || r.status === 'calculated',
    canApprove: r.status === 'calculated' && !blocked,
    approveBlockedReason: r.status === 'calculated' ? blocked : null,
    canPay: r.status === 'approved' && !earlierUnpaid(r),
    canReopen: r.status === 'calculated' || r.status === 'approved',
    canExport: r.status === 'approved' || r.status === 'paid',
    exports: r.exports.map((x) => ({ at: x.at, byName: nameOfUser(r.companyId, x.by) ?? 'Unknown', format: x.format, count: x.count })),
    notes: r.notes,
  }
}

const earlierUnpaid = (r: Tenant<PayrollRunRecord>) => hrPayrollRuns.find((x) => x.companyId === r.companyId && x.month < r.month && x.status !== 'paid')

export async function listRuns(user: User): Promise<PayrollRunRow[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  return delay(hrPayrollRuns.filter((r) => r.companyId === co).sort((a, b) => b.month.localeCompare(a.month)).map(runRow))
}

function ownRun(user: User, id: string): Tenant<PayrollRunRecord> {
  hrAccessOf(user)
  const r = hrPayrollRuns.find((x) => x.companyId === tenantOf(user) && x.id === id)
  if (!r) return notFound()
  assertHrFull(user)
  return r
}

export async function getRun(user: User, id: string): Promise<PayrollRunDetail> {
  return delay(runDetail(user, ownRun(user, id)))
}

function payDateOf(month: string, payDay: number): string {
  return `${month}-${String(Math.min(payDay, daysInMonth(month))).padStart(2, '0')}`
}

export function newRun(co: string, month: string, by: string | null, at = nowIso()): Tenant<PayrollRunRecord> {
  const s = settingsFor(co)
  const r: Tenant<PayrollRunRecord> = {
    companyId: co,
    id: nextPayId('PR-', hrPayrollRuns.map((x) => x.id)),
    month,
    status: 'draft',
    currency: s.currency,
    periodStart: monthStart(month),
    periodEnd: monthEnd(month),
    payDate: payDateOf(month, s.payDay),
    lines: [],
    calculatedAt: null,
    calculatedBy: null,
    approvedAt: null,
    approvedBy: null,
    paidAt: null,
    paidBy: null,
    notes: '',
    alertMarks: [],
    exports: [],
    createdAt: at,
    createdBy: by,
  }
  hrPayrollRuns.push(r)
  return r
}

export async function createRun(user: User, input: { month?: unknown; notes?: unknown } | null): Promise<PayrollRunDetail> {
  assertHrFull(user)
  const co = tenantOf(user)
  const month = input?.month
  if (!monthOk(month)) return bad('Pick the month (yyyy-MM).')
  const next = addMonths(todayOf(co).slice(0, 7), 1)
  if (month > next) bad('A run can be prepared for the current or the next month at the latest.')
  if (hrPayrollRuns.some((r) => r.companyId === co && r.month === month)) conflict(`There is already a run for ${monthLabel(month)}.`, 'run_exists')
  const paid = latestPaidMonth(co)
  if (paid && month < paid) bad(`${monthLabel(paid)} is already paid: corrections for earlier months go into the next run as adjustments.`, 'month_paid')
  const r = newRun(co, month, user.id)
  r.notes = typeof input?.notes === 'string' ? input.notes.slice(0, 500) : ''
  return delay(runDetail(user, r))
}

function notifyApprovers(r: Tenant<PayrollRunRecord>, by: User): void {
  if (r.alertMarks.includes('awaiting')) return
  const t = totalsOf(r.lines)
  for (const u of hrFullUsers(r.companyId)) {
    if (u.id === by.id) continue
    pushNotification({ companyId: r.companyId, userId: u.id, type: PAYROLL_ALERT_TYPE, title: `Payroll ${monthLabel(r.month)} awaits your approval`, body: `${t.headcount} employees · net ${t.net.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${r.currency} · calculated by ${by.name}`, link: `${PAYROLL_LINK}?run=${encodeURIComponent(r.id)}`, at: nowIso() })
  }
  r.alertMarks.push('awaiting')
}

export async function calculateRun(user: User, id: string): Promise<PayrollRunDetail> {
  const r = ownRun(user, id)
  if (r.status === 'approved' || r.status === 'paid') conflict(r.status === 'paid' ? 'This run is paid and locked.' : 'This run is approved: reopen it to recalculate.', 'run_locked')
  calculateLines(r)
  r.status = 'calculated'
  r.calculatedAt = nowIso()
  r.calculatedBy = user.id
  notifyApprovers(r, user)
  return delay(runDetail(user, r))
}

export async function acknowledgeWarnings(user: User, id: string, input: { warnings?: unknown; all?: unknown } | null): Promise<PayrollRunDetail> {
  const r = ownRun(user, id)
  if (r.status !== 'calculated') conflict('Warnings are acknowledged on a calculated run.', 'run_not_calculated')
  const list = Array.isArray(input?.warnings) ? (input!.warnings as { employeeId?: unknown; code?: unknown }[]) : []
  let n = 0
  for (const l of r.lines) {
    for (const w of l.warnings) {
      if (w.acknowledged) continue
      if (input?.all === true || list.some((x) => x && x.employeeId === l.employeeId && x.code === w.code)) {
        w.acknowledged = true
        n++
      }
    }
  }
  if (!n && input?.all !== true) bad('Name the warnings to acknowledge (employee and code).')
  return delay(runDetail(user, r))
}

export async function approveRun(user: User, id: string): Promise<PayrollRunDetail> {
  const r = ownRun(user, id)
  if (r.status !== 'calculated') conflict(r.status === 'draft' ? 'Calculate the run first.' : `This run is already ${r.status}.`, 'run_not_calculated')
  if (r.calculatedBy === user.id) throw new CodedApiError('Maker–checker: another HR user (Company Admin, Management or HR Manager) must approve the run you calculated.', 403, 'maker_checker')
  const open = openWarnings(r)
  if (open) conflict(`${open} warning${open === 1 ? '' : 's'} to resolve (fix and recalculate) or acknowledge first.`, 'unresolved_warnings')
  r.status = 'approved'
  r.approvedAt = nowIso()
  r.approvedBy = user.id
  recordAudit(user, { action: 'update', entity: 'payroll_run', entityId: r.id, summary: `Approved the payroll of ${monthLabel(r.month)}`, changes: [] })
  emitPayroll({ type: 'run_approved', companyId: r.companyId, runId: r.id, userId: user.id })
  return delay(runDetail(user, r))
}

export async function reopenRun(user: User, id: string): Promise<PayrollRunDetail> {
  const r = ownRun(user, id)
  if (r.status === 'paid') conflict('A paid run is locked: corrections go into the next run as adjustments.', 'run_locked')
  if (r.status === 'draft') conflict('The run is already a draft.', 'run_draft')
  r.status = 'draft'
  r.approvedAt = null
  r.approvedBy = null
  r.alertMarks = r.alertMarks.filter((m) => m !== 'awaiting')
  emitPayroll({ type: 'run_reopened', companyId: r.companyId, runId: r.id, userId: user.id })
  return delay(runDetail(user, r))
}

/** Applies a paid run: loan repayments, paid adjustments, payslip notifications (each once). */
function applyPaid(r: Tenant<PayrollRunRecord>, notify: boolean): void {
  const co = r.companyId
  for (const l of r.lines) {
    for (const inst of l.loanInstallments) {
      const loan = hrPayLoans.find((x) => x.companyId === co && x.id === inst.loanId)
      if (!loan || loan.status !== 'active' || loan.repayments.some((x) => x.runId === r.id)) continue
      const amount = r2(Math.min(inst.amount, loan.principal - repaidOf(loan)))
      if (amount > 0) loan.repayments.push({ runId: r.id, month: r.month, amount, source: 'run' })
      if (repaidOf(loan) >= loan.principal) loan.status = 'repaid'
    }
    for (const id of l.adjustmentIds) {
      const a = hrPayAdjustments.find((x) => x.companyId === co && x.id === id)
      if (a && !a.paidRunIds.includes(r.id)) a.paidRunIds.push(r.id)
    }
    if (l.notifiedAt) continue
    const e = employeeById(co, l.employeeId)
    const u = e?.userId ? users.find((x) => x.id === e.userId && x.companyId === co && x.active) : undefined
    if (notify && u && l.paidDays > 0) {
      pushNotification({ companyId: co, userId: u.id, type: PAYROLL_ALERT_TYPE, title: `Your payslip for ${monthLabel(r.month)} is available`, body: `Net pay ${l.net.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${r.currency}`, link: `${PAYROLL_LINK}?tab=payslips&payslip=${encodeURIComponent(l.id)}`, at: r.paidAt ?? nowIso() })
    }
    l.notifiedAt = r.paidAt ?? nowIso()
  }
}

export async function payRun(user: User, id: string): Promise<PayrollRunDetail> {
  const r = ownRun(user, id)
  if (r.status !== 'approved') conflict(r.status === 'paid' ? 'This run is already paid.' : 'Only an approved run can be marked paid.', 'run_not_approved')
  const earlier = earlierUnpaid(r)
  if (earlier) conflict(`Pay ${monthLabel(earlier.month)} first.`, 'earlier_run_unpaid')
  r.status = 'paid'
  r.paidAt = nowIso()
  r.paidBy = user.id
  applyPaid(r, true)
  recordAudit(user, { action: 'update', entity: 'payroll_run', entityId: r.id, summary: `Marked the payroll of ${monthLabel(r.month)} paid`, changes: [] })
  emitPayroll({ type: 'run_paid', companyId: r.companyId, runId: r.id, userId: user.id })
  return delay(runDetail(user, r))
}

export async function deleteRun(user: User, id: string): Promise<{ id: string }> {
  const r = ownRun(user, id)
  if (r.status === 'approved' || r.status === 'paid') conflict('Only a draft or calculated run can be deleted.', 'run_locked')
  hrPayrollRuns.splice(hrPayrollRuns.indexOf(r), 1)
  return delay({ id: r.id })
}

/* ---------------- Bank files ---------------- */

/**
 * POST /hr/payroll/runs/:id/bank-file { format: wps | mudad } — HR full, approved or paid run. The answer IS the
 * file (full IBANs and ids): it is never a GET and never part of a list; every export is audit-logged.
 */
export async function exportBankFile(user: User, id: string, input: { format?: unknown } | null): Promise<BankFile> {
  const r = ownRun(user, id)
  const co = r.companyId
  const s = settingsFor(co)
  const format = input?.format as BankFileFormat
  if (format !== 'wps' && format !== 'mudad') return bad('Pick the file format: wps (UAE) or mudad (KSA).')
  if (r.status !== 'approved' && r.status !== 'paid') conflict('Approve the run before exporting the bank file.', 'run_not_approved')
  if (format === 'wps' && s.country !== 'AE') bad('The WPS SIF file is for UAE companies; use Mudad.')
  if (format === 'mudad' && s.country !== 'SA') bad('The Mudad file is for KSA companies; use WPS.')
  if (format === 'wps' && (!/^\d{13}$/.test(s.wpsEmployerId) || !/^\d{9}$/.test(s.wpsRoutingCode))) bad('Set the WPS employer id and routing code in the pay settings first.', 'settings_incomplete')
  if (format === 'mudad' && !s.mudadEstablishmentNo) bad('Set the Mudad establishment number in the pay settings first.', 'settings_incomplete')
  const skipped: BankFile['skipped'] = []
  const ready = r.lines.flatMap((l) => {
    const p = peekProfile(co, l.employeeId)
    const iban = bankOf(co, l.employeeId)?.iban ?? ''
    const reason = l.payMethod !== 'bank' ? `Paid by ${l.payMethod}` : l.net <= 0 ? 'Nothing to pay' : !iban ? 'No IBAN' : !p?.personId ? (s.country === 'SA' ? 'No national id / iqama' : 'No WPS person id') : null
    if (reason) {
      skipped.push({ employeeId: l.employeeId, employeeName: l.employeeName, reason })
      return []
    }
    return [{ l, iban, personId: p!.personId, routing: p!.bankRoutingCode || s.wpsRoutingCode }]
  })
  const local = zonedParts(clockNow(), regionOf(co).timezone)
  const file =
    format === 'wps'
      ? buildSif({
          employerId: s.wpsEmployerId,
          routingCode: s.wpsRoutingCode,
          localDate: local.date,
          localTime: `${local.time}:${String(clockNow().getUTCSeconds()).padStart(2, '0')}`,
          month: r.month,
          reference: r.id,
          lines: ready.map(({ l, iban, personId, routing }) => ({ personId, routingCode: routing, iban, payStart: l.payStart!, payEnd: l.payEnd!, days: l.paidDays, fixed: l.fixedPay, variable: l.variablePay, leaveDays: l.leaveDays })),
        })
      : buildMudadCsv(
          s.mudadEstablishmentNo,
          r.month,
          ready.map(({ l, iban, personId }) => {
            const earn = (code: string) => l.items.find((i) => i.code === code)?.amount ?? 0
            return { personId, name: l.employeeName, bank: l.bankName, iban, basic: earn('basic'), housing: earn('housing'), otherAllowances: r2(l.gross - earn('basic') - earn('housing')), deductions: l.totalDeductions, net: l.net }
          }),
        )
  const at = nowIso()
  r.exports.push({ at, by: user.id, format, count: ready.length })
  recordAudit(user, { action: 'security', entity: 'payroll_run', entityId: r.id, summary: `Exported the ${format === 'wps' ? 'WPS SIF' : 'Mudad'} file of ${monthLabel(r.month)} (${ready.length} employees, full bank details)`, changes: [] })
  return delay({ format, fileName: file.fileName, mimeType: format === 'wps' ? 'text/plain' : 'text/csv', content: file.content, count: ready.length, total: file.total, skipped })
}

/* ---------------- Payslips ---------------- */

/** Payslips the caller may see: HR full every paid line; everyone else (team / own) only their own. */
function visiblePayslipLines(user: User): { r: Tenant<PayrollRunRecord>; l: PayLineRecord }[] {
  const access = hrAccessOf(user)
  const co = tenantOf(user)
  const me = hrEmployees.find((e) => e.companyId === co && e.userId === user.id)
  if (access === 'full') return paidLines(co, null)
  return me ? paidLines(co, me.id) : []
}

/** Paid payslip lines of a company (one employee's when `employeeId` is set). No scope check: the caller decides. */
function paidLines(co: string, employeeId: string | null): { r: Tenant<PayrollRunRecord>; l: PayLineRecord }[] {
  const out: { r: Tenant<PayrollRunRecord>; l: PayLineRecord }[] = []
  for (const r of hrPayrollRuns) {
    if (r.companyId !== co || r.status !== 'paid') continue
    for (const l of r.lines) if (l.paidDays > 0 && (employeeId === null || l.employeeId === employeeId)) out.push({ r, l })
  }
  return out
}

/** Self-service portal (GET /hr/me): one employee's own paid payslips, newest first, whatever their hr scope. */
export function ownPayslipRows(co: string, employeeId: string): PayslipRow[] {
  return paidLines(co, employeeId)
    .sort((a, b) => b.r.month.localeCompare(a.r.month))
    .map(({ r, l }) => payslipRow(r, l))
}

/** Self-service portal (GET /hr/me/payslips/:id): one of the employee's own paid payslips, or 404. */
export async function ownPayslip(co: string, employeeId: string, id: string): Promise<Payslip> {
  const hit = paidLines(co, employeeId).find(({ l }) => l.id === id)
  if (!hit) return notFound()
  return delay(payslipOf(hit.r, hit.l))
}

function payslipRow(r: Tenant<PayrollRunRecord>, l: PayLineRecord): PayslipRow {
  return { id: l.id, runId: r.id, month: r.month, employeeId: l.employeeId, employeeName: l.employeeName, employeeNo: l.employeeNo, departmentName: l.departmentName, gross: l.gross, totalDeductions: l.totalDeductions, net: l.net, currency: r.currency, payDate: r.payDate, paidAt: r.paidAt }
}

export async function listPayslips(user: User, q: { employeeId?: unknown; month?: unknown }): Promise<PayslipRow[]> {
  return delay(
    visiblePayslipLines(user)
      .filter(({ l, r }) => (!q.employeeId || l.employeeId === q.employeeId) && (!monthOk(q.month) || r.month === q.month))
      .sort((a, b) => b.r.month.localeCompare(a.r.month) || a.l.employeeNo.localeCompare(b.l.employeeNo))
      .map(({ r, l }) => payslipRow(r, l)),
  )
}

export async function getPayslip(user: User, id: string): Promise<Payslip> {
  const hit = visiblePayslipLines(user).find(({ l }) => l.id === id)
  if (!hit) return notFound()
  return delay(payslipOf(hit.r, hit.l))
}

function payslipOf(r: Tenant<PayrollRunRecord>, l: PayLineRecord): Payslip {
  const c = companyById(r.companyId)
  return {
    ...payslipRow(r, l),
    company: { name: c?.name ?? '', country: c?.regional.country ?? '' },
    jobTitle: l.jobTitle,
    nationality: l.nationality,
    payMethod: l.payMethod,
    bankName: l.bankName,
    ibanMasked: l.ibanMasked,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payStart: l.payStart,
    payEnd: l.payEnd,
    daysInMonth: l.daysInMonth,
    paidDays: l.paidDays,
    unpaidLeaveDays: l.unpaidLeaveDays,
    absenceDays: l.absenceDays,
    overtimeHours: l.overtimeHours,
    items: l.items.filter((i) => i.type !== 'employer').map((i) => ({ ...i })),
    employerSocialInsurance: l.employerSocialInsurance,
  }
}

/* ---------------- Summary ---------------- */

export async function getSummary(user: User, q: { months?: unknown }): Promise<PayrollSummary> {
  assertHrFull(user)
  const co = tenantOf(user)
  const n = Math.min(24, Math.max(1, Number(q.months) || 12))
  const runs = hrPayrollRuns
    .filter((r) => r.companyId === co && (r.status === 'paid' || r.status === 'approved'))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, n)
    .reverse()
  const depts = new Map<string, PayrollSummary['departments'][number]>()
  for (const r of runs) {
    for (const l of r.lines) {
      const key = l.departmentId ?? '—'
      let d = depts.get(key)
      if (!d) {
        d = { departmentId: l.departmentId, departmentName: l.departmentName ?? 'No department', byMonth: {}, total: 0, headcount: 0 }
        depts.set(key, d)
      }
      d.byMonth[r.month] = r2((d.byMonth[r.month] ?? 0) + l.employerCost)
      d.total = r2(d.total + l.employerCost)
    }
  }
  const latest = runs[runs.length - 1]
  if (latest) for (const l of latest.lines) if (l.paidDays > 0) depts.get(l.departmentId ?? '—')!.headcount++
  const months = runs.map((r) => {
    const t = totalsOf(r.lines)
    return { month: r.month, runId: r.id, status: r.status, headcount: t.headcount, gross: t.gross, deductions: t.deductions, net: t.net, employerCost: t.employerCost }
  })
  return delay({
    currency: settingsFor(co).currency,
    months,
    departments: [...depts.values()].sort((a, b) => b.total - a.total),
    totals: { gross: sum(months.map((m) => m.gross)), deductions: sum(months.map((m) => m.deductions)), net: sum(months.map((m) => m.net)), employerCost: sum(months.map((m) => m.employerCost)), headcountLatest: months[months.length - 1]?.headcount ?? 0 },
  })
}

/* ---------------- Final settlement ---------------- */

interface SettlementCalc extends Omit<SettlementRecord, 'id' | 'status' | 'notes' | 'createdAt' | 'createdBy' | 'paidAt' | 'paidBy'> {
  companyId: string
}

function cleanSettlementAdjustments(v: unknown): SettlementAdjustment[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > 20) return bad('Adjustments are a list (20 at most).')
  return v.map((x) => {
    const label = String((x as SettlementAdjustment)?.label ?? '').trim()
    const amount = Number((x as SettlementAdjustment)?.amount)
    if (!label || label.length > 80) bad('Every adjustment needs a label.')
    if (!Number.isFinite(amount) || Math.abs(amount) > 5_000_000 || amount === 0) bad('Every adjustment needs a non-zero amount (negative deducts).')
    return { label, amount: r2(amount) }
  })
}

/** Salary still owed from the day after the last paid run through the exit date (calendar-day proration). */
function unpaidSalary(co: string, e: Employee, exitDate: string, c: ContractRecord): { from: string | null; days: number; amount: number } {
  let lastEnd: string | null = null
  for (const r of hrPayrollRuns) {
    if (r.companyId !== co || r.status !== 'paid') continue
    const l = r.lines.find((x) => x.employeeId === e.id && x.payEnd)
    if (l && (!lastEnd || l.payEnd! > lastEnd)) lastEnd = l.payEnd
  }
  const from = lastEnd ? addDays(lastEnd, 1) : e.hireDate
  if (from > exitDate) return { from: null, days: 0, amount: 0 }
  const monthly = c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance
  let amount = 0
  let days = 0
  for (let m = from.slice(0, 7); m <= exitDate.slice(0, 7); m = addMonths(m, 1)) {
    const a = from > monthStart(m) ? from : monthStart(m)
    const b = exitDate < monthEnd(m) ? exitDate : monthEnd(m)
    const n = inclusiveDays(a, b)
    days += n
    amount += r2((monthly * n) / daysInMonth(m))
  }
  return { from, days, amount: r2(amount) }
}

function computeSettlement(co: string, e: Tenant<Employee>, reason: ExitReason, exitDate: string, adjustments: SettlementAdjustment[]): SettlementCalc {
  const s = settingsFor(co)
  const c = payContract(co, e.id) ?? hrContracts.filter((x) => x.companyId === co && x.employeeId === e.id).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  if (!c) return bad(`${e.fullName} has no contract: the settlement needs the basic salary.`, 'no_contract')
  const r = regionOf(co)
  const holidays = holidayMap(co)
  const unpaidLeave = leaveIn(co, e.id, e.hireDate, exitDate, r.weekend, holidays).unpaid
  const g = gratuity({ country: s.country, reason, basic: c.basicSalary, housing: c.housingAllowance, startDate: e.hireDate, endDate: exitDate, unpaidLeaveDays: unpaidLeave, basis: s.gratuityBasis })
  const owed = unpaidSalary(co, e, exitDate, c)
  const annual = hrLeaveTypes.find((t) => t.companyId === co && t.code === 'annual' && t.isActive)
  const leaveDays = annual ? Math.max(0, balanceOf(timeCtx(co, exitDate), e, annual, Number(exitDate.slice(0, 4))).remainingDays) : 0
  const leaveWage = s.country === 'SA' && s.gratuityBasis === 'basic_housing' ? c.basicSalary + c.housingAllowance : c.basicSalary
  const leaveEncashment = r2((leaveDays * leaveWage * 12) / 365)
  const loanBalance = sum(hrPayLoans.filter((l) => l.companyId === co && l.employeeId === e.id && l.status === 'active').map((l) => l.principal - repaidOf(l)))
  const total = r2(g.amount + owed.amount + leaveEncashment - loanBalance + sum(adjustments.map((a) => a.amount)))
  return {
    companyId: co,
    employeeId: e.id,
    exitDate,
    reason,
    currency: s.currency,
    basicSalary: c.basicSalary,
    housingAllowance: c.housingAllowance,
    gratuity: g,
    unpaidSalaryFrom: owed.from,
    unpaidSalaryDays: owed.days,
    unpaidSalary: owed.amount,
    leaveDays,
    leaveEncashment,
    loanBalance,
    adjustments,
    total,
  }
}

function settlementView(f: Omit<SettlementRecord, 'id' | 'status' | 'notes' | 'createdAt' | 'createdBy' | 'paidAt' | 'paidBy'> & Partial<SettlementRecord> & { companyId: string }): FinalSettlement {
  const e = employeeById(f.companyId, f.employeeId)
  return {
    id: f.id ?? '',
    employeeId: f.employeeId,
    employeeName: e?.fullName ?? 'Unknown',
    employeeNo: e?.employeeNo ?? '',
    hireDate: e?.hireDate ?? '',
    exitDate: f.exitDate,
    reason: f.reason,
    currency: f.currency,
    basicSalary: f.basicSalary,
    housingAllowance: f.housingAllowance,
    gratuity: { ...f.gratuity, explanation: [...f.gratuity.explanation] },
    unpaidSalaryFrom: f.unpaidSalaryFrom,
    unpaidSalaryDays: f.unpaidSalaryDays,
    unpaidSalary: f.unpaidSalary,
    leaveDays: f.leaveDays,
    leaveEncashment: f.leaveEncashment,
    loanBalance: f.loanBalance,
    adjustments: f.adjustments.map((a) => ({ ...a })),
    total: f.total,
    status: f.status ?? 'draft',
    notes: f.notes ?? '',
    createdAt: f.createdAt ?? '',
    createdByName: nameOfUser(f.companyId, f.createdBy ?? null),
    paidAt: f.paidAt ?? null,
    paidByName: nameOfUser(f.companyId, f.paidBy ?? null),
  }
}

function settlementInputs(e: Tenant<Employee>, input: SettlementInput, base: SettlementRecord | null) {
  const reason = (input.reason ?? base?.reason ?? 'resignation') as ExitReason
  if (!EXIT_REASONS.includes(reason)) bad('Pick the reason: resignation, termination or end of contract.')
  const exitDate = input.exitDate ?? base?.exitDate ?? e.exitDate
  if (!exitDate || !/^\d{4}-\d{2}-\d{2}$/.test(exitDate) || Number.isNaN(Date.parse(exitDate))) return bad('Set the exit date (last working day).') as never
  if (exitDate < e.hireDate) bad('The exit date is before the hire date.')
  const adjustments = input.adjustments !== undefined ? cleanSettlementAdjustments(input.adjustments) : (base?.adjustments ?? [])
  return { reason, exitDate, adjustments }
}

export async function previewSettlement(user: User, input: SettlementInput | null): Promise<FinalSettlement> {
  const e = fullEmployee(user, input?.employeeId)
  const i = settlementInputs(e, input ?? {}, null)
  return delay(settlementView(computeSettlement(e.companyId, e, i.reason, i.exitDate, i.adjustments)))
}

export async function listSettlements(user: User): Promise<FinalSettlement[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  return delay(hrFinalSettlements.filter((f) => f.companyId === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(settlementView))
}

export async function createSettlement(user: User, input: SettlementInput | null): Promise<FinalSettlement> {
  const e = fullEmployee(user, input?.employeeId)
  const co = e.companyId
  if (!leaving(e)) bad(`${e.fullName} is not leaving: set the status to Notice period or Left (with the exit date) first.`, 'not_leaving')
  if (hrFinalSettlements.some((f) => f.companyId === co && f.employeeId === e.id)) conflict(`${e.fullName} already has a final settlement.`, 'settlement_exists')
  const i = settlementInputs(e, input ?? {}, null)
  const calc = computeSettlement(co, e, i.reason, i.exitDate, i.adjustments)
  const f: Tenant<SettlementRecord> = { ...calc, id: nextPayId('PFS-', hrFinalSettlements.map((x) => x.id)), status: 'draft', notes: String(input?.notes ?? '').slice(0, 1000), createdAt: nowIso(), createdBy: user.id, paidAt: null, paidBy: null }
  hrFinalSettlements.push(f)
  logHr(co, e.id, user, 'payroll', `Final settlement ${f.id} prepared (${f.total} ${f.currency})`)
  return delay(settlementView(f))
}

function ownSettlement(user: User, id: string): Tenant<SettlementRecord> {
  hrAccessOf(user)
  const f = hrFinalSettlements.find((x) => x.companyId === tenantOf(user) && x.id === id)
  if (!f) return notFound()
  assertHrFull(user)
  return f
}

export async function getSettlement(user: User, id: string): Promise<FinalSettlement> {
  return delay(settlementView(ownSettlement(user, id)))
}

export async function updateSettlement(user: User, id: string, input: SettlementInput | null): Promise<FinalSettlement> {
  const f = ownSettlement(user, id)
  if (f.status === 'paid') conflict('This settlement is paid and locked.', 'settlement_paid')
  const e = employeeById(f.companyId, f.employeeId) ?? notFound()
  const i = settlementInputs(e, input ?? {}, f)
  Object.assign(f, computeSettlement(f.companyId, e, i.reason, i.exitDate, i.adjustments))
  if (input?.notes !== undefined) f.notes = String(input.notes ?? '').slice(0, 1000)
  return delay(settlementView(f))
}

export async function deleteSettlement(user: User, id: string): Promise<{ id: string }> {
  const f = ownSettlement(user, id)
  if (f.status === 'paid') conflict('This settlement is paid and locked.', 'settlement_paid')
  hrFinalSettlements.splice(hrFinalSettlements.indexOf(f), 1)
  return delay({ id: f.id })
}

/** POST /hr/payroll/settlements/:id/pay — recomputes, locks, settles the open loans, ticks the offboarding step. */
export async function paySettlement(user: User, id: string): Promise<FinalSettlement> {
  const f = ownSettlement(user, id)
  if (f.status === 'paid') conflict('This settlement is already paid.', 'settlement_paid')
  const e = employeeById(f.companyId, f.employeeId) ?? notFound()
  Object.assign(f, computeSettlement(f.companyId, e, f.reason, f.exitDate, f.adjustments))
  const now = nowIso()
  for (const l of hrPayLoans) {
    if (l.companyId !== f.companyId || l.employeeId !== e.id || l.status !== 'active') continue
    const left = r2(l.principal - repaidOf(l))
    if (left > 0) l.repayments.push({ runId: null, month: f.exitDate.slice(0, 7), amount: left, source: 'settlement' })
    l.status = 'settled'
  }
  f.status = 'paid'
  f.paidAt = now
  f.paidBy = user.id
  logHr(f.companyId, e.id, user, 'payroll', `Final settlement ${f.id} paid (${f.total} ${f.currency})`, now)
  recordAudit(user, { action: 'update', entity: 'final_settlement', entityId: f.id, summary: `Paid the final settlement of ${e.fullName}`, changes: [] })
  emitPayroll({ type: 'settlement_paid', companyId: f.companyId, settlementId: f.id, userId: user.id })
  return delay(settlementView(f))
}

/* ---------------- Seed ---------------- */

function luhnOk(digits: string): boolean {
  let s = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    s += d
    dbl = !dbl
  }
  return s % 10 === 0
}
/** A synthetic 14-digit WPS person id that never passes Luhn (so it can't be mistaken for a card number). */
function wpsPersonId(n: number): string {
  let id = `10${String(4_829_310_000 + n * 7_919).padStart(12, '0')}`
  if (luhnOk(id)) id = id.slice(0, -1) + String((Number(id.slice(-1)) + 1) % 10)
  return id
}

interface CompanySeed {
  joiner: { id: string; name: string; title: string; dept: string; manager: string; nationality: string; gender: 'male' | 'female'; iban: string; basic: number; day: number }
  unpaid: { emp: string; monthOffset: number; nth: number }
  noPersonId: string[]
  payMethods: Record<string, PayMethod>
  adjustments: { emp: string; kind: AdjustmentKind; label: string; amount: number; recurrence: 'once' | 'monthly'; offset: number }[]
  loan: { emp: string; kind: 'loan' | 'advance'; principal: number; installment: number; offset: number; reason: string }
  settings: Partial<PaySettingsRecord>
  maker: string
  checker: string
}

const SEEDS: Record<string, CompanySeed> = {
  [APEX_ID]: {
    joiner: { id: 'EMP-X4', name: 'Aisha Karimi', title: 'Project Coordinator', dept: 'd-delivery', manager: 'EMP-u10', nationality: 'AE', gender: 'female', iban: '', basic: 9000, day: 10 },
    unpaid: { emp: 'EMP-u6', monthOffset: 0, nth: 2 },
    noPersonId: ['EMP-X3'],
    payMethods: { 'EMP-X1': 'cash' },
    adjustments: [
      { emp: 'EMP-u10', kind: 'allowance', label: 'Mobile allowance', amount: 300, recurrence: 'monthly', offset: -3 },
      { emp: 'EMP-u5', kind: 'bonus', label: 'Q3 sales bonus', amount: 2500, recurrence: 'once', offset: -1 },
      { emp: 'EMP-u12', kind: 'deduction', label: 'Traffic fine (company car)', amount: 500, recurrence: 'once', offset: 0 },
    ],
    loan: { emp: 'EMP-u14', kind: 'loan', principal: 6000, installment: 1000, offset: -3, reason: 'Car down payment' },
    settings: { payDay: 28, cutoffDay: 25, wpsEmployerId: '1000000425517', wpsRoutingCode: '803320101', defaultsConfirmed: false },
    maker: 'u9',
    checker: 'u2',
  },
  [CREST_ID]: {
    joiner: { id: 'EMP-X104', name: 'Khalid Al Otaibi', title: 'Dispatch Clerk', dept: 'c2-ops', manager: 'EMP-u106', nationality: 'SA', gender: 'male', iban: 'SA4480000000608010167519', basic: 7000, day: 5 },
    unpaid: { emp: 'EMP-X102', monthOffset: -1, nth: 9 },
    noPersonId: [],
    payMethods: { 'EMP-X103': 'cheque' },
    adjustments: [
      { emp: 'EMP-u106', kind: 'allowance', label: 'Site allowance', amount: 800, recurrence: 'monthly', offset: -2 },
      { emp: 'EMP-X103', kind: 'deduction', label: 'Uniform', amount: 200, recurrence: 'once', offset: -1 },
      { emp: 'EMP-u104', kind: 'allowance', label: 'Correction: October overtime', amount: 350, recurrence: 'once', offset: 0 },
    ],
    loan: { emp: 'EMP-X101', kind: 'advance', principal: 4500, installment: 1500, offset: -2, reason: 'Family emergency' },
    settings: { payDay: 27, cutoffDay: 31, mudadEstablishmentNo: '7-0012345', defaultsConfirmed: true, defaultsConfirmedBy: 'u101' },
    maker: 'u101',
    checker: 'u102',
  },
}

function seedCompany(co: string): void {
  const seed = SEEDS[co]
  const c = companyById(co)
  if (!seed || !c) return
  const r = regionOf(co)
  const today = todayIsoIn(r.timezone, clockNow())
  const cur = today.slice(0, 7)
  const s = settingsFor(co)
  Object.assign(s, seed.settings, seed.settings.defaultsConfirmed ? { defaultsConfirmedAt: `${addMonths(cur, -4)}-02T08:00:00.000Z` } : {})

  /* A joiner this month (with contract, bank, attendance since the hire date). */
  const hire = `${cur}-${String(Math.max(1, Math.min(seed.joiner.day, Number(today.slice(8, 10))))).padStart(2, '0')}`
  if (!hrEmployees.some((e) => e.id === seed.joiner.id)) {
    const own = hrEmployees.filter((e) => e.companyId === co)
    const prefix = co === APEX_ID ? 'APX' : 'CRS'
    const no = Math.max(...own.map((e) => Number(e.employeeNo.replace(/\D/g, '')) || 0)) + 1
    const created = `${hire}T06:00:00.000Z`
    hrEmployees.push({ companyId: co, id: seed.joiner.id, userId: null, employeeNo: `${prefix}-${String(no).padStart(4, '0')}`, fullName: seed.joiner.name, jobTitle: seed.joiner.title, departmentId: seed.joiner.dept, managerId: seed.joiner.manager, email: '', mobile: '', nationality: seed.joiner.nationality, gender: seed.joiner.gender, dateOfBirth: '1997-04-12', hireDate: hire, employmentType: 'full_time', status: 'active', exitDate: null, createdAt: created, updatedAt: created })
    hrProfiles.push({ companyId: co, employeeId: seed.joiner.id, emergencyContact: { name: '', relation: '', phone: '' }, address: { line1: '', city: co === APEX_ID ? 'Dubai' : 'Riyadh', country: c.regional.country }, bankName: seed.joiner.iban ? 'Al Rajhi Bank' : '', accountName: seed.joiner.iban ? seed.joiner.name : '', iban: seed.joiner.iban, offboarding: null })
    const basic = seed.joiner.basic
    hrContracts.push({ companyId: co, id: nextHrId('HCT-', hrContracts), employeeId: seed.joiner.id, type: 'unlimited', startDate: hire, endDate: null, probationMonths: 6, probationEndDate: `${addMonths(cur, 6)}-${hire.slice(8)}`, noticeDays: 30, hoursPerWeek: 48, basicSalary: basic, housingAllowance: Math.round(basic * 0.25), transportAllowance: 800, otherAllowance: 0, currency: r.currency, status: 'active', signedDate: addDays(hire, -14), file: null, notes: '', renewedFromId: null, renewedToId: null, alertMarks: [], createdAt: created, updatedAt: created })
    for (const d of workingDates(hire, addDays(today, -1), r.weekend, holidayMap(co))) {
      const id = nextTimeId('ATT-', hrAttendance)
      const inAt = zonedToUtc(d, '08:52', r.timezone)
      hrAttendance.push({ companyId: co, id, employeeId: seed.joiner.id, workDate: d, checkInAt: inAt, checkOutAt: zonedToUtc(d, '18:04', r.timezone), source: 'web', note: '', location: '', createdBy: '', createdAt: inAt, updatedAt: inAt })
    }
  }

  /* Payroll profiles: everyone (person ids: UAE synthetic WPS ids; KSA the iqama / national id document). */
  employeesOf(co).forEach((e, i) => {
    if (hrPayrollProfiles.some((p) => p.companyId === co && p.employeeId === e.id)) return
    let personId = ''
    if (!seed.noPersonId.includes(e.id) && e.id !== seed.joiner.id) {
      if (r.country === 'AE') personId = wpsPersonId(i + (co === APEX_ID ? 0 : 500))
      else personId = hrDocuments.find((d) => d.companyId === co && d.employeeId === e.id && (d.type === 'iqama' || (d.type === 'other' && /^1\d{9}$/.test(d.number))))?.number ?? ''
    }
    hrPayrollProfiles.push({ companyId: co, employeeId: e.id, payMethod: seed.payMethods[e.id] ?? 'bank', personId, bankRoutingCode: '', updatedAt: e.createdAt })
  })

  /* Approved unpaid leave (2 working days). */
  const emp = employeeById(co, seed.unpaid.emp)
  const unpaidType = hrLeaveTypes.find((t) => t.companyId === co && t.code === 'unpaid')
  if (emp && unpaidType) {
    const m = addMonths(cur, seed.unpaid.monthOffset)
    const days = workingDates(monthStart(m), monthEnd(m), r.weekend, holidayMap(co))
    const from = days[Math.min(seed.unpaid.nth, days.length - 2)]
    const to = days[Math.min(seed.unpaid.nth + 1, days.length - 1)]
    const approver = hrApproverIds(co).find((id) => id !== emp.userId) ?? null
    const at = zonedToUtc(addDays(from, -7), '10:00', r.timezone)
    hrLeaveRequests.push({ companyId: co, id: nextTimeId('LVR-', hrLeaveRequests), employeeId: emp.id, leaveTypeId: unpaidType.id, startDate: from, endDate: to, halfDay: null, days: leaveDayCount(from, to, null, r.weekend, holidayMap(co)).days, reason: 'Personal matter (unpaid)', documentName: null, status: 'approved', approvals: [{ step: 'hr', approverIds: [], decision: 'approved', decidedBy: approver, comment: 'Approved as unpaid leave.', decidedAt: at }], submittedAt: at, submittedBy: emp.userId ?? '', cancelledAt: null, cancelledBy: null })
  }

  /* Adjustments and a loan in repayment. */
  for (const a of seed.adjustments) {
    if (!employeeById(co, a.emp)) continue
    hrPayAdjustments.push({ companyId: co, id: nextPayId('PADJ-', hrPayAdjustments.map((x) => x.id)), employeeId: a.emp, kind: a.kind, label: a.label, amount: a.amount, recurrence: a.recurrence, month: addMonths(cur, a.offset), endMonth: null, notes: '', paidRunIds: [], createdAt: `${addMonths(cur, a.offset)}-01T08:00:00.000Z`, createdBy: seed.maker })
  }
  if (employeeById(co, seed.loan.emp)) {
    const l = seed.loan
    hrPayLoans.push({ companyId: co, id: nextPayId('PLN-', hrPayLoans.map((x) => x.id)), employeeId: l.emp, kind: l.kind, principal: l.principal, installmentAmount: l.installment, startMonth: addMonths(cur, l.offset), reason: l.reason, status: 'active', repayments: [], createdAt: `${addMonths(cur, l.offset - 1)}-20T08:00:00.000Z`, createdBy: seed.maker })
  }

  /* Three paid months, then a draft for the current month. */
  for (const off of [-3, -2, -1]) {
    const month = addMonths(cur, off)
    const run = newRun(co, month, seed.maker, `${month}-20T06:00:00.000Z`)
    calculateLines(run, today)
    for (const l of run.lines) for (const w of l.warnings) w.acknowledged = true
    const stamp = (day: string, time: string) => `${month}-${day}T${time}:00.000Z`
    Object.assign(run, { status: 'paid', calculatedAt: stamp('22', '07:10'), calculatedBy: seed.maker, approvedAt: stamp('23', '09:30'), approvedBy: seed.checker, paidAt: `${run.payDate}T10:00:00.000Z`, paidBy: seed.maker, alertMarks: ['awaiting'] })
    if (co === APEX_ID) run.exports.push({ at: `${run.payDate}T08:15:00.000Z`, by: seed.maker, format: 'wps', count: run.lines.filter((x) => x.payMethod === 'bank' && x.net > 0).length })
    applyPaid(run, false)
  }
  newRun(co, cur, seed.maker, `${cur}-15T06:00:00.000Z`)
}

/** Seeds both demo companies once (module load; the stores are registered and the HR seeds are in). */
function seedPayroll(): void {
  if (hrPaySettings.length) return
  for (const co of [APEX_ID, CREST_ID]) seedCompany(co)
}
seedPayroll()

export const _testing = { calculateLines, eligibleEmployees, wpsPersonId, luhnOk }
