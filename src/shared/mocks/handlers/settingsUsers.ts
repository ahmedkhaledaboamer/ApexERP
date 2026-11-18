import { http, HttpResponse, type HttpHandler } from 'msw'
import type { UserInput, UserUpdateInput } from '@/modules/settings/users/types'
import * as svc from '@/shared/mocks/services/settingsUsers'
import { departmentOptionMapper, settingsUserMapper } from '@/shared/api/mappers'
import { API, respond, respondAs, userFrom } from './utils'

async function body<T>(request: Request): Promise<T> {
  try {
    return settingsUserMapper.fromApi(await request.json()) as T
  } catch {
    return {} as T
  }
}

export const settingsUsersHandlers: HttpHandler[] = [
  http.get(`${API}/settings/users`, ({ request }) => respondAs(settingsUserMapper, () => svc.getSettingsUsers(userFrom(request)))),
  http.get(`${API}/settings/departments`, ({ request }) => respondAs(departmentOptionMapper, () => svc.getDepartments(userFrom(request)))),
  http.post(`${API}/settings/users`, async ({ request }) => {
    const input = await body<UserInput>(request)
    return respondAs(settingsUserMapper, () => svc.createUser(userFrom(request), input))
  }),
  http.patch<{ id: string }>(`${API}/settings/users/:id`, async ({ request, params }) => {
    const input = await body<UserUpdateInput>(request)
    return respondAs(settingsUserMapper, () => svc.updateUser(userFrom(request), params.id, input))
  }),
  http.post<{ id: string }>(`${API}/settings/users/:id/deactivate`, async ({ request, params }) => {
    const { confirm } = await body<{ confirm?: boolean }>(request)
    // respond() would drop `openLeads`, so the confirm case is answered here.
    try {
      return HttpResponse.json(settingsUserMapper.toApi(await svc.deactivateUser(userFrom(request), params.id, confirm === true)))
    } catch (error) {
      if (error instanceof svc.ConfirmRequiredError) {
        return HttpResponse.json({ message: error.message, openLeads: error.openLeads }, { status: 409 })
      }
      return respond(() => {
        throw error
      })
    }
  }),
  http.post<{ id: string }>(`${API}/settings/users/:id/reactivate`, ({ request, params }) =>
    respondAs(settingsUserMapper, () => svc.reactivateUser(userFrom(request), params.id)),
  ),
]
