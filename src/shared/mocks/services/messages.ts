import type { User } from '@/shared/types'
import type { ActivityView } from '@/modules/leads/types'
import type { SendMessageInput, SendMessageResult } from '@/modules/leads/api/messagesApi'
import { BODY_MAX, SUBJECT_MAX, WHATSAPP_MAX } from '@/modules/settings/templates/types'
import { companyContextFor } from '@/modules/settings/templates/context'
import { fillKnown } from '@/modules/settings/templates/render'
import { emailBrandOf, renderEmailHtml } from '@/modules/settings/templates/emailLayout'
import { DEFAULT_BRANDING } from '@/modules/tenancy/branding'
import { formatMobile, normalizeMobile } from '@/shared/lib/phone'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import { companyById } from '@/shared/mocks/data/tenancy'
import { contacts, leads } from '@/shared/mocks/db'
import { templates } from '@/shared/mocks/data/templates'
import { fail } from '@/shared/mocks/server'
import { findInTenant, scoped, tenantOf } from '@/shared/mocks/tenant'
import { assertCapacity, recordUsage } from '@/shared/mocks/services/billing'
import { countryOf, logActivity, mobileHint, salesTeamOf } from './leads'

/**
 * POST /leads/:id/messages. Sending is mocked: nothing leaves the app. The message is checked,
 * then logged as an email / WhatsApp activity through `logActivity`, so the same Do Not Contact
 * rule, New → Contacted move and No response → Cold automation apply as for a logged activity.
 * Emails go out from the company's sender (Settings > Branding: emailSenderName / emailSenderAddress);
 * WhatsApp numbers are checked against the company's country.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}|\[unknown: [^\]]*\]/

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The "From" of the company's outgoing email, e.g. "Apex Aora Sales <sales@apexaora.ae>". */
export function emailSenderOf(user: Pick<User, 'companyId'>): { name: string; address: string } {
  const branding = companyById(tenantOf(user))?.branding
  return { name: branding?.emailSenderName ?? '', address: branding?.emailSenderAddress ?? '' }
}

export async function sendMessage(user: User, leadId: string, input: SendMessageInput): Promise<SendMessageResult> {
  // Another company's lead answers exactly like a missing one.
  const lead = findInTenant(leads, user, (l) => l.id === leadId)
  if (!lead) return fail('That lead doesn’t exist.', 404)
  if (!inScope(scopeOf(user.role, 'sales'), user, lead.ownerId, salesTeamOf(user))) {
    return fail('This lead belongs to someone outside your access.', 403)
  }
  if (!can(user.role, 'sales', 'edit')) return fail('Your role can view leads but not change them.', 403)
  // Same wording as POST /leads/:id/activities.
  if (lead.doNotContact) {
    return fail(`${lead.company} is marked Do Not Contact, so calls, emails and WhatsApp are blocked.`, 422)
  }

  const country = countryOf(user)
  const channel = input.channel
  if (channel !== 'email' && channel !== 'whatsapp') return fail('Pick Email or WhatsApp.', 422)
  const to = clean(input.to)
  // `{{company.*}}` left in the text is filled from the sender's company (Settings > Company
  // profile through issuerFor), the same values the composer shows. Anything else still blocks.
  const companyCtx = { company: companyContextFor(companyById(tenantOf(user)) ?? null) }
  const subject = fillKnown(clean(input.subject), companyCtx)
  const body = fillKnown(clean(input.body), companyCtx)

  if (!to) return fail(channel === 'email' ? 'Pick who the email goes to.' : 'Pick who the WhatsApp goes to.', 422)
  if (channel === 'email' && !EMAIL_RE.test(to)) return fail(`${to} isn’t a valid email address.`, 422)
  if (channel === 'whatsapp' && !normalizeMobile(to, country)) {
    return fail(`${to} isn’t a ${mobileHint(country)}.`, 422)
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
    // Templates are per company: another company's template doesn't exist here.
    const template = findInTenant(templates, user, (t) => t.id === input.templateId)
    if (!template || template.channel !== channel) return fail('That template doesn’t exist for this channel.', 422)
  }

  if (channel === 'email') {
    const sender = emailSenderOf(user)
    if (!sender.address) return fail('Set the email sender in Settings > Branding before sending emails.', 422)
    // Plan limit: emails per billing period (402 LIMIT_REACHED).
    assertCapacity(tenantOf(user), 'emailsPerMonth')
  }

  // Name the contact in the timeline when the address is one of the lead's contacts.
  const leadContacts = scoped(contacts, user).filter((c) => c.leadId === lead.id)
  const contact =
    channel === 'email'
      ? leadContacts.find((c) => c.email.toLowerCase() === to.toLowerCase())
      : leadContacts.find((c) => normalizeMobile(c.mobile, country) === normalizeMobile(to, country))
  const who = contact?.name || (channel === 'whatsapp' ? formatMobile(to, country) : to)

  const summary =
    channel === 'email' ? `Email sent to ${who}: ${subject}` : `WhatsApp to ${who}: ${excerpt(body, 120)}`

  const activity: ActivityView = await logActivity(user, { leadId: lead.id, type: channel, summary })
  if (channel === 'email') recordUsage(tenantOf(user), 'emailsPerMonth')
  const { autoStatus, ...rest } = activity
  const result: SendMessageResult = autoStatus ? { activity: rest, autoStatus } : { activity: rest }
  if (channel === 'email') {
    const sender = emailSenderOf(user)
    const company = companyById(tenantOf(user))
    result.email = {
      from: `${sender.name} <${sender.address}>`,
      subject,
      html: renderEmailHtml({ brand: emailBrandOf(company?.branding ?? DEFAULT_BRANDING), subject, body }),
    }
  }
  return result
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}
