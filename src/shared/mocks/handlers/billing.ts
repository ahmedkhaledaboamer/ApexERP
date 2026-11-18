import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/billing'
import { delay } from '@/shared/mocks/server'
import { API, respond, userFrom } from './utils'

const json = async <T,>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null

/**
 * Plans, limits and the subscription lifecycle. Read-only mode, module gating and the lifecycle run
 * centrally in userFrom (services/billing.ts enforceRequestPolicy). Platform billing settings moved to
 * GET/PATCH /platform/settings (handlers/platform.ts).
 */
export const billingHandlers: HttpHandler[] = [
  http.get(`${API}/billing/entitlements`, ({ request }) => respond(() => svc.getEntitlements(userFrom(request)))),
  http.get(`${API}/billing/overview`, ({ request }) => respond(() => svc.getBillingOverview(userFrom(request)))),
  http.post(`${API}/billing/change-plan`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respond(() => svc.changePlan(userFrom(request), body))
  }),
  http.post(`${API}/billing/trial-plan`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respond(() => svc.setTrialPlan(userFrom(request), body))
  }),
  http.delete(`${API}/billing/scheduled-change`, ({ request }) => respond(() => svc.cancelScheduledChange(userFrom(request)))),
  http.post(`${API}/billing/payment-method`, async ({ request }) => {
    const body = await json<Parameters<typeof svc.setPaymentMethod>[1]>(request)
    return respond(() => svc.setPaymentMethod(userFrom(request), body))
  }),
  http.post(`${API}/billing/cancel`, ({ request }) => respond(() => svc.cancelSubscription(userFrom(request)))),
  http.post(`${API}/billing/resume`, ({ request }) => respond(() => svc.resumeSubscription(userFrom(request)))),
  http.post(`${API}/billing/reactivate`, async ({ request }) => {
    const body = await json<{ planId?: unknown }>(request)
    return respond(() => svc.reactivateSubscription(userFrom(request), body))
  }),
  http.get(`${API}/billing/export`, ({ request }) => respond(() => svc.exportData(userFrom(request)))),

  // AI credits: the single consumer for now (module `ai` + the aiCredits limit).
  http.post(`${API}/ai/credits/consume`, async ({ request }) => {
    const body = await json<{ credits?: unknown }>(request)
    return respond(() => svc.consumeAiCredits(userFrom(request), body))
  }),

  // Stubs of modules that have no screens yet, so plan gating is real (403 module_not_in_plan).
  ...['/hr/employees', '/events', '/marketing/campaigns', '/finance/invoices', '/integrations'].map((path) =>
    http.get(`${API}${path}`, ({ request }) =>
      respond(() => {
        userFrom(request)
        return delay([] as unknown[])
      }),
    ),
  ),
]
