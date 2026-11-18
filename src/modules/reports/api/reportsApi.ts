import { http } from '@/shared/lib/axios'
import type {
  CustomReport,
  CustomReportInput,
  ReportSchedule,
  SalesReport,
  SalesReportQuery,
  ScheduleInput,
} from '@/modules/reports/types'
import { REPORT_QUERY, reportMapper, reportScheduleMapper } from '@/shared/api/mappers'

/** Reports API. The server scopes every figure to the caller's permissions. */

export async function getSalesReport(q: SalesReportQuery): Promise<SalesReport> {
  const params = {
    [REPORT_QUERY.from]: q.from,
    [REPORT_QUERY.to]: q.to,
    ...(q.ownerId ? { [REPORT_QUERY.ownerId]: q.ownerId } : {}),
    ...(q.departmentId ? { [REPORT_QUERY.departmentId]: q.departmentId } : {}),
  }
  return reportMapper.fromApi((await http.get<unknown>('/reports/sales', { params })).data)
}

export async function runCustomReport(input: CustomReportInput): Promise<CustomReport> {
  return reportMapper.fromApi((await http.post<unknown>('/reports/custom', reportMapper.toApi(input as never))).data)
}

export async function getSchedules(): Promise<ReportSchedule[]> {
  return reportScheduleMapper.fromApiList((await http.get<unknown>('/reports/schedules')).data)
}

export async function createSchedule(input: ScheduleInput): Promise<ReportSchedule> {
  return reportScheduleMapper.fromApi((await http.post<unknown>('/reports/schedules', reportScheduleMapper.toApi(input as never))).data)
}

export async function deleteSchedule(id: string): Promise<{ id: string }> {
  return reportScheduleMapper.fromApi((await http.delete<unknown>(`/reports/schedules/${encodeURIComponent(id)}`)).data)
}
