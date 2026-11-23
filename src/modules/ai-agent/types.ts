import type { Role } from '@/shared/types'
import type { AiToolName } from './toolSchemas'

/**
 * AI assistant (docs/API.md › AI assistant). The UI shape; the wire shape is the same in snake_case
 * (shared/api/aiMappers.ts). The mock answers with a deterministic engine (services/ai*.ts); a real backend
 * (Anthropic Messages API with tool use, the same tool names and schemas: ./toolSchemas.ts) replaces it
 * behind the same contract.
 */

export type AiLanguage = 'en' | 'ar'
export type AiMessageRole = 'user' | 'assistant'
export type AiRecordType = 'lead' | 'customer' | 'invoice' | 'task' | 'quotation' | 'contract' | 'service' | 'package' | 'event' | 'leave'

/** A record the assistant links to (card) or the page the question was asked from (context). */
export interface AiRecordRef {
  type: AiRecordType
  id: string
}

export interface AiCard {
  type: AiRecordType
  id: string
  title: string
  subtitle: string
  /** Short status label, e.g. "Interested", "Overdue 12 days". */
  badge: string | null
  /** App path of the record (`/leads/L-1016`), null when the record has no page. */
  link: string | null
  /** Extra label/value pairs. */
  meta: { label: string; value: string }[]
}

export interface AiTableColumn {
  key: string
  label: string
  align?: 'start' | 'end'
}

export type AiBlock =
  | { type: 'text'; text: string }
  | { type: 'cards'; cards: AiCard[] }
  | { type: 'table'; title: string; columns: AiTableColumn[]; rows: Record<string, string | number>[]; links: (string | null)[] }
  | { type: 'stats'; items: { label: string; value: string }[] }
  | { type: 'bullets'; title: string; items: string[] }
  | { type: 'draft'; subject: string; body: string; language: AiLanguage }
  | { type: 'refusal'; code: string; text: string }
  | { type: 'notice'; text: string }

export interface AiToolCall {
  id: string
  name: AiToolName
  input: Record<string, unknown>
}

export type AiToolStatus = 'ok' | 'refused' | 'not_found' | 'error' | 'proposed'

export interface AiToolResult {
  toolCallId: string
  name: AiToolName
  status: AiToolStatus
  /** One line for logs and the backend transcript (no record content). */
  summary: string
}

export type AiActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed'

export interface AiChange {
  field: string
  label: string
  from: string
  to: string
}

/** A write the assistant proposes. Nothing changes until the user confirms it (POST /ai/actions/:id/confirm). */
export interface AiAction {
  id: string
  conversationId: string
  messageId: string
  tool: AiToolName
  status: AiActionStatus
  title: string
  /** What will happen, in one sentence. */
  summary: string
  record: { type: AiRecordType; id: string; label: string } | null
  /** The tool input that will run (camelCase here, snake_case on the wire). */
  input: Record<string, unknown>
  /** Fields the user may edit before confirming. */
  editable: string[]
  changes: AiChange[]
  /** Options of a choice field (e.g. lossReason → the company's loss reasons). */
  choices: Record<string, { value: string; label: string }[]>
  /** On confirm: what was created / changed. */
  result: { type: AiRecordType | 'activity'; id: string; label: string; link: string | null } | null
  error: string | null
  createdAt: string
  decidedAt: string | null
}

export interface AiMessage {
  id: string
  conversationId: string
  role: AiMessageRole
  /** Plain text (the user's prompt, or the assistant's answer as text for copy / transcripts). */
  content: string
  language: AiLanguage
  /** The assistant's rich answer. */
  blocks: AiBlock[]
  toolCalls: AiToolCall[]
  toolResults: AiToolResult[]
  actions: AiAction[]
  context: AiRecordRef | null
  /** The detected intent (mock engine) — informational. */
  intent: string | null
  createdAt: string
}

export interface AiConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  lastMessage: string
}

export interface AiConversationDetail extends AiConversation {
  messages: AiMessage[]
}

export interface AiUsage {
  /** Requests this billing period, the whole company (one AI credit each). */
  used: number
  /** Plan allowance (aiCredits), null = unlimited. */
  limit: number | null
  remaining: number | null
  /** ≥ 80% of the allowance used. */
  warning: string | null
  periodStart: string
}

export interface AiPostResult {
  conversation: AiConversation
  messages: AiMessage[]
  usage: AiUsage
}

export interface AiConfirmInput {
  /** Edited fields of the proposal (only `editable` ones are taken). */
  input?: Record<string, unknown>
}

export interface AiConfirmResult {
  action: AiAction
  message: AiMessage
}

export interface AiRoleSetting {
  enabled: boolean
  /** Write tools (proposals) allowed for this role. */
  writeTools: boolean
}

export interface AiSettings {
  enabled: boolean
  roles: Record<Role, AiRoleSetting>
  /** Tool on/off for the company (a disabled tool is never called). */
  tools: Record<AiToolName, boolean>
  updatedAt: string | null
  updatedByName: string | null
}

export type AiSettingsInput = Partial<Pick<AiSettings, 'enabled' | 'roles' | 'tools'>>

/** GET /ai/me — what the caller may do here. */
export interface AiMe {
  enabled: boolean
  /** Why the assistant is off for the caller (role turned off, company turned off). */
  disabledReason: string | null
  role: Role
  tools: { name: AiToolName; kind: 'read' | 'write'; enabled: boolean }[]
  writeTools: boolean
  canManage: boolean
  /** Company usage for admins (Company Admin, Management); null for everyone else. */
  usage: AiUsage | null
  /** Rate limit per user. */
  rateLimit: { perMinute: number }
}

/** GET /ai/usage — counts only (never conversation content), admins. */
export interface AiUsageReport extends AiUsage {
  byUser: { userId: string; name: string; role: Role; requests: number }[]
  byTool: { tool: AiToolName; calls: number }[]
}
