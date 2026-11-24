import { http, type HttpHandler } from 'msw'
import type { ProfitQuery, ProfitSettingsInput } from '@/modules/finance/profitability/types'
import * as svc from '@/shared/mocks/services/financeProfitability'
import * as m from '@/shared/api/financeProfitabilityMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

/** `from`, `to` (company-local yyyy-MM-dd) and the optional filters `department_id`, `project_id`, `event_id`, `customer_id`. */
function query(request: Request): ProfitQuery {
  const s = new URL(request.url).searchParams
  const v = (k: string) => s.get(k) ?? undefined
  return { from: v('from'), to: v('to'), departmentId: v('department_id'), projectId: v('project_id'), eventId: v('event_id'), customerId: v('customer_id') }
}

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

const P = `${API}/finance/profitability`

/**
 * Accounts & finance › Profitability (docs/API.md › Finance › Profitability). Under /finance: plan module `accounting`
 * through the request policy. Static paths before `/projects/:id` and `/:report/export`.
 */
export const financeProfitabilityHandlers: HttpHandler[] = [
  http.get(`${P}/options`, ({ request }) => respondAs(m.profitOptionsMapper, () => svc.profitOptions(userFrom(request)))),
  http.put(`${P}/settings`, async ({ request }) => {
    const input = await body<ProfitSettingsInput>(request, m.profitSettingsInputMapper)
    return respondAs(m.profitSettingsMapper, () => svc.updateProfitSettings(userFrom(request), input))
  }),
  http.get(`${P}/projects`, ({ request }) => respondAs(m.projectProfitabilityMapper, () => svc.projectProfitability(userFrom(request), query(request)))),
  // Before /projects/:id: `/projects/export` is the CSV export, not a project.
  http.get<{ report: string }>(`${P}/:report/export`, ({ request, params }) =>
    respondAs(m.profitExportMapper, () => svc.exportProfitability(userFrom(request), params.report, query(request))),
  ),
  http.get<{ id: string }>(`${P}/projects/:id`, ({ request, params }) =>
    respondAs(m.projectProfitDetailMapper, () => svc.projectProfitDetail(userFrom(request), params.id, query(request))),
  ),
  http.get(`${P}/events`, ({ request }) => respondAs(m.eventProfitabilityMapper, () => svc.eventProfitability(userFrom(request), query(request)))),
  http.get(`${P}/customers`, ({ request }) => respondAs(m.customerProfitabilityMapper, () => svc.customerProfitability(userFrom(request), query(request)))),
  http.get(`${P}/departments`, ({ request }) => respondAs(m.departmentPnlMapper, () => svc.departmentPnl(userFrom(request), query(request)))),
]
