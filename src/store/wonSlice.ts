import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** The global Won confirm dialog: which lead (and optionally which accepted quotation) is being won. */
export interface WonDialogTarget {
  leadId: string
  quotationId: string | null
}

export interface WonState {
  open: WonDialogTarget | null
}

const initialState: WonState = { open: null }

const wonSlice = createSlice({
  name: 'won',
  initialState,
  reducers: {
    wonDialogOpened(state, action: PayloadAction<{ leadId: string; quotationId?: string | null }>) {
      state.open = { leadId: action.payload.leadId, quotationId: action.payload.quotationId ?? null }
    },
    wonDialogClosed(state) {
      state.open = null
    },
  },
})

export const { wonDialogOpened, wonDialogClosed } = wonSlice.actions
export default wonSlice.reducer
