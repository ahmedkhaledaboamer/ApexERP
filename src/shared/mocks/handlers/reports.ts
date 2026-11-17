import { http, type HttpHandler } from 'msw'
import type { CustomReportInput, ScheduleInput } from '@/modules/reports/types'
import { createSchedule, deleteSchedule, getSalesReport, getSchedules, runCustomReport } from '@/shared/mocks/services/reports'
import { API, respond, userFrom } from './utils'

async function body<T>(request: Request): Promise<Partial<T>> {
  try {
    return ((await request.json()) ?? {}) as Partial<T>
  } catch {
    return {}
  }
}

export const reportsHandlers: HttpHandler[] = [
  http.get(`${API}/reports/sales`, ({ request }) =>
    respond(() => {
      const p = new URL(request.url).searchParams
      return getSalesReport(userFrom(request), {
        from: p.get('from') ?? undefined,
        to: p.get('to') ?? undefined,
        ownerId: p.get('ownerId') || undefined,
        departmentId: p.get('departmentId') || undefined,
      })
    }),
  ),
  http.post(`${API}/reports/custom`, ({ request }) =>
    respond(async () => runCustomReport(userFrom(request), await body<CustomReportInput>(request))),
  ),
  http.get(`${API}/reports/schedules`, ({ request }) => respond(() => getSchedules(userFrom(request)))),
  http.post(`${API}/reports/schedules`, ({ request }) =>
    respond(async () => createSchedule(userFrom(request), await body<ScheduleInput>(request))),
  ),
  http.delete(`${API}/reports/schedules/:id`, ({ request, params }) =>
    respond(() => deleteSchedule(userFrom(request), String(params.id))),
  ),
]
