import { http, type HttpHandler } from 'msw'
import * as perf from '@/shared/mocks/services/reportsPerformance'
import * as hub from '@/shared/mocks/services/reportsHub'
import * as m from '@/shared/api/reportsPerformanceMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/**
 * Reports › Company performance and Reports hub (docs/API.md › Reports › Company performance, Reports hub). Reports is
 * in every plan; sections that need a plan module (accounting, hr) are checked inside the services.
 */
export const reportsPerformanceHandlers: HttpHandler[] = [
  http.get(`${API}/reports/performance`, ({ request }) =>
    respondAs(m.companyPerformanceMapper, () => {
      const s = new URL(request.url).searchParams
      return perf.getCompanyPerformance(userFrom(request), { from: s.get('from') ?? undefined, to: s.get('to') ?? undefined })
    }),
  ),
  http.get(`${API}/reports/hub`, ({ request }) => respondAs(m.reportsHubMapper, () => hub.getReportsHub(userFrom(request)))),
  http.put<{ reportId: string }>(`${API}/reports/hub/favourites/:reportId`, ({ request, params }) =>
    respondAs(m.reportsHubMapper, () => hub.addFavourite(userFrom(request), params.reportId)),
  ),
  http.delete<{ reportId: string }>(`${API}/reports/hub/favourites/:reportId`, ({ request, params }) =>
    respondAs(m.reportsHubMapper, () => hub.removeFavourite(userFrom(request), params.reportId)),
  ),
  http.post(`${API}/reports/hub/recent`, async ({ request }) => {
    const input = await body<{ reportId?: unknown }>(request, m.hubRecentInputMapper)
    return respondAs(m.reportsHubMapper, () => hub.recordView(userFrom(request), input))
  }),
]
