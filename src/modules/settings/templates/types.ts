/** Settings > Templates: reusable follow-up emails, quotation text and WhatsApp messages. */

export type TemplateChannel = 'email' | 'quotation' | 'whatsapp'

export const TEMPLATE_CHANNELS: TemplateChannel[] = ['email', 'quotation', 'whatsapp']

export const CHANNEL_LABELS: Record<TemplateChannel, string> = {
  email: 'Email',
  quotation: 'Quotation',
  whatsapp: 'WhatsApp',
}

/** What a template is for. The AI agent and pickers look templates up by channel + purpose. */
export type TemplatePurpose =
  | 'First follow-up'
  | 'No response'
  | 'After meeting'
  | 'Proposal sent'
  | 'Renewal reminder'
  | 'Quotation cover'
  | 'Quotation terms'
  | 'General'

/** Purposes offered per channel, in picker order. */
export const PURPOSES_BY_CHANNEL: Record<TemplateChannel, TemplatePurpose[]> = {
  email: ['First follow-up', 'No response', 'After meeting', 'Proposal sent', 'Renewal reminder', 'General'],
  whatsapp: ['First follow-up', 'No response', 'After meeting', 'Proposal sent', 'Renewal reminder', 'General'],
  quotation: ['Quotation cover', 'Quotation terms'],
}

/** WhatsApp Business caps a template body at 1024 characters. */
export const WHATSAPP_MAX = 1024
export const NAME_MAX = 80
export const SUBJECT_MAX = 150
export const BODY_MAX = 5000

export interface MessageTemplate {
  id: string
  channel: TemplateChannel
  name: string
  purpose: TemplatePurpose
  /** Email only; empty for the other channels. */
  subject: string
  /** Plain text with `{{group.field}}` variables. WhatsApp supports *bold*, _italic_, ~strike~. */
  body: string
  /** Inactive templates are hidden from pickers but kept for history (never deleted). */
  active: boolean
  /** At most one default per channel + purpose; the one pre-selected when sending. */
  isDefault: boolean
  updatedAt: string
  /** Display name of the last editor. */
  updatedBy: string
}

/** POST /templates. */
export interface TemplateInput {
  channel: TemplateChannel
  name: string
  purpose: TemplatePurpose
  subject?: string
  body: string
}

/** PATCH /templates/:id. The channel is fixed once created (duplicate to switch). */
export type TemplateUpdateInput = Partial<Omit<TemplateInput, 'channel'>>

/** GET /templates query. Omitted fields don't filter. */
export interface TemplateFilter {
  channel?: TemplateChannel
  purpose?: TemplatePurpose
  /** true: active only. */
  active?: boolean
}
