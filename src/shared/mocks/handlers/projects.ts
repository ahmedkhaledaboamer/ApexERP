import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/projects'
import { projectDetailMapper, projectInputMapper, projectRowMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

/** Delivery projects: list/detail scoped by the tasks column of the matrix; create; update. projects columns on the wire. */
export const projectsHandlers: HttpHandler[] = [
  http.get(`${API}/projects`, ({ request }) => respondAs(projectRowMapper, () => svc.listProjects(userFrom(request)))),
  http.post(`${API}/projects`, async ({ request }) => {
    const body = await bodyAs<svc.ProjectCreateBody>(request, projectInputMapper)
    return respondAs(projectRowMapper, () => svc.createProject(userFrom(request), body))
  }),
  http.get<Params>(`${API}/projects/:id`, ({ request, params }) => respondAs(projectDetailMapper, () => svc.getProject(userFrom(request), params.id))),
  http.patch<Params>(`${API}/projects/:id`, async ({ request, params }) => {
    const body = await bodyAs<svc.ProjectUpdateBody>(request, projectInputMapper)
    return respondAs(projectRowMapper, () => svc.updateProject(userFrom(request), params.id, body))
  }),
]
