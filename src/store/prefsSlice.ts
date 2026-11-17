import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** Small per-user preferences saved with the other prefs in localStorage (see app/store.ts). */
export interface PrefsState {
  /** Source lookup key each user picked on their last lead create, by user id (Quick add default). */
  lastSourceByUser: Record<string, string>
}

const initialState: PrefsState = { lastSourceByUser: {} }

const prefsSlice = createSlice({
  name: 'prefs',
  initialState,
  reducers: {
    lastSourceUsed(state, action: PayloadAction<{ userId: string; source: string }>) {
      const { userId, source } = action.payload
      if (userId && source) state.lastSourceByUser[userId] = source
    },
  },
})

export const { lastSourceUsed } = prefsSlice.actions
export default prefsSlice.reducer

/** Merges saved prefs over the defaults, dropping anything malformed. */
export function hydratePrefs(saved: unknown): PrefsState {
  const raw = (saved && typeof saved === 'object' ? (saved as Partial<PrefsState>).lastSourceByUser : undefined) ?? {}
  const lastSourceByUser: Record<string, string> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) lastSourceByUser[k] = v
  }
  return { lastSourceByUser }
}
