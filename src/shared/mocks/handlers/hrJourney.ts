import { http, type HttpHandler } from 'msw'
import type { JourneyItemInput, StartJourneyInput, TemplateInput } from '@/modules/hr/journey/types'
import * as jr from '@/shared/mocks/services/hrJourney'
import {
  hrJourneyDetailMapper,
  hrJourneyItemInputMapper,
  hrJourneyOptionsMapper,
  hrJourneyPlainMapper,
  hrJourneyRowMapper,
  hrJourneyStartMapper,
  hrJourneyTemplateInputMapper,
  hrJourneyTemplateMapper,
  hrMyJourneyTaskMapper,
} from '@/shared/api/hrJourneyMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }
type ItemIds = { id: string; itemId: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/**
 * HR › Onboarding & offboarding (docs/API.md › HR › Onboarding & offboarding). Plan module `hr` (request policy);
 * scopes in services/hrJourney.ts. Static paths (my-tasks, options, templates) are registered before `/hr/journeys/:id`.
 */
export const hrJourneyHandlers: HttpHandler[] = [
  http.get(`${API}/hr/journeys/my-tasks`, ({ request }) => respondAs(hrMyJourneyTaskMapper, () => jr.myTasks(userFrom(request)))),
  http.get(`${API}/hr/journeys/options`, ({ request }) => respondAs(hrJourneyOptionsMapper, () => jr.journeyOptions(userFrom(request)))),

  /* ---- templates ---- */
  http.get(`${API}/hr/journeys/templates`, ({ request }) => respondAs(hrJourneyTemplateMapper, () => jr.listTemplates(userFrom(request)))),
  http.post(`${API}/hr/journeys/templates`, async ({ request }) => {
    const input = await body<Partial<TemplateInput>>(request, hrJourneyTemplateInputMapper)
    return respondAs(hrJourneyTemplateMapper, () => jr.createTemplate(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/journeys/templates/:id`, ({ request, params }) => respondAs(hrJourneyTemplateMapper, () => jr.getTemplate(userFrom(request), params.id))),
  http.patch<Id>(`${API}/hr/journeys/templates/:id`, async ({ request, params }) => {
    const input = await body<Partial<TemplateInput>>(request, hrJourneyTemplateInputMapper)
    return respondAs(hrJourneyTemplateMapper, () => jr.updateTemplate(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/hr/journeys/templates/:id`, ({ request, params }) => respondAs(hrJourneyPlainMapper, () => jr.deleteTemplate(userFrom(request), params.id))),

  /* ---- journeys ---- */
  http.get(`${API}/hr/journeys`, ({ request }) => {
    const q = new URL(request.url).searchParams
    return respondAs(hrJourneyRowMapper, () => jr.listJourneys(userFrom(request), { kind: q.get('kind'), status: q.get('status'), employeeId: q.get('employee_id') }))
  }),
  http.post(`${API}/hr/journeys`, async ({ request }) => {
    const input = await body<Partial<StartJourneyInput>>(request, hrJourneyStartMapper)
    return respondAs(hrJourneyDetailMapper, () => jr.startJourneyFor(userFrom(request), input))
  }),
  http.get<Id>(`${API}/hr/journeys/:id`, ({ request, params }) => respondAs(hrJourneyDetailMapper, () => jr.getJourney(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/journeys/:id/activate`, ({ request, params }) => respondAs(hrJourneyDetailMapper, () => jr.activateFromJourney(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/journeys/:id/cancel`, ({ request, params }) => respondAs(hrJourneyDetailMapper, () => jr.cancelJourney(userFrom(request), params.id))),
  http.post<Id>(`${API}/hr/journeys/:id/items`, async ({ request, params }) => {
    const input = await body<Partial<JourneyItemInput>>(request, hrJourneyItemInputMapper)
    return respondAs(hrJourneyDetailMapper, () => jr.addItem(userFrom(request), params.id, input))
  }),
  http.patch<ItemIds>(`${API}/hr/journeys/:id/items/:itemId`, async ({ request, params }) => {
    const input = await body<Partial<JourneyItemInput>>(request, hrJourneyItemInputMapper)
    return respondAs(hrJourneyDetailMapper, () => jr.updateItem(userFrom(request), params.id, params.itemId, input))
  }),
  http.delete<ItemIds>(`${API}/hr/journeys/:id/items/:itemId`, ({ request, params }) => respondAs(hrJourneyDetailMapper, () => jr.deleteItem(userFrom(request), params.id, params.itemId))),
  http.post<ItemIds>(`${API}/hr/journeys/:id/items/:itemId/complete`, async ({ request, params }) => {
    const input = await body<{ note?: unknown }>(request, hrJourneyPlainMapper)
    return respondAs(hrJourneyPlainMapper, () => jr.completeItem(userFrom(request), params.id, params.itemId, input))
  }),
  http.post<ItemIds>(`${API}/hr/journeys/:id/items/:itemId/reopen`, ({ request, params }) => respondAs(hrJourneyPlainMapper, () => jr.reopenItem(userFrom(request), params.id, params.itemId))),
]
