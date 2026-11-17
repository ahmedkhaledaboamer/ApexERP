import { combineReducers, configureStore } from '@reduxjs/toolkit'
import authReducer, { loadPersistedAuth, persistAuth } from '@/store/authSlice'
import uiReducer, { type UiState } from '@/store/uiSlice'
import aiChatReducer from '@/store/aiChatSlice'
import tablePrefsReducer, { type TablePrefsState } from '@/store/tablePrefsSlice'
import prefsReducer, { hydratePrefs, type PrefsState } from '@/store/prefsSlice'

const rootReducer = combineReducers({
  auth: authReducer,
  ui: uiReducer,
  aiChat: aiChatReducer,
  tablePrefs: tablePrefsReducer,
  prefs: prefsReducer,
})

export type RootState = ReturnType<typeof rootReducer>

/* ---------- Saved preferences: theme, sidebar, table views, per-user form defaults ---------- */

const PREFS_KEY = 'apex-aora.prefs'

interface SavedPrefs {
  theme?: UiState['theme']
  sidebarCollapsed?: boolean
  navOpen?: Record<string, boolean>
  tablePrefs?: TablePrefsState
  /** Per-user form defaults, e.g. the last lead source (Quick add). */
  prefs?: PrefsState
}

function loadPrefs(): SavedPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    return raw ? (JSON.parse(raw) as SavedPrefs) : {}
  } catch {
    return {}
  }
}

function savePrefs(state: RootState) {
  try {
    const prefs: SavedPrefs = {
      theme: state.ui.theme,
      sidebarCollapsed: state.ui.sidebarCollapsed,
      navOpen: state.ui.navOpen,
      tablePrefs: state.tablePrefs,
      prefs: state.prefs,
    }
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: preferences last for this tab only.
  }
}

interface StoreOptions {
  /** Load the session and preferences from localStorage and keep them saved there. */
  persistSession?: boolean
}

/** A factory rather than a singleton, so tests can build isolated stores. */
export function makeStore(preloadedState?: Partial<RootState>, { persistSession = false }: StoreOptions = {}) {
  const preloaded: Partial<RootState> = { ...preloadedState }
  if (persistSession) {
    if (!preloaded.auth) preloaded.auth = loadPersistedAuth()
    const prefs = loadPrefs()
    if (!preloaded.ui) {
      const base = uiReducer(undefined, { type: '@@init' })
      preloaded.ui = {
        ...base,
        theme: prefs.theme ?? base.theme,
        sidebarCollapsed: prefs.sidebarCollapsed ?? base.sidebarCollapsed,
        navOpen: prefs.navOpen ?? base.navOpen,
      }
    }
    if (!preloaded.tablePrefs && prefs.tablePrefs) preloaded.tablePrefs = prefs.tablePrefs
    if (!preloaded.prefs && prefs.prefs) preloaded.prefs = hydratePrefs(prefs.prefs)
  }

  const store = configureStore({ reducer: rootReducer, preloadedState: preloaded })

  if (persistSession) {
    let last = store.getState()
    persistAuth(last.auth)
    store.subscribe(() => {
      const next = store.getState()
      if (next.auth !== last.auth) persistAuth(next.auth)
      if (
        next.ui.theme !== last.ui.theme ||
        next.ui.sidebarCollapsed !== last.ui.sidebarCollapsed ||
        next.ui.navOpen !== last.ui.navOpen ||
        next.tablePrefs !== last.tablePrefs ||
        next.prefs !== last.prefs
      ) {
        savePrefs(next)
      }
      last = next
    })
  }
  return store
}

export type AppStore = ReturnType<typeof makeStore>
export type AppDispatch = AppStore['dispatch']
