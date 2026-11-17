import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type Theme = 'light' | 'dark'
export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  body?: string
}

export interface UiState {
  /** Desktop: sidebar narrowed to icons. */
  sidebarCollapsed: boolean
  /** Tablet and phone: sidebar shown as a drawer. */
  mobileNavOpen: boolean
  theme: Theme
  /** The ⌘K command palette. */
  commandPaletteOpen: boolean
  /** Visible toast notifications, oldest first. */
  toasts: Toast[]
  /** Which sidebar sections are expanded, by section id. */
  navOpen: Record<string, boolean>
  /** The global "New lead" quick-add dialog (opened from the header or the leads page). */
  quickAddLeadOpen: boolean
}

const initialState: UiState = {
  sidebarCollapsed: false,
  mobileNavOpen: false,
  theme: 'light',
  commandPaletteOpen: false,
  toasts: [],
  navOpen: { sales: true },
  quickAddLeadOpen: false,
}

const MAX_TOASTS = 4

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    sidebarToggled(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed
    },
    mobileNavOpened(state) {
      state.mobileNavOpen = true
    },
    mobileNavClosed(state) {
      state.mobileNavOpen = false
    },
    themeToggled(state) {
      state.theme = state.theme === 'light' ? 'dark' : 'light'
    },
    commandPaletteSet(state, action: PayloadAction<boolean>) {
      state.commandPaletteOpen = action.payload
    },
    toastAdded: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts = [...state.toasts.slice(-(MAX_TOASTS - 1)), action.payload]
      },
      prepare(toast: Omit<Toast, 'id'>) {
        return { payload: { ...toast, id: Math.random().toString(36).slice(2, 10) } }
      },
    },
    toastDismissed(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload)
    },
    navSectionToggled(state, action: PayloadAction<string>) {
      state.navOpen[action.payload] = !state.navOpen[action.payload]
    },
    navSectionOpened(state, action: PayloadAction<string>) {
      state.navOpen[action.payload] = true
    },
    quickAddLeadSet(state, action: PayloadAction<boolean>) {
      state.quickAddLeadOpen = action.payload
    },
  },
})

export const {
  sidebarToggled,
  mobileNavOpened,
  mobileNavClosed,
  themeToggled,
  commandPaletteSet,
  toastAdded,
  toastDismissed,
  navSectionToggled,
  navSectionOpened,
  quickAddLeadSet,
} = uiSlice.actions
export default uiSlice.reducer
