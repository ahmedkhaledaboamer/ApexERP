import { subDays } from 'date-fns'
import type { MessageTemplate } from '@/modules/settings/templates/types'

/**
 * Seed templates (mock): UAE B2B follow-ups, quotation text and short WhatsApp nudges.
 * Mutable; the templates service edits it in place. Dates are relative to load time.
 */

type Seed = Omit<MessageTemplate, 'updatedAt'> & { daysAgo: number }

const seeds: Seed[] = [
  /* ---------------- Email ---------------- */
  {
    id: 'TPL-1',
    channel: 'email',
    name: 'Website enquiry – first follow-up',
    purpose: 'First follow-up',
    subject: 'Your enquiry with {{company.name}}',
    body: `Dear {{lead.firstName}},

Thank you for reaching out to {{company.name}} through our website. I'm {{agent.firstName}}, and I'll be your point of contact.

I'd love to understand what {{lead.company}} is looking to achieve so we can suggest the right approach. Would you have 20 minutes this week for a short call? I'm flexible around your schedule, Monday to Friday.

In the meantime, you can see some of our recent work at {{company.website}}.

Kind regards,
{{agent.name}}
{{agent.title}}, {{company.name}}
{{agent.email}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 21,
  },
  {
    id: 'TPL-2',
    channel: 'email',
    name: 'No response – gentle nudge',
    purpose: 'No response',
    subject: 'Following up – {{lead.company}}',
    body: `Hi {{lead.firstName}},

I know things get busy, so I wanted to bring my previous email back to the top of your inbox.

If now isn't the right time, no problem at all. Just let me know when would suit you better and I'll follow up then. And if someone else at {{lead.company}} handles this, I'd be grateful for an introduction.

Best regards,
{{agent.name}}
{{company.name}} · {{company.phone}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 14,
  },
  {
    id: 'TPL-3',
    channel: 'email',
    name: 'Meeting recap and next steps',
    purpose: 'After meeting',
    subject: 'Great meeting today – next steps for {{lead.company}}',
    body: `Dear {{lead.firstName}},

Thank you for your time today. It was good to learn more about {{lead.company}} and your plans for the coming months.

As agreed, the next step is: {{lead.nextStep}}.

I'll be in touch on {{lead.nextFollowUpDate}}. If anything comes up before then, please reply to this email or call us on {{company.phone}}.

Kind regards,
{{agent.name}}
{{agent.title}}, {{company.name}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Karim Nasser',
    daysAgo: 9,
  },
  {
    id: 'TPL-4',
    channel: 'email',
    name: 'Proposal sent – follow-up',
    purpose: 'Proposal sent',
    subject: 'Quotation {{quotation.number}} – any questions?',
    body: `Dear {{lead.firstName}},

I hope you've had a chance to review our quotation for "{{quotation.title}}" ({{quotation.total}} including VAT). You can view it online here:
{{quotation.link}}

The quotation is valid until {{quotation.validUntil}}. If you'd like to adjust the scope, phase the work or discuss payment terms, I'm happy to walk your team through the options.

Looking forward to hearing from you.

Kind regards,
{{agent.name}}
{{company.name}} · {{company.phone}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 4,
  },
  {
    id: 'TPL-5',
    channel: 'email',
    name: 'Annual renewal reminder',
    purpose: 'Renewal reminder',
    subject: 'Your {{company.name}} renewal is coming up',
    body: `Dear {{lead.firstName}},

Thank you for another year working with {{company.name}}. A quick reminder that your service with us is due for renewal soon.

I'd like to schedule a short review to go over the results so far and anything you'd like to change for the year ahead. Would next week work for you?

Warm regards,
{{agent.name}}
{{agent.title}}, {{company.name}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Layla Mansour',
    daysAgo: 40,
  },
  {
    id: 'TPL-6',
    channel: 'email',
    name: 'Exhibition follow-up (GITEX)',
    purpose: 'First follow-up',
    subject: 'Good to meet you at GITEX, {{lead.firstName}}',
    body: `Dear {{lead.firstName}},

It was a pleasure meeting you at our stand at GITEX. Thank you for stopping by.

As promised, I'm following up to arrange a proper conversation about {{lead.company}}'s plans. Let me know a time that suits you and I'll send an invite.

Kind regards,
{{agent.name}}
{{company.name}}`,
    active: false,
    isDefault: false,
    updatedBy: 'Sara Khoury',
    daysAgo: 60,
  },

  /* ---------------- Quotation ---------------- */
  {
    id: 'TPL-7',
    channel: 'quotation',
    name: 'Standard cover note',
    purpose: 'Quotation cover',
    subject: '',
    body: `Dear {{lead.contactName}},

Thank you for the opportunity to propose our services to {{lead.company}}. Following our recent discussions, please find below our quotation for {{quotation.title}}.

The total investment is {{quotation.total}} including 5% VAT. This quotation is valid until {{quotation.validUntil}}.

We look forward to working with you.

{{agent.name}}
{{agent.title}}, {{company.name}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 30,
  },
  {
    id: 'TPL-8',
    channel: 'quotation',
    name: 'Payment terms and validity',
    purpose: 'Quotation terms',
    subject: '',
    body: `This quotation is valid until {{quotation.validUntil}}.
50% advance on acceptance, 50% on delivery.
Invoices are payable within 15 days by bank transfer.
Prices are in AED. VAT is charged at 5% under UAE law.
Monthly services are billed in advance and can be cancelled with 30 days' notice.
Work starts once the signed quotation and the advance payment are received.`,
    active: true,
    isDefault: true,
    updatedBy: 'Rashid Iqbal',
    daysAgo: 30,
  },

  /* ---------------- WhatsApp ---------------- */
  {
    id: 'TPL-9',
    channel: 'whatsapp',
    name: 'Intro after enquiry',
    purpose: 'First follow-up',
    subject: '',
    body: `Hi {{lead.firstName}}, this is {{agent.firstName}} from *{{company.name}}* 👋

Thanks for your enquiry. When's a good time for a quick 10-minute call this week?`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 12,
  },
  {
    id: 'TPL-10',
    channel: 'whatsapp',
    name: 'No response – short nudge',
    purpose: 'No response',
    subject: '',
    body: `Hi {{lead.firstName}}, just checking in on my last message. Happy to call whenever suits you. – {{agent.firstName}}, {{company.name}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Karim Nasser',
    daysAgo: 6,
  },
  {
    id: 'TPL-11',
    channel: 'whatsapp',
    name: 'Quotation sent',
    purpose: 'Proposal sent',
    subject: '',
    body: `Hi {{lead.firstName}}, I've just emailed quotation *{{quotation.number}}* for {{lead.company}}.

Total: *{{quotation.total}}* (incl. VAT)
Valid until: {{quotation.validUntil}}

View it here: {{quotation.link}}

Any questions, just reply here.`,
    active: true,
    isDefault: true,
    updatedBy: 'Omar Haddad',
    daysAgo: 2,
  },
  {
    id: 'TPL-12',
    channel: 'whatsapp',
    name: 'Meeting confirmation',
    purpose: 'After meeting',
    subject: '',
    body: `Thanks for your time today, {{lead.firstName}}. As discussed, next step: _{{lead.nextStep}}_. I'll follow up on {{lead.nextFollowUpDate}}. – {{agent.firstName}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Karim Nasser',
    daysAgo: 1,
  },
]

export const templates: MessageTemplate[] = seeds.map(({ daysAgo, ...t }) => ({
  ...t,
  updatedAt: subDays(new Date(), daysAgo).toISOString(),
}))

let seq = seeds.length + 1

export function nextTemplateId(): string {
  return `TPL-${seq++}`
}
