import axios from 'axios'
import { emitBillingError } from '@/shared/lib/billingEvents'
import { safeEnv } from '@/shared/lib/env'
import { createSessionGuard, installSessionInterceptors, type SessionGuardDeps, type SessionTokens } from '@/shared/lib/httpSession'
import { emitImpersonationError } from '@/shared/lib/impersonationEvents'
import { reportRequestFailed, reportRequestSucceeded } from '@/shared/lib/networkStatus'
import { globalStorage } from '@/shared/lib/storage'
import { currentWorkspace, emitTenantError } from '@/shared/lib/tenantContext'
import { SESSION_STORAGE_KEY } from '@/store/authSlice'

/**
 * HTTP client. Requests carry the bearer token and the workspace the app was opened on
 * (X-Workspace, standing in for the Host header). They never carry a company id: the server
 * derives the tenant from the token and refuses a token whose company doesn't match the address.
 * Session refresh / expiry and error mapping: httpSession.ts (wired to the store in app/authSession.ts).
 */
export const http = axios.create({
  baseURL: safeEnv().apiUrl,
  timeout: 20_000,
})

/** The stored company session (the token source for every request). */
export function readStoredSession(): SessionTokens | null {
  try {
    const raw = globalStorage.get(SESSION_STORAGE_KEY)
    const s = raw ? (JSON.parse(raw) as Partial<SessionTokens>) : null
    return s && typeof s.token === 'string' ? { token: s.token, refreshToken: s.refreshToken, expiresAt: s.expiresAt } : null
  } catch {
    // No stored session: send the request unauthenticated.
    return null
  }
}

/** Until the app binds the store (app/authSession.ts): no refresh, and a 401 just rejects. */
const deps: SessionGuardDeps = {
  readSession: readStoredSession,
  refresh: null,
  saveTokens: () => {},
  expire: () => {},
}

/** Replaces parts of the session wiring (refresh call, token store, expiry); returns an undo. */
export function configureSession(next: Partial<SessionGuardDeps>): () => void {
  const prev = { ...deps }
  Object.assign(deps, next)
  return () => Object.assign(deps, prev)
}

export const sessionGuard = createSessionGuard({
  readSession: () => deps.readSession(),
  get refresh() {
    return deps.refresh
  },
  saveTokens: (previous, tokens) => deps.saveTokens(previous, tokens),
  expire: () => deps.expire(),
})

installSessionInterceptors(http, sessionGuard, {
  decorate(config) {
    const workspace = currentWorkspace()
    if (workspace) config.headers['X-Workspace'] = workspace
  },
  onErrorResponse(error) {
    const body = error.details as { message?: string } | undefined
    // Workspace problems (not found, mismatch, suspended) switch the app to the matching screen.
    emitTenantError(error.code, error.message)
    // Plan / subscription problems (limit reached, module not in plan, read-only) open the one
    // upgrade prompt (UpgradePromptHost); the caller still gets the rejection for its own UI.
    emitBillingError(error.code, error.message, body)
    // Support-session limits (read-only, blocked) and its end (expired/ended) → ImpersonationBanner.
    emitImpersonationError(error.code, error.message)
  },
  onReachable: reportRequestSucceeded,
  onUnreachable: reportRequestFailed,
})
