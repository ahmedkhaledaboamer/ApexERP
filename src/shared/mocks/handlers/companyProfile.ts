import { http } from 'msw'
import { getCompanyProfile, updateCompanyProfile } from '@/shared/mocks/services/companyProfile'
import {
  connectEmail,
  disconnectEmail,
  getEmailConnection,
  getOnboarding,
  setOnboardingDismissed,
  setOnboardingItem,
} from '@/shared/mocks/services/onboarding'
import * as signup from '@/shared/mocks/services/signup'
import { getRoles } from '@/shared/mocks/services/subscription'
import { API, respond, userFrom } from './utils'

const json = async <T,>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null
const clientKey = (request: Request) => request.headers.get('X-Client-Id')?.trim() || 'anonymous'

/** Company profile, onboarding checklist, subscription/roles, email connection and public self-service sign-up. */
export const companyProfileHandlers = [
  http.get(`${API}/settings/company-profile`, ({ request }) => respond(() => getCompanyProfile(userFrom(request)))),
  http.patch(`${API}/settings/company-profile`, async ({ request }) => {
    const body = await json<unknown>(request)
    return respond(() => updateCompanyProfile(userFrom(request), body))
  }),
  http.get(`${API}/settings/roles`, ({ request }) => respond(() => getRoles(userFrom(request)))),
  http.get(`${API}/settings/email-connection`, ({ request }) => respond(() => getEmailConnection(userFrom(request)))),
  http.post(`${API}/settings/email-connection`, async ({ request }) => {
    const body = await json<{ provider?: unknown; address?: unknown }>(request)
    return respond(() => connectEmail(userFrom(request), body))
  }),
  http.delete(`${API}/settings/email-connection`, ({ request }) => respond(() => disconnectEmail(userFrom(request)))),

  http.get(`${API}/onboarding`, ({ request }) => respond(() => getOnboarding(userFrom(request)))),
  http.patch(`${API}/onboarding`, async ({ request }) => {
    const body = await json<{ dismissed?: unknown }>(request)
    return respond(() => setOnboardingDismissed(userFrom(request), body?.dismissed === true))
  }),
  http.post(`${API}/onboarding/dismiss`, ({ request }) => respond(() => setOnboardingDismissed(userFrom(request), true))),
  http.post(`${API}/onboarding/restore`, ({ request }) => respond(() => setOnboardingDismissed(userFrom(request), false))),
  http.post<{ id: string }>(`${API}/onboarding/items/:id/complete`, ({ request, params }) =>
    respond(() => setOnboardingItem(userFrom(request), params.id, true)),
  ),
  http.patch<{ id: string }>(`${API}/onboarding/items/:id`, async ({ request, params }) => {
    const body = await json<{ done?: unknown }>(request)
    return respond(() => setOnboardingItem(userFrom(request), params.id, body?.done !== false))
  }),

  // Public (no auth). The availability route comes before /public/signup/:id.
  http.get(`${API}/public/plans`, () => respond(() => signup.listPlans())),
  http.get(`${API}/public/signup/availability`, ({ request }) =>
    respond(() => signup.checkSubdomain(new URL(request.url).searchParams.get('subdomain'))),
  ),
  http.post(`${API}/public/signup`, async ({ request }) => {
    const body = await json<Parameters<typeof signup.startSignup>[0]>(request)
    return respond(() => signup.startSignup(body, clientKey(request)))
  }),
  http.get<{ id: string }>(`${API}/public/signup/:id`, ({ params }) => respond(() => signup.getSignup(params.id))),
  http.post<{ id: string }>(`${API}/public/signup/:id/resend`, ({ params }) => respond(() => signup.resendCode(params.id))),
  http.post<{ id: string }>(`${API}/public/signup/:id/verify`, async ({ request, params }) => {
    const body = await json<{ code?: unknown }>(request)
    return respond(() => signup.verifySignup(params.id, body))
  }),
  http.post<{ id: string }>(`${API}/public/signup/:id/complete`, async ({ request, params }) => {
    const body = await json<Parameters<typeof signup.completeSignup>[1]>(request)
    return respond(() => signup.completeSignup(params.id, body))
  }),
  http.post(`${API}/public/checkout`, async ({ request }) => {
    const body = await json<Parameters<typeof signup.checkout>[0]>(request)
    return respond(() => signup.checkout(body))
  }),
  http.post(`${API}/public/contact-sales`, async ({ request }) => {
    const body = await json<Parameters<typeof signup.contactSales>[0]>(request)
    return respond(() => signup.contactSales(body))
  }),
]
