/**
 * HR › Reports (docs/API.md › HR › HR reports). One aggregate per report, computed server-side over the
 * caller's scope (HR full: the company; Department Head: the departments they head and their
 * sub-departments, never pay). UI names are camelCase; the wire is snake_case (hrReportsMappers.ts, deep).
 * Every list is an array (no data-keyed maps), so the mechanical key mapping never touches data.
 */

export type ReportKey =
  | 'overview'
  | 'headcount'
  | 'turnover'
  | 'nationalisation'
  | 'attendance'
  | 'leave'
  | 'compliance'
  | 'assets'
  | 'recruitment'
  | 'training'
  | 'payroll-cost'

export const REPORT_KEYS: ReportKey[] = ['overview', 'headcount', 'turnover', 'nationalisation', 'attendance', 'leave', 'compliance', 'assets', 'recruitment', 'training', 'payroll-cost']

export const REPORT_LABEL: Record<ReportKey, string> = {
  overview: 'Overview',
  headcount: 'Headcount',
  turnover: 'Joiners & leavers',
  nationalisation: 'Nationalisation',
  attendance: 'Attendance',
  leave: 'Leave',
  compliance: 'Compliance & expiries',
  assets: 'Assets',
  recruitment: 'Recruitment',
  training: 'Training',
  'payroll-cost': 'Payroll cost',
}

/** Reports only HR full may open (pay amounts). */
export const FULL_ONLY_REPORTS: ReportKey[] = ['payroll-cost']

export type ReportScope = 'full' | 'team'

export interface ReportQuery {
  from?: string
  to?: string
  departmentId?: string
}

/** Common header of every report answer. */
export interface ReportMeta {
  from: string
  to: string
  /** min(to, today): point-in-time figures ("current headcount") are taken on this day. */
  asOf: string
  today: string
  timezone: string
  currency: string
  scope: ReportScope
  departmentId: string | null
  departmentName: string | null
}

export interface CountRow {
  key: string
  label: string
  count: number
}

export interface DepartmentOption {
  id: string
  name: string
  parentId: string | null
}

export interface ReportOptions {
  scope: ReportScope
  departments: DepartmentOption[]
  reports: ReportKey[]
  defaultFrom: string
  defaultTo: string
  today: string
  timezone: string
  currency: string
  country: string
  /** "Emiratisation" (AE), "Saudization" (SA), else "Nationalisation". */
  nationalisationLabel: string
  canEditSettings: boolean
}

/* ---- headcount ---- */

export interface MonthPoint {
  month: string // yyyy-MM
  headcount: number
}

export interface HeadcountReport extends ReportMeta {
  total: number
  byDepartment: CountRow[]
  byNationality: CountRow[]
  byGender: CountRow[]
  byEmploymentType: CountRow[]
  trend: MonthPoint[]
}

/* ---- joiners, leavers, turnover ---- */

export interface TurnoverMonth {
  month: string
  joiners: number
  leavers: number
  opening: number
  closing: number
  averageHeadcount: number
  turnoverPct: number | null
}

export interface PersonRow {
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
}

export interface LeaverRow extends PersonRow {
  exitDate: string
  tenureYears: number
}

export interface TurnoverReport extends ReportMeta {
  months: TurnoverMonth[]
  joiners: number
  leavers: number
  averageHeadcount: number
  turnoverPct: number | null
  /** Mean tenure of the headcount on `asOf`, in years (one decimal). */
  averageTenureYears: number | null
  leaverList: LeaverRow[]
  joinerList: (PersonRow & { hireDate: string })[]
  probation: { passed: number; leftInProbation: number; inProbationNow: number }
}

/* ---- nationalisation ---- */

export interface NationalisationPoint {
  month: string
  nationals: number
  total: number
  pct: number | null
}

export interface NationalisationReport extends ReportMeta {
  country: string
  label: string
  targetPct: number | null
  canEditTarget: boolean
  nationals: number
  total: number
  pct: number | null
  gapToTarget: number | null
  trend: NationalisationPoint[]
  byDepartment: { key: string; label: string; nationals: number; total: number; pct: number | null }[]
  disclaimer: string
}

/* ---- attendance ---- */

export interface AttendanceTotals {
  expectedDays: number
  presentDays: number
  lateArrivals: number
  lateMinutes: number
  absences: number
  overtimeMinutes: number
  absenceRatePct: number | null
}

export interface AttendanceReport extends ReportMeta {
  trackedFrom: string | null
  totals: AttendanceTotals
  byMonth: (AttendanceTotals & { month: string })[]
  byDepartment: (AttendanceTotals & { key: string; label: string })[]
  topLate: (PersonRow & { lateArrivals: number; lateMinutes: number })[]
}

/* ---- leave ---- */

export interface LeaveTypeTotal {
  leaveTypeId: string
  name: string
  color: string
  days: number
}

export interface LeaveReport extends ReportMeta {
  year: number
  totalDays: number
  byType: LeaveTypeTotal[]
  byMonth: { month: string; days: number; byType: { leaveTypeId: string; days: number }[] }[]
  balances: { leaveTypeId: string; name: string; employees: number; accruedDays: number; usedDays: number; pendingDays: number; remainingDays: number }[]
  upcoming: (PersonRow & { leaveTypeName: string; startDate: string; endDate: string; days: number })[]
  pendingRequests: number
}

/* ---- compliance ---- */

export type ExpiryBucket = 'expired' | 'd30' | 'd60' | 'd90'
export const EXPIRY_BUCKET_LABEL: Record<ExpiryBucket, string> = { expired: 'Expired', d30: 'Within 30 days', d60: 'In 31–60 days', d90: 'In 61–90 days' }
export type ComplianceKind = 'document' | 'contract' | 'probation'
export const COMPLIANCE_KIND_LABEL: Record<ComplianceKind, string> = { document: 'Document', contract: 'Contract end', probation: 'Probation end' }

export interface ComplianceRow extends PersonRow {
  id: string
  kind: ComplianceKind
  /** Document type / contract type label (never a document number). */
  label: string
  date: string
  daysLeft: number
  bucket: ExpiryBucket
}

export interface ComplianceReport extends ReportMeta {
  summary: { kind: ComplianceKind; expired: number; d30: number; d60: number; d90: number }[]
  rows: ComplianceRow[]
}

/* ---- assets ---- */

export interface AssetGroupRow {
  key: string
  label: string
  count: number
  value: number
}

export interface AssetsReport extends ReportMeta {
  count: number
  value: number
  assigned: number
  available: number
  byStatus: AssetGroupRow[]
  byCategory: AssetGroupRow[]
  warranties: { id: string; tag: string; name: string; warrantyEnd: string; daysLeft: number; assignedToName: string | null }[]
}

/* ---- recruitment ---- */

export interface FunnelStage {
  stage: string
  label: string
  reached: number
  /** Share of the previous stage that reached this one (null for the first stage or when the previous is 0). */
  conversionPct: number | null
}

export interface RecruitmentReport extends ReportMeta {
  applications: number
  funnel: FunnelStage[]
  rejected: number
  withdrawn: number
  hires: number
  averageTimeToHireDays: number | null
  openPositions: number
  openings: { id: string; title: string; departmentName: string; status: string; headcount: number; hired: number; remaining: number; applications: number }[]
  offers: { sent: number; accepted: number; declined: number; pending: number; acceptanceRatePct: number | null }
  bySource: CountRow[]
}

/* ---- training ---- */

export interface TrainingReport extends ReportMeta {
  compliancePct: number
  mandatoryCourses: number
  overdue: number
  byDepartment: { key: string; label: string; compliancePct: number; cells: number }[]
  byCourse: { courseId: string; title: string; compliancePct: number; compliant: number; cells: number }[]
  certificatesExpiring: (PersonRow & { certificateId: string; courseTitle: string; expiryDate: string; daysLeft: number })[]
  certificatesExpired: number
  completions: number
  /** HR full only (null for Department Heads). */
  spend: number | null
  budgetYear: number
  yearSpend: number | null
  budget: number | null
  budgetUsedPct: number | null
  canEditBudget: boolean
}

/* ---- payroll cost (committed) ---- */

export interface PayrollCostReport extends ReportMeta {
  /** 'contracts' today; 'payroll_runs' once Salary Management's runs feed this report. */
  source: 'contracts' | 'payroll_runs'
  months: { month: string; amount: number; employees: number }[]
  byDepartment: { key: string; label: string; employees: number; monthly: number; total: number }[]
  /** Committed cost of the last month of the range. */
  currentMonthly: number
  total: number
  note: string
}

/* ---- overview ---- */

export interface OverviewReport extends ReportMeta {
  headcount: number
  joiners: number
  leavers: number
  turnoverPct: number | null
  absenceRatePct: number | null
  openPositions: number
  expiringDocuments: number
  expiredDocuments: number
  nationalisationLabel: string
  nationalisationPct: number | null
  nationalisationTargetPct: number | null
  trainingCompliancePct: number
  /** HR full only. */
  monthlyPayrollCost: number | null
  trend: MonthPoint[]
}

/* ---- export & settings ---- */

export interface ReportExport {
  report: ReportKey
  fileName: string
  headers: string[]
  rows: (string | number | null)[][]
}

export interface ReportSettings {
  nationalisationTargetPct: number | null
  trainingBudgets: { year: number; amount: number }[]
  currency: string
  updatedAt: string | null
}

export interface ReportSettingsInput {
  nationalisationTargetPct?: number | null
  trainingBudget?: { year: number; amount: number | null }
}
