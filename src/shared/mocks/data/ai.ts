import type { AiAction, AiMessage, AiRecordRef, AiSettings } from '@/modules/ai-agent/types'
import type { AiToolName } from '@/modules/ai-agent/toolSchemas'
import { AI_TOOL_NAMES } from '@/modules/ai-agent/toolSchemas'
import type { Role } from '@/shared/types'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { perTenant, type Tenant } from '@/shared/mocks/tenant'

/**
 * AI assistant stores (docs/API.md › AI assistant; docs/DB-ALIGNMENT.md › AI-1…). Conversations, their messages and
 * the proposed actions belong to ONE user of one company: only that user reads them (another user's or another
 * company's id answers 404). Admins see counts only (`aiUsage`). Ids are unique across companies (`aiSeq`).
 */

export interface AiConversationRecord {
  id: string
  userId: string
  title: string
  /** The record the conversation is about (the last one named or opened from), for "draft an email to him". */
  focus: AiRecordRef | null
  createdAt: string
  updatedAt: string
}

export type AiMessageRecord = AiMessage & { userId: string }
export type AiActionRecord = AiAction & { userId: string }

/** One counted request (a message to the assistant): the per-user rate limit and the usage report. */
export interface AiUsageRecord {
  userId: string
  at: string
  /** Billing period of the company subscription it counted in. */
  periodStart: string
  tools: AiToolName[]
}

export const aiConversations: Tenant<AiConversationRecord>[] = registerArray('ai.conversations', [])
export const aiMessages: Tenant<AiMessageRecord>[] = registerArray('ai.messages', [])
export const aiActions: Tenant<AiActionRecord>[] = registerArray('ai.actions', [])
export const aiUsage: Tenant<AiUsageRecord>[] = registerArray('ai.usage', [])
export const aiSeq: { n: number } = registerObject('ai.seq', { n: 1 })

/** AIC-1, AIM-2, AIA-3… (one counter, unique across companies). */
export const aiId = (prefix: 'AIC' | 'AIM' | 'AIA' | 'AIT') => `${prefix}-${aiSeq.n++}`

/** Default: every read tool on; write tools for roles that can write somewhere (sales or tasks full / team / own). */
export function defaultAiSettings(): AiSettings {
  const roles = Object.fromEntries(
    (Object.keys(PERMISSION_MATRIX) as Role[]).map((role) => {
      const m = PERMISSION_MATRIX[role]
      const writes = ['full', 'team', 'own'].includes(m.sales) || ['full', 'team', 'own'].includes(m.tasks)
      return [role, { enabled: true, writeTools: writes }]
    }),
  ) as AiSettings['roles']
  return {
    enabled: true,
    roles,
    tools: Object.fromEntries(AI_TOOL_NAMES.map((t) => [t, true])) as Record<AiToolName, boolean>,
    updatedAt: null,
    updatedByName: null,
  }
}

export const aiSettingsStore = perTenant<AiSettings>(() => defaultAiSettings(), 'ai.settings')
