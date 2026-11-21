import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '@/modules/hr/types'
import { CONTRACT_TYPE_LABEL, DOCUMENT_TYPE_LABEL, ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, type AssetCategory, type AssetStatus } from '@/modules/hr/peopleTypes'
import { CANDIDATE_SOURCE_LABEL, OPENING_STATUS_LABEL, STAGE_LABEL, type CandidateSource } from '@/modules/hr/recruitmentTypes'
import type { DailyRecord } from '@/modules/hr/time/types'
import type { MatrixCell } from '@/modules/hr/trainingTypes'
import { leaveDayCount } from '@/modules/hr/time/calc'
import { certificateState, compliancePct, isCompliant, isOverdue } from '@/modules/hr/lib/talent'
import {
  FULL_ONLY_REPORTS,
  REPORT_KEYS,
  COMPLIANCE_KIND_LABEL,
  EXPIRY_BUCKET_LABEL,
  type AssetsReport,
  type AttendanceReport,
  type AttendanceTotals,
  type ComplianceKind,
  type ComplianceReport,
  type ComplianceRow,
  type HeadcountReport,
  type LeaveReport,
  type NationalisationReport,
  type OverviewReport,
  type PayrollCostReport,
  type PersonRow,
  type RecruitmentReport,
  type ReportExport,
  type ReportKey,
  type ReportMeta,
  type ReportOptions,
  type ReportQuery,
  type ReportScope,
  type ReportSettings,
  type ReportSettingsInput,
  type TrainingReport,
  type TurnoverReport,
} from '@/modules/hr/reports/types'
import {
  averageOf,
  contractCoversMonth,
  countBy,
  daysToHire,
  employedOn,
  expiryBucket,
  funnel,
  gapToTarget,
  inRange,
  leftOn,
  monthEnd,
  monthlyPay,
  monthsBetween,
  monthStart,
  nationalisationLabel,
  nationalisationOn,
  periodTurnover,
  resolveRange,
  round1,
  round2,
  sharePct,
  tenureYears,
  turnoverByMonth,
} from '@/modules/hr/reports/calc'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { departmentSubtree } from '@/shared/lib/permissions'
import { zonedParts } from '@/shared/lib/zonedTime'
import { nowIso } from '@/shared/mocks/clock'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts, hrDocuments } from '@/shared/mocks/data/hrPeople'
import { hrApplications, hrCandidates, hrCertificates, hrCourses, hrEnrollments, hrInterviews, hrOffers, hrOpenings, hrSessions } from '@/shared/mocks/data/hrTalent'
import { hrAttendance, hrLeaveRequests, hrLeaveTypes } from '@/shared/mocks/data/hrTime'
import { hrReportSettings, reportSettingsOf } from '@/shared/mocks/data/hrReports'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { hrAccessOf } from './hrAccess'
import { hrCtx, type HrCtx } from './hrTimeAccess'
import { daysOf, holidayMap } from './attendance'
import { balanceOf } from './leave'
import { cellFor } from './hrTraining'

/**
 * HR › Reports (docs/API.md › HR › HR reports). Every report is one aggregate computed here over the caller's
 * scope; the pure rules (ranges, turnover, nationalisation %, funnel, expiry buckets, committed pay) live in
 * src/modules/hr/reports/calc.ts.
 *
 * Scope (matrix `hr` column):
 *   full    Company Admin, Management, HR Manager: the whole company; pay (Payroll cost, training spend)
 *   team    Department Head: employees of the departments they head and their sub-departments; never pay
 *   own / hidden  403 (an employee has no reports; hidden roles have no HR)
 * The company comes from the session. A `department_id` outside the caller's departments (another company's,
 * missing, or not headed by a Department Head) answers 404 like a missing one.
 */

type Emp = Tenant<Employee>

const REPORTS_FORBIDDEN = 'HR reports are for HR and department heads.'
const PAY_FORBIDDEN = 'Only HR (full access) sees pay in reports.'
const forbidden = (message: string) => new CodedApiError(message, 403, 'forbidden')
const invalid = (message: string, field?: string) => new CodedApiError(message, 422, 'validation_failed', field ? { field } : {})
const notFound = () => new CodedApiError(NOT_FOUND, 404, 'not_found')

export const NATIONALISATION_DISCLAIMER =
  'Internal tracker: the share of nationals in the headcount. Not an official MOHRE (Emiratisation) or Nitaqat (Saudization) calculation, which use their own rules and weights.'

interface ReportCtx {
  user: User
  co: string
  scope: ReportScope
  time: HrCtx
  today: string
  timezone: string
  currency: string
  country: string
  from: string
  to: string
  asOf: string
  /** The departments the caller may report on (null = every department and none, HR full). */
  allowedDepartments: Set<string> | null
  departmentId: string | null
  /** Employees in scope after the department filter (left ones too: history counts). */
  employees: Emp[]
  ids: Set<string>
}

/* ---------------- Context ---------------- */

const coDepartments = (co: string) => departments.filter((d) => d.companyId === co)
const deptName = (co: string, id: string | null | undefined) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? 'No department') : 'No department')

function reportScope(user: User): ReportScope {
  const access = hrAccessOf(user) // 403 for hidden roles
  if (access === 'own') throw forbidden(REPORTS_FORBIDDEN)
  return access
}

/** Departments headed by the caller and their sub-departments (team scope). */
function headedDepartments(user: User, co: string): Set<string> {
  const deps = coDepartments(co)
  return new Set(deps.filter((d) => d.active && d.headId === user.id).flatMap((d) => departmentSubtree(d.id, deps)))
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function contextOf(user: User, q: ReportQuery): ReportCtx {
  const scope = reportScope(user)
  const co = tenantOf(user)
  const time = hrCtx(user)
  const c = companyById(co)
  const range = resolveRange(time.today, str(q.from), str(q.to))
  if (!range.ok) throw invalid(range.message, 'from')
  const allowed = scope === 'full' ? null : headedDepartments(user, co)
  const deptId = str(q.departmentId) ?? null
  let filter: Set<string> | null = allowed
  if (deptId) {
    const dept = coDepartments(co).find((d) => d.id === deptId)
    if (!dept || (allowed && !allowed.has(dept.id))) throw notFound()
    const subtree = new Set(departmentSubtree(dept.id, coDepartments(co)))
    filter = new Set([...subtree].filter((id) => !allowed || allowed.has(id)))
  }
  const employees = employeesOf(co).filter((e) => !filter || (e.departmentId !== null && filter.has(e.departmentId)))
  return {
    user,
    co,
    scope,
    time,
    today: time.today,
    timezone: time.timezone,
    currency: c?.regional.currency ?? 'AED',
    country: c?.regional.country ?? 'AE',
    from: range.from,
    to: range.to,
    asOf: range.asOf,
    allowedDepartments: allowed,
    departmentId: deptId,
    employees,
    ids: new Set(employees.map((e) => e.id)),
  }
}

function meta(ctx: ReportCtx): ReportMeta {
  return {
    from: ctx.from,
    to: ctx.to,
    asOf: ctx.asOf,
    today: ctx.today,
    timezone: ctx.timezone,
    currency: ctx.currency,
    scope: ctx.scope,
    departmentId: ctx.departmentId,
    departmentName: ctx.departmentId ? deptName(ctx.co, ctx.departmentId) : null,
  }
}

const person = (e: Emp): PersonRow => ({ employeeId: e.id, employeeName: e.fullName, employeeNo: e.employeeNo, departmentName: e.departmentId ? deptName(e.companyId, e.departmentId) : null })

let regionNames: Intl.DisplayNames | null = null
function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** The local (company) calendar day of a stored UTC instant. */
const localDay = (ctx: ReportCtx, iso: string) => zonedParts(iso, ctx.timezone).date

/* ---------------- Options ---------------- */

export function reportOptions(user: User): ReportOptions {
  const scope = reportScope(user)
  const co = tenantOf(user)
  const time = hrCtx(user)
  const c = companyById(co)
  const allowed = scope === 'full' ? null : headedDepartments(user, co)
  const range = resolveRange(time.today)
  const country = c?.regional.country ?? 'AE'
  return {
    scope,
    departments: coDepartments(co)
      .filter((d) => d.active && (!allowed || allowed.has(d.id)))
      .map((d) => ({ id: d.id, name: d.name, parentId: d.parentId }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    reports: REPORT_KEYS.filter((k) => scope === 'full' || !FULL_ONLY_REPORTS.includes(k)),
    defaultFrom: range.ok ? range.from : time.today,
    defaultTo: range.ok ? range.to : time.today,
    today: time.today,
    timezone: time.timezone,
    currency: c?.regional.currency ?? 'AED',
    country,
    nationalisationLabel: nationalisationLabel(country),
    canEditSettings: scope === 'full',
  }
}

/* ---------------- Headcount ---------------- */

const onPayroll = (ctx: ReportCtx, date = ctx.asOf) => ctx.employees.filter((e) => employedOn(e, date))

/** Months of the period up to `asOf` (trends stop today), each with the day its point-in-time figure uses. */
function trendMonths(ctx: ReportCtx): { month: string; end: string }[] {
  if (ctx.asOf < ctx.from) return []
  return monthsBetween(ctx.from, ctx.asOf).map((month) => ({ month, end: monthEnd(month) > ctx.asOf ? ctx.asOf : monthEnd(month) }))
}

function headcountTrend(ctx: ReportCtx) {
  return trendMonths(ctx).map(({ month, end }) => ({ month, headcount: onPayroll(ctx, end).length }))
}

function headcountOf(ctx: ReportCtx): HeadcountReport {
  const now = onPayroll(ctx)
  return {
    ...meta(ctx),
    total: now.length,
    byDepartment: countBy(now, (e) => e.departmentId ?? '', (k) => deptName(ctx.co, k || null)),
    byNationality: countBy(now, (e) => e.nationality || '—', (k) => (k === '—' ? 'Not set' : countryName(k))),
    byGender: countBy(now, (e) => e.gender ?? 'not_set', (k) => (k === 'male' ? 'Male' : k === 'female' ? 'Female' : 'Not set')),
    byEmploymentType: countBy(now, (e) => e.employmentType, (k) => EMPLOYMENT_TYPE_LABEL[k as EmploymentType] ?? k),
    trend: headcountTrend(ctx),
  }
}

export function headcountReport(user: User, q: ReportQuery): HeadcountReport {
  return headcountOf(contextOf(user, q))
}

/* ---------------- Joiners, leavers, turnover ---------------- */

/** Turnover months of the period so far (to `asOf`: future months would dilute the average headcount). */
const turnoverMonths = (ctx: ReportCtx) => (ctx.asOf < ctx.from ? [] : turnoverByMonth(ctx.employees, ctx.from, ctx.asOf))

function turnoverOf(ctx: ReportCtx): TurnoverReport {
  const months = turnoverMonths(ctx)
  const period = periodTurnover(months)
  const current = onPayroll(ctx)
  const contracts = hrContracts.filter((c) => c.companyId === ctx.co && ctx.ids.has(c.employeeId) && c.status !== 'draft' && c.probationEndDate)
  let passed = 0
  let leftInProbation = 0
  let inProbationNow = 0
  for (const c of contracts) {
    const e = ctx.employees.find((x) => x.id === c.employeeId)!
    const left = leftOn(e)
    const end = c.probationEndDate!
    if (left && left <= end && inRange(left, ctx.from, ctx.to) && left >= c.startDate) leftInProbation++
    else if (inRange(end, ctx.from, ctx.asOf) && employedOn(e, end)) passed++
    if (c.status === 'active' && c.startDate <= ctx.today && end >= ctx.today && employedOn(e, ctx.today)) inProbationNow++
  }
  return {
    ...meta(ctx),
    months,
    ...period,
    averageTenureYears: averageOf(current.map((e) => tenureYears(e.hireDate, ctx.asOf))),
    leaverList: ctx.employees
      .filter((e) => inRange(leftOn(e), ctx.from, ctx.to))
      .map((e) => ({ ...person(e), exitDate: leftOn(e)!, tenureYears: tenureYears(e.hireDate, leftOn(e)!) }))
      .sort((a, b) => a.exitDate.localeCompare(b.exitDate)),
    joinerList: ctx.employees
      .filter((e) => inRange(e.hireDate, ctx.from, ctx.to))
      .map((e) => ({ ...person(e), hireDate: e.hireDate }))
      .sort((a, b) => a.hireDate.localeCompare(b.hireDate)),
    probation: { passed, leftInProbation, inProbationNow },
  }
}

export function turnoverReport(user: User, q: ReportQuery): TurnoverReport {
  return turnoverOf(contextOf(user, q))
}

/* ---------------- Nationalisation ---------------- */

function nationalisationOf(ctx: ReportCtx): NationalisationReport {
  const target = reportSettingsOf(ctx.co).nationalisationTargetPct
  const now = nationalisationOn(ctx.employees, ctx.country, ctx.asOf)
  const current = onPayroll(ctx)
  const byDept = new Map<string, { nationals: number; total: number }>()
  for (const e of current) {
    const k = e.departmentId ?? ''
    const row = byDept.get(k) ?? { nationals: 0, total: 0 }
    row.total++
    if (e.nationality === ctx.country) row.nationals++
    byDept.set(k, row)
  }
  return {
    ...meta(ctx),
    country: ctx.country,
    label: nationalisationLabel(ctx.country),
    targetPct: target,
    canEditTarget: ctx.scope === 'full',
    ...now,
    gapToTarget: gapToTarget(now.pct, target),
    trend: trendMonths(ctx).map(({ month, end }) => ({ month, ...nationalisationOn(ctx.employees, ctx.country, end) })),
    byDepartment: [...byDept.entries()]
      .map(([k, v]) => ({ key: k, label: deptName(ctx.co, k || null), ...v, pct: sharePct(v.nationals, v.total) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    disclaimer: NATIONALISATION_DISCLAIMER,
  }
}

export function nationalisationReport(user: User, q: ReportQuery): NationalisationReport {
  return nationalisationOf(contextOf(user, q))
}

/* ---------------- Attendance ---------------- */

const EXPECTED: DailyRecord['status'][] = ['present', 'late', 'absent', 'half_day']

function emptyTotals(): AttendanceTotals {
  return { expectedDays: 0, presentDays: 0, lateArrivals: 0, lateMinutes: 0, absences: 0, overtimeMinutes: 0, absenceRatePct: null }
}
function addDay(t: AttendanceTotals, r: DailyRecord): void {
  if (EXPECTED.includes(r.status)) t.expectedDays++
  if (r.status === 'present' || r.status === 'late' || r.status === 'half_day') t.presentDays++
  if (r.status === 'absent') t.absences++
  if (r.lateMinutes > 0) {
    t.lateArrivals++
    t.lateMinutes += r.lateMinutes
  }
  t.overtimeMinutes += r.overtimeMinutes
}
const finish = (t: AttendanceTotals): AttendanceTotals => ({ ...t, absenceRatePct: sharePct(t.absences, t.expectedDays) })

/** The first day the company recorded attendance: earlier days have no data, so they never count as absences. */
function trackedFrom(co: string): string | null {
  let min: string | null = null
  for (const a of hrAttendance) if (a.companyId === co && (!min || a.workDate < min)) min = a.workDate
  return min
}

interface AttendanceCalc {
  report: AttendanceReport
  perEmployee: { e: Emp; t: AttendanceTotals }[]
}

function attendanceOf(ctx: ReportCtx): AttendanceCalc {
  const tracked = trackedFrom(ctx.co)
  const totals = emptyTotals()
  const byMonth = new Map<string, AttendanceTotals>(trendMonths(ctx).map(({ month }) => [month, emptyTotals()]))
  const byDept = new Map<string, AttendanceTotals>()
  const perEmployee: AttendanceCalc['perEmployee'] = []
  const last = ctx.to < ctx.today ? ctx.to : ctx.today
  if (tracked) {
    for (const e of ctx.employees) {
      let start = ctx.from
      if (tracked > start) start = tracked
      if (e.hireDate > start) start = e.hireDate
      const left = leftOn(e)
      const end = left && left < last ? left : last
      if (start > end) continue
      const dates: string[] = []
      for (let d = start; d <= end; d = addDaysIso(d, 1)) dates.push(d)
      const own = emptyTotals()
      const dept = byDept.get(e.departmentId ?? '') ?? emptyTotals()
      for (const r of daysOf(ctx.time, e, dates)) {
        if (r.inProgress) continue
        addDay(totals, r)
        addDay(own, r)
        addDay(dept, r)
        const m = byMonth.get(r.workDate.slice(0, 7))
        if (m) addDay(m, r)
      }
      byDept.set(e.departmentId ?? '', dept)
      perEmployee.push({ e, t: finish(own) })
    }
  }
  const report: AttendanceReport = {
    ...meta(ctx),
    trackedFrom: tracked,
    totals: finish(totals),
    byMonth: [...byMonth.entries()].filter(([month]) => !!tracked && month >= tracked.slice(0, 7)).map(([month, t]) => ({ month, ...finish(t) })),
    byDepartment: [...byDept.entries()].map(([k, t]) => ({ key: k, label: deptName(ctx.co, k || null), ...finish(t) })).sort((a, b) => a.label.localeCompare(b.label)),
    topLate: perEmployee
      .filter((p) => p.t.lateArrivals > 0)
      .sort((a, b) => b.t.lateArrivals - a.t.lateArrivals || b.t.lateMinutes - a.t.lateMinutes || a.e.fullName.localeCompare(b.e.fullName))
      .slice(0, 10)
      .map((p) => ({ ...person(p.e), lateArrivals: p.t.lateArrivals, lateMinutes: p.t.lateMinutes })),
  }
  return { report, perEmployee }
}

export function attendanceReport(user: User, q: ReportQuery): AttendanceReport {
  return attendanceOf(contextOf(user, q)).report
}

/* ---------------- Leave ---------------- */

function leaveOf(ctx: ReportCtx): { report: LeaveReport; requests: typeof hrLeaveRequests } {
  const types = hrLeaveTypes.filter((t) => t.companyId === ctx.co)
  const holidays = holidayMap(ctx.co)
  const approved = hrLeaveRequests.filter((r) => r.companyId === ctx.co && ctx.ids.has(r.employeeId) && r.status === 'approved')
  const byType = new Map<string, number>()
  const byMonth = new Map<string, Map<string, number>>(monthsBetween(ctx.from, ctx.to).map((m) => [m, new Map()]))
  const inPeriod: typeof hrLeaveRequests = []
  for (const r of approved) {
    if (r.endDate < ctx.from || r.startDate > ctx.to) continue
    inPeriod.push(r)
    const { dates } = leaveDayCount(r.startDate, r.endDate, r.halfDay, ctx.time.weekend, holidays)
    const weight = r.halfDay ? 0.5 : 1
    for (const d of dates) {
      if (d < ctx.from || d > ctx.to) continue
      byType.set(r.leaveTypeId, (byType.get(r.leaveTypeId) ?? 0) + weight)
      const m = byMonth.get(d.slice(0, 7))
      if (m) m.set(r.leaveTypeId, (m.get(r.leaveTypeId) ?? 0) + weight)
    }
  }
  const typeOf = (id: string) => types.find((t) => t.id === id)
  const year = Number(ctx.asOf.slice(0, 4))
  const people = onPayroll(ctx)
  const balances = types
    .filter((t) => t.isActive && t.isPaid)
    .map((t) => {
      const rows = people.filter((e) => !t.gender || !e.gender || t.gender === e.gender).map((e) => balanceOf(ctx.time, e, t, year))
      const sum = (k: 'accruedDays' | 'usedDays' | 'pendingDays' | 'remainingDays') => round2(rows.reduce((s, b) => s + b[k] + (k === 'accruedDays' ? b.carriedDays : 0), 0))
      return { leaveTypeId: t.id, name: t.name, employees: rows.length, accruedDays: sum('accruedDays'), usedDays: sum('usedDays'), pendingDays: sum('pendingDays'), remainingDays: sum('remainingDays') }
    })
  const horizon = addDaysIso(ctx.today, 30)
  const upcoming = approved
    .filter((r) => r.endDate >= ctx.today && r.startDate <= horizon)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((r) => ({ ...person(ctx.employees.find((e) => e.id === r.employeeId)!), leaveTypeName: typeOf(r.leaveTypeId)?.name ?? 'Leave', startDate: r.startDate, endDate: r.endDate, days: r.days }))
  const byTypeRows = [...byType.entries()]
    .map(([id, days]) => ({ leaveTypeId: id, name: typeOf(id)?.name ?? 'Leave', color: typeOf(id)?.color ?? '#94a3b8', days: round2(days) }))
    .sort((a, b) => b.days - a.days)
  return {
    report: {
      ...meta(ctx),
      year,
      totalDays: round2(byTypeRows.reduce((s, r) => s + r.days, 0)),
      byType: byTypeRows,
      byMonth: [...byMonth.entries()].map(([month, m]) => ({
        month,
        days: round2([...m.values()].reduce((s, v) => s + v, 0)),
        byType: [...m.entries()].map(([leaveTypeId, days]) => ({ leaveTypeId, days: round2(days) })),
      })),
      balances,
      upcoming,
      pendingRequests: hrLeaveRequests.filter((r) => r.companyId === ctx.co && ctx.ids.has(r.employeeId) && (r.status === 'pending_head' || r.status === 'pending_hr')).length,
    },
    requests: inPeriod,
  }
}

export function leaveReport(user: User, q: ReportQuery): LeaveReport {
  return leaveOf(contextOf(user, q)).report
}

/* ---------------- Compliance & expiries (as of today) ---------------- */

function complianceOf(ctx: ReportCtx): ComplianceReport {
  const current = ctx.employees.filter((e) => employedOn(e, ctx.today) || e.hireDate > ctx.today)
  const byId = new Map(current.map((e) => [e.id, e]))
  const rows: ComplianceRow[] = []
  const push = (kind: ComplianceKind, id: string, e: Emp, label: string, date: string) => {
    const bucket = expiryBucket(ctx.today, date)
    if (!bucket) return
    if (kind === 'probation' && bucket === 'expired') return // a probation that ended is done, not overdue
    rows.push({ ...person(e), id, kind, label, date, daysLeft: daysBetweenIso(ctx.today, date), bucket })
  }
  for (const d of hrDocuments) {
    const e = d.companyId === ctx.co ? byId.get(d.employeeId) : undefined
    if (e && d.expiryDate) push('document', d.id, e, DOCUMENT_TYPE_LABEL[d.type] ?? d.type, d.expiryDate)
  }
  for (const c of hrContracts) {
    const e = c.companyId === ctx.co && c.status === 'active' ? byId.get(c.employeeId) : undefined
    if (!e) continue
    if (c.endDate) push('contract', c.id, e, CONTRACT_TYPE_LABEL[c.type] ?? c.type, c.endDate)
    if (c.probationEndDate) push('probation', `${c.id}:probation`, e, CONTRACT_TYPE_LABEL[c.type] ?? c.type, c.probationEndDate)
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName))
  const kinds: ComplianceKind[] = ['document', 'contract', 'probation']
  return {
    ...meta(ctx),
    summary: kinds.map((kind) => {
      const of = rows.filter((r) => r.kind === kind)
      const n = (b: string) => of.filter((r) => r.bucket === b).length
      return { kind, expired: n('expired'), d30: n('d30'), d60: n('d60'), d90: n('d90') }
    }),
    rows,
  }
}

export function complianceReport(user: User, q: ReportQuery): ComplianceReport {
  return complianceOf(contextOf(user, q))
}

/* ---------------- Assets ---------------- */

function scopedAssets(ctx: ReportCtx) {
  const holder = (a: (typeof hrAssets)[number]) => a.assignments.find((x) => !x.returnedDate && !x.lost)?.employeeId ?? null
  // HR full without a department filter: the whole register (stock included); otherwise the assets their people hold.
  const whole = ctx.scope === 'full' && !ctx.departmentId
  return hrAssets
    .filter((a) => a.companyId === ctx.co)
    .map((a) => ({ a, holderId: holder(a) }))
    .filter(({ holderId }) => whole || (!!holderId && ctx.ids.has(holderId)))
}

function assetsOf(ctx: ReportCtx): AssetsReport {
  const rows = scopedAssets(ctx)
  const group = (keyOf: (a: (typeof rows)[number]['a']) => string, label: (k: string) => string) => {
    const m = new Map<string, { count: number; value: number }>()
    for (const { a } of rows) {
      const g = m.get(keyOf(a)) ?? { count: 0, value: 0 }
      g.count++
      g.value += a.cost ?? 0
      m.set(keyOf(a), g)
    }
    return [...m.entries()].map(([key, g]) => ({ key, label: label(key), count: g.count, value: round2(g.value) })).sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
  }
  const horizon = addDaysIso(ctx.today, 90)
  const emp = (id: string | null) => (id ? (employeesOf(ctx.co).find((e) => e.id === id)?.fullName ?? null) : null)
  return {
    ...meta(ctx),
    count: rows.length,
    value: round2(rows.reduce((s, { a }) => s + (a.cost ?? 0), 0)),
    assigned: rows.filter(({ a }) => a.status === 'assigned').length,
    available: rows.filter(({ a }) => a.status === 'in_stock').length,
    byStatus: group((a) => a.status, (k) => ASSET_STATUS_LABEL[k as AssetStatus] ?? k),
    byCategory: group((a) => a.category, (k) => ASSET_CATEGORY_LABEL[k as AssetCategory] ?? k),
    warranties: rows
      .filter(({ a }) => a.warrantyEnd && a.warrantyEnd >= ctx.today && a.warrantyEnd <= horizon && a.status !== 'retired' && a.status !== 'lost')
      .map(({ a, holderId }) => ({ id: a.id, tag: a.tag, name: a.name, warrantyEnd: a.warrantyEnd!, daysLeft: daysBetweenIso(ctx.today, a.warrantyEnd!), assignedToName: emp(holderId) }))
      .sort((x, y) => x.warrantyEnd.localeCompare(y.warrantyEnd)),
  }
}

export function assetsReport(user: User, q: ReportQuery): AssetsReport {
  return assetsOf(contextOf(user, q))
}

/* ---------------- Recruitment ---------------- */

function recruitmentOf(ctx: ReportCtx): RecruitmentReport {
  const filter = ctx.departmentId ? new Set(departmentSubtree(ctx.departmentId, coDepartments(ctx.co))) : null
  const openings = hrOpenings.filter(
    (o) => o.companyId === ctx.co && (!ctx.allowedDepartments || ctx.allowedDepartments.has(o.departmentId)) && (!filter || filter.has(o.departmentId)),
  )
  const openingIds = new Set(openings.map((o) => o.id))
  const allApps = hrApplications.filter((a) => a.companyId === ctx.co && openingIds.has(a.openingId))
  const apps = allApps.filter((a) => inRange(localDay(ctx, a.createdAt), ctx.from, ctx.to))
  const interviewed = new Set(hrInterviews.filter((i) => i.companyId === ctx.co && i.status !== 'cancelled').map((i) => i.applicationId))
  const offersAll = hrOffers.filter((o) => o.companyId === ctx.co && allApps.some((a) => a.id === o.applicationId))
  const offered = new Set(offersAll.map((o) => o.applicationId))
  const hires = allApps.filter((a) => a.stage === 'hired' && inRange(localDay(ctx, a.stageChangedAt), ctx.from, ctx.to))
  const offers = offersAll.filter((o) => inRange(localDay(ctx, o.createdAt), ctx.from, ctx.to))
  const accepted = offers.filter((o) => o.status === 'accepted').length
  const declined = offers.filter((o) => o.status === 'declined').length
  const hiredOf = (id: string) => allApps.filter((a) => a.openingId === id && a.stage === 'hired').length
  const live = openings.filter((o) => o.status === 'open' || o.status === 'on_hold')
  const candidates = new Map(hrCandidates.filter((c) => c.companyId === ctx.co).map((c) => [c.id, c]))
  return {
    ...meta(ctx),
    applications: apps.length,
    funnel: funnel(
      apps.map((a) => ({ stage: a.stage, interviewed: interviewed.has(a.id), offered: offered.has(a.id) })),
      STAGE_LABEL as Record<string, string>,
    ),
    rejected: apps.filter((a) => a.stage === 'rejected').length,
    withdrawn: apps.filter((a) => a.stage === 'withdrawn').length,
    hires: hires.length,
    averageTimeToHireDays: averageOf(hires.map((a) => daysToHire(a.createdAt, a.stageChangedAt))),
    openPositions: live.reduce((s, o) => s + Math.max(0, o.headcount - hiredOf(o.id)), 0),
    openings: live
      .map((o) => ({
        id: o.id,
        title: o.title,
        departmentName: deptName(ctx.co, o.departmentId),
        status: OPENING_STATUS_LABEL[o.status] ?? o.status,
        headcount: o.headcount,
        hired: hiredOf(o.id),
        remaining: Math.max(0, o.headcount - hiredOf(o.id)),
        applications: allApps.filter((a) => a.openingId === o.id).length,
      }))
      .sort((a, b) => b.remaining - a.remaining || a.title.localeCompare(b.title)),
    offers: {
      sent: offers.filter((o) => o.status !== 'draft').length,
      accepted,
      declined,
      pending: offers.filter((o) => o.status === 'sent').length,
      acceptanceRatePct: sharePct(accepted, accepted + declined),
    },
    bySource: countBy(
      apps.map((a) => candidates.get(a.candidateId)?.source ?? 'other'),
      (s) => s,
      (k) => CANDIDATE_SOURCE_LABEL[k as CandidateSource] ?? k,
    ),
  }
}

export function recruitmentReport(user: User, q: ReportQuery): RecruitmentReport {
  return recruitmentOf(contextOf(user, q))
}

/* ---------------- Training ---------------- */

function trainingOf(ctx: ReportCtx): TrainingReport {
  const people = ctx.employees.filter((e) => employedOn(e, ctx.today))
  const courses = hrCourses.filter((c) => c.companyId === ctx.co && c.mandatory && c.active)
  const byDept = new Map<string, MatrixCell[]>()
  const all: MatrixCell[] = []
  const byCourse = courses.map((c) => ({ courseId: c.id, title: c.title, cells: [] as MatrixCell[] }))
  for (const e of people) {
    for (const [i, c] of courses.entries()) {
      const cell = cellFor(ctx.co, ctx.today, e, c)
      all.push(cell)
      byCourse[i].cells.push(cell)
      byDept.set(e.departmentId ?? '', [...(byDept.get(e.departmentId ?? '') ?? []), cell])
    }
  }
  const certs = hrCertificates.filter((c) => c.companyId === ctx.co && ctx.ids.has(c.employeeId) && people.some((e) => e.id === c.employeeId))
  const courseTitle = (id: string) => hrCourses.find((c) => c.companyId === ctx.co && c.id === id)?.title ?? 'Course'
  const states = certs.map((c) => ({ c, ...certificateState(ctx.today, c.expiryDate) }))
  const sessions = hrSessions.filter((s) => s.companyId === ctx.co && s.status !== 'cancelled')
  const seatsOf = (sessionId: string) => hrEnrollments.filter((e) => e.companyId === ctx.co && e.sessionId === sessionId && e.status !== 'invited')
  /** Spend of the sessions starting in [from, to] for the employees in scope (course fee per seat + a share of the extra cost). */
  const spendIn = (from: string, to: string) => {
    let total = 0
    for (const s of sessions) {
      if (!inRange(s.startDate, from, to)) continue
      const course = hrCourses.find((c) => c.companyId === ctx.co && c.id === s.courseId)
      if (!course) continue
      const seats = seatsOf(s.id)
      const mine = seats.filter((e) => ctx.ids.has(e.employeeId))
      total += mine.length * course.cost + (seats.length ? (s.extraCost * mine.length) / seats.length : 0)
      if (!seats.length && ctx.scope === 'full' && !ctx.departmentId) total += s.extraCost
    }
    return round2(total)
  }
  const full = ctx.scope === 'full'
  const budgetYear = Number(ctx.to.slice(0, 4))
  const budget = full ? (reportSettingsOf(ctx.co).trainingBudgets.find((b) => b.year === budgetYear)?.amount ?? null) : null
  const yearSpend = full ? spendIn(`${budgetYear}-01-01`, `${budgetYear}-12-31`) : null
  const sessionIds = new Set(sessions.filter((s) => inRange(s.startDate, ctx.from, ctx.to)).map((s) => s.id))
  return {
    ...meta(ctx),
    compliancePct: compliancePct(all),
    mandatoryCourses: courses.length,
    overdue: all.filter(isOverdue).length,
    byDepartment: [...byDept.entries()]
      .map(([k, cells]) => ({ key: k, label: deptName(ctx.co, k || null), compliancePct: compliancePct(cells ), cells: cells.length }))
      .sort((a, b) => a.compliancePct - b.compliancePct || a.label.localeCompare(b.label)),
    byCourse: byCourse.map((c) => ({ courseId: c.courseId, title: c.title, compliancePct: compliancePct(c.cells), compliant: c.cells.filter(isCompliant).length, cells: c.cells.length })),
    certificatesExpiring: states
      .filter((s) => s.state === 'expiring')
      .map((s) => ({ ...person(people.find((e) => e.id === s.c.employeeId)!), certificateId: s.c.id, courseTitle: courseTitle(s.c.courseId), expiryDate: s.c.expiryDate!, daysLeft: s.daysLeft ?? 0 }))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    certificatesExpired: states.filter((s) => s.state === 'expired').length,
    completions: hrEnrollments.filter((e) => e.companyId === ctx.co && ctx.ids.has(e.employeeId) && e.status === 'completed' && sessionIds.has(e.sessionId)).length,
    spend: full ? spendIn(ctx.from, ctx.to) : null,
    budgetYear,
    yearSpend,
    budget,
    budgetUsedPct: budget && yearSpend !== null ? sharePct(yearSpend, budget) : null,
    canEditBudget: full,
  }
}

export function trainingReport(user: User, q: ReportQuery): TrainingReport {
  return trainingOf(contextOf(user, q))
}

/* ---------------- Payroll cost (committed), HR full only ---------------- */

/**
 * Where the monthly cost per employee comes from.
 *
 * Payroll (Salary Management): a month with an APPROVED or PAID payroll run uses the run's lines (gross pay per
 * employee: prorated contract pay, overtime, allowances and bonuses; not the employer's social insurance); a month
 * without one (or with only a draft / calculated run) falls back to COMMITTED pay from the contract in force that
 * month. `source` is `payroll_runs` as soon as one month of the range comes from a run, else `contracts`.
 * The response shape is the same either way.
 */
type PayrollCostSource = (ctx: ReportCtx, e: Emp, month: string) => number

const committedFromContracts: PayrollCostSource = (ctx, e, month) => {
  const left = leftOn(e)
  if (e.hireDate > monthEnd(month) || (left && left < monthStart(month))) return 0
  // The contract in force that month (the latest start when a renewal starts mid-month: never both).
  const c = hrContracts
    .filter((x) => x.companyId === ctx.co && x.employeeId === e.id && contractCoversMonth(x, month))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  return c ? monthlyPay(c) : 0
}

/** Gross pay per employee of the months that have an approved / paid run (month → employee → gross). */
function runGrossByMonth(co: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const r of hrPayrollRuns) {
    if (r.companyId !== co || (r.status !== 'approved' && r.status !== 'paid')) continue
    const m = new Map<string, number>()
    for (const l of r.lines) m.set(l.employeeId, (m.get(l.employeeId) ?? 0) + l.gross)
    out.set(r.month, m)
  }
  return out
}

/** Run totals where a month has an approved / paid run; committed contract pay for the other months. */
function payrollRunsOrContracts(runs: Map<string, Map<string, number>>): PayrollCostSource {
  return (ctx, e, month) => {
    const m = runs.get(month)
    return m ? (m.get(e.id) ?? 0) : committedFromContracts(ctx, e, month)
  }
}

function payrollCostOf(ctx: ReportCtx, override?: PayrollCostSource): PayrollCostReport {
  if (ctx.scope !== 'full') throw forbidden(PAY_FORBIDDEN)
  const months = monthsBetween(ctx.from, ctx.to)
  const runs = runGrossByMonth(ctx.co)
  const fromRuns = !override && months.some((m) => runs.has(m))
  const source = override ?? payrollRunsOrContracts(runs)
  const perMonth = months.map((month) => ({ month, amount: 0, employees: 0 }))
  const byDept = new Map<string, { employees: Set<string>; total: number; last: number }>()
  for (const e of ctx.employees) {
    months.forEach((month, i) => {
      const amount = source(ctx, e, month)
      if (!amount) return
      perMonth[i].amount += amount
      perMonth[i].employees++
      const d = byDept.get(e.departmentId ?? '') ?? { employees: new Set(), total: 0, last: 0 }
      d.employees.add(e.id)
      d.total += amount
      if (month === ctx.asOf.slice(0, 7)) d.last += amount
      byDept.set(e.departmentId ?? '', d)
    })
  }
  return {
    ...meta(ctx),
    source: fromRuns ? 'payroll_runs' : 'contracts',
    months: perMonth.map((m) => ({ ...m, amount: round2(m.amount) })),
    byDepartment: [...byDept.entries()]
      .map(([k, d]) => ({ key: k, label: deptName(ctx.co, k || null), employees: d.employees.size, monthly: round2(d.last), total: round2(d.total) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    currentMonthly: round2(perMonth.find((m) => m.month === ctx.asOf.slice(0, 7))?.amount ?? perMonth[perMonth.length - 1]?.amount ?? 0),
    total: round2(perMonth.reduce((s, m) => s + m.amount, 0)),
    note: fromRuns
      ? 'Gross pay from the approved / paid payroll runs (prorated pay, overtime, allowances, bonuses; before deductions, without employer social insurance), in the company currency. Months without an approved run use the committed contract pay.'
      : 'Committed cost from the contracts in force each month (basic + housing + transport + other allowances), in the company currency. No approved payroll run in this range yet: no overtime, deductions or end-of-service.',
  }
}

export function payrollCostReport(user: User, q: ReportQuery): PayrollCostReport {
  return payrollCostOf(contextOf(user, q))
}

/* ---------------- Overview ---------------- */

function overviewOf(ctx: ReportCtx): OverviewReport {
  const head = headcountOf(ctx)
  const turn = periodTurnover(turnoverMonths(ctx))
  const nat = nationalisationOf(ctx)
  const docs = complianceOf(ctx).summary.find((s) => s.kind === 'document')!
  return {
    ...meta(ctx),
    headcount: head.total,
    joiners: turn.joiners,
    leavers: turn.leavers,
    turnoverPct: turn.turnoverPct,
    absenceRatePct: attendanceOf(ctx).report.totals.absenceRatePct,
    openPositions: recruitmentOf(ctx).openPositions,
    expiringDocuments: docs.d30 + docs.d60,
    expiredDocuments: docs.expired,
    nationalisationLabel: nat.label,
    nationalisationPct: nat.pct,
    nationalisationTargetPct: nat.targetPct,
    trainingCompliancePct: trainingOf(ctx).compliancePct,
    monthlyPayrollCost: ctx.scope === 'full' ? payrollCostOf(ctx).currentMonthly : null,
    trend: head.trend,
  }
}

export function overviewReport(user: User, q: ReportQuery): OverviewReport {
  return overviewOf(contextOf(user, q))
}

/* ---------------- CSV export ---------------- */

const pct = (n: number | null) => (n === null ? null : n)
const minutesToHours = (m: number) => round1(m / 60)

/**
 * Rows of a report's CSV (built client-side from `headers` + `rows`). Same scope as the report; never a
 * document number or an IBAN, and pay only in the Payroll cost export (HR full only).
 */
export function exportReport(user: User, report: string, q: ReportQuery): ReportExport {
  if (!(REPORT_KEYS as string[]).includes(report)) throw notFound()
  const key = report as ReportKey
  const ctx = contextOf(user, q)
  if (FULL_ONLY_REPORTS.includes(key) && ctx.scope !== 'full') throw forbidden(PAY_FORBIDDEN)
  let headers: string[] = []
  let rows: (string | number | null)[][] = []
  const dep = (e: Emp) => (e.departmentId ? deptName(ctx.co, e.departmentId) : 'No department')
  switch (key) {
    case 'overview': {
      const o = overviewOf(ctx)
      headers = ['Metric', 'Value']
      rows = [
        ['Headcount', o.headcount],
        ['Joiners', o.joiners],
        ['Leavers', o.leavers],
        ['Turnover %', pct(o.turnoverPct)],
        ['Absence rate %', pct(o.absenceRatePct)],
        ['Open positions', o.openPositions],
        ['Documents expiring (60 days)', o.expiringDocuments],
        ['Documents expired', o.expiredDocuments],
        [`${o.nationalisationLabel} %`, pct(o.nationalisationPct)],
        [`${o.nationalisationLabel} target %`, pct(o.nationalisationTargetPct)],
        ['Mandatory training compliance %', o.trainingCompliancePct],
        ...(o.monthlyPayrollCost !== null ? [[`Committed monthly payroll (${ctx.currency})`, o.monthlyPayrollCost] as (string | number | null)[]] : []),
      ]
      break
    }
    case 'headcount': {
      headers = ['Employee no', 'Name', 'Department', 'Job title', 'Nationality', 'Gender', 'Employment type', 'Hire date', 'Status']
      rows = onPayroll(ctx)
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
        .map((e) => [e.employeeNo, e.fullName, dep(e), e.jobTitle, e.nationality, e.gender ?? '', EMPLOYMENT_TYPE_LABEL[e.employmentType], e.hireDate, e.status])
      break
    }
    case 'turnover': {
      const t = turnoverOf(ctx)
      headers = ['Month', 'Joiners', 'Leavers', 'Opening headcount', 'Closing headcount', 'Average headcount', 'Turnover %']
      rows = t.months.map((m) => [m.month, m.joiners, m.leavers, m.opening, m.closing, m.averageHeadcount, pct(m.turnoverPct)])
      rows.push(['Total', t.joiners, t.leavers, null, null, t.averageHeadcount, pct(t.turnoverPct)])
      break
    }
    case 'nationalisation': {
      const n = nationalisationOf(ctx)
      headers = ['Month', 'Nationals', 'Headcount', `${n.label} %`, 'Target %']
      rows = n.trend.map((p) => [p.month, p.nationals, p.total, pct(p.pct), pct(n.targetPct)])
      break
    }
    case 'attendance': {
      const a = attendanceOf(ctx)
      headers = ['Employee no', 'Name', 'Department', 'Expected days', 'Days present', 'Late arrivals', 'Late hours', 'Absences', 'Absence rate %', 'Overtime hours']
      rows = a.perEmployee
        .sort((x, y) => x.e.employeeNo.localeCompare(y.e.employeeNo))
        .map(({ e, t }) => [e.employeeNo, e.fullName, dep(e), t.expectedDays, t.presentDays, t.lateArrivals, minutesToHours(t.lateMinutes), t.absences, pct(t.absenceRatePct), minutesToHours(t.overtimeMinutes)])
      break
    }
    case 'leave': {
      const { requests } = leaveOf(ctx)
      const types = hrLeaveTypes.filter((t) => t.companyId === ctx.co)
      headers = ['Employee no', 'Name', 'Department', 'Leave type', 'Start date', 'End date', 'Working days']
      rows = requests
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((r) => {
          const e = ctx.employees.find((x) => x.id === r.employeeId)!
          return [e.employeeNo, e.fullName, dep(e), types.find((t) => t.id === r.leaveTypeId)?.name ?? 'Leave', r.startDate, r.endDate, r.days]
        })
      break
    }
    case 'compliance': {
      const c = complianceOf(ctx)
      headers = ['Employee no', 'Name', 'Department', 'What', 'Type', 'Date', 'Days left', 'Status']
      rows = c.rows.map((r) => [r.employeeNo, r.employeeName, r.departmentName ?? 'No department', COMPLIANCE_KIND_LABEL[r.kind], r.label, r.date, r.daysLeft, EXPIRY_BUCKET_LABEL[r.bucket]])
      break
    }
    case 'assets': {
      const emp = (id: string | null) => (id ? (employeesOf(ctx.co).find((e) => e.id === id)?.fullName ?? '') : '')
      headers = ['Tag', 'Name', 'Category', 'Status', `Value (${ctx.currency})`, 'Held by', 'Warranty end']
      rows = scopedAssets(ctx).map(({ a, holderId }) => [a.tag, a.name, ASSET_CATEGORY_LABEL[a.category], ASSET_STATUS_LABEL[a.status], a.cost, emp(holderId), a.warrantyEnd])
      break
    }
    case 'recruitment': {
      const r = recruitmentOf(ctx)
      headers = ['Stage', 'Applications reached', 'Conversion from previous %']
      rows = r.funnel.map((s) => [s.label, s.reached, pct(s.conversionPct)])
      break
    }
    case 'training': {
      const t = trainingOf(ctx)
      headers = ['Mandatory course', 'Compliant', 'Employees × course', 'Compliance %']
      rows = t.byCourse.map((c) => [c.title, c.compliant, c.cells, c.compliancePct])
      break
    }
    case 'payroll-cost': {
      const p = payrollCostOf(ctx)
      headers = ['Month', 'Employees', `Committed cost (${ctx.currency})`]
      rows = p.months.map((m) => [m.month, m.employees, m.amount])
      rows.push(['Total', null, p.total])
      break
    }
  }
  const dept = ctx.departmentId ? `-${ctx.departmentId}` : ''
  return { report: key, fileName: `hr-${key}${dept}-${ctx.from}-to-${ctx.to}.csv`, headers, rows }
}

/* ---------------- Settings ---------------- */

function settingsView(co: string): ReportSettings {
  const s = reportSettingsOf(co)
  return {
    nationalisationTargetPct: s.nationalisationTargetPct,
    trainingBudgets: [...s.trainingBudgets].sort((a, b) => a.year - b.year),
    currency: companyById(co)?.regional.currency ?? 'AED',
    updatedAt: s.updatedAt,
  }
}

/** PUT /hr/reports/settings (HR full): the nationalisation target and the training budget of a year. */
export function updateReportSettings(user: User, input: ReportSettingsInput | null): ReportSettings {
  if (reportScope(user) !== 'full') throw forbidden('Only HR (full access) can change report targets.')
  const co = tenantOf(user)
  const body = input ?? {}
  let target: number | null | undefined
  if (body.nationalisationTargetPct !== undefined) {
    const raw = body.nationalisationTargetPct as unknown
    if (raw === null || raw === '') target = null
    else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 100) throw invalid('The target is a percentage from 0 to 100.', 'nationalisation_target_pct')
      target = round1(n)
    }
  }
  let budget: { year: number; amount: number | null } | undefined
  if (body.trainingBudget !== undefined) {
    const b = body.trainingBudget as { year?: unknown; amount?: unknown } | null
    const year = Number(b?.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid('Pick the budget year.', 'training_budget.year')
    const rawAmount = b?.amount
    if (rawAmount === null || rawAmount === '' || rawAmount === undefined) budget = { year, amount: null }
    else {
      const amount = Number(rawAmount)
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) throw invalid('The budget is an amount of 0 or more.', 'training_budget.amount')
      budget = { year, amount: round2(amount) }
    }
  }
  if (target === undefined && budget === undefined) throw invalid('Nothing to change.')
  let row = hrReportSettings.find((s) => s.companyId === co)
  if (!row) {
    row = { companyId: co, nationalisationTargetPct: null, trainingBudgets: [], updatedAt: null, updatedBy: null }
    hrReportSettings.push(row)
  }
  if (target !== undefined) row.nationalisationTargetPct = target
  if (budget) {
    row.trainingBudgets = row.trainingBudgets.filter((x) => x.year !== budget.year)
    if (budget.amount !== null) row.trainingBudgets.push({ year: budget.year, amount: budget.amount })
  }
  row.updatedAt = nowIso()
  row.updatedBy = user.id
  return settingsView(co)
}

