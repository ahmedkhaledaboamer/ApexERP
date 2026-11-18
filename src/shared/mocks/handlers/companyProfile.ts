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
import { companyProfileMapper, emailConnectionMapper, onboardingMapper, roleMapper, signupMapper } from '@/shared/api/mappers'
import { API, respond, respondAs, userFrom } from './utils'

const json = async <T,>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null
const clientKey = (request: Request) => request.headers.get('X-Client-Id')?.trim() || 'anonymous'

/** Company profile, onboarding checklist, subscription/roles, email connection and public self-service sign-up. */
export const companyProfileHandlers = [
  http.get(`${API}/settings/company-profile`, ({ request }) => respondAs(companyProfileMapper, () => getCompanyProfile(userFrom(request)))),
  http.patch(`${API}/settings/company-profile`, async ({ request }) => {
    const body = companyProfileMapper.fromApi(await json<unknown>(request))
    return respondAs(companyProfileMapper, () => updateCompanyProfile(userFrom(request), body))
  }),
  http.get(`${API}/settings/roles`, ({ request }) => respondAs(roleMapper, () => getRoles(userFrom(request)))),
  http.get(`${API}/settings/email-connection`, ({ request }) => respondAs(emailConnectionMapper, () => getEmailConnection(userFrom(request)))),
  http.post(`${API}/settings/email-connection`, async ({ request }) => {
    const body = emailConnectionMapper.fromApi(await json<unknown>(request)) as { provider?: unknown; address?: unknown } | null
    return respondAs(emailConnectionMapper, () => connectEmail(userFrom(request), body))
  }),
  http.delete(`${API}/settings/email-connection`, ({ request }) => respondAs(emailConnectionMapper, () => disconnectEmail(userFrom(request)))),

  http.get(`${API}/onboarding`, ({ request }) => respondAs(onboardingMapper, () => getOnboarding(userFrom(request)))),
  http.patch(`${API}/onboarding`, async ({ request }) => {
    const body = await json<{ dismissed?: unknown }>(request)
    return respondAs(onboardingMapper, () => setOnboardingDismissed(userFrom(request), body?.dismissed === true))
  }),
  http.post(`${API}/onboarding/dismiss`, ({ request }) => respondAs(onboardingMapper, () => setOnboardingDismissed(userFrom(request), true))),
  http.post(`${API}/onboarding/restore`, ({ request }) => respondAs(onboardingMapper, () => setOnboardingDismissed(userFrom(request), false))),
  http.post<{ id: string }>(`${API}/onboarding/items/:id/complete`, ({ request, params }) =>
    respondAs(onboardingMapper, () => setOnboardingItem(userFrom(request), params.id, true)),
  ),
  http.patch<{ id: string }>(`${API}/onboarding/items/:id`, async ({ request, params }) => {
    const body = await json<{ done?: unknown }>(request)
    return respondAs(onboardingMapper, () => setOnboardingItem(userFrom(request), params.id, body?.done !== false))
  }),

  // Public (no auth). The availability route comes before /public/signup/:id.
  http.get(`${API}/public/plans`, () => respondAs(signupMapper, () => signup.listPlans())),
  http.get(`${API}/public/signup/availability`, ({ request }) =>
    respondAs(signupMapper, () => signup.checkSubdomain(new URL(request.url).searchParams.get('subdomain'))),
  ),
  http.post(`${API}/public/signup`, async ({ request }) => {
    const body = signupMapper.fromApi(await json<unknown>(request)) as Parameters<typeof signup.startSignup>[0]
    return respondAs(signupMapper, () => signup.startSignup(body, clientKey(request)))
  }),
  http.get<{ id: string }>(`${API}/public/signup/:id`, ({ params }) => respondAs(signupMapper, () => signup.getSignup(params.id))),
  http.post<{ id: string }>(`${API}/public/signup/:id/resend`, ({ params }) => respondAs(signupMapper, () => signup.resendCode(params.id))),
  http.post<{ id: string }>(`${API}/public/signup/:id/verify`, async ({ request, params }) => {
    const body = signupMapper.fromApi(await json<unknown>(request)) as { code?: unknown } | null
    return respondAs(signupMapper, () => signup.verifySignup(params.id, body))
  }),
  http.post<{ id: string }>(`${API}/public/signup/:id/complete`, async ({ request, params }) => {
    // Answers the new session in the auth session shape (like POST /auth/login), not mapped.
    const body = signupMapper.fromApi(await json<unknown>(request)) as Parameters<typeof signup.completeSignup>[1]
    return respond(() => signup.completeSignup(params.id, body))
  }),
  http.post(`${API}/public/checkout`, async ({ request }) => {
    const body = signupMapper.fromApi(await json<unknown>(request)) as Parameters<typeof signup.checkout>[0]
    return respondAs(signupMapper, () => signup.checkout(body))
  }),
  http.post(`${API}/public/contact-sales`, async ({ request }) => {
    const body = signupMapper.fromApi(await json<unknown>(request)) as Parameters<typeof signup.contactSales>[0]
    return respondAs(signupMapper, () => signup.contactSales(body))
  }),
]
