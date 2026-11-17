import { http } from 'msw'
import type { PackageInput, PackageUpdateInput, ProjectTemplateInput, ServiceInput, ServiceUpdateInput } from '@/modules/services/types'
import * as svc from '@/shared/mocks/services/services'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

/** Service catalog, packages and project templates. Package routes come before /services/:id. */
export const serviceHandlers = [
  http.get(`${API}/services/packages`, ({ request }) => respond(() => svc.listPackages(userFrom(request)))),
  http.post(`${API}/services/packages`, async ({ request }) => {
    const body = (await request.json()) as PackageInput
    return respond(() => svc.createPackage(userFrom(request), body))
  }),
  http.get<Params>(`${API}/services/packages/:id`, ({ request, params }) => respond(() => svc.getPackage(userFrom(request), params.id))),
  http.patch<Params>(`${API}/services/packages/:id`, async ({ request, params }) => {
    const body = (await request.json()) as PackageUpdateInput
    return respond(() => svc.updatePackage(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/services/packages/:id/deactivate`, ({ request, params }) =>
    respond(() => svc.setPackageActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/services/packages/:id/reactivate`, ({ request, params }) =>
    respond(() => svc.setPackageActive(userFrom(request), params.id, true)),
  ),

  http.get(`${API}/services`, ({ request }) => respond(() => svc.listServices(userFrom(request)))),
  http.post(`${API}/services`, async ({ request }) => {
    const body = (await request.json()) as ServiceInput
    return respond(() => svc.createService(userFrom(request), body))
  }),
  http.get<Params>(`${API}/services/:id`, ({ request, params }) => respond(() => svc.getService(userFrom(request), params.id))),
  http.patch<Params>(`${API}/services/:id`, async ({ request, params }) => {
    const body = (await request.json()) as ServiceUpdateInput
    return respond(() => svc.updateService(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/services/:id/deactivate`, ({ request, params }) =>
    respond(() => svc.setServiceActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/services/:id/reactivate`, ({ request, params }) =>
    respond(() => svc.setServiceActive(userFrom(request), params.id, true)),
  ),
  http.get<Params>(`${API}/services/:id/project-template`, ({ request, params }) =>
    respond(() => svc.getProjectTemplate(userFrom(request), params.id)),
  ),
  http.put<Params>(`${API}/services/:id/project-template`, async ({ request, params }) => {
    const body = (await request.json()) as ProjectTemplateInput
    return respond(() => svc.saveProjectTemplate(userFrom(request), params.id, body))
  }),
]
