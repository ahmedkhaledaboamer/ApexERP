import type { AxiosRequestConfig } from 'axios'
import type { Session } from '@/shared/types'
import type { PlatformSession } from '@/modules/tenancy/types'
import type {
  Announcement,
  AnnouncementInput,
  CompanyAction,
  ModuleOverrideInput,
  PlanCreateInput,
  PlanEditInput,
  PlanEditResult,
  PlatformAuditEntry,
  PlatformAuditQuery,
  PlatformCompanyDetail,
  PlatformCompanyQuery,
  PlatformCompanyRow,
  PlatformCompanyUser,
  PlatformOverview,
  PlatformPlan,
  PlatformSettings,
  SubdomainChangeInput,
  SubdomainCheck,
  SupportNote,
  TimelineEvent,
} from '@/modules/platform/types'
import { http } from '@/shared/lib/axios'
import { ApiError } from '@/shared/lib/apiError'

/**
 * Super-Admin Console API (contract: platform/types.ts). Every call carries the PLATFORM token
 * explicitly; the axios interceptor only adds the company token when no Authorization header is
 * set, so the two sessions never mix. A 401 from any of these ends the platform session.
 */

type Unauthorized = () => void
const unauthorizedListeners = new Set<Unauthorized>()

/** PlatformApp listens and signs the operator out on an expired or foreign platform token. */
export function onPlatformUnauthorized(listener: Unauthorized): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

const enc = encodeURIComponent

function auth(token: string, extra: AxiosRequestConfig = {}): AxiosRequestConfig {
  return { ...extra, headers: { ...(extra.headers ?? {}), Authorization: `Bearer ${token}` } }
}

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await run()).data
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) unauthorizedListeners.forEach((l) => l())
    throw e
  }
}

/* ---------------- Auth ---------------- */

export async function platformLogin(email: string, password: string): Promise<PlatformSession> {
  return (await http.post<PlatformSession>('/platform/auth/login', { email, password })).data
}

/* ---------------- Overview ---------------- */

export const getOverview = (token: string) => call(() => http.get<PlatformOverview>('/platform/overview', auth(token)))

/* ---------------- Companies ---------------- */

export const listCompanies = (token: string, query: PlatformCompanyQuery = {}) =>
  call(() => http.get<PlatformCompanyRow[]>('/platform/companies', auth(token, { params: query })))

export const getCompany = (token: string, id: string) => call(() => http.get<PlatformCompanyDetail>(`/platform/companies/${enc(id)}`, auth(token)))

export const getCompanyUsers = (token: string, id: string) =>
  call(() => http.get<PlatformCompanyUser[]>(`/platform/companies/${enc(id)}/users`, auth(token)))

export const getCompanyTimeline = (token: string, id: string) =>
  call(() => http.get<TimelineEvent[]>(`/platform/companies/${enc(id)}/timeline`, auth(token)))

export const getCompanyNotes = (token: string, id: string) =>
  call(() => http.get<SupportNote[]>(`/platform/companies/${enc(id)}/notes`, auth(token)))

export const addCompanyNote = (token: string, id: string, body: string) =>
  call(() => http.post<SupportNote>(`/platform/companies/${enc(id)}/notes`, { body }, auth(token)))

/** change_plan / extend_trial / suspend / reactivate / cancel — always with a reason. */
export const companyAction = (token: string, id: string, action: CompanyAction) =>
  call(() => http.post<unknown>(`/platform/companies/${enc(id)}/actions`, action, auth(token)))

export const setModuleOverride = (token: string, id: string, input: ModuleOverrideInput) =>
  call(() => http.post<unknown>(`/platform/companies/${enc(id)}/modules`, input, auth(token)))

export const changeSubdomain = (token: string, id: string, input: SubdomainChangeInput) =>
  call(() => http.post<unknown>(`/platform/companies/${enc(id)}/subdomain`, input, auth(token)))

export const checkPlatformSubdomain = (token: string, subdomain: string, companyId: string, signal?: AbortSignal) =>
  call(() => http.get<SubdomainCheck>('/platform/subdomains/check', auth(token, { params: { subdomain, companyId }, signal })))

/* ---------------- Plans + settings ---------------- */

export const listPlatformPlans = (token: string) => call(() => http.get<PlatformPlan[]>('/platform/plans', auth(token)))

export const updatePlatformPlan = (token: string, id: string, input: PlanEditInput) =>
  call(() => http.patch<PlanEditResult>(`/platform/plans/${enc(id)}`, input, auth(token)))

export const createPlatformPlan = (token: string, input: PlanCreateInput) =>
  call(() => http.post<PlatformPlan>('/platform/plans', input, auth(token)))

export const getPlatformSettings = (token: string) => call(() => http.get<PlatformSettings>('/platform/settings', auth(token)))

export const updatePlatformSettings = (token: string, input: Partial<PlatformSettings> & { reason: string }) =>
  call(() => http.patch<PlatformSettings>('/platform/settings', input, auth(token)))

/* ---------------- Announcements ---------------- */

export const listAnnouncements = (token: string) => call(() => http.get<Announcement[]>('/platform/announcements', auth(token)))

export const createAnnouncement = (token: string, input: AnnouncementInput) =>
  call(() => http.post<Announcement>('/platform/announcements', input, auth(token)))

export const updateAnnouncement = (token: string, id: string, input: AnnouncementInput) =>
  call(() => http.patch<Announcement>(`/platform/announcements/${enc(id)}`, input, auth(token)))

/** Ends it now (kept in the list and the audit log). */
export const endAnnouncement = (token: string, id: string, reason?: string) =>
  call(() => http.delete<unknown>(`/platform/announcements/${enc(id)}`, auth(token, { data: reason ? { reason } : undefined })))

/* ---------------- Audit ---------------- */

export const listPlatformAudit = (token: string, query: PlatformAuditQuery) =>
  call(() => http.get<PlatformAuditEntry[]>('/platform/audit', auth(token, { params: query })))

/* ---------------- Impersonation ---------------- */

/** Returns a COMPANY session (read-only, time-limited) for that user. */
export const startImpersonation = (token: string, userId: string, reason: string) =>
  call(() => http.post<Session>('/platform/impersonations', { userId, reason }, auth(token)))
