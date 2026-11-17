import { http, type HttpHandler } from 'msw'
import type { SecurityPolicy } from '@/modules/settings/security/types'
import * as svc from '@/shared/mocks/services/security'
import { API, respond, userFrom } from './utils'

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}

export const securityHandlers: HttpHandler[] = [
  http.get(`${API}/security/2fa`, ({ request }) => respond(() => svc.getTwoFactor(userFrom(request)))),
  http.post(`${API}/security/2fa/setup`, ({ request }) => respond(() => svc.setupTwoFactor(userFrom(request)))),
  http.post(`${API}/security/2fa/verify`, async ({ request }) => {
    const { code } = await body<{ code?: string }>(request)
    return respond(() => svc.verifyTwoFactor(userFrom(request), code ?? ''))
  }),
  http.post(`${API}/security/2fa/disable`, async ({ request }) => {
    const { code } = await body<{ code?: string }>(request)
    return respond(() => svc.disableTwoFactor(userFrom(request), code ?? ''))
  }),
  http.get(`${API}/security/sessions`, ({ request }) => respond(() => svc.getSessions(userFrom(request)))),
  http.post(`${API}/security/sessions/revoke-others`, ({ request }) => respond(() => svc.revokeOtherSessions(userFrom(request)))),
  http.delete<{ id: string }>(`${API}/security/sessions/:id`, ({ request, params }) =>
    respond(() => svc.revokeSession(userFrom(request), params.id)),
  ),
  http.get(`${API}/security/backups`, ({ request }) => respond(() => svc.getBackups(userFrom(request)))),
  http.post(`${API}/security/backups/run`, ({ request }) => respond(() => svc.runBackup(userFrom(request)))),
  http.get(`${API}/security/policy`, ({ request }) => respond(() => svc.getPolicy(userFrom(request)))),
  http.put(`${API}/security/policy`, async ({ request }) => {
    const input = await body<Partial<SecurityPolicy>>(request)
    return respond(() => svc.savePolicy(userFrom(request), input))
  }),
]
