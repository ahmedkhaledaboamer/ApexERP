import { combineReducers, configureStore, type UnknownAction } from '@reduxjs/toolkit'
import authReducer, { loadPersistedAuth, persistAuth } from '@/store/authSlice'
import uiReducer, { type UiState } from '@/store/uiSlice'
import aiChatReducer from '@/store/aiChatSlice'
import tablePrefsReducer, { type TablePrefsState } from '@/store/tablePrefsSlice'
import prefsReducer, { hydratePrefs, type PrefsState } from '@/store/prefsSlice'
import wonReducer from '@/store/wonSlice'
import tenantReducer, { TENANT_CONTEXT_RESET, loadPlatformSession, persistPlatformSession } from '@/store/tenantSlice'
import { globalStorage, userStorage } from '@/shared/lib/storage'
import { setActiveIdentity } from '@/shared/lib/tenantContext'
import { setRegion } from '@/shared/lib/region'

const combined = combineReducers({
  auth: authReducer,
  tenant: tenantReducer,
  ui: uiReducer,
  aiChat: aiChatReducer,
  tablePrefs: tablePrefsReducer,
  prefs: prefsReducer,
  won: wonReducer,
})

export type RootState = ReturnType<typeof combined>

/* ---------- Saved UI preferences (per company + user, kept across sessions) ---------- */

/** userStorage.pref key: <companyId>:<userId>:apexcrm.pref.ui */
export const USER_PREFS_KEY = 'ui'
/** Global: only the last theme, for screens shown before anyone signs in. */
const DEVICE_KEY = 'device'

export interface UserPrefs {
  theme?: UiState['theme']
  sidebarCollapsed?: boolean
  navOpen?: Record<string, boolean>
  /** Saved table views, column order and visibility, sorting, filters. */
  tablePrefs?: TablePrefsState
  /** Per-user form defaults, e.g. the last lead source (Quick add). */
  prefs?: PrefsState
}

function readJson<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** The active user's saved preferences (never another user's or company's). */
export function loadUserPrefs(): UserPrefs | null {
  return readJson<UserPrefs>(userStorage.pref.get(USER_PREFS_KEY))
}

function prefsOf(state: RootState): UserPrefs {
  return {
    theme: state.ui.theme,
    sidebarCollapsed: state.ui.sidebarCollapsed,
    navOpen: state.ui.navOpen,
    tablePrefs: state.tablePrefs,
    prefs: state.prefs,
  }
}

/** Applies saved preferences over a fresh slice set. */
function withPrefs(fresh: RootState, p: UserPrefs | null, fallbackTheme: UiState['theme']): Pick<RootState, 'ui' | 'tablePrefs' | 'prefs'> {
  return {
    ui: {
      ...fresh.ui,
      theme: p?.theme ?? fallbackTheme,
      sidebarCollapsed: p?.sidebarCollapsed ?? fresh.ui.sidebarCollapsed,
      navOpen: p?.navOpen ?? fresh.ui.navOpen,
    },
    tablePrefs: p?.tablePrefs ?? fresh.tablePrefs,
    prefs: p?.prefs ? hydratePrefs(p.prefs) : fresh.prefs,
  }
}

/**
 * On a session transition every tenant-scoped slice goes back to its initial state (nothing from
 * the previous user or company survives in memory), then the incoming user's own saved
 * preferences are applied. The session and the tenant slice are kept.
 */
/** Set while a transition loads preferences, so loading isn't mistaken for a change to save. */
let loadingPrefs = false

function rootReducer(state: RootState | undefined, action: UnknownAction): RootState {
  if (action.type === TENANT_CONTEXT_RESET && state) {
    loadingPrefs = true
    const fresh = combined(undefined, { type: '@@tenant/init' })
    const saved = (action as { payload?: UserPrefs | null }).payload ?? null
    // A signed-in user with no saved prefs gets the defaults, never the previous user's theme;
    // after sign-out the login screen keeps the last theme.
    const fallbackTheme = state.auth.session ? fresh.ui.theme : state.ui.theme
    return { ...fresh, auth: state.auth, tenant: state.tenant, ...withPrefs(fresh, saved, fallbackTheme) }
  }
  return combined(state, action)
}

interface StoreOptions {
  /** Load the session and preferences from storage and keep them saved there. */
  persistSession?: boolean
}

/** A factory rather than a singleton, so tests can build isolated stores. */
export function makeStore(preloadedState?: Partial<RootState>, { persistSession = false }: StoreOptions = {}) {
  const preloaded: Partial<RootState> = { ...preloadedState }
  if (persistSession && !preloaded.auth) preloaded.auth = loadPersistedAuth()

  // Company and user must be active before scoped preferences are read.
  const session = preloaded.auth?.session ?? null
  setActiveIdentity(session?.tenant.id ?? null, session?.user.id ?? null)
  setRegion(session?.tenant.regional ?? null)

  if (persistSession) {
    const fresh = combined(undefined, { type: '@@init' })
    const device = readJson<{ theme?: UiState['theme'] }>(globalStorage.get(DEVICE_KEY))
    const applied = withPrefs(fresh, session ? loadUserPrefs() : null, device?.theme ?? fresh.ui.theme)
    if (!preloaded.ui) preloaded.ui = applied.ui
    if (!preloaded.tablePrefs) preloaded.tablePrefs = applied.tablePrefs
    if (!preloaded.prefs) preloaded.prefs = applied.prefs
    if (!preloaded.tenant) preloaded.tenant = { ...fresh.tenant, platform: loadPlatformSession() }
  }

  const store = configureStore({ reducer: rootReducer, preloadedState: preloaded as RootState })

  if (persistSession) {
    let last = store.getState()
    persistAuth(last.auth)
    store.subscribe(() => {
      const next = store.getState()
      if (next.auth !== last.auth) persistAuth(next.auth)
      if (next.tenant.platform !== last.tenant.platform) persistPlatformSession(next.tenant.platform)
      const prefsChanged =
        next.ui.theme !== last.ui.theme ||
        next.ui.sidebarCollapsed !== last.ui.sidebarCollapsed ||
        next.ui.navOpen !== last.ui.navOpen ||
        next.tablePrefs !== last.tablePrefs ||
        next.prefs !== last.prefs
      // A transition swaps the whole preference set; it's loaded, not a change to save. Saving
      // only within the same session means one user's prefs can never land under another's key.
      const loaded = loadingPrefs
      loadingPrefs = false
      // A support session (impersonation) shows the user's own saved views but never saves over
      // them: what the operator changes lasts for the support session only.
      if (prefsChanged && !loaded && next.auth.session && next.auth.session === last.auth.session && !next.auth.session.impersonation) {
        userStorage.pref.set(USER_PREFS_KEY, JSON.stringify(prefsOf(next)))
      }
      if (next.ui.theme !== last.ui.theme) globalStorage.set(DEVICE_KEY, JSON.stringify({ theme: next.ui.theme }))
      last = next
    })
  }
  return store
}

export type AppStore = ReturnType<typeof makeStore>
export type AppDispatch = AppStore['dispatch']
