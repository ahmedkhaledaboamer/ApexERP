import { http, type HttpHandler } from 'msw'
import type { SecurityPolicy } from '@/modules/settings/security/types'
import * as svc from '@/shared/mocks/services/security'
import { backupStatusMapper, plainMapper } from '@/shared/api/mappers'
import { API, respondAs, userFrom } from './utils'

async function body<T>(request: Request): Promise<T> {
  try {
    return plainMapper.fromApi(await request.json()) as T
  } catch {
    return {} as T
  }
}

export const securityHandlers: HttpHandler[] = [
  http.get(`${API}/security/2fa`, ({ request }) => respondAs(plainMapper, () => svc.getTwoFactor(userFrom(request)))),
  http.post(`${API}/security/2fa/setup`, ({ request }) => respondAs(plainMapper, () => svc.setupTwoFactor(userFrom(request)))),
  http.post(`${API}/security/2fa/verify`, async ({ request }) => {
    const { code } = await body<{ code?: string }>(request)
    return respondAs(plainMapper, () => svc.verifyTwoFactor(userFrom(request), code ?? ''))
  }),
  http.post(`${API}/security/2fa/disable`, async ({ request }) => {
    const { code } = await body<{ code?: string }>(request)
    return respondAs(plainMapper, () => svc.disableTwoFactor(userFrom(request), code ?? ''))
  }),
  http.get(`${API}/security/sessions`, ({ request }) => respondAs(plainMapper, () => svc.getSessions(userFrom(request)))),
  http.post(`${API}/security/sessions/revoke-others`, ({ request }) => respondAs(plainMapper, () => svc.revokeOtherSessions(userFrom(request)))),
  http.delete<{ id: string }>(`${API}/security/sessions/:id`, ({ request, params }) =>
    respondAs(plainMapper, () => svc.revokeSession(userFrom(request), params.id)),
  ),
  http.get(`${API}/security/backups`, ({ request }) => respondAs(backupStatusMapper, () => svc.getBackups(userFrom(request)))),
  http.post(`${API}/security/backups/run`, ({ request }) => respondAs(plainMapper, () => svc.runBackup(userFrom(request)))),
  http.get(`${API}/security/policy`, ({ request }) => respondAs(plainMapper, () => svc.getPolicy(userFrom(request)))),
  http.put(`${API}/security/policy`, async ({ request }) => {
    const input = await body<Partial<SecurityPolicy>>(request)
    return respondAs(plainMapper, () => svc.savePolicy(userFrom(request), input))
  }),
]
