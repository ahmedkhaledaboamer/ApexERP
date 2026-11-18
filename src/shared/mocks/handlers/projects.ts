import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/projects'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

/** Delivery projects: list/detail scoped by the tasks column of the matrix; create; update. */
export const projectsHandlers: HttpHandler[] = [
  http.get(`${API}/projects`, ({ request }) => respond(() => svc.listProjects(userFrom(request)))),
  http.post(`${API}/projects`, async ({ request }) => {
    const body = (await request.json()) as svc.ProjectCreateBody
    return respond(() => svc.createProject(userFrom(request), body))
  }),
  http.get<Params>(`${API}/projects/:id`, ({ request, params }) => respond(() => svc.getProject(userFrom(request), params.id))),
  http.patch<Params>(`${API}/projects/:id`, async ({ request, params }) => {
    const body = (await request.json()) as svc.ProjectUpdateBody
    return respond(() => svc.updateProject(userFrom(request), params.id, body))
  }),
]
