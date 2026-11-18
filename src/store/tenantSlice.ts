import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Company, PlatformSession, PublicCompany } from '@/modules/tenancy/types'
import { globalStorage } from '@/shared/lib/storage'

/**
 * Tenant context. The company itself comes from the session (`auth.session.tenant`, refreshed
 * from GET /tenant); this slice tracks how the workspace address resolved, the public branding
 * shown before sign-in, and the platform operator's own session (platform console).
 */
/** `deleted`: the subscription ran out its retention period and the company's data is gone (410). */
export type TenantStatus = 'ok' | 'not_found' | 'mismatch' | 'suspended' | 'deleted'

export interface TenantState {
  status: TenantStatus
  message: string | null
  /** Branding of the workspace address before anyone signs in (login page). */
  publicWorkspace: PublicCompany | null
  /** Platform console session; kept while impersonating so "Stop" can return to it. */
  platform: PlatformSession | null
}

const initialState: TenantState = { status: 'ok', message: null, publicWorkspace: null, platform: null }

const tenantSlice = createSlice({
  name: 'tenant',
  initialState,
  reducers: {
    tenantStatusChanged(state, action: PayloadAction<{ status: TenantStatus; message?: string | null }>) {
      state.status = action.payload.status
      state.message = action.payload.message ?? null
    },
    publicWorkspaceLoaded(state, action: PayloadAction<PublicCompany | null>) {
      state.publicWorkspace = action.payload
    },
    platformSignedIn(state, action: PayloadAction<PlatformSession>) {
      state.platform = action.payload
    },
    platformSignedOut(state) {
      state.platform = null
    },
  },
})

export const { tenantStatusChanged, publicWorkspaceLoaded, platformSignedIn, platformSignedOut } = tenantSlice.actions
export default tenantSlice.reducer

/**
 * Dispatched on every session transition (sign-in, sign-out, tenant switch, impersonation
 * start/stop). The root reducer resets all tenant-scoped client state and loads the incoming
 * user's saved preferences (`prefs`, from storage.ts userStorage.pref) when it sees it.
 */
export const TENANT_CONTEXT_RESET = 'tenant/contextReset'
export const tenantContextReset = (prefs: unknown = null) => ({ type: TENANT_CONTEXT_RESET, payload: prefs }) as const

/** Refreshes the session's copy of the company (e.g. after GET /tenant or a settings change). */
export type TenantRefresh = Company

const PLATFORM_KEY = 'platform'

export function loadPlatformSession(): PlatformSession | null {
  try {
    const raw = globalStorage.get(PLATFORM_KEY)
    const v = raw ? (JSON.parse(raw) as PlatformSession) : null
    return v && v.kind === 'platform' && typeof v.token === 'string' ? v : null
  } catch {
    return null
  }
}

export function persistPlatformSession(s: PlatformSession | null): void {
  if (s) globalStorage.set(PLATFORM_KEY, JSON.stringify(s))
  else globalStorage.remove(PLATFORM_KEY)
}
