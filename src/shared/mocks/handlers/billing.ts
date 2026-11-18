import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/billing'
import { delay } from '@/shared/mocks/server'
import { billingMapper } from '@/shared/api/mappers'
import { API, respondAs, userFrom } from './utils'

/** A JSON body in the API's snake_case, parsed to the service shape (null when empty or invalid). */
const json = async <T,>(request: Request): Promise<T | null> => {
  const raw = (await request.json().catch(() => null)) as unknown
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? billingMapper.fromApi(raw) : raw) as T | null
}

/**
 * Plans, limits and the subscription lifecycle. Read-only mode, module gating and the lifecycle run
 * centrally in userFrom (services/billing.ts enforceRequestPolicy). Platform billing settings moved to
 * GET/PATCH /platform/settings (handlers/platform.ts). snake_case on the wire (billingMapper).
 */
export const billingHandlers: HttpHandler[] = [
  http.get(`${API}/billing/entitlements`, ({ request }) => respondAs(billingMapper, () => svc.getEntitlements(userFrom(request)))),
  http.get(`${API}/billing/overview`, ({ request }) => respondAs(billingMapper, () => svc.getBillingOverview(userFrom(request)))),
  http.post(`${API}/billing/change-plan`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respondAs(billingMapper, () => svc.changePlan(userFrom(request), body))
  }),
  http.post(`${API}/billing/trial-plan`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respondAs(billingMapper, () => svc.setTrialPlan(userFrom(request), body))
  }),
  http.delete(`${API}/billing/scheduled-change`, ({ request }) => respondAs(billingMapper, () => svc.cancelScheduledChange(userFrom(request)))),
  http.post(`${API}/billing/payment-method`, async ({ request }) => {
    const body = await json<Parameters<typeof svc.setPaymentMethod>[1]>(request)
    return respondAs(billingMapper, () => svc.setPaymentMethod(userFrom(request), body))
  }),
  http.post(`${API}/billing/cancel`, ({ request }) => respondAs(billingMapper, () => svc.cancelSubscription(userFrom(request)))),
  http.post(`${API}/billing/resume`, ({ request }) => respondAs(billingMapper, () => svc.resumeSubscription(userFrom(request)))),
  http.post(`${API}/billing/reactivate`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respondAs(billingMapper, () => svc.reactivateSubscription(userFrom(request), body))
  }),
  http.get(`${API}/billing/export`, ({ request }) => respondAs(billingMapper, () => svc.exportData(userFrom(request)))),

  // AI credits: the single consumer for now (module `ai` + the aiCredits limit).
  http.post(`${API}/ai/credits/consume`, async ({ request }) => {
    const body = await json<{ credits?: unknown }>(request)
    return respondAs(billingMapper, () => svc.consumeAiCredits(userFrom(request), body))
  }),

  // Stubs of modules that have no screens yet, so plan gating is real (403 module_not_in_plan).
  ...['/hr/employees', '/finance/invoices', '/integrations'].map((path) =>
    http.get(`${API}${path}`, ({ request }) =>
      respondAs(billingMapper, () => {
        userFrom(request)
        return delay([] as unknown[])
      }),
    ),
  ),
]
