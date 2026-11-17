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

const enc = encodeURIComponent

/** Whole catalog, active and inactive (pickers filter to `active`). Rows include usage counts. */
export async function getServices(): Promise<ServiceRow[]> {
  return (await http.get<ServiceRow[]>('/services')).data
}

export async function getService(id: string): Promise<ServiceDetail> {
  return (await http.get<ServiceDetail>(`/services/${enc(id)}`)).data
}

export async function createService(input: ServiceInput): Promise<ServiceRow> {
  return (await http.post<ServiceRow>('/services', input)).data
}

export async function updateService(id: string, input: ServiceUpdateInput): Promise<ServiceRow> {
  return (await http.patch<ServiceRow>(`/services/${enc(id)}`, input)).data
}

export async function setServiceActive(id: string, active: boolean): Promise<ServiceRow> {
  return (await http.post<ServiceRow>(`/services/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data
}

/** Delivery tasks for a service (empty when none). The Won → project flow reads this. */
export async function getProjectTemplate(serviceId: string): Promise<ProjectTemplate> {
  return (await http.get<ProjectTemplate>(`/services/${enc(serviceId)}/project-template`)).data
}

export async function saveProjectTemplate(serviceId: string, input: ProjectTemplateInput): Promise<ProjectTemplate> {
  return (await http.put<ProjectTemplate>(`/services/${enc(serviceId)}/project-template`, input)).data
}

export async function getPackages(): Promise<PackageRow[]> {
  return (await http.get<PackageRow[]>('/services/packages')).data
}

export async function getPackage(id: string): Promise<PackageRow> {
  return (await http.get<PackageRow>(`/services/packages/${enc(id)}`)).data
}

export async function createPackage(input: PackageInput): Promise<PackageRow> {
  return (await http.post<PackageRow>('/services/packages', input)).data
}

export async function updatePackage(id: string, input: PackageUpdateInput): Promise<PackageRow> {
  return (await http.patch<PackageRow>(`/services/packages/${enc(id)}`, input)).data
}

export async function setPackageActive(id: string, active: boolean): Promise<PackageRow> {
  return (await http.post<PackageRow>(`/services/packages/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data
}
