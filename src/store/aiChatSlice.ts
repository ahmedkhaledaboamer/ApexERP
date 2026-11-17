import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: string
}

/** An action the AI agent proposed (e.g. "create task", "update lead") awaiting the user's OK. */
export interface PendingAction {
  id: string
  kind: string
  summary: string
  payload: unknown
}

export interface AiChatState {
  open: boolean
  messages: ChatMessage[]
  pendingActions: PendingAction[]
  sending: boolean
}

const initialState: AiChatState = { open: false, messages: [], pendingActions: [], sending: false }

const aiChatSlice = createSlice({
  name: 'aiChat',
  initialState,
  reducers: {
    chatToggled(state) {
      state.open = !state.open
    },
    messageAdded(state, action: PayloadAction<ChatMessage>) {
      state.messages.push(action.payload)
    },
    sendingChanged(state, action: PayloadAction<boolean>) {
      state.sending = action.payload
    },
    actionProposed(state, action: PayloadAction<PendingAction>) {
      state.pendingActions.push(action.payload)
    },
    actionResolved(state, action: PayloadAction<string>) {
      state.pendingActions = state.pendingActions.filter((a) => a.id !== action.payload)
    },
    chatCleared() {
      return initialState
    },
  },
})

export const { chatToggled, messageAdded, sendingChanged, actionProposed, actionResolved, chatCleared } =
  aiChatSlice.actions
export default aiChatSlice.reducer
