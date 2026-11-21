import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/hrTimeMappers'
import type {
  ClockInput,
  CorrectionInput,
  DecisionInput,
  HolidayInput,
  ImportPunchesInput,
  LeaveRequestInput,
  LeaveTypeInput,
  ManualEntryInput,
  ShiftInput,
} from './types'

/** HR › Attendance, Leave, Public holidays (docs/API.md › HR). snake_case on the wire via hrTimeMappers. */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}

export const hrTimeApi = {
  myAttendance: async (month?: string) => m.myAttendanceMapper.fromApi((await http.get<unknown>(`/hr/attendance/me${qs({ month })}`)).data),
  clockIn: async (input: ClockInput) => m.myAttendanceMapper.fromApi((await http.post<unknown>('/hr/attendance/clock-in', m.clockInputMapper.toApi(input))).data),
  clockOut: async (input: ClockInput) => m.myAttendanceMapper.fromApi((await http.post<unknown>('/hr/attendance/clock-out', m.clockInputMapper.toApi(input))).data),
  today: async () => m.todayBoardMapper.fromApi((await http.get<unknown>('/hr/attendance/today')).data),
  sheet: async (q: { month?: string; departmentId?: string; status?: string }) =>
    m.monthSheetMapper.fromApi((await http.get<unknown>(`/hr/attendance/sheet${qs({ month: q.month, department_id: q.departmentId, status: q.status })}`)).data),
  employee: async (id: string, month?: string) => m.employeeAttendanceMapper.fromApi((await http.get<unknown>(`/hr/attendance/employees/${enc(id)}${qs({ month })}`)).data),
  manualEntry: async (input: ManualEntryInput) => m.attendanceEntryMapper.fromApi((await http.post<unknown>('/hr/attendance/entries', m.manualEntryInputMapper.toApi(input))).data),
  importPunches: async (input: ImportPunchesInput) => m.importReportMapper.fromApi((await http.post<unknown>('/hr/attendance/import', m.importInputMapper.toApi(input))).data),
  shifts: async () => m.shiftsViewMapper.fromApi((await http.get<unknown>('/hr/attendance/shifts')).data),
  createShift: async (input: ShiftInput) => m.shiftsViewMapper.fromApi((await http.post<unknown>('/hr/attendance/shifts', m.shiftInputMapper.toApi(input))).data),
  updateShift: async (id: string, input: ShiftInput) => m.shiftsViewMapper.fromApi((await http.patch<unknown>(`/hr/attendance/shifts/${enc(id)}`, m.shiftInputMapper.toApi(input))).data),
  deleteShift: async (id: string) => m.shiftsViewMapper.fromApi((await http.delete<unknown>(`/hr/attendance/shifts/${enc(id)}`)).data),
  assignShift: async (employeeId: string, shiftId: string | null) =>
    m.shiftsViewMapper.fromApi((await http.put<unknown>('/hr/attendance/assignments', m.assignmentInputMapper.toApi({ employeeId, shiftId }))).data),
  corrections: async (status?: string) => m.correctionMapper.fromApiList((await http.get<unknown>(`/hr/attendance/corrections${qs({ status })}`)).data),
  createCorrection: async (input: CorrectionInput) => m.correctionMapper.fromApi((await http.post<unknown>('/hr/attendance/corrections', m.correctionInputMapper.toApi(input))).data),
  decideCorrection: async (id: string, input: DecisionInput) =>
    m.correctionMapper.fromApi((await http.post<unknown>(`/hr/attendance/corrections/${enc(id)}/decide`, m.decisionInputMapper.toApi(input))).data),

  myLeave: async (year?: number) => m.myLeaveMapper.fromApi((await http.get<unknown>(`/hr/leave/me${qs({ year })}`)).data),
  leaveTypes: async () => m.leaveTypesViewMapper.fromApi((await http.get<unknown>('/hr/leave/types')).data),
  createLeaveType: async (input: LeaveTypeInput) => m.leaveTypesViewMapper.fromApi((await http.post<unknown>('/hr/leave/types', m.leaveTypeInputMapper.toApi(input))).data),
  updateLeaveType: async (id: string, input: LeaveTypeInput) => m.leaveTypesViewMapper.fromApi((await http.patch<unknown>(`/hr/leave/types/${enc(id)}`, m.leaveTypeInputMapper.toApi(input))).data),
  updateLeaveSettings: async (conflictThresholdPct: number) =>
    m.leaveTypesViewMapper.fromApi((await http.put<unknown>('/hr/leave/settings', m.leaveSettingsInputMapper.toApi({ conflictThresholdPct }))).data),
  balances: async (year?: number) => m.balanceRowMapper.fromApiList((await http.get<unknown>(`/hr/leave/balances${qs({ year })}`)).data),
  calendar: async (month?: string) => m.leaveCalendarMapper.fromApi((await http.get<unknown>(`/hr/leave/calendar${qs({ month })}`)).data),
  requests: async (q: { status?: string; view?: string }) => m.leaveRequestMapper.fromApiList((await http.get<unknown>(`/hr/leave/requests${qs(q)}`)).data),
  request: async (id: string) => m.leaveRequestMapper.fromApi((await http.get<unknown>(`/hr/leave/requests/${enc(id)}`)).data),
  preview: async (input: LeaveRequestInput) => m.leavePreviewMapper.fromApi((await http.post<unknown>('/hr/leave/requests/preview', m.leaveRequestInputMapper.toApi(input))).data),
  createRequest: async (input: LeaveRequestInput) => m.leaveRequestMapper.fromApi((await http.post<unknown>('/hr/leave/requests', m.leaveRequestInputMapper.toApi(input))).data),
  decideRequest: async (id: string, input: DecisionInput) =>
    m.leaveRequestMapper.fromApi((await http.post<unknown>(`/hr/leave/requests/${enc(id)}/decide`, m.decisionInputMapper.toApi(input))).data),
  cancelRequest: async (id: string, comment?: string) => m.leaveRequestMapper.fromApi((await http.post<unknown>(`/hr/leave/requests/${enc(id)}/cancel`, m.decisionInputMapper.toApi({ comment }))).data),
  holidays: async (year?: number) => m.holidayMapper.fromApiList((await http.get<unknown>(`/hr/holidays${qs({ year })}`)).data),
  createHoliday: async (input: HolidayInput) => m.holidayMapper.fromApi((await http.post<unknown>('/hr/holidays', m.holidayInputMapper.toApi(input))).data),
  updateHoliday: async (id: string, input: HolidayInput) => m.holidayMapper.fromApi((await http.patch<unknown>(`/hr/holidays/${enc(id)}`, m.holidayInputMapper.toApi(input))).data),
  deleteHoliday: async (id: string) => (await http.delete<unknown>(`/hr/holidays/${enc(id)}`)).data,
}

/** Every HR time query sits under ['hr', 'time'] so one invalidation refreshes all of them. */
export const hrTimeKeys = {
  root: ['hr', 'time'] as const,
  myAttendance: (month?: string) => ['hr', 'time', 'attendance', 'me', month ?? ''] as const,
  today: ['hr', 'time', 'attendance', 'today'] as const,
  sheet: (q: object) => ['hr', 'time', 'attendance', 'sheet', q] as const,
  employee: (id: string, month?: string) => ['hr', 'time', 'attendance', 'employee', id, month ?? ''] as const,
  shifts: ['hr', 'time', 'attendance', 'shifts'] as const,
  corrections: (status?: string) => ['hr', 'time', 'attendance', 'corrections', status ?? ''] as const,
  myLeave: (year?: number) => ['hr', 'time', 'leave', 'me', year ?? 0] as const,
  leaveTypes: ['hr', 'time', 'leave', 'types'] as const,
  balances: (year?: number) => ['hr', 'time', 'leave', 'balances', year ?? 0] as const,
  calendar: (month?: string) => ['hr', 'time', 'leave', 'calendar', month ?? ''] as const,
  requests: (q: object) => ['hr', 'time', 'leave', 'requests', q] as const,
  holidays: (year?: number) => ['hr', 'time', 'holidays', year ?? 0] as const,
}

export const useMyAttendance = (month?: string, enabled = true) => useQuery({ queryKey: hrTimeKeys.myAttendance(month), queryFn: () => hrTimeApi.myAttendance(month), enabled, retry: false })
export const useTodayBoard = (enabled = true) => useQuery({ queryKey: hrTimeKeys.today, queryFn: hrTimeApi.today, enabled })
export const useMonthSheet = (q: { month?: string; departmentId?: string; status?: string }, enabled = true) =>
  useQuery({ queryKey: hrTimeKeys.sheet(q), queryFn: () => hrTimeApi.sheet(q), enabled })
export const useShifts = (enabled = true) => useQuery({ queryKey: hrTimeKeys.shifts, queryFn: hrTimeApi.shifts, enabled })
export const useCorrections = (status?: string) => useQuery({ queryKey: hrTimeKeys.corrections(status), queryFn: () => hrTimeApi.corrections(status) })
export const useMyLeave = (year?: number, enabled = true) => useQuery({ queryKey: hrTimeKeys.myLeave(year), queryFn: () => hrTimeApi.myLeave(year), enabled, retry: false })
export const useLeaveTypes = () => useQuery({ queryKey: hrTimeKeys.leaveTypes, queryFn: hrTimeApi.leaveTypes })
export const useBalances = (year?: number, enabled = true) => useQuery({ queryKey: hrTimeKeys.balances(year), queryFn: () => hrTimeApi.balances(year), enabled })
export const useLeaveCalendar = (month?: string) => useQuery({ queryKey: hrTimeKeys.calendar(month), queryFn: () => hrTimeApi.calendar(month) })
export const useLeaveRequests = (q: { status?: string; view?: string }) => useQuery({ queryKey: hrTimeKeys.requests(q), queryFn: () => hrTimeApi.requests(q) })
export const useHolidays = (year?: number) => useQuery({ queryKey: hrTimeKeys.holidays(year), queryFn: () => hrTimeApi.holidays(year) })

/** A mutation that refreshes every HR time query (and the bell: approvals notify people). */
export function useHrTimeMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...hrTimeKeys.root] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
