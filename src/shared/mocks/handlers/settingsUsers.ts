import { http, HttpResponse, type HttpHandler } from 'msw'
import type { UserInput, UserUpdateInput } from '@/modules/settings/users/types'
import * as svc from '@/shared/mocks/services/settingsUsers'
import { API, respond, userFrom } from './utils'

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}

export const settingsUsersHandlers: HttpHandler[] = [
  http.get(`${API}/settings/users`, ({ request }) => respond(() => svc.getSettingsUsers(userFrom(request)))),
  http.get(`${API}/settings/departments`, ({ request }) =>
    respond(() => {
      userFrom(request)
      return svc.getDepartments()
    }),
  ),
  http.post(`${API}/settings/users`, async ({ request }) => {
    const input = await body<UserInput>(request)
    return respond(() => svc.createUser(userFrom(request), input))
  }),
  http.patch<{ id: string }>(`${API}/settings/users/:id`, async ({ request, params }) => {
    const input = await body<UserUpdateInput>(request)
    return respond(() => svc.updateUser(userFrom(request), params.id, input))
  }),
  http.post<{ id: string }>(`${API}/settings/users/:id/deactivate`, async ({ request, params }) => {
    const { confirm } = await body<{ confirm?: boolean }>(request)
    // respond() would drop `openLeads`, so the confirm case is answered here.
    try {
      return HttpResponse.json((await svc.deactivateUser(userFrom(request), params.id, confirm === true)) as never)
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
    respond(() => svc.reactivateUser(userFrom(request), params.id)),
  ),
]
