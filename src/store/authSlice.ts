import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Session } from '@/shared/types'
import type { Company } from '@/modules/tenancy/types'
import { globalStorage } from '@/shared/lib/storage'

export interface AuthState {
  session: Session | null
}

const initialState: AuthState = { session: null }

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<Session>) {
      state.session = action.payload
    },
    signedOut(state) {
      state.session = null
    },
    /** POST /auth/refresh rotated the tokens of the same session (user, tenant and cache stay). */
    tokensRefreshed(state, action: PayloadAction<{ token: string; refreshToken?: string; expiresAt?: string }>) {
      if (!state.session) return
      state.session.token = action.payload.token
      if (action.payload.refreshToken !== undefined) state.session.refreshToken = action.payload.refreshToken
      if (action.payload.expiresAt !== undefined) state.session.expiresAt = action.payload.expiresAt
    },
    /** Server copy of the tenant (GET /tenant) replaces the one saved with the session. */
    tenantRefreshed(state, action: PayloadAction<Company>) {
      if (state.session && state.session.tenant.id === action.payload.id) state.session.tenant = action.payload
    },
  },
})

export const { signedIn, signedOut, tenantRefreshed, tokensRefreshed } = authSlice.actions
export default authSlice.reducer

/*
 * Persistence for the auth slice. The reducers stay pure; the store loads the saved
 * session as its preloaded state and writes it back whenever the slice changes.
 */

/** Global key (not tenant-scoped): the session is what decides the tenant. Full key: apexcrm.session. */
export const SESSION_STORAGE_KEY = 'session'

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const user = v.user as Record<string, unknown> | undefined
  const tenant = v.tenant as Record<string, unknown> | undefined
  return (
    typeof v.token === 'string' &&
    !!user &&
    typeof user.id === 'string' &&
    typeof user.role === 'string' &&
    !!tenant &&
    typeof tenant.id === 'string' &&
    tenant.id === user.companyId
  )
}

export function loadPersistedAuth(): AuthState {
  try {
    const raw = globalStorage.get(SESSION_STORAGE_KEY)
    if (!raw) return initialState
    const parsed: unknown = JSON.parse(raw)
    return { session: isSession(parsed) ? parsed : null }
  } catch {
    return initialState
  }
}

export function persistAuth(state: AuthState): void {
  // Storage can be unavailable (private mode, sandboxed iframes); the session then lasts the tab.
  if (state.session) globalStorage.set(SESSION_STORAGE_KEY, JSON.stringify(state.session))
  else globalStorage.remove(SESSION_STORAGE_KEY)
}
