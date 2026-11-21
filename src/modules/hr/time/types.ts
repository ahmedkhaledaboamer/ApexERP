/**
 * HR › Attendance and Leave (docs/API.md › HR › Attendance, Leave, Public holidays). UI camelCase; the
 * API speaks snake_case through shared/api/hrTimeMappers.ts. Field names follow the design tables
 * (attendance_records, leave_types, leave_balances, leave_requests, leave_request_approvals) so the
 * mechanical conversion lands on the design's column names (work_date, check_in_at, is_paid …).
 *
 * Employees are the shared HR core (modules/hr/types.ts, ids `EMP-<userId>`).
 */

/* ---------------- Work schedules (shifts) ---------------- */

export interface Shift {
  id: string
  name: string
  /** Company-local wall clock, HH:mm. A shift ends on the day it starts (no overnight shifts). */
  startTime: string
  endTime: string
  breakMinutes: number
  /** Minutes after the start that still count as on time. */
  graceMinutes: number
  /** Working weekdays (0 = Sunday … 6 = Saturday). Default: the company's working week (regional weekend). */
  workingDays: number[]
  isDefault: boolean
  isActive: boolean
  /** Employees assigned (explicitly or through the default). */
  employeeCount?: number
}

export interface ShiftInput {
  name?: string
  startTime?: string
  endTime?: string
  breakMinutes?: number
  graceMinutes?: number
  workingDays?: number[]
  isDefault?: boolean
  isActive?: boolean
}

export interface ShiftAssignment {
  employeeId: string
  employeeName: string
  shiftId: string
  /** True when the employee has no explicit assignment and follows the default shift. */
  isDefault: boolean
}

export interface ShiftsView {
  shifts: Shift[]
  assignments: ShiftAssignment[]
  /** The company weekend (regional settings), for the "working days" default. */
  weekend: number[]
  timezone: string
}

/* ---------------- Attendance ---------------- */

export type AttendanceSource = 'web' | 'manual' | 'import'
export const ATTENDANCE_SOURCE_LABEL: Record<AttendanceSource, string> = { web: 'Web clock', manual: 'Manual', import: 'Import' }

/** One clock-in / clock-out pair (attendance_records). `checkOutAt` null = still open or a missing clock-out. */
export interface AttendanceEntry {
  id: string
  employeeId: string
  /** Company-local date of the clock-in (yyyy-MM-dd). */
  workDate: string
  checkInAt: string
  checkOutAt: string | null
  source: AttendanceSource
  note: string
  location: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type DayStatus = 'present' | 'late' | 'absent' | 'on_leave' | 'holiday' | 'weekend' | 'half_day'
export const DAY_STATUSES: DayStatus[] = ['present', 'late', 'absent', 'on_leave', 'holiday', 'weekend', 'half_day']
export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  half_day: 'Half day',
}
/** One-letter code for the monthly sheet grid. */
export const DAY_STATUS_CODE: Record<DayStatus, string> = { present: 'P', late: 'L', absent: 'A', on_leave: 'V', holiday: 'H', weekend: 'W', half_day: '½' }

/** A computed day of an employee (company timezone). Not stored: derived from entries, shift, holidays and leave. */
export interface DailyRecord {
  employeeId: string
  workDate: string
  status: DayStatus
  /** First clock-in / last clock-out of the day (UTC instants) and their company-local HH:mm. */
  checkInAt: string | null
  checkOutAt: string | null
  checkInLocal: string | null
  checkOutLocal: string | null
  minutesWorked: number
  lateMinutes: number
  earlyLeaveMinutes: number
  overtimeMinutes: number
  /** An entry of the day has no clock-out (and the day is over). */
  missingCheckOut: boolean
  /** Currently clocked in (today only). */
  open: boolean
  shiftId: string | null
  holidayName: string | null
  leaveTypeName: string | null
  /** Today and the shift hasn't ended yet: "absent" means "not clocked in yet". */
  inProgress: boolean
  entryIds: string[]
}

export interface MonthSummary {
  workingDays: number
  present: number
  late: number
  absent: number
  onLeave: number
  halfDays: number
  holidays: number
  minutesWorked: number
  lateMinutes: number
  overtimeMinutes: number
  missingCheckOuts: number
}

export interface EmployeeRef {
  id: string
  employeeNo: string
  fullName: string
  jobTitle: string
  departmentId: string | null
  departmentName: string | null
}

export interface MyAttendance {
  employee: EmployeeRef
  timezone: string
  today: DailyRecord
  /** The open entry of today (clocked in), if any. */
  openEntry: AttendanceEntry | null
  shift: Shift
  month: string
  days: DailyRecord[]
  entries: AttendanceEntry[]
  summary: MonthSummary
}

export interface ClockInput {
  note?: string
  location?: string
}

export interface TodayBoardRow {
  employee: EmployeeRef
  record: DailyRecord
}

export interface TodayBoard {
  date: string
  timezone: string
  rows: TodayBoardRow[]
  counts: { in: number; late: number; absent: number; onLeave: number; notExpected: number; total: number }
}

export interface SheetRow {
  employee: EmployeeRef
  days: DailyRecord[]
  summary: MonthSummary
}

export interface MonthSheet {
  month: string
  timezone: string
  dates: string[]
  rows: SheetRow[]
}

export interface EmployeeAttendance {
  employee: EmployeeRef
  shift: Shift
  month: string
  days: DailyRecord[]
  entries: AttendanceEntry[]
  summary: MonthSummary
}

export interface ManualEntryInput {
  employeeId?: string
  workDate?: string
  checkIn?: string
  checkOut?: string | null
  note?: string
}

/* ---------------- Corrections ---------------- */

export type CorrectionStatus = 'pending' | 'approved' | 'rejected'
export const CORRECTION_STATUS_LABEL: Record<CorrectionStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

export interface AttendanceCorrection {
  id: string
  employeeId: string
  employeeName: string
  workDate: string
  /** The entry being corrected (null: add a missing day). */
  entryId: string | null
  /** Requested company-local times (HH:mm). */
  checkIn: string
  checkOut: string | null
  reason: string
  status: CorrectionStatus
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null
  comment: string
  /** The caller may approve / reject it. */
  canDecide: boolean
}

export interface CorrectionInput {
  workDate?: string
  entryId?: string | null
  checkIn?: string
  checkOut?: string | null
  reason?: string
}

export interface DecisionInput {
  decision?: 'approve' | 'reject'
  comment?: string
}

/* ---------------- CSV import ---------------- */

export interface ImportPunchesInput {
  csv?: string
  dryRun?: boolean
}

export interface ImportRowResult {
  line: number
  employeeNo: string
  timestamp: string
  ok: boolean
  error: string | null
  employeeName: string | null
  workDate: string | null
}

export interface ImportReport {
  rows: ImportRowResult[]
  valid: number
  invalid: number
  /** Entries created (0 for a dry run). */
  entriesCreated: number
  dryRun: boolean
}

/* ---------------- Leave ---------------- */

export type LeaveCode = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity' | 'hajj' | 'compassionate' | 'emergency' | 'other'
export const LEAVE_CODES: LeaveCode[] = ['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'hajj', 'compassionate', 'emergency', 'other']
export type Accrual = 'monthly' | 'yearly'
export const ACCRUAL_LABEL: Record<Accrual, string> = { monthly: 'Monthly', yearly: 'Yearly, upfront' }

export interface LeaveType {
  id: string
  code: LeaveCode
  name: string
  isPaid: boolean
  daysPerYear: number
  accrual: Accrual
  carryOverMax: number
  /** A supporting document is required when a request is longer than this many working days (null: never). */
  documentAfterDays: number | null
  minNoticeDays: number
  gender: 'male' | 'female' | null
  /** Requests may exceed the balance (unpaid-style types). */
  allowNegative: boolean
  isActive: boolean
  color: string
  /** Synthetic country default, to review with HR. */
  isDefault: boolean
}

export type LeaveTypeInput = Partial<Omit<LeaveType, 'id' | 'isDefault'>>

export interface LeaveBalance {
  employeeId: string
  leaveTypeId: string
  leaveTypeName: string
  code: LeaveCode
  year: number
  entitledDays: number
  accruedDays: number
  carriedDays: number
  usedDays: number
  pendingDays: number
  remainingDays: number
  allowNegative: boolean
}

export interface BalanceRow {
  employee: EmployeeRef
  balances: LeaveBalance[]
}

export type LeaveStatus = 'pending_head' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled'
export const LEAVE_STATUSES: LeaveStatus[] = ['pending_head', 'pending_hr', 'approved', 'rejected', 'cancelled']
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending_head: 'Waiting for manager',
  pending_hr: 'Waiting for HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export type ApprovalStep = 'department_head' | 'hr'
export type ApprovalDecision = 'pending' | 'approved' | 'rejected'

export interface LeaveApproval {
  step: ApprovalStep
  /** Who may decide this step (user ids): the manager / department head, or every HR-full user. */
  approverIds: string[]
  approverNames: string[]
  decision: ApprovalDecision
  decidedBy: string | null
  decidedByName: string | null
  comment: string
  decidedAt: string | null
}

export type HalfDay = 'am' | 'pm'

export interface LeaveRequest {
  id: string
  employeeId: string
  employeeName: string
  departmentId: string | null
  leaveTypeId: string
  leaveTypeName: string
  color: string
  startDate: string
  endDate: string
  halfDay: HalfDay | null
  /** Working days (weekend and public holidays excluded; 0.5 for a half day). */
  days: number
  reason: string
  documentName: string | null
  status: LeaveStatus
  approvals: LeaveApproval[]
  submittedAt: string
  submittedBy: string
  cancelledAt: string | null
  cancelledBy: string | null
  /** For the caller. */
  canDecide: boolean
  canCancel: boolean
}

export interface LeaveRequestInput {
  /** HR full only: on behalf of another employee. Default: the caller's own employee record. */
  employeeId?: string
  leaveTypeId?: string
  startDate?: string
  endDate?: string
  halfDay?: HalfDay | null
  reason?: string
  documentName?: string | null
}

export interface LeavePreview {
  days: number
  /** Working days counted (yyyy-MM-dd). */
  dates: string[]
  excludedHolidays: { date: string; name: string }[]
  balance: LeaveBalance | null
  /** Why the request would be refused (null: it can be submitted). */
  problem: { code: string; message: string } | null
  documentRequired: boolean
}

export interface MyLeave {
  employee: EmployeeRef
  year: number
  timezone: string
  today: string
  balances: LeaveBalance[]
  requests: LeaveRequest[]
  types: LeaveType[]
}

export interface LeaveSettings {
  /** Calendar warning when more than this share of a department is off on a day. */
  conflictThresholdPct: number
}

export interface LeaveTypesView {
  types: LeaveType[]
  settings: LeaveSettings
  country: string
}

export interface CalendarEntry {
  requestId: string
  employeeId: string
  employeeName: string
  departmentId: string | null
  departmentName: string | null
  leaveTypeName: string
  color: string
  startDate: string
  endDate: string
  halfDay: HalfDay | null
  status: LeaveStatus
}

export interface CalendarConflict {
  date: string
  departmentId: string
  departmentName: string
  off: number
  size: number
  pct: number
}

export interface LeaveCalendar {
  month: string
  timezone: string
  today: string
  weekend: number[]
  holidays: PublicHoliday[]
  entries: CalendarEntry[]
  conflicts: CalendarConflict[]
  thresholdPct: number
}

/* ---------------- Public holidays ---------------- */

export interface PublicHoliday {
  id: string
  date: string
  name: string
  /** Seeded from the country defaults (synthetic, review with HR). */
  isDefault: boolean
}

export interface HolidayInput {
  date?: string
  name?: string
}
