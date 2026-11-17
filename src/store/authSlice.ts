import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Session } from '@/shared/types'

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
  },
})

export const { signedIn, signedOut } = authSlice.actions
export default authSlice.reducer

/*
 * Persistence for the auth slice. The reducers stay pure; the store loads the saved
 * session as its preloaded state and writes it back whenever the slice changes.
 */

export const SESSION_STORAGE_KEY = 'apex-aora.session'

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const user = v.user as Record<string, unknown> | undefined
  return typeof v.token === 'string' && !!user && typeof user.id === 'string' && typeof user.role === 'string'
}

export function loadPersistedAuth(): AuthState {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return initialState
    const parsed: unknown = JSON.parse(raw)
    return { session: isSession(parsed) ? parsed : null }
  } catch {
    return initialState
  }
}

export function persistAuth(state: AuthState): void {
  try {
    if (state.session) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.session))
    else window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode, sandboxed iframes); the session then lasts the tab.
  }
}
