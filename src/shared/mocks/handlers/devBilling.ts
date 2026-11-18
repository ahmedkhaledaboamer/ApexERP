import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/billing'
import { API, respond, userFrom } from './utils'

const json = async <T,>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null

/** Dev-only simulation (loaded with a dynamic import only when import.meta.env.DEV, so the production bundle has none of it). A real backend has none of these. */
export const devBillingHandlers: HttpHandler[] = [
  http.get(`${API}/dev/billing/state`, ({ request }) => respond(() => svc.devGetState(userFrom(request)))),
  http.post(`${API}/dev/billing/advance`, async ({ request }) => {
    const body = await json<{ days?: unknown }>(request)
    return respond(() => svc.devAdvance(userFrom(request), body))
  }),
  http.post(`${API}/dev/billing/status`, async ({ request }) => {
    const body = await json<{ status?: unknown }>(request)
    return respond(() => svc.devSetStatus(userFrom(request), body))
  }),
  http.post(`${API}/dev/billing/fail-next-payment`, async ({ request }) => {
    const body = await json<{ fail?: unknown }>(request)
    return respond(() => svc.devFailNextPayment(userFrom(request), body))
  }),
  http.post(`${API}/dev/billing/usage`, async ({ request }) => {
    const body = await json<{ key?: unknown; percent?: unknown }>(request)
    return respond(() => svc.devSetUsage(userFrom(request), body))
  }),
  http.post(`${API}/dev/billing/reset`, ({ request }) => respond(() => svc.devReset(userFrom(request)))),
]
