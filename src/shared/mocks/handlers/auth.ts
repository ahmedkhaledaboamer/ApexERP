import { http } from 'msw'
import type { Role } from '@/shared/types'
import {
  devSignInAs,
  getDevAccounts,
  getPublicWorkspace,
  getTenant,
  getUsers,
  impersonationWriteMode,
  login,
  loginTwoFactor,
  platformLogin,
  stopImpersonation,
  switchRole,
} from '@/shared/mocks/services/auth'
import { API, WORKSPACE_HEADER, impersonationSessionFrom, respond, userFrom } from './utils'

export const authHandlers = [
  // The workspace comes from the address the app was opened on (Host header in production).
  http.post(`${API}/auth/login`, async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    return respond(() => login(email, password, request.headers.get(WORKSPACE_HEADER)))
  }),
  http.post(`${API}/auth/login/2fa`, async ({ request }) => {
    const { challengeId, code } = (await request.json()) as { challengeId: string; code: string }
    return respond(() => loginTwoFactor(challengeId, code))
  }),
  http.post(`${API}/auth/switch-role`, async ({ request }) => {
    const { role } = (await request.json()) as { role: Role }
    return respond(() => switchRole(userFrom(request), role))
  }),
  http.get(`${API}/auth/me`, ({ request }) => respond(() => userFrom(request))),
  http.get(`${API}/tenant`, ({ request }) => respond(() => getTenant(userFrom(request)))),
  // An old (still redirecting) subdomain answers the company with `redirectTo`.
  http.get(`${API}/public/workspaces/:subdomain`, ({ params }) => respond(() => getPublicWorkspace(String(params.subdomain)))),
  http.get(`${API}/users`, ({ request }) => respond(() => getUsers(userFrom(request)))),

  // Dev only (mock): the tenant switcher.
  http.get(`${API}/auth/dev/accounts`, () => respond(() => getDevAccounts())),
  http.post(`${API}/auth/dev/sign-in`, async ({ request }) => {
    const { userId } = (await request.json()) as { userId: string }
    return respond(() => devSignInAs(userId))
  }),

  // Platform console sign-in (every other /platform/* endpoint is in handlers/platform.ts).
  http.post(`${API}/platform/auth/login`, async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    return respond(() => platformLogin(email, password))
  }),

  // Impersonation (company side; impersonation token).
  http.post(`${API}/auth/impersonation/stop`, ({ request }) =>
    respond(() => {
      userFrom(request)
      return stopImpersonation(impersonationSessionFrom(request))
    }),
  ),
  http.post(`${API}/auth/impersonation/write-mode`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
    return respond(() => impersonationWriteMode(userFrom(request), impersonationSessionFrom(request), body))
  }),
]
