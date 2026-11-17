import type { Contact, LeadStatus } from '@/shared/types'
import type { LeadDetail } from '@/modules/leads/types'
import type { MessageChannel } from '@/modules/leads/api/messagesApi'
import type { LookupsApi } from '@/shared/hooks/useLookups'
import { SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { formatUaeMobile, normalizeUaeMobile } from '@/shared/lib/phone'
import { findVariables, renderSegments, renderTemplate, type TemplateContext } from '@/modules/settings/templates/render'
import { getVariable, isKnownVariable } from '@/modules/settings/templates/variables'
import type { MessageTemplate, TemplatePurpose } from '@/modules/settings/templates/types'
import { PURPOSES_BY_CHANNEL } from '@/modules/settings/templates/types'

/** Pure helpers for the lead message composer (no React). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface Recipient {
  /** Contact id, or `lead` when it comes from the lead's own contact fields. */
  id: string
  name: string
  title: string
  /** Email address or display-formatted UAE mobile. */
  address: string
  isDecisionMaker: boolean
}

function addressOf(c: Pick<Contact, 'email' | 'mobile'>, channel: MessageChannel): string | null {
  if (channel === 'email') return EMAIL_RE.test(c.email.trim()) ? c.email.trim() : null
  return normalizeUaeMobile(c.mobile) ? formatUaeMobile(c.mobile) : null
}

/**
 * Contacts reachable on a channel: decision maker first, then the primary contact (the one shown on
 * the lead), then the rest. Falls back to the lead's own contact fields when it has no contact rows.
 */
export function recipientsFor(lead: LeadDetail, channel: MessageChannel): Recipient[] {
  const rows: Recipient[] = []
  for (const c of lead.contacts ?? []) {
    const address = addressOf(c, channel)
    if (address) rows.push({ id: c.id, name: c.name, title: c.title, address, isDecisionMaker: c.isDecisionMaker })
  }
  if (rows.length === 0) {
    const address = addressOf({ email: lead.contactEmail ?? '', mobile: lead.mobile ?? '' }, channel)
    if (address) rows.push({ id: 'lead', name: lead.contactName || lead.company, title: '', address, isDecisionMaker: false })
  }
  const primaryAddress = channel === 'email' ? (lead.contactEmail ?? '').toLowerCase() : normalizeUaeMobile(lead.mobile ?? '')
  const isPrimary = (r: Recipient) =>
    channel === 'email' ? r.address.toLowerCase() === primaryAddress : normalizeUaeMobile(r.address) === primaryAddress
  const rank = (r: Recipient) => (r.isDecisionMaker ? 0 : isPrimary(r) ? 1 : 2)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r)
}

/** The purpose that fits where the lead is in the pipeline. */
export function suggestedPurpose(status: LeadStatus, lookups: LookupsApi): TemplatePurpose {
  if (status === SYSTEM_STATUS.noResponse) return 'No response'
  if (status === SYSTEM_STATUS.proposal) return 'Proposal sent'
  if (status === SYSTEM_STATUS.meeting) return 'After meeting'
  if (lookups.isWon(status)) return 'Renewal reminder'
  return 'First follow-up'
}

/** Picks the template to pre-select: the suggested purpose's default, then First follow-up's, then any. */
export function pickTemplate(options: MessageTemplate[], purpose: TemplatePurpose): MessageTemplate | null {
  const of = (p: TemplatePurpose) => options.filter((t) => t.purpose === p)
  const best = (list: MessageTemplate[]) => list.find((t) => t.isDefault) ?? list[0] ?? null
  return best(of(purpose)) ?? best(of('First follow-up')) ?? options.find((t) => t.isDefault) ?? options[0] ?? null
}

/** Active templates of a channel grouped by purpose, in picker order. */
export function groupByPurpose(options: MessageTemplate[], channel: MessageChannel) {
  return PURPOSES_BY_CHANNEL[channel]
    .map((purpose) => ({
      purpose,
      templates: options
        .filter((t) => t.purpose === purpose)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.templates.length > 0)
}

/**
 * Fills a template for editing: known variables with a value are replaced; known variables with no
 * value and unknown variables stay as `{{key}}` so the composer can flag them before sending.
 */
export function fillForEditing(text: string, ctx: TemplateContext): string {
  return renderSegments(text, ctx)
    .map((s) => (s.kind === 'empty' || s.kind === 'unknown' ? `{{${s.key}}}` : s.text))
    .join('')
}

export interface VariableIssue {
  key: string
  kind: 'empty' | 'unknown'
  label: string
}

/** Variables still in the text that can't be filled for this lead. Any issue blocks sending. */
export function variableIssues(text: string, ctx: TemplateContext): VariableIssue[] {
  const issues: VariableIssue[] = []
  for (const key of findVariables(text)) {
    if (!isKnownVariable(key)) issues.push({ key, kind: 'unknown', label: key || 'empty variable' })
    else if (!renderTemplate(`{{${key}}}`, ctx)) issues.push({ key, kind: 'empty', label: getVariable(key)?.label ?? key })
  }
  return issues
}

/** Group label for an issue, e.g. "Lead · Next step". */
export function issueLabel(issue: VariableIssue): string {
  if (issue.kind === 'unknown') return issue.label
  const group = issue.key.split('.')[0]
  return `${group.charAt(0).toUpperCase()}${group.slice(1)} · ${issue.label}`
}
