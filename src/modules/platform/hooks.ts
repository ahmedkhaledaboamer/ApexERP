import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PlatformSession } from '@/modules/tenancy/types'
import type { PlatformAuditQuery, PlatformPermissionV2 } from '@/modules/platform/types'
import { companyCapabilities, platformPermissions } from '@/modules/platform/permissions'
import * as api from '@/modules/platform/api'
import { useAppSelector } from '@/store/hooks'

export interface PlatformContext {
  session: PlatformSession
  token: string
  perms: PlatformPermissionV2[]
  can: (p: PlatformPermissionV2) => boolean
}

/** The platform session; only used under RequirePlatform, which guarantees one. */
export function usePlatform(): PlatformContext {
  const session = useAppSelector((s) => s.tenant.platform)
  if (!session) throw new Error('usePlatform() outside the platform console')
  return useMemo(() => {
    const perms = platformPermissions(session.platformUser as PlatformSession['platformUser'] & { permissions?: unknown })
    return { session, token: session.token, perms, can: (p: PlatformPermissionV2) => perms.includes(p) }
  }, [session])
}

export function useCompanyCaps() {
  return companyCapabilities(usePlatform().perms)
}

/** All console query keys start with 'platform' so one invalidation refreshes the console. */
export const platformKeys = {
  all: ['platform'] as const,
  overview: ['platform', 'overview'] as const,
  companies: ['platform', 'companies'] as const,
  company: (id: string) => ['platform', 'company', id] as const,
  companyUsers: (id: string) => ['platform', 'company', id, 'users'] as const,
  companyTimeline: (id: string) => ['platform', 'company', id, 'timeline'] as const,
  companyNotes: (id: string) => ['platform', 'company', id, 'notes'] as const,
  plans: ['platform', 'plans'] as const,
  settings: ['platform', 'settings'] as const,
  announcements: ['platform', 'announcements'] as const,
  audit: (q: PlatformAuditQuery) => ['platform', 'audit', q] as const,
}

export function useOverview() {
  const { token, session } = usePlatform()
  return useQuery({ queryKey: [...platformKeys.overview, session.platformUser.id], queryFn: () => api.getOverview(token) })
}

export function useCompanies() {
  const { token, session } = usePlatform()
  return useQuery({ queryKey: [...platformKeys.companies, session.platformUser.id], queryFn: () => api.listCompanies(token) })
}

export function useCompany(id: string) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.company(id), queryFn: () => api.getCompany(token, id) })
}

export function useCompanyUsers(id: string, enabled = true) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.companyUsers(id), queryFn: () => api.getCompanyUsers(token, id), enabled })
}

export function useCompanyTimeline(id: string) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.companyTimeline(id), queryFn: () => api.getCompanyTimeline(token, id) })
}

export function useCompanyNotes(id: string) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.companyNotes(id), queryFn: () => api.getCompanyNotes(token, id) })
}

export function usePlatformPlans(enabled = true) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.plans, queryFn: () => api.listPlatformPlans(token), enabled })
}

export function usePlatformSettings(enabled = true) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.settings, queryFn: () => api.getPlatformSettings(token), enabled })
}

export function useAnnouncements() {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.announcements, queryFn: () => api.listAnnouncements(token) })
}

export function usePlatformAudit(query: PlatformAuditQuery) {
  const { token } = usePlatform()
  return useQuery({ queryKey: platformKeys.audit(query), queryFn: () => api.listPlatformAudit(token, query), placeholderData: (prev) => prev })
}
