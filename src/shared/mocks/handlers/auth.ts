import { http } from 'msw'
import type { Role } from '@/shared/types'
import { getUsers, login, loginTwoFactor, switchRole } from '@/shared/mocks/services/auth'
import { API, respond, userFrom } from './utils'

export const authHandlers = [
  http.post(`${API}/auth/login`, async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    return respond(() => login(email, password))
  }),
  http.post(`${API}/auth/login/2fa`, async ({ request }) => {
    const { challengeId, code } = (await request.json()) as { challengeId: string; code: string }
    return respond(() => loginTwoFactor(challengeId, code))
  }),
  http.post(`${API}/auth/switch-role`, async ({ request }) => {
    const { role } = (await request.json()) as { role: Role }
    return respond(() => switchRole(role))
  }),
  http.get(`${API}/auth/me`, ({ request }) => respond(() => userFrom(request))),
  http.get(`${API}/users`, ({ request }) =>
    respond(() => {
      userFrom(request)
      return getUsers()
    }),
  ),
]
