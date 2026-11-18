import { http, type HttpHandler } from 'msw'
import type { CustomReportInput, ScheduleInput } from '@/modules/reports/types'
import { createSchedule, deleteSchedule, getSalesReport, getSchedules, runCustomReport } from '@/shared/mocks/services/reports'
import { REPORT_QUERY, reportMapper, reportScheduleMapper } from '@/shared/api/mappers'
import { API, respondAs, userFrom } from './utils'

/** A JSON body parsed with the endpoint's mapper (an empty or invalid body = {}). */
async function body<T>(request: Request, mapper: { fromApi(v: unknown): unknown }): Promise<Partial<T>> {
  try {
    return mapper.fromApi((await request.json()) ?? {}) as Partial<T>
  } catch {
    return {}
  }
}

export const reportsHandlers: HttpHandler[] = [
  http.get(`${API}/reports/sales`, ({ request }) =>
    respondAs(reportMapper, () => {
      const p = new URL(request.url).searchParams
      return getSalesReport(userFrom(request), {
        from: p.get(REPORT_QUERY.from) ?? undefined,
        to: p.get(REPORT_QUERY.to) ?? undefined,
        ownerId: p.get(REPORT_QUERY.ownerId) || undefined,
        departmentId: p.get(REPORT_QUERY.departmentId) || undefined,
      })
    }),
  ),
  http.post(`${API}/reports/custom`, ({ request }) =>
    respondAs(reportMapper, async () => runCustomReport(userFrom(request), await body<CustomReportInput>(request, reportMapper))),
  ),
  http.get(`${API}/reports/schedules`, ({ request }) => respondAs(reportScheduleMapper, () => getSchedules(userFrom(request)))),
  http.post(`${API}/reports/schedules`, ({ request }) =>
    respondAs(reportScheduleMapper, async () => createSchedule(userFrom(request), await body<ScheduleInput>(request, reportScheduleMapper))),
  ),
  http.delete(`${API}/reports/schedules/:id`, ({ request, params }) =>
    respondAs(reportScheduleMapper, () => deleteSchedule(userFrom(request), String(params.id))),
  ),
]
