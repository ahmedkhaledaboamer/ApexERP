import type { Session, User } from '@/shared/types'
import type { Company, PublicCompany } from '@/modules/tenancy/types'
import type { CompanyAnnouncement } from '@/modules/platform/types'
import { http } from '@/shared/lib/axios'
import { companyAnnouncementMapper } from '@/shared/api/mappers'

/** Tenant API. None of these send a company id; the server reads it from the token. */

export async function getTenant(): Promise<Company> {
  return (await http.get<Company>('/tenant')).data
}

/** Branding for a workspace address before sign-in (login page). 404 → workspace not found. */
export async function getPublicWorkspace(subdomain: string): Promise<PublicCompany> {
  return (await http.get<PublicCompany>(`/public/workspaces/${encodeURIComponent(subdomain)}`)).data
}

/* ---- Dev only (mock): tenant switcher ---- */

export interface DevAccountGroup {
  company: PublicCompany
  users: Pick<User, 'id' | 'name' | 'role' | 'email'>[]
}

export async function getDevAccounts(): Promise<DevAccountGroup[]> {
  return (await http.get<DevAccountGroup[]>('/auth/dev/accounts')).data
}

export async function devSignInAs(userId: string): Promise<Session> {
  return (await http.post<Session>('/auth/dev/sign-in', { userId })).data
}

/* ---- Support sessions (company token; the platform console starts them in modules/platform/api.ts) ---- */

/** Ends the support session (audited). The client then drops the company session. */
export async function stopImpersonation(): Promise<void> {
  await http.post('/auth/impersonation/stop')
}

/** Read-only → write mode (second confirmation). Returns the new Session. */
export async function enableImpersonationWriteMode(): Promise<Session> {
  return (await http.post<Session>('/auth/impersonation/write-mode', { confirm: true })).data
}

/* ---- Announcements (company app) ---- */

/** Active, in-segment announcements this user hasn't dismissed. */
export async function getAnnouncements(): Promise<CompanyAnnouncement[]> {
  return companyAnnouncementMapper.fromApiList((await http.get<unknown>('/announcements')).data)
}

export async function dismissAnnouncement(id: string): Promise<void> {
  await http.post(`/announcements/${encodeURIComponent(id)}/dismiss`)
}
