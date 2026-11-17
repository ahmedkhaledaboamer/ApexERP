import type { User } from '@/shared/types'
import type { ActivityView } from '@/modules/leads/types'
import type { SendMessageInput, SendMessageResult } from '@/modules/leads/api/messagesApi'
import { BODY_MAX, SUBJECT_MAX, WHATSAPP_MAX } from '@/modules/settings/templates/types'
import { formatUaeMobile, isUaeMobile, normalizeUaeMobile } from '@/shared/lib/phone'
import { can, inScope, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { contacts, leads, users } from '@/shared/mocks/db'
import { templates } from '@/shared/mocks/data/templates'
import { fail } from '@/shared/mocks/server'
import { logActivity } from './leads'

/**
 * POST /leads/:id/messages. Sending is mocked: nothing leaves the app. The message is checked,
 * then logged as an email / WhatsApp activity through `logActivity`, so the same Do Not Contact
 * rule, New → Contacted move and No response → Cold automation apply as for a logged activity.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}|\[unknown: [^\]]*\]/

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function sendMessage(user: User, leadId: string, input: SendMessageInput): Promise<SendMessageResult> {
  const lead = leads.find((l) => l.id === leadId)
  if (!lead) return fail('That lead doesn’t exist.', 404)
  if (!inScope(scopeOf(user.role, 'sales'), user, lead.ownerId, teamIdsFor(user, users, departments))) {
    return fail('This lead belongs to someone outside your access.', 403)
  }
  if (!can(user.role, 'sales', 'edit')) return fail('Your role can view leads but not change them.', 403)
  // Same wording as POST /leads/:id/activities.
  if (lead.doNotContact) {
    return fail(`${lead.company} is marked Do Not Contact, so calls, emails and WhatsApp are blocked.`, 422)
  }

  const channel = input.channel
  if (channel !== 'email' && channel !== 'whatsapp') return fail('Pick Email or WhatsApp.', 422)
  const to = clean(input.to)
  const subject = clean(input.subject)
  const body = clean(input.body)

  if (!to) return fail(channel === 'email' ? 'Pick who the email goes to.' : 'Pick who the WhatsApp goes to.', 422)
  if (channel === 'email' && !EMAIL_RE.test(to)) return fail(`${to} isn’t a valid email address.`, 422)
  if (channel === 'whatsapp' && !isUaeMobile(to) && !normalizeUaeMobile(to)) {
    return fail(`${to} isn’t a UAE mobile (+971 5X XXX XXXX).`, 422)
  }
  if (channel === 'email' && !subject) return fail('Add a subject.', 422)
  if (subject.length > SUBJECT_MAX) return fail(`Keep the subject under ${SUBJECT_MAX} characters.`, 422)
  if (!body) return fail('The message can’t be empty.', 422)
  if (channel === 'whatsapp' && body.length > WHATSAPP_MAX) {
    return fail(`WhatsApp messages are limited to ${WHATSAPP_MAX} characters.`, 422)
  }
  if (body.length > BODY_MAX) return fail(`Keep the message under ${BODY_MAX.toLocaleString()} characters.`, 422)
  const token = TOKEN_RE.exec(`${subject}\n${body}`)
  if (token) return fail(`Fill in or remove ${token[0]} before sending.`, 422)

  if (input.templateId) {
    const template = templates.find((t) => t.id === input.templateId)
    if (!template || template.channel !== channel) return fail('That template doesn’t exist for this channel.', 422)
  }

  // Name the contact in the timeline when the address is one of the lead's contacts.
  const leadContacts = contacts.filter((c) => c.leadId === lead.id)
  const contact =
    channel === 'email'
      ? leadContacts.find((c) => c.email.toLowerCase() === to.toLowerCase())
      : leadContacts.find((c) => normalizeUaeMobile(c.mobile) === normalizeUaeMobile(to))
  const who = contact?.name || (channel === 'whatsapp' ? formatUaeMobile(to) : to)

  const summary =
    channel === 'email' ? `Email sent to ${who}: ${subject}` : `WhatsApp to ${who}: ${excerpt(body, 120)}`

  const activity: ActivityView = await logActivity(user, { leadId: lead.id, type: channel, summary })
  const { autoStatus, ...rest } = activity
  return autoStatus ? { activity: rest, autoStatus } : { activity: rest }
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}
