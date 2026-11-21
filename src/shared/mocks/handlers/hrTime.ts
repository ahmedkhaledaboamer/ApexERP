import { http, type HttpHandler } from 'msw'
import * as att from '@/shared/mocks/services/attendance'
import * as lv from '@/shared/mocks/services/leave'
import * as m from '@/shared/api/hrTimeMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const q = (request: Request) => new URL(request.url).searchParams
const opt = (v: string | null) => v ?? undefined

/**
 * HR › Attendance, Leave and Public holidays (docs/API.md › HR). Under /hr: plan module `hr` through
 * the request policy (handlers/utils.ts userFrom → 403 module_not_in_plan without it).
 */
export const hrTimeHandlers: HttpHandler[] = [
  /* Attendance: self-service */
  http.get(`${API}/hr/attendance/me`, ({ request }) => respondAs(m.myAttendanceMapper, () => att.getMyAttendance(userFrom(request), opt(q(request).get('month'))))),
  http.post(`${API}/hr/attendance/clock-in`, async ({ request }) => {
    const input = await body<Parameters<typeof att.clockIn>[1]>(request, m.clockInputMapper)
    return respondAs(m.myAttendanceMapper, () => att.clockIn(userFrom(request), input))
  }),
  http.post(`${API}/hr/attendance/clock-out`, async ({ request }) => {
    const input = await body<Parameters<typeof att.clockOut>[1]>(request, m.clockInputMapper)
    return respondAs(m.myAttendanceMapper, () => att.clockOut(userFrom(request), input))
  }),
  /* Attendance: manager / HR */
  http.get(`${API}/hr/attendance/today`, ({ request }) => respondAs(m.todayBoardMapper, () => att.getTodayBoard(userFrom(request)))),
  http.get(`${API}/hr/attendance/sheet`, ({ request }) => {
    const s = q(request)
    return respondAs(m.monthSheetMapper, () =>
      att.getMonthSheet(userFrom(request), { month: opt(s.get('month')), departmentId: opt(s.get('department_id')), employeeId: opt(s.get('employee_id')), status: opt(s.get('status')) }),
    )
  }),
  http.get(`${API}/hr/attendance/employees/:employeeId`, ({ request, params }) =>
    respondAs(m.employeeAttendanceMapper, () => att.getEmployeeAttendance(userFrom(request), String(params.employeeId), opt(q(request).get('month')))),
  ),
  http.post(`${API}/hr/attendance/entries`, async ({ request }) => {
    const input = await body<Parameters<typeof att.createManualEntry>[1]>(request, m.manualEntryInputMapper)
    return respondAs(m.attendanceEntryMapper, () => att.createManualEntry(userFrom(request), input))
  }),
  http.post(`${API}/hr/attendance/import`, async ({ request }) => {
    const input = await body<Parameters<typeof att.importPunches>[1]>(request, m.importInputMapper)
    return respondAs(m.importReportMapper, () => att.importPunches(userFrom(request), input))
  }),
  /* Shifts */
  http.get(`${API}/hr/attendance/shifts`, ({ request }) => respondAs(m.shiftsViewMapper, () => att.listShifts(userFrom(request)))),
  http.post(`${API}/hr/attendance/shifts`, async ({ request }) => {
    const input = await body<Parameters<typeof att.createShift>[1]>(request, m.shiftInputMapper)
    return respondAs(m.shiftsViewMapper, () => att.createShift(userFrom(request), input))
  }),
  http.patch(`${API}/hr/attendance/shifts/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof att.updateShift>[2]>(request, m.shiftInputMapper)
    return respondAs(m.shiftsViewMapper, () => att.updateShift(userFrom(request), String(params.id), input))
  }),
  http.delete(`${API}/hr/attendance/shifts/:id`, ({ request, params }) => respondAs(m.shiftsViewMapper, () => att.deleteShift(userFrom(request), String(params.id)))),
  http.put(`${API}/hr/attendance/assignments`, async ({ request }) => {
    const input = await body<Parameters<typeof att.assignShift>[1]>(request, m.assignmentInputMapper)
    return respondAs(m.shiftsViewMapper, () => att.assignShift(userFrom(request), input))
  }),
  /* Corrections */
  http.get(`${API}/hr/attendance/corrections`, ({ request }) => respondAs(m.correctionMapper, () => att.listCorrections(userFrom(request), opt(q(request).get('status'))))),
  http.post(`${API}/hr/attendance/corrections`, async ({ request }) => {
    const input = await body<Parameters<typeof att.createCorrection>[1]>(request, m.correctionInputMapper)
    return respondAs(m.correctionMapper, () => att.createCorrection(userFrom(request), input))
  }),
  http.post(`${API}/hr/attendance/corrections/:id/decide`, async ({ request, params }) => {
    const input = await body<Parameters<typeof att.decideCorrection>[2]>(request, m.decisionInputMapper)
    return respondAs(m.correctionMapper, () => att.decideCorrection(userFrom(request), String(params.id), input))
  }),

  /* Leave */
  http.get(`${API}/hr/leave/me`, ({ request }) => respondAs(m.myLeaveMapper, () => lv.getMyLeave(userFrom(request), opt(q(request).get('year'))))),
  http.get(`${API}/hr/leave/types`, ({ request }) => respondAs(m.leaveTypesViewMapper, () => lv.listLeaveTypes(userFrom(request)))),
  http.post(`${API}/hr/leave/types`, async ({ request }) => {
    const input = await body<Parameters<typeof lv.createLeaveType>[1]>(request, m.leaveTypeInputMapper)
    return respondAs(m.leaveTypesViewMapper, () => lv.createLeaveType(userFrom(request), input))
  }),
  http.patch(`${API}/hr/leave/types/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof lv.updateLeaveType>[2]>(request, m.leaveTypeInputMapper)
    return respondAs(m.leaveTypesViewMapper, () => lv.updateLeaveType(userFrom(request), String(params.id), input))
  }),
  http.put(`${API}/hr/leave/settings`, async ({ request }) => {
    const input = await body<Parameters<typeof lv.updateLeaveSettings>[1]>(request, m.leaveSettingsInputMapper)
    return respondAs(m.leaveTypesViewMapper, () => lv.updateLeaveSettings(userFrom(request), input))
  }),
  http.get(`${API}/hr/leave/balances`, ({ request }) => {
    const s = q(request)
    return respondAs(m.balanceRowMapper, () => lv.listBalances(userFrom(request), { year: opt(s.get('year')), employeeId: opt(s.get('employee_id')) }))
  }),
  http.get(`${API}/hr/leave/calendar`, ({ request }) => respondAs(m.leaveCalendarMapper, () => lv.getLeaveCalendar(userFrom(request), opt(q(request).get('month'))))),
  http.get(`${API}/hr/leave/requests`, ({ request }) => {
    const s = q(request)
    return respondAs(m.leaveRequestMapper, () => lv.listLeaveRequests(userFrom(request), { status: opt(s.get('status')), employeeId: opt(s.get('employee_id')), view: opt(s.get('view')) }))
  }),
  // Before /hr/leave/requests/:id.
  http.post(`${API}/hr/leave/requests/preview`, async ({ request }) => {
    const input = await body<Parameters<typeof lv.previewLeave>[1]>(request, m.leaveRequestInputMapper)
    return respondAs(m.leavePreviewMapper, () => lv.previewLeave(userFrom(request), input))
  }),
  http.post(`${API}/hr/leave/requests`, async ({ request }) => {
    const input = await body<Parameters<typeof lv.createLeaveRequest>[1]>(request, m.leaveRequestInputMapper)
    return respondAs(m.leaveRequestMapper, () => lv.createLeaveRequest(userFrom(request), input))
  }),
  http.get(`${API}/hr/leave/requests/:id`, ({ request, params }) => respondAs(m.leaveRequestMapper, () => lv.getLeaveRequest(userFrom(request), String(params.id)))),
  http.post(`${API}/hr/leave/requests/:id/decide`, async ({ request, params }) => {
    const input = await body<Parameters<typeof lv.decideLeaveRequest>[2]>(request, m.decisionInputMapper)
    return respondAs(m.leaveRequestMapper, () => lv.decideLeaveRequest(userFrom(request), String(params.id), input))
  }),
  http.post(`${API}/hr/leave/requests/:id/cancel`, async ({ request, params }) => {
    const input = await body<Parameters<typeof lv.cancelLeaveRequest>[2]>(request, m.decisionInputMapper)
    return respondAs(m.leaveRequestMapper, () => lv.cancelLeaveRequest(userFrom(request), String(params.id), input))
  }),

  /* Public holidays */
  http.get(`${API}/hr/holidays`, ({ request }) => respondAs(m.holidayMapper, () => lv.listHolidays(userFrom(request), opt(q(request).get('year'))))),
  http.post(`${API}/hr/holidays`, async ({ request }) => {
    const input = await body<Parameters<typeof lv.createHoliday>[1]>(request, m.holidayInputMapper)
    return respondAs(m.holidayMapper, () => lv.createHoliday(userFrom(request), input))
  }),
  http.patch(`${API}/hr/holidays/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof lv.updateHoliday>[2]>(request, m.holidayInputMapper)
    return respondAs(m.holidayMapper, () => lv.updateHoliday(userFrom(request), String(params.id), input))
  }),
  http.delete(`${API}/hr/holidays/:id`, ({ request, params }) => respondAs(m.okMapper, () => lv.deleteHoliday(userFrom(request), String(params.id)))),
]
