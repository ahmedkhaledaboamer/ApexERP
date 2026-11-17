import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/services/api/servicesApi'
import type {
  PackageInput,
  PackageUpdateInput,
  ProjectTemplateInput,
  ServiceInput,
  ServiceRow,
  ServiceUpdateInput,
} from '@/modules/services/types'

export const serviceKeys = {
  all: ['services'] as const,
  list: () => ['services', 'list'] as const,
  detail: (id: string) => ['services', 'detail', id] as const,
  template: (id: string) => ['services', 'template', id] as const,
  packages: () => ['services', 'packages'] as const,
  package: (id: string) => ['services', 'package', id] as const,
}

/** The whole catalog (active + inactive), shared by quotations, the lead form and this module. */
export function useServicesQuery() {
  return useQuery({ queryKey: serviceKeys.list(), queryFn: api.getServices, staleTime: 60_000 })
}

/** Catalog helpers: active services for pickers, lookup by id for display (inactive still resolve). */
export function useCatalog() {
  const query = useServicesQuery()
  return useMemo(() => {
    const all: ServiceRow[] = query.data ?? []
    const byId = new Map(all.map((s) => [s.id, s]))
    return {
      ...query,
      all,
      active: all.filter((s) => s.active),
      byId: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
      nameOf: (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? id) : '—'),
    }
  }, [query])
}

export function useServiceQuery(id: string) {
  return useQuery({ queryKey: serviceKeys.detail(id), queryFn: () => api.getService(id), enabled: !!id })
}

/** Stored delivery template for a service; the Won → project flow (next step) reads it too. */
export function useProjectTemplate(serviceId: string) {
  return useQuery({ queryKey: serviceKeys.template(serviceId), queryFn: () => api.getProjectTemplate(serviceId), enabled: !!serviceId })
}

export function usePackagesQuery() {
  return useQuery({ queryKey: serviceKeys.packages(), queryFn: api.getPackages, staleTime: 60_000 })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: serviceKeys.all })
    qc.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function useCreateService() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: ServiceInput) => api.createService(input), onSuccess: done })
}

export function useUpdateService() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ServiceUpdateInput }) => api.updateService(id, input),
    onSuccess: done,
  })
}

export function useSetServiceActive() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setServiceActive(id, active),
    onSuccess: done,
  })
}

export function useSaveProjectTemplate(serviceId: string) {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: ProjectTemplateInput) => api.saveProjectTemplate(serviceId, input), onSuccess: done })
}

export function useCreatePackage() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: PackageInput) => api.createPackage(input), onSuccess: done })
}

export function useUpdatePackage() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PackageUpdateInput }) => api.updatePackage(id, input),
    onSuccess: done,
  })
}

export function useSetPackageActive() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setPackageActive(id, active),
    onSuccess: done,
  })
}
