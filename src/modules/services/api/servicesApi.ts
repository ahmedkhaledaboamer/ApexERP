import { http } from '@/shared/lib/axios'
import type {
  PackageInput,
  PackageRow,
  PackageUpdateInput,
  ProjectTemplate,
  ProjectTemplateInput,
  ServiceDetail,
  ServiceInput,
  ServiceRow,
  ServiceUpdateInput,
} from '@/modules/services/types'
import {
  packageInputMapper,
  packageRowMapper,
  projectTemplateMapper,
  serviceDetailMapper,
  serviceInputMapper,
  serviceRowMapper,
} from '@/shared/api/mappers'

/**
 * Services API. The API speaks the services / service_packages / project_template_tasks columns
 * (category_id, currency_code, is_active, day_offset…); every function maps both ways (shared/api/mappers.ts).
 */

const enc = encodeURIComponent

/** Whole catalog, active and inactive (pickers filter to `active`). Rows include usage counts. */
export async function getServices(): Promise<ServiceRow[]> {
  return serviceRowMapper.fromApiList((await http.get<unknown>('/services')).data)
}

export async function getService(id: string): Promise<ServiceDetail> {
  return serviceDetailMapper.fromApi((await http.get<unknown>(`/services/${enc(id)}`)).data)
}

export async function createService(input: ServiceInput): Promise<ServiceRow> {
  return serviceRowMapper.fromApi((await http.post<unknown>('/services', serviceInputMapper.toApi(input))).data)
}

export async function updateService(id: string, input: ServiceUpdateInput): Promise<ServiceRow> {
  return serviceRowMapper.fromApi((await http.patch<unknown>(`/services/${enc(id)}`, serviceInputMapper.toApi(input))).data)
}

export async function setServiceActive(id: string, active: boolean): Promise<ServiceRow> {
  return serviceRowMapper.fromApi((await http.post<unknown>(`/services/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data)
}

/** Delivery tasks for a service (empty when none). The Won → project flow reads this. */
export async function getProjectTemplate(serviceId: string): Promise<ProjectTemplate> {
  return projectTemplateMapper.fromApi((await http.get<unknown>(`/services/${enc(serviceId)}/project-template`)).data)
}

export async function saveProjectTemplate(serviceId: string, input: ProjectTemplateInput): Promise<ProjectTemplate> {
  return projectTemplateMapper.fromApi((await http.put<unknown>(`/services/${enc(serviceId)}/project-template`, projectTemplateMapper.toApi(input as never))).data)
}

export async function getPackages(): Promise<PackageRow[]> {
  return packageRowMapper.fromApiList((await http.get<unknown>('/services/packages')).data)
}

export async function getPackage(id: string): Promise<PackageRow> {
  return packageRowMapper.fromApi((await http.get<unknown>(`/services/packages/${enc(id)}`)).data)
}

export async function createPackage(input: PackageInput): Promise<PackageRow> {
  return packageRowMapper.fromApi((await http.post<unknown>('/services/packages', packageInputMapper.toApi(input))).data)
}

export async function updatePackage(id: string, input: PackageUpdateInput): Promise<PackageRow> {
  return packageRowMapper.fromApi((await http.patch<unknown>(`/services/packages/${enc(id)}`, packageInputMapper.toApi(input))).data)
}

export async function setPackageActive(id: string, active: boolean): Promise<PackageRow> {
  return packageRowMapper.fromApi((await http.post<unknown>(`/services/packages/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data)
}
