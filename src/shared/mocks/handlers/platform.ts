import { http, HttpResponse, type HttpHandler } from 'msw'
import type { PlatformAuditQuery, PlatformCompanyQuery, PlatformPermissionV2 } from '@/modules/platform/types'
import * as svc from '@/shared/mocks/services/platform'
import { startImpersonation } from '@/shared/mocks/services/auth'
import { API, errorBody, requirePlatform, respond, userFrom } from './utils'
import { ApiError } from '@/shared/lib/apiError'

const json = async <T,>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null
const params = (request: Request) => new URL(request.url).searchParams
const str = (v: string | null) => (v && v.trim() ? v.trim() : undefined)

/**
 * Super-Admin Console (/platform/*). Every endpoint starts with requirePlatform(request, permission)
 * (handlers/utils.ts): a platform token only (company and impersonation tokens → 401), then the
 * permission (→ 403 platform_forbidden). POST /platform/auth/login lives in handlers/auth.ts.
 * Company-side announcements (GET /announcements, POST /announcements/:id/dismiss) are here too.
 */
export const platformHandlers: HttpHandler[] = [
  http.get(`${API}/platform/me`, ({ request }) => respond(() => svc.getMe(requirePlatform(request, null)))),

  /* ---- Companies ---- */
  http.get(`${API}/platform/companies`, ({ request }) =>
    respond(() => {
      const ctx = requirePlatform(request, 'tenants:view')
      const p = params(request)
      const query: PlatformCompanyQuery = {
        status: str(p.get('status')) as PlatformCompanyQuery['status'],
        plan: str(p.get('plan')),
        country: str(p.get('country')) as PlatformCompanyQuery['country'],
        q: str(p.get('q')),
        sort: str(p.get('sort')) as PlatformCompanyQuery['sort'],
        dir: str(p.get('dir')) as PlatformCompanyQuery['dir'],
      }
      return svc.listCompanies(ctx, query)
    }),
  ),
  http.get<{ id: string }>(`${API}/platform/companies/:id`, ({ request, params: p }) =>
    respond(() => svc.getCompanyDetail(requirePlatform(request, 'tenants:view'), p.id)),
  ),
  http.get<{ id: string }>(`${API}/platform/companies/:id/users`, ({ request, params: p }) =>
    respond(() => svc.getCompanyUsers(requirePlatform(request, 'tenants:view'), p.id)),
  ),
  http.get<{ id: string }>(`${API}/platform/companies/:id/timeline`, ({ request, params: p }) =>
    respond(() => svc.getCompanyTimeline(requirePlatform(request, 'tenants:view'), p.id)),
  ),
  http.get<{ id: string }>(`${API}/platform/companies/:id/notes`, ({ request, params: p }) =>
    respond(() => svc.listNotes(requirePlatform(request, 'tenants:view'), p.id)),
  ),
  http.post<{ id: string }>(`${API}/platform/companies/:id/notes`, async ({ request, params: p }) => {
    const body = await json<{ body?: unknown }>(request)
    return respond(() => svc.addNote(requirePlatform(request, 'support:notes'), p.id, body))
  }),
  http.post<{ id: string }>(`${API}/platform/companies/:id/actions`, async ({ request, params: p }) => {
    const body = await json<Record<string, unknown>>(request)
    // Permission per action (unknown action: any platform user gets 422 invalid_action).
    const permission: PlatformPermissionV2 | null = svc.ACTION_PERMISSION[String(body?.action ?? '')] ?? null
    return respond(() => svc.runCompanyAction(requirePlatform(request, permission), p.id, body))
  }),
  http.post<{ id: string }>(`${API}/platform/companies/:id/modules`, async ({ request, params: p }) => {
    const body = await json<Parameters<typeof svc.setModuleOverride>[2]>(request)
    return respond(() => svc.setModuleOverride(requirePlatform(request, 'tenants:manage'), p.id, body))
  }),
  http.post<{ id: string }>(`${API}/platform/companies/:id/subdomain`, async ({ request, params: p }) => {
    const body = await json<Parameters<typeof svc.changeSubdomain>[2]>(request)
    return respond(() => svc.changeSubdomain(requirePlatform(request, 'tenants:subdomain'), p.id, body))
  }),
  http.get(`${API}/platform/subdomains/check`, ({ request }) =>
    respond(() => {
      const ctx = requirePlatform(request, 'tenants:subdomain')
      const p = params(request)
      return svc.checkSubdomain(ctx, p.get('subdomain'), str(p.get('companyId')) ?? null)
    }),
  ),

  /* ---- Overview, plans, settings ---- */
  http.get(`${API}/platform/overview`, ({ request }) => respond(() => svc.getOverview(requirePlatform(request, 'tenants:view')))),
  http.get(`${API}/platform/plans`, ({ request }) => respond(() => svc.listPlatformPlans(requirePlatform(request, ['billing:view', 'plans:manage'])))),
  http.post(`${API}/platform/plans`, async ({ request }) => {
    const body = await json<Parameters<typeof svc.createPlan>[1]>(request)
    return respond(() => svc.createPlan(requirePlatform(request, 'plans:manage'), body))
  }),
  http.patch<{ id: string }>(`${API}/platform/plans/:id`, async ({ request, params: p }) => {
    const body = await json<Parameters<typeof svc.editPlan>[2]>(request)
    return respond(() => svc.editPlan(requirePlatform(request, 'plans:manage'), p.id, body))
  }),
  // Plans are never deleted (deactivate with PATCH { active: false }).
  http.delete(`${API}/platform/plans/:id`, ({ request }) =>
    respond(() => {
      requirePlatform(request, 'plans:manage')
      throw new ApiError('Plans can’t be deleted. Deactivate the plan instead.', 405, 'method_not_allowed')
    }),
  ),
  http.get(`${API}/platform/settings`, ({ request }) => respond(() => svc.getSettings(requirePlatform(request, 'tenants:view')))),
  http.patch(`${API}/platform/settings`, async ({ request }) => {
    const body = await json<Parameters<typeof svc.updateSettings>[1]>(request)
    return respond(() => svc.updateSettings(requirePlatform(request, 'plans:manage'), body))
  }),

  /* ---- Announcements ---- */
  http.get(`${API}/platform/announcements`, ({ request }) => respond(() => svc.listAnnouncements(requirePlatform(request, 'tenants:view')))),
  http.post(`${API}/platform/announcements`, async ({ request }) => {
    const body = await json<Parameters<typeof svc.createAnnouncement>[1]>(request)
    return respond(() => svc.createAnnouncement(requirePlatform(request, 'announcements:manage'), body))
  }),
  http.patch<{ id: string }>(`${API}/platform/announcements/:id`, async ({ request, params: p }) => {
    const body = await json<Parameters<typeof svc.updateAnnouncement>[2]>(request)
    return respond(() => svc.updateAnnouncement(requirePlatform(request, 'announcements:manage'), p.id, body))
  }),
  http.delete<{ id: string }>(`${API}/platform/announcements/:id`, ({ request, params: p }) =>
    respond(() => svc.endAnnouncement(requirePlatform(request, 'announcements:manage'), p.id)),
  ),
  // Company app.
  http.get(`${API}/announcements`, ({ request }) => respond(() => svc.companyAnnouncements(userFrom(request)))),
  http.post<{ id: string }>(`${API}/announcements/:id/dismiss`, ({ request, params: p }) =>
    respond(() => svc.dismissAnnouncement(userFrom(request), p.id)),
  ),

  /* ---- Audit ---- */
  http.get(`${API}/platform/audit`, ({ request }) =>
    respond(() => {
      const ctx = requirePlatform(request, 'audit:view')
      const p = params(request)
      const query: PlatformAuditQuery = {
        actor: str(p.get('actor')),
        action: str(p.get('action')),
        companyId: str(p.get('companyId')),
        from: str(p.get('from')),
        to: str(p.get('to')),
        q: str(p.get('q')),
      }
      return svc.queryAudit(ctx, query)
    }),
  ),

  /* ---- Impersonation ---- */
  http.post(`${API}/platform/impersonations`, async ({ request }) => {
    const body = await json<{ userId?: unknown; reason?: unknown }>(request)
    return respond(() => startImpersonation(requirePlatform(request, 'support:impersonate'), String(body?.userId ?? ''), body?.reason))
  }),

  // Anything else under /platform answers 404 (still behind the platform gate).
  http.all(`${API}/platform/*`, ({ request }) => {
    try {
      requirePlatform(request, null)
    } catch (e) {
      if (e instanceof ApiError) return HttpResponse.json(errorBody(e), { status: e.status })
      throw e
    }
    return HttpResponse.json({ message: 'Not found.', code: 'not_found' }, { status: 404 })
  }),
]
