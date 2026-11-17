import { http } from '@/shared/lib/axios'
import type { ActivityView } from '@/modules/leads/types'

/** Channels the lead composer can send on. */
export type MessageChannel = 'email' | 'whatsapp'

/** POST /leads/:id/messages. */
export interface SendMessageInput {
  channel: MessageChannel
  /** Email address (email) or UAE mobile (whatsapp). */
  to: string
  /** Email only. */
  subject?: string
  /** Final text: every `{{variable}}` already filled in. */
  body: string
  /** Template the message started from, for reporting. */
  templateId?: string
}

export interface SendMessageResult {
  /** The email / WhatsApp activity logged on the lead. */
  activity: ActivityView
  /** Set when logging the attempt moved the lead automatically (No response → Cold). */
  autoStatus?: NonNullable<ActivityView['autoStatus']>
}

/** Sends (mocked for now) an email or WhatsApp to a lead contact and logs it as an activity. */
export async function sendLeadMessage(leadId: string, input: SendMessageInput): Promise<SendMessageResult> {
  return (await http.post<SendMessageResult>(`/leads/${encodeURIComponent(leadId)}/messages`, input)).data
}
