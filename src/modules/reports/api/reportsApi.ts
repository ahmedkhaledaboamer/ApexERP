import { http } from '@/shared/lib/axios'
import type {
  CustomReport,
  CustomReportInput,
  ReportSchedule,
  SalesReport,
  SalesReportQuery,
  ScheduleInput,
} from '@/modules/reports/types'

/** Reports API. The server scopes every figure to the caller's permissions. */

export async function getSalesReport(q: SalesReportQuery): Promise<SalesReport> {
  const params = {
    from: q.from,
    to: q.to,
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
  }
  return (await http.get<SalesReport>('/reports/sales', { params })).data
}

export async function runCustomReport(input: CustomReportInput): Promise<CustomReport> {
  return (await http.post<CustomReport>('/reports/custom', input)).data
}

export async function getSchedules(): Promise<ReportSchedule[]> {
  return (await http.get<ReportSchedule[]>('/reports/schedules')).data
}

export async function createSchedule(input: ScheduleInput): Promise<ReportSchedule> {
  return (await http.post<ReportSchedule>('/reports/schedules', input)).data
}

export async function deleteSchedule(id: string): Promise<{ id: string }> {
  return (await http.delete<{ id: string }>(`/reports/schedules/${encodeURIComponent(id)}`)).data
}
