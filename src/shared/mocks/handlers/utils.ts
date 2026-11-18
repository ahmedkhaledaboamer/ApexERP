import { HttpResponse } from 'msw'
import type { User } from '@/shared/types'
import type { ImpersonationInfo } from '@/modules/tenancy/types'
import type { PlatformPermissionV2 } from '@/modules/platform/types'
import { canPlatform } from '@/modules/tenancy/types'
import type { ImpersonationSessionRecord } from '@/modules/platform/types'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { activeMembershipOf, companyById, platformUsers } from '@/shared/mocks/data/tenancy'
import { liveAliasesOfCompany } from '@/shared/mocks/data/platform'
import { readToken } from '@/shared/mocks/server'
import { setSupportActor } from '@/shared/mocks/data/audit'
import { CodedApiError } from '@/shared/mocks/tenant'
import { enforceRequestPolicy } from '@/shared/mocks/services/billing'
import { assertImpersonationAllows, infoOf, liveImpersonation } from '@/shared/mocks/services/impersonation'
import { fakeIp, type PlatformCtx } from '@/shared/mocks/services/platformAudit'

/** Base path the mock answers on; matches the axios baseURL. */
export const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

/** Header the client sends with the workspace it was opened on (stands in for the Host header). */
export const WORKSPACE_HEADER = 'X-Workspace'

const EXPIRED = 'Your session has expired. Sign in again.'

/** The API base as a path (VITE_API_URL may be absolute). */
const API_PATH = new URL(API || '/', 'http://mock.local').pathname.replace(/\/$/, '')

/** The request path relative to the API base, e.g. "/leads/L-1". */
export function apiPath(request: Request): string {
  const path = new URL(request.url, 'http://mock.local').pathname
  return API_PATH && path.startsWith(API_PATH) ? path.slice(API_PATH.length) || '/' : path
}

/**
 * The signed-in user, resolved the way the real backend does it:
 *  token → user → active membership → company. The company id comes from the membership, never
 *  from the request. The token's company must still match the membership (a moved user must sign
 *  in again), the company must not be suspended, and the workspace the app was opened on (host)
 *  must be that company (its current subdomain or a still-redirecting old one), or the request is
 *  refused with `tenant_mismatch`.
 * Impersonation tokens: the session record decides (services/impersonation.ts) — ended / expired → 401,
 *  read mode → 403 impersonation_read_only for writes, sensitive paths → 403 impersonation_blocked.
 * Then the billing policy (services/billing.ts `enforceRequestPolicy`): the subscription lifecycle
 * runs for the company, a deleted workspace answers 410 `workspace_deleted`, a path of a module the
 * company can't use 403 `module_not_in_plan`, and a write while Suspended / Cancelled 423 `workspace_read_only`.
 */
export function userFrom(request: Request): User {
  const claims = readToken(request.headers.get('Authorization'))
  if (!claims || claims.kind !== 'user') throw new ApiError(EXPIRED, 401)
  const session = claims.imp ? liveImpersonation(claims.imp) : null
  if (session && (session.userId !== claims.sub || session.companyId !== claims.co)) throw new ApiError(EXPIRED, 401)
  const user = users.find((u) => u.id === claims.sub)
  if (!user) throw new ApiError(EXPIRED, 401)
  // A deactivated account loses access immediately, even with a token issued earlier.
  if (user.active === false) throw new ApiError('This account is deactivated.', 401)
  const membership = activeMembershipOf(user.id)
  if (!membership || membership.companyId !== claims.co) throw new ApiError(EXPIRED, 401)
  const company = companyById(membership.companyId)
  if (!company) throw new CodedApiError('Workspace not found.', 404, 'workspace_not_found')
  if (company.status === 'suspended') throw new CodedApiError('This workspace is suspended. Contact your administrator.', 403, 'workspace_suspended')
  const host = request.headers.get(WORKSPACE_HEADER)?.trim().toLowerCase()
  if (host && host !== company.subdomain && !liveAliasesOfCompany(company.id).some((a) => a.subdomain === host)) {
    throw new CodedApiError('You are signed in to a different workspace than the one this address belongs to.', 403, 'tenant_mismatch')
  }
  // Membership is the source of truth for tenant and role.
  user.companyId = membership.companyId
  user.role = membership.role
  const path = apiPath(request)
  if (session) assertImpersonationAllows(session, request.method, path)
  setSupportActor(session ? { userId: user.id, platformUserName: session.platformUserName, reason: session.reason } : null)
  enforceRequestPolicy(company.id, request.method, path)
  return user
}

/** The live impersonation session behind the request's token, if any (null for a normal session). */
export function impersonationSessionFrom(request: Request): ImpersonationSessionRecord | null {
  const claims = readToken(request.headers.get('Authorization'))
  return claims?.kind === 'user' && claims.imp ? liveImpersonation(claims.imp) : null
}

/** The platform operator behind an impersonated session, if any (mode and expiry from the server record). */
export function impersonationFrom(request: Request): ImpersonationInfo | null {
  const rec = impersonationSessionFrom(request)
  return rec ? infoOf(rec) : null
}

const PLATFORM_SIGN_IN = 'Sign in to the platform console.'

/**
 * Every /platform/* endpoint (except POST /platform/auth/login) starts here. Only a platform token
 * passes (company tokens, impersonation tokens included → 401). `permission` (any of a list) is
 * checked against PLATFORM_PERMISSIONS → 403 `platform_forbidden`; null = any platform user.
 * Returns the operator and the mocked client IP of their sign-in session (for the platform audit).
 */
export function requirePlatform(request: Request, permission: PlatformPermissionV2 | PlatformPermissionV2[] | null): PlatformCtx {
  const claims = readToken(request.headers.get('Authorization'))
  if (!claims || claims.kind !== 'platform') throw new CodedApiError(PLATFORM_SIGN_IN, 401, 'platform_auth_required')
  const pu = platformUsers.find((p) => p.id === claims.sub)
  if (!pu) throw new CodedApiError(PLATFORM_SIGN_IN, 401, 'platform_auth_required')
  const needed = permission === null ? [] : Array.isArray(permission) ? permission : [permission]
  if (needed.length && !needed.some((p) => canPlatform(pu.platformRole, p))) {
    throw new CodedApiError('Your platform role doesn’t allow this.', 403, 'platform_forbidden', { permission: needed.join(' | ') })
  }
  return { user: { ...pu }, ip: fakeIp(pu.id, claims.iat) }
}

/** `{ message, code?, ...details }` for an ApiError (details of a CodedApiError, e.g. LIMIT_REACHED fields). */
export function errorBody(error: ApiError): Record<string, unknown> {
  const details = error instanceof CodedApiError ? error.details : {}
  return { ...details, message: error.message, ...(error.code ? { code: error.code } : {}) }
}

/** Runs a mock service call and turns its result, or its ApiError, into an HTTP response. */
export async function respond<T>(run: () => Promise<T> | T): Promise<Response> {
  try {
    return HttpResponse.json((await run()) as never)
  } catch (error) {
    if (error instanceof ApiError) {
      return HttpResponse.json(errorBody(error), { status: error.status })
    }
    throw error
  }
}
