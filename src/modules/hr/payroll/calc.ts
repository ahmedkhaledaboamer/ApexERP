import type {
  AdjustmentKind,
  ExitReason,
  GratuityBasis,
  GratuityResult,
  LoanInstallment,
  LoanRepayment,
  PayCountry,
  PayItem,
  SocialInsuranceRates,
} from './types'

/**
 * Pure payroll arithmetic, shared by the mock API (the contract) and the screens (the gratuity
 * calculator). Every date is a company-local calendar date (yyyy-MM-dd); money is rounded to
 * 2 decimals per item (`r2`), totals are sums of rounded items (so a payslip always adds up).
 *
 * The statutory figures below are DEFAULTS for the demo, to be confirmed by HR — not legal advice:
 *   UAE GPSSA      nationals: employee 11 %, employer 12.5 % of basic + housing
 *   KSA GOSI       Saudis: employee 9.75 %, employer 11.75 %; non-Saudis: employer 2 % (occupational
 *                  hazards); base basic + housing, capped at 45,000 SAR a month
 *   UAE gratuity   Federal Decree-Law 33/2021 art. 51: after 1 year; 21 days' basic per year for the first
 *                  5 years, 30 days after; daily wage = basic × 12 / 365; capped at 2 years' basic;
 *                  unpaid leave days are not service; resignation does not reduce it
 *   KSA gratuity   Labor Law art. 84–85: half a month's wage per year for the first 5 years, a month after;
 *                  resignation: < 2 years nothing, 2–5 one third, 5–10 two thirds, ≥ 10 the full award
 */

/** Money: 2 decimals, half away from zero (minor-unit safe for AED / SAR). */
export function r2(n: number): number {
  const v = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
  return n < 0 ? -v : v
}

export const sum = (xs: readonly number[]) => r2(xs.reduce((s, x) => s + x, 0))

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const monthStart = (month: string) => `${month}-01`
export const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`

/** "2026-11" + 2 → "2027-01". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Months from a to b (b − a), "2026-01" → "2026-03" = 2. */
export function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

/** "2026-11" → "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const DAY_MS = 86_400_000
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
/** Calendar days from `from` to `to`, both included (0 when to < from). */
export function inclusiveDays(from: string, to: string): number {
  return Math.max(0, Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1)
}
export function addDays(iso: string, n: number): string {
  return new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10)
}

/* ---------------- Social insurance defaults ---------------- */

export function defaultSocialInsurance(country: PayCountry): SocialInsuranceRates {
  return country === 'SA'
    ? { nationalEmployeeRate: 9.75, nationalEmployerRate: 11.75, expatEmployeeRate: 0, expatEmployerRate: 2, base: 'basic_housing', cap: 45_000 }
    : { nationalEmployeeRate: 11, nationalEmployerRate: 12.5, expatEmployeeRate: 0, expatEmployerRate: 0, base: 'basic_housing', cap: null }
}

/** The employee counts as a national for the scheme (UAE: Emirati; KSA: Saudi). */
export const isNational = (country: PayCountry, nationality: string) => nationality === country

/* ---------------- One payroll line ---------------- */

export interface ContractPay {
  basic: number
  housing: number
  transport: number
  other: number
}

export interface LineCalcInput {
  month: string
  /** The days the employee is employed under the contract this month (null: not at all). */
  window: { start: string; end: string } | null
  contract: ContractPay | null
  /** Approved unpaid leave, working days (half days 0.5) inside the window. */
  unpaidLeaveDays: number
  /** Unexcused absence days (see services/hrPayroll.ts for the rule). */
  absenceDays: number
  overtimeMinutes: number
  overtime: { enabled: boolean; multiplier: number }
  national: boolean
  si: SocialInsuranceRates
  adjustments: { id: string; kind: AdjustmentKind; label: string; amount: number }[]
  loans: { id: string; label: string; amount: number }[]
}

export interface LineCalc {
  daysInMonth: number
  paidDays: number
  items: PayItem[]
  basic: number
  housing: number
  gross: number
  totalDeductions: number
  net: number
  employeeSocialInsurance: number
  employerSocialInsurance: number
  employerCost: number
  fixedPay: number
  variablePay: number
  overtimeHours: number
  dailyRate: number
}

const fmt2 = (n: number) => n.toFixed(2)

/**
 * One employee's month:
 *   earnings     contract components × paid calendar days / days in the month (joiners and leavers);
 *                overtime (if enabled) = hours × basic / days in month / 8 × multiplier; allowance / bonus adjustments
 *   deductions   unpaid-leave days and absence days × daily rate (full monthly fixed pay / days in the month);
 *                employee social insurance; loan installments; deduction adjustments
 *   employer     employer social insurance; employer cost = gross + employer social insurance
 * Social insurance base = the prorated components named by `si.base`, capped at `si.cap`.
 */
export function computeLine(input: LineCalcInput): LineCalc {
  const dim = daysInMonth(input.month)
  const items: PayItem[] = []
  const add = (code: string, label: string, type: PayItem['type'], amount: number, note = '') => {
    const a = r2(amount)
    if (a !== 0) items.push({ code, label, type, amount: a, note })
  }
  const c = input.contract
  const paidDays = input.window && c ? inclusiveDays(input.window.start, input.window.end) : 0
  const factor = dim ? paidDays / dim : 0
  const prorated = paidDays < dim ? ` (${paidDays}/${dim} days)` : ''
  const basic = c ? r2(c.basic * factor) : 0
  const housing = c ? r2(c.housing * factor) : 0
  const transport = c ? r2(c.transport * factor) : 0
  const other = c ? r2(c.other * factor) : 0
  add('basic', 'Basic salary', 'earning', basic, prorated.trim())
  add('housing', 'Housing allowance', 'earning', housing, prorated.trim())
  add('transport', 'Transport allowance', 'earning', transport, prorated.trim())
  add('other', 'Other allowances', 'earning', other, prorated.trim())

  const monthlyFixed = c ? c.basic + c.housing + c.transport + c.other : 0
  const dailyRate = dim ? monthlyFixed / dim : 0
  let overtimeHours = 0
  let overtimeAmount = 0
  if (c && input.overtime.enabled && input.overtimeMinutes > 0) {
    overtimeHours = r2(input.overtimeMinutes / 60)
    const hourly = c.basic / dim / 8
    overtimeAmount = r2(overtimeHours * hourly * input.overtime.multiplier)
    add('overtime', 'Overtime', 'earning', overtimeAmount, `${overtimeHours} h × ${fmt2(hourly)} × ${input.overtime.multiplier}`)
  }
  let variable = overtimeAmount
  for (const a of input.adjustments) {
    if (a.kind === 'deduction') continue
    add(`adj:${a.id}`, a.label, 'earning', a.amount, a.kind === 'bonus' ? 'Bonus' : 'Allowance')
    variable += r2(a.amount)
  }

  if (c && input.unpaidLeaveDays > 0) add('unpaid_leave', 'Unpaid leave', 'deduction', input.unpaidLeaveDays * dailyRate, `${input.unpaidLeaveDays} day(s) × ${fmt2(dailyRate)}`)
  if (c && input.absenceDays > 0) add('absence', 'Unexcused absence', 'deduction', input.absenceDays * dailyRate, `${input.absenceDays} day(s) × ${fmt2(dailyRate)}`)

  const si = input.si
  const rawBase = si.base === 'basic' ? basic : si.base === 'gross' ? basic + housing + transport + other : basic + housing
  const base = si.cap !== null && si.cap !== undefined ? Math.min(rawBase, si.cap) : rawBase
  const empRate = input.national ? si.nationalEmployeeRate : si.expatEmployeeRate
  const erRate = input.national ? si.nationalEmployerRate : si.expatEmployerRate
  const employeeSI = r2((base * empRate) / 100)
  const employerSI = r2((base * erRate) / 100)
  add('si_employee', input.national ? 'Social insurance (employee)' : 'Social insurance (employee)', 'deduction', employeeSI, `${empRate}% of ${fmt2(base)}`)
  for (const l of input.loans) add(`loan:${l.id}`, l.label, 'deduction', l.amount, 'Installment')
  for (const a of input.adjustments) if (a.kind === 'deduction') add(`adj:${a.id}`, a.label, 'deduction', a.amount, 'Deduction')
  add('si_employer', 'Social insurance (employer)', 'employer', employerSI, `${erRate}% of ${fmt2(base)}`)

  const gross = sum(items.filter((i) => i.type === 'earning').map((i) => i.amount))
  const totalDeductions = sum(items.filter((i) => i.type === 'deduction').map((i) => i.amount))
  const net = r2(gross - totalDeductions)
  const variablePay = r2(Math.max(0, Math.min(r2(variable), net)))
  return {
    daysInMonth: dim,
    paidDays,
    items,
    basic,
    housing,
    gross,
    totalDeductions,
    net,
    employeeSocialInsurance: employeeSI,
    employerSocialInsurance: employerSI,
    employerCost: r2(gross + employerSI),
    fixedPay: r2(net - variablePay),
    variablePay,
    overtimeHours,
    dailyRate: r2(dailyRate),
  }
}

/* ---------------- Loans ---------------- */

/** The installment due in a run: the plan amount, or what is left (never more). 0 before the start month. */
export function installmentDue(loan: { principal: number; installmentAmount: number; startMonth: string }, repaid: number, month: string): number {
  if (month < loan.startMonth) return 0
  return r2(Math.max(0, Math.min(loan.installmentAmount, loan.principal - repaid)))
}

/** Paid installments (from the repayments), then planned ones month after month until the balance is 0. */
export function loanSchedule(loan: { principal: number; installmentAmount: number; startMonth: string }, repayments: readonly LoanRepayment[]): LoanInstallment[] {
  const out: LoanInstallment[] = repayments.map((r) => ({ month: r.month, amount: r2(r.amount), status: 'paid' as const }))
  let left = r2(loan.principal - sum(repayments.map((r) => r.amount)))
  const lastPaid = repayments.length ? repayments.map((r) => r.month).sort().slice(-1)[0] : null
  let month = lastPaid && lastPaid >= loan.startMonth ? addMonths(lastPaid, 1) : loan.startMonth
  for (let guard = 0; left > 0 && guard < 240 && loan.installmentAmount > 0; guard++) {
    const amount = r2(Math.min(loan.installmentAmount, left))
    out.push({ month, amount, status: 'planned' })
    left = r2(left - amount)
    month = addMonths(month, 1)
  }
  return out
}

/* ---------------- End-of-service gratuity ---------------- */

export interface GratuityInput {
  country: PayCountry
  reason: ExitReason
  basic: number
  housing: number
  /** First day of service and last working day (both included). */
  startDate: string
  endDate: string
  /** UAE: unpaid leave days are not counted as service. */
  unpaidLeaveDays?: number
  /** KSA wage basis (default basic + housing). */
  basis?: GratuityBasis
}

const yearsText = (y: number) => `${Math.round(y * 1000) / 1000} years`

export function gratuity(input: GratuityInput): GratuityResult {
  const calendarDays = inclusiveDays(input.startDate, input.endDate)
  return input.country === 'SA' ? ksaGratuity(input, calendarDays) : uaeGratuity(input, calendarDays)
}

/** UAE (Federal Decree-Law 33/2021): 21 days' basic per year for 5 years, 30 after; cap 2 years' basic. */
function uaeGratuity(input: GratuityInput, calendarDays: number): GratuityResult {
  const excluded = Math.max(0, Math.min(calendarDays, Math.round((input.unpaidLeaveDays ?? 0) * 2) / 2))
  const serviceDays = calendarDays - excluded
  const years = serviceDays / 365
  const daily = (input.basic * 12) / 365
  const eligible = years >= 1
  const first = Math.min(years, 5) * 21
  const later = Math.max(0, years - 5) * 30
  const full = eligible ? (first + later) * daily : 0
  const cap = 24 * input.basic
  const capped = eligible && full > cap
  const amount = r2(capped ? cap : full)
  const explanation = [
    `Service: ${serviceDays} days${excluded ? ` (${calendarDays} calendar days − ${excluded} unpaid leave days)` : ''} = ${yearsText(years)}.`,
    `Daily wage = basic ${fmt2(input.basic)} × 12 ÷ 365 = ${fmt2(daily)}.`,
  ]
  if (!eligible) explanation.push('Less than 1 year of continuous service: no gratuity.')
  else {
    explanation.push(`First 5 years: ${r2(first)} days × daily wage; after 5 years: ${r2(later)} days × daily wage = ${fmt2(full)}.`)
    if (capped) explanation.push(`Capped at 2 years' basic wage (24 × ${fmt2(input.basic)} = ${fmt2(cap)}).`)
    if (input.reason === 'resignation') explanation.push('A resignation does not reduce the gratuity (Decree-Law 33/2021).')
  }
  return { country: 'AE', serviceDays, excludedDays: excluded, years: r2(years), monthlyWage: r2(input.basic), dailyWage: r2(daily), firstPeriodUnits: r2(first), laterPeriodUnits: r2(later), fullAmount: r2(full), factor: 1, capped, amount, eligible, explanation }
}

/** The KSA resignation factor (art. 85). */
export function ksaResignationFactor(years: number): number {
  if (years < 2) return 0
  if (years < 5) return 1 / 3
  if (years < 10) return 2 / 3
  return 1
}

/** KSA (Labor Law art. 84–85): ½ month's wage per year for 5 years, a month after; resignation factor. */
function ksaGratuity(input: GratuityInput, calendarDays: number): GratuityResult {
  const serviceDays = calendarDays
  const years = serviceDays / 365
  const wage = input.basis === 'basic' ? input.basic : input.basic + input.housing
  const first = Math.min(years, 5) * 0.5
  const later = Math.max(0, years - 5) * 1
  const full = (first + later) * wage
  const factor = input.reason === 'resignation' ? ksaResignationFactor(years) : 1
  const amount = r2(full * factor)
  const explanation = [
    `Service: ${serviceDays} days = ${yearsText(years)}.`,
    `Monthly wage (${input.basis === 'basic' ? 'basic' : 'basic + housing'}) = ${fmt2(wage)}.`,
    `First 5 years: ${r2(first)} months' wage; after 5 years: ${r2(later)} months' wage = ${fmt2(full)}.`,
  ]
  if (input.reason === 'resignation') {
    explanation.push(
      factor === 0
        ? 'Resignation with less than 2 years of service: no award (art. 85).'
        : factor === 1
          ? 'Resignation after 10 years or more: the full award (art. 85).'
          : `Resignation with ${years < 5 ? '2–5' : '5–10'} years of service: ${factor < 0.5 ? 'one third' : 'two thirds'} of the award (art. 85).`,
    )
  } else explanation.push('End of contract or termination by the employer: the full award (art. 84).')
  return { country: 'SA', serviceDays, excludedDays: 0, years: r2(years), monthlyWage: r2(wage), dailyWage: r2((wage * 12) / 365), firstPeriodUnits: r2(first), laterPeriodUnits: r2(later), fullAmount: r2(full), factor, capped: false, amount, eligible: amount > 0, explanation }
}

/* ---------------- Bank files ---------------- */

export interface SifLine {
  personId: string
  routingCode: string
  iban: string
  payStart: string
  payEnd: string
  days: number
  fixed: number
  variable: number
  leaveDays: number
}

export interface SifInput {
  employerId: string
  routingCode: string
  /** Company-local date (yyyy-MM-dd) and time (HH:mm:ss) the file is made. */
  localDate: string
  localTime: string
  month: string
  reference: string
  lines: SifLine[]
}

/**
 * UAE WPS Salary Information File: one EDR per employee, then the SCR control record.
 *   EDR,<person id>,<agent routing code>,<IBAN>,<pay start>,<pay end>,<days>,<fixed>,<variable>,<days on leave>
 *   SCR,<employer id>,<routing code>,<file date>,<HHMM>,<MMYYYY>,<EDR count>,<total>,AED,<reference>
 * File name `<employerId><yyMMdd><HHmmss>.SIF`. Exact column specs to confirm with the bank before go-live.
 */
export function buildSif(input: SifInput): { fileName: string; content: string; total: number } {
  const rows = input.lines.map((l) => ['EDR', l.personId, l.routingCode, l.iban, l.payStart, l.payEnd, String(l.days), fmt2(l.fixed), fmt2(l.variable), String(l.leaveDays)].join(','))
  const total = sum(input.lines.map((l) => l.fixed + l.variable))
  const [y, m] = input.month.split('-')
  const hhmm = input.localTime.slice(0, 5).replace(':', '')
  rows.push(['SCR', input.employerId, input.routingCode, input.localDate, hhmm, `${m}${y}`, String(input.lines.length), fmt2(total), 'AED', input.reference].join(','))
  const stamp = `${input.localDate.slice(2, 4)}${input.localDate.slice(5, 7)}${input.localDate.slice(8, 10)}${input.localTime.replace(/:/g, '').slice(0, 6)}`
  return { fileName: `${input.employerId}${stamp}.SIF`, content: rows.join('\r\n') + '\r\n', total }
}

const FORMULA = /^[=+\-@\t\r]/
export function csvCell(value: string | number): string {
  let s = String(value)
  if (typeof value === 'string' && FORMULA.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface MudadLine {
  personId: string
  name: string
  bank: string
  iban: string
  basic: number
  housing: number
  otherAllowances: number
  deductions: number
  net: number
}

export const MUDAD_HEADER = ['Employee ID / Iqama', 'Name', 'Bank', 'IBAN', 'Basic salary', 'Housing allowance', 'Other allowances', 'Deductions', 'Net salary']

/** KSA Mudad payroll upload (CSV). Exact column specs to confirm with the bank / Mudad before go-live. */
export function buildMudadCsv(establishmentNo: string, month: string, lines: MudadLine[]): { fileName: string; content: string; total: number } {
  const rows = [MUDAD_HEADER.map(csvCell).join(',')]
  for (const l of lines) rows.push([l.personId, l.name, l.bank, l.iban, fmt2(l.basic), fmt2(l.housing), fmt2(l.otherAllowances), fmt2(l.deductions), fmt2(l.net)].map((v) => csvCell(v)).join(','))
  const est = establishmentNo.replace(/[^0-9A-Za-z-]/g, '') || 'establishment'
  return { fileName: `mudad-${est}-${month}.csv`, content: rows.join('\r\n') + '\r\n', total: sum(lines.map((l) => l.net)) }
}
