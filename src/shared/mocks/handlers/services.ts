import { http } from 'msw'
import type { PackageInput, PackageUpdateInput, ProjectTemplateInput, ServiceInput, ServiceUpdateInput } from '@/modules/services/types'
import * as svc from '@/shared/mocks/services/services'
import {
  packageInputMapper,
  packageRowMapper,
  projectTemplateMapper,
  serviceDetailMapper,
  serviceInputMapper,
  serviceRowMapper,
} from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

/**
 * Service catalog, packages and project templates (services / service_packages / project_template_tasks
 * columns on the wire). Package routes come before /services/:id.
 */
export const serviceHandlers = [
  http.get(`${API}/services/packages`, ({ request }) => respondAs(packageRowMapper, () => svc.listPackages(userFrom(request)))),
  http.post(`${API}/services/packages`, async ({ request }) => {
    const body = await bodyAs<PackageInput>(request, packageInputMapper)
    return respondAs(packageRowMapper, () => svc.createPackage(userFrom(request), body))
  }),
  http.get<Params>(`${API}/services/packages/:id`, ({ request, params }) => respondAs(packageRowMapper, () => svc.getPackage(userFrom(request), params.id))),
  http.patch<Params>(`${API}/services/packages/:id`, async ({ request, params }) => {
    const body = await bodyAs<PackageUpdateInput>(request, packageInputMapper)
    return respondAs(packageRowMapper, () => svc.updatePackage(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/services/packages/:id/deactivate`, ({ request, params }) =>
    respondAs(packageRowMapper, () => svc.setPackageActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/services/packages/:id/reactivate`, ({ request, params }) =>
    respondAs(packageRowMapper, () => svc.setPackageActive(userFrom(request), params.id, true)),
  ),

  http.get(`${API}/services`, ({ request }) => respondAs(serviceRowMapper, () => svc.listServices(userFrom(request)))),
  http.post(`${API}/services`, async ({ request }) => {
    const body = await bodyAs<ServiceInput>(request, serviceInputMapper)
    return respondAs(serviceRowMapper, () => svc.createService(userFrom(request), body))
  }),
  http.get<Params>(`${API}/services/:id`, ({ request, params }) => respondAs(serviceDetailMapper, () => svc.getService(userFrom(request), params.id))),
  http.patch<Params>(`${API}/services/:id`, async ({ request, params }) => {
    const body = await bodyAs<ServiceUpdateInput>(request, serviceInputMapper)
    return respondAs(serviceRowMapper, () => svc.updateService(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/services/:id/deactivate`, ({ request, params }) =>
    respondAs(serviceRowMapper, () => svc.setServiceActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/services/:id/reactivate`, ({ request, params }) =>
    respondAs(serviceRowMapper, () => svc.setServiceActive(userFrom(request), params.id, true)),
  ),
  http.get<Params>(`${API}/services/:id/project-template`, ({ request, params }) =>
    respondAs(projectTemplateMapper, () => svc.getProjectTemplate(userFrom(request), params.id)),
  ),
  http.put<Params>(`${API}/services/:id/project-template`, async ({ request, params }) => {
    const body = await bodyAs<ProjectTemplateInput>(request, projectTemplateMapper)
    return respondAs(projectTemplateMapper, () => svc.saveProjectTemplate(userFrom(request), params.id, body))
  }),
]
