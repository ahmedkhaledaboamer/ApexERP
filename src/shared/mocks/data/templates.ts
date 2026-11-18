import { subDays } from 'date-fns'
import type { MessageTemplate } from '@/modules/settings/templates/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * Message templates (mock), per company.
 *
 * - `DEFAULT_TEMPLATES`: the product's 12 default templates (B2B follow-up emails, quotation
 *   cover note and terms, short WhatsApp messages). Every new company gets a copy through
 *   `defaultTemplatesFor`; the seeded Apex workspace uses the same factory (ids TPL-1…TPL-12).
 * - Crest Logistics' own Saudi logistics set (TPL-901…907).
 *
 * Company identity is never written into a template: it stays in `{{company.*}}` variables
 * (name, legal_name, phone, email, website, address), resolved from the sending company's
 * profile (issuerFor) when a message is rendered, so the same text works for any company.
 * Mutable; the templates service edits it in place. Dates are relative to load time.
 */

/** A default template before it belongs to a company. */
export type DefaultTemplate = Omit<MessageTemplate, 'id' | 'updatedAt' | 'updatedBy'>

/** Who `updatedBy` names on templates a company received from the product defaults. */
export const DEFAULT_TEMPLATE_AUTHOR = 'System'

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  /* ---------------- Email ---------------- */
  {
    channel: 'email',
    name: 'Website enquiry – first follow-up',
    purpose: 'First follow-up',
    subject: 'Your enquiry with {{company.name}}',
    body: `Dear {{lead.firstName}},

Thank you for reaching out to {{company.name}} through our website. I'm {{agent.firstName}}, and I'll be your point of contact.

I'd love to understand what {{lead.company}} is looking to achieve so we can suggest the right approach. Would you have 20 minutes this week for a short call? I'm flexible around your schedule.

In the meantime, you can see some of our recent work at {{company.website}}.

Kind regards,
{{agent.name}}
{{agent.title}}, {{company.name}}
{{agent.email}} · {{company.phone}}
{{company.website}}`,
    active: true,
    isDefault: true,
  },
  {
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
  },
  {
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
{{agent.title}}, {{company.name}}
{{company.address}}`,
    active: true,
    isDefault: true,
  },
  {
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
{{company.name}} · {{company.phone}}
{{company.email}}`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'email',
    name: 'Annual renewal reminder',
    purpose: 'Renewal reminder',
    subject: 'Your {{company.name}} renewal is coming up',
    body: `Dear {{lead.firstName}},

Thank you for another year working with {{company.name}}. A quick reminder that your service with us is due for renewal soon.

I'd like to schedule a short review to go over the results so far and anything you'd like to change for the year ahead. Would next week work for you?

Warm regards,
{{agent.name}}
{{agent.title}}, {{company.name}}
{{company.phone}} · {{company.website}}`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'email',
    name: 'Exhibition follow-up',
    purpose: 'First follow-up',
    subject: 'Good to meet you at the exhibition, {{lead.firstName}}',
    body: `Dear {{lead.firstName}},

It was a pleasure meeting you at our stand at the exhibition. Thank you for stopping by.

As promised, I'm following up to arrange a proper conversation about {{lead.company}}'s plans. Let me know a time that suits you and I'll send an invite.

Kind regards,
{{agent.name}}
{{agent.title}}, {{company.name}}
{{company.website}}`,
    active: false,
    isDefault: false,
  },

  /* ---------------- Quotation ---------------- */
  {
    channel: 'quotation',
    name: 'Standard cover note',
    purpose: 'Quotation cover',
    subject: '',
    body: `Dear {{lead.contactName}},

Thank you for the opportunity to propose our services to {{lead.company}}. Following our recent discussions, please find below our quotation for {{quotation.title}}.

The total investment is {{quotation.total}} including VAT. This quotation is valid until {{quotation.validUntil}}.

We look forward to working with you.

{{agent.name}}
{{agent.title}}, {{company.name}}
{{company.phone}} · {{company.email}}`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'quotation',
    name: 'Payment terms and validity',
    purpose: 'Quotation terms',
    subject: '',
    body: `This quotation is issued by {{company.legal_name}} and is valid until {{quotation.validUntil}}.
50% advance on acceptance, 50% on delivery.
Invoices are payable within 15 days by bank transfer to {{company.legal_name}}.
Prices include VAT at the rate shown on this quotation.
Monthly services are billed in advance and can be cancelled with 30 days' notice.
Work starts once the signed quotation and the advance payment are received.`,
    active: true,
    isDefault: true,
  },

  /* ---------------- WhatsApp ---------------- */
  {
    channel: 'whatsapp',
    name: 'Intro after enquiry',
    purpose: 'First follow-up',
    subject: '',
    body: `Hi {{lead.firstName}}, this is {{agent.firstName}} from *{{company.name}}* 👋

Thanks for your enquiry. When's a good time for a quick 10-minute call this week?`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'whatsapp',
    name: 'No response – short nudge',
    purpose: 'No response',
    subject: '',
    body: `Hi {{lead.firstName}}, just checking in on my last message. Happy to call whenever suits you. – {{agent.firstName}}, {{company.name}}`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'whatsapp',
    name: 'Quotation sent',
    purpose: 'Proposal sent',
    subject: '',
    body: `Hi {{lead.firstName}}, I've just emailed quotation *{{quotation.number}}* from {{company.name}} for {{lead.company}}.

Total: *{{quotation.total}}* (incl. VAT)
Valid until: {{quotation.validUntil}}

View it here: {{quotation.link}}

Any questions, just reply here.`,
    active: true,
    isDefault: true,
  },
  {
    channel: 'whatsapp',
    name: 'Meeting confirmation',
    purpose: 'After meeting',
    subject: '',
    body: `Thanks for your time today, {{lead.firstName}}. As discussed, next step: _{{lead.nextStep}}_. I'll follow up on {{lead.nextFollowUpDate}}. – {{agent.firstName}}, {{company.name}}`,
    active: true,
    isDefault: true,
  },
]

/**
 * The 12 product default templates as rows of `companyId`, in `DEFAULT_TEMPLATES` order. `idFor`
 * is called once per row, in order (pass `nextTemplateId` for a new company). Pure: returns new
 * rows, the caller adds them to `templates` (`seedDefaultTemplates` does both).
 */
export function defaultTemplatesFor(
  companyId: string,
  idFor: () => string,
  updatedBy: string = DEFAULT_TEMPLATE_AUTHOR,
): Tenant<MessageTemplate>[] {
  const now = new Date().toISOString()
  return DEFAULT_TEMPLATES.map((t) => ({ ...t, id: idFor(), companyId, updatedAt: now, updatedBy }))
}

/* ---------------- Apex Aora (co_apex): the defaults, with seed history ---------------- */

/** Last editor and age of each Apex default, in `DEFAULT_TEMPLATES` order. */
const APEX_HISTORY: [updatedBy: string, daysAgo: number][] = [
  ['Omar Haddad', 21],
  ['Omar Haddad', 14],
  ['Karim Nasser', 9],
  ['Omar Haddad', 4],
  ['Layla Mansour', 40],
  ['Sara Khoury', 60],
  ['Omar Haddad', 30],
  ['Rashid Iqbal', 30],
  ['Omar Haddad', 12],
  ['Karim Nasser', 6],
  ['Omar Haddad', 2],
  ['Karim Nasser', 1],
]

function apexTemplates(): Tenant<MessageTemplate>[] {
  let n = 1
  return defaultTemplatesFor('co_apex', () => `TPL-${n++}`).map((t, i) => {
    const [updatedBy, daysAgo] = APEX_HISTORY[i] ?? [DEFAULT_TEMPLATE_AUTHOR, 0]
    return { ...t, updatedBy, updatedAt: subDays(new Date(), daysAgo).toISOString() }
  })
}

/* ---------------- Crest Logistics (co_crest) ---------------- */

type Seed = Omit<MessageTemplate, 'updatedAt'> & { daysAgo: number }

const crestSeeds: Seed[] = [
  {
    id: 'TPL-901',
    channel: 'email',
    name: 'Freight enquiry – first follow-up',
    purpose: 'First follow-up',
    subject: 'Your freight enquiry with {{company.name}}',
    body: `Dear {{lead.firstName}},

Thank you for contacting {{company.name}}. I'm {{agent.firstName}}, and I'll look after {{lead.company}}'s enquiry.

To prepare an accurate rate, could you share the lanes, volumes and any customs requirements? I'd be glad to arrange a short call or a visit to your site this week, Sunday to Thursday.

Best regards,
{{agent.name}}
{{agent.title}}, {{company.name}}
{{agent.email}} · {{company.phone}}
{{company.website}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Majed Al Dossari',
    daysAgo: 18,
  },
  {
    id: 'TPL-902',
    channel: 'email',
    name: 'No response – follow-up',
    purpose: 'No response',
    subject: 'Following up – {{lead.company}} logistics',
    body: `Dear {{lead.firstName}},

I wanted to follow up on my previous message about {{lead.company}}'s logistics needs. If the timing isn't right, just let me know when to get back in touch.

Kind regards,
{{agent.name}}
{{company.name}} · {{company.phone}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Majed Al Dossari',
    daysAgo: 11,
  },
  {
    id: 'TPL-903',
    channel: 'email',
    name: 'Rate proposal sent',
    purpose: 'Proposal sent',
    subject: 'Quotation {{quotation.number}} – {{lead.company}}',
    body: `Dear {{lead.firstName}},

Please find our quotation "{{quotation.title}}" ({{quotation.total}} including VAT):
{{quotation.link}}

The rates are valid until {{quotation.validUntil}}. I'm happy to adjust volumes, lanes or service levels if needed.

Best regards,
{{agent.name}}
{{company.name}} · {{company.phone}}
{{company.email}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Reem Al Shammari',
    daysAgo: 5,
  },
  {
    id: 'TPL-904',
    channel: 'quotation',
    name: 'Logistics cover note',
    purpose: 'Quotation cover',
    subject: '',
    body: `Dear {{lead.contactName}},

Thank you for considering {{company.name}} for {{lead.company}}'s logistics. Please find below our quotation for {{quotation.title}}.

The total is {{quotation.total}} including 15% VAT, valid until {{quotation.validUntil}}.

{{agent.name}}
{{agent.title}}, {{company.name}}
{{company.phone}} · {{company.email}}
{{company.address}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Majed Al Dossari',
    daysAgo: 25,
  },
  {
    id: 'TPL-905',
    channel: 'quotation',
    name: 'Terms and validity (KSA)',
    purpose: 'Quotation terms',
    subject: '',
    body: `This quotation is issued by {{company.legal_name}} and is valid until {{quotation.validUntil}}.
Prices are in SAR. VAT is charged at 15% in line with ZATCA regulations.
Invoices are payable within 30 days by bank transfer to {{company.legal_name}}.
Fuel surcharges and port charges are passed through at cost.
Warehousing is billed monthly in advance per pallet position.`,
    active: true,
    isDefault: true,
    updatedBy: 'Faisal Al Harbi',
    daysAgo: 25,
  },
  {
    id: 'TPL-906',
    channel: 'whatsapp',
    name: 'Intro after enquiry',
    purpose: 'First follow-up',
    subject: '',
    body: `Hello {{lead.firstName}}, this is {{agent.firstName}} from *{{company.name}}*.

Thank you for your enquiry. When would suit you for a quick call about your shipments?`,
    active: true,
    isDefault: true,
    updatedBy: 'Reem Al Shammari',
    daysAgo: 8,
  },
  {
    id: 'TPL-907',
    channel: 'whatsapp',
    name: 'Quotation sent',
    purpose: 'Proposal sent',
    subject: '',
    body: `Hello {{lead.firstName}}, I've emailed quotation *{{quotation.number}}* from {{company.name}} for {{lead.company}}.

Total: *{{quotation.total}}* (incl. VAT)
Valid until: {{quotation.validUntil}}

{{quotation.link}}`,
    active: true,
    isDefault: true,
    updatedBy: 'Tariq Al Mutairi',
    daysAgo: 3,
  },
]

const toTemplate = (companyId: string) => ({ daysAgo, ...t }: Seed): Tenant<MessageTemplate> => ({
  ...t,
  companyId,
  updatedAt: subDays(new Date(), daysAgo).toISOString(),
})

export const templates: Tenant<MessageTemplate>[] = [...apexTemplates(), ...crestSeeds.map(toTemplate('co_crest'))]

let seq = DEFAULT_TEMPLATES.length + 1
registerArray('templates', templates)
registerValue('templates.seq', () => seq, (v) => { seq = v })

/** One global sequence (ids are unique across companies); skips ids already taken by seeds. */
export function nextTemplateId(): string {
  let id = `TPL-${seq++}`
  while (templates.some((t) => t.id === id)) id = `TPL-${seq++}`
  return id
}

/**
 * Gives a new company the 12 product default templates (fresh ids from `nextTemplateId`) and
 * adds them to the store. Returns the new rows. Sign-up calls this when it creates a company.
 */
export function seedDefaultTemplates(companyId: string, updatedBy: string = DEFAULT_TEMPLATE_AUTHOR): Tenant<MessageTemplate>[] {
  const rows = defaultTemplatesFor(companyId, nextTemplateId, updatedBy)
  templates.push(...rows)
  return rows
}
