import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ColumnFiltersState, ColumnOrderState, SortingState, VisibilityState } from '@tanstack/react-table'

/**
 * How the user left a table (a saved view): visible columns, column order, sort, column filters
 * and page size, keyed by table id. Stored per company + user (see app/store.ts).
 */
export interface TablePrefs {
  columnVisibility?: VisibilityState
  columnOrder?: ColumnOrderState
  sorting?: SortingState
  columnFilters?: ColumnFiltersState
  pageSize?: number
}

export type TablePrefsState = Record<string, TablePrefs>

const tablePrefsSlice = createSlice({
  name: 'tablePrefs',
  initialState: {} as TablePrefsState,
  reducers: {
    tablePrefsChanged(state, action: PayloadAction<{ id: string; prefs: TablePrefs }>) {
      state[action.payload.id] = { ...state[action.payload.id], ...action.payload.prefs }
    },
    tablePrefsReset(state, action: PayloadAction<string>) {
      delete state[action.payload]
    },
  },
})

export const { tablePrefsChanged, tablePrefsReset } = tablePrefsSlice.actions
export default tablePrefsSlice.reducer
