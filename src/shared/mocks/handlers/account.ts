import { http, type HttpHandler } from 'msw'
import type { ChangePasswordInput } from '@/modules/account/types'
import * as svc from '@/shared/mocks/services/account'
import { API, respond, userFrom } from './utils'

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}

export const accountHandlers: HttpHandler[] = [
  http.get(`${API}/account`, ({ request }) => respond(() => svc.getAccount(userFrom(request)))),
  http.post(`${API}/account/password`, async ({ request }) => {
    const input = await body<Partial<ChangePasswordInput>>(request)
    return respond(() => svc.changePassword(userFrom(request), input))
  }),
]
