import { defineMapper } from './mapping'
import type {
  AttendanceCorrection,
  AttendanceEntry,
  BalanceRow,
  ClockInput,
  CorrectionInput,
  DecisionInput,
  EmployeeAttendance,
  HolidayInput,
  ImportPunchesInput,
  ImportReport,
  LeaveCalendar,
  LeavePreview,
  LeaveRequest,
  LeaveRequestInput,
  LeaveTypeInput,
  LeaveTypesView,
  ManualEntryInput,
  MonthSheet,
  MyAttendance,
  MyLeave,
  PublicHoliday,
  ShiftInput,
  ShiftsView,
  TodayBoard,
} from '@/modules/hr/time/types'

/**
 * HR › Attendance, Leave and Public holidays (docs/API.md › HR). The UI field names follow the
 * design columns (work_date, check_in_at, is_paid, days_per_year, leave_type_id …), so every resource
 * converts mechanically at any depth (`deep`); no data-keyed maps are sent (arrays only).
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const myAttendanceMapper = deep<MyAttendance>()
export const clockInputMapper = deep<ClockInput>()
export const todayBoardMapper = deep<TodayBoard>()
export const monthSheetMapper = deep<MonthSheet>()
export const employeeAttendanceMapper = deep<EmployeeAttendance>()
export const attendanceEntryMapper = deep<AttendanceEntry>()
export const manualEntryInputMapper = deep<ManualEntryInput>()
export const importInputMapper = deep<ImportPunchesInput>()
export const importReportMapper = deep<ImportReport>()
export const shiftsViewMapper = deep<ShiftsView>()
export const shiftInputMapper = deep<ShiftInput>()
export const assignmentInputMapper = deep<{ employeeId?: string; shiftId?: string | null }>()
export const correctionMapper = deep<AttendanceCorrection>()
export const correctionInputMapper = deep<CorrectionInput>()
export const decisionInputMapper = deep<DecisionInput>()

export const leaveTypesViewMapper = deep<LeaveTypesView>()
export const leaveTypeInputMapper = deep<LeaveTypeInput>()
export const leaveSettingsInputMapper = deep<{ conflictThresholdPct?: number }>()
export const myLeaveMapper = deep<MyLeave>()
export const balanceRowMapper = deep<BalanceRow>()
export const leaveRequestMapper = deep<LeaveRequest>()
export const leaveRequestInputMapper = deep<LeaveRequestInput>()
export const leavePreviewMapper = deep<LeavePreview>()
export const leaveCalendarMapper = deep<LeaveCalendar>()
export const holidayMapper = deep<PublicHoliday>()
export const holidayInputMapper = deep<HolidayInput>()
export const okMapper = deep<{ ok: true }>()
