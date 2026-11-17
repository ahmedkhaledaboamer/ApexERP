import { http, type HttpHandler } from 'msw'
import type { TargetValues, UpdateTargetsInput } from '@/modules/targets/types'
import * as svc from '@/shared/mocks/services/targets'
import { API, respond, userFrom } from './utils'

type Params = { userId: string }

const monthOf = (request: Request) => new URL(request.url).searchParams.get('month')

/** `/targets/defaults` is registered before `/targets/:userId` so it isn't read as a user id. */
export const targetsHandlers: HttpHandler[] = [
  http.get(`${API}/targets/defaults`, ({ request }) => respond(() => svc.getTargetDefaults(userFrom(request)))),
  http.put(`${API}/targets/defaults`, async ({ request }) => {
    const body = (await request.json()) as { values?: Partial<TargetValues> }
    return respond(() => svc.saveTargetDefaults(userFrom(request), body))
  }),
  http.get(`${API}/targets`, ({ request }) => respond(() => svc.getTargets(userFrom(request), monthOf(request)))),
  http.put<Params>(`${API}/targets/:userId`, async ({ request, params }) => {
    const body = (await request.json()) as UpdateTargetsInput
    return respond(() => svc.updateTargets(userFrom(request), params.userId, monthOf(request), body))
  }),
  http.delete<Params>(`${API}/targets/:userId`, ({ request, params }) =>
    respond(() => svc.resetTargets(userFrom(request), params.userId, monthOf(request))),
  ),
]
