import { http, type HttpHandler } from 'msw'
import * as c from '@/shared/mocks/services/financeCommissions'
import * as m from '@/shared/api/financeCommissionsMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const F = `${API}/finance`

/** Accounts & finance › Sales commissions (docs/API.md › Finance › Commissions). Plan module `accounting`. */
export const financeCommissionsHandlers: HttpHandler[] = [
  http.get(`${F}/commission-plans`, ({ request }) => respondAs(m.commissionPlanMapper, () => c.listPlans(userFrom(request)))),
  http.post(`${F}/commission-plans`, async ({ request }) => {
    const input = await body<Parameters<typeof c.createPlan>[1]>(request, m.commissionPlanInputMapper)
    return respondAs(m.commissionPlanMapper, () => c.createPlan(userFrom(request), input))
  }),
  http.patch<Id>(`${F}/commission-plans/:id`, async ({ request, params }) => {
    const input = await body<Parameters<typeof c.updatePlan>[2]>(request, m.commissionPlanInputMapper)
    return respondAs(m.commissionPlanMapper, () => c.updatePlan(userFrom(request), params.id, input))
  }),
  http.get(`${F}/commissions/mine`, ({ request }) => respondAs(m.myCommissionsMapper, () => c.myCommissions(userFrom(request)))),
  http.get(`${F}/commission-statements`, ({ request }) => {
    const q = new URL(request.url).searchParams
    return respondAs(m.commissionStatementMapper, () => c.listStatements(userFrom(request), { month: q.get('month'), userId: q.get('user_id'), status: q.get('status') }))
  }),
  http.post(`${F}/commission-statements/generate`, async ({ request }) => {
    const input = await body<{ month?: unknown }>(request, m.commissionPlainMapper)
    return respondAs(m.commissionStatementMapper, () => c.generateStatements(userFrom(request), input))
  }),
  http.get<Id>(`${F}/commission-statements/:id`, ({ request, params }) => respondAs(m.commissionStatementMapper, () => c.getStatement(userFrom(request), params.id))),
  http.post<Id>(`${F}/commission-statements/:id/approve`, ({ request, params }) => respondAs(m.commissionStatementMapper, () => c.approveStatement(userFrom(request), params.id))),
  http.post<Id>(`${F}/commission-statements/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.commissionPlainMapper)
    return respondAs(m.commissionStatementMapper, () => c.rejectStatement(userFrom(request), params.id, input))
  }),
]
