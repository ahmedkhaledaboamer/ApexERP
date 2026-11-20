/**
 * The variables a template may use, written `{{group.field}}`. One catalog for the Settings
 * editor, the server-side validation and every renderer (follow-ups, quotations, AI agent).
 */

export type VariableGroupId = 'lead' | 'agent' | 'company' | 'quotation' | 'event' | 'date'

export interface TemplateVariable {
  /** Full key, e.g. `lead.company`. */
  key: string
  group: VariableGroupId
  field: string
  label: string
  description: string
  /** Shown in the picker and used when there's no real record to preview with. */
  sample: string
}

export interface VariableGroup {
  id: VariableGroupId
  label: string
  variables: TemplateVariable[]
}

type Def = [field: string, label: string, description: string, sample: string]

function group(id: VariableGroupId, label: string, defs: Def[]): VariableGroup {
  return {
    id,
    label,
    variables: defs.map(([field, l, description, sample]) => ({ key: `${id}.${field}`, group: id, field, label: l, description, sample })),
  }
}

export const VARIABLE_GROUPS: VariableGroup[] = [
  group('lead', 'Lead', [
    ['company', 'Company', 'The lead’s company name.', 'Gulf Horizon Logistics'],
    ['contactName', 'Contact name', 'Full name of the main contact.', 'Fatima Al Mansoori'],
    ['firstName', 'Contact first name', 'First name of the main contact, without titles.', 'Fatima'],
    ['status', 'Status', 'Current pipeline status.', 'Interested'],
    ['industry', 'Industry', 'The lead’s industry.', 'Logistics & Transport'],
    ['source', 'Source', 'Where the lead came from.', 'Website'],
    ['nextFollowUpDate', 'Next follow-up', 'Date of the next planned follow-up.', '24 Nov 2026'],
    ['nextStep', 'Next step', 'The agreed next step.', 'Share a fixed-scope proposal'],
  ]),
  group('agent', 'Agent', [
    ['name', 'Name', 'Full name of the sender.', 'Sara Khalil'],
    ['firstName', 'First name', 'First name of the sender.', 'Sara'],
    ['email', 'Email', 'Sender’s work email.', 'sara.khalil@yourcompany.com'],
    ['mobile', 'Mobile', 'Sender’s mobile number.', '+000 50 123 4567'],
    ['title', 'Job title', 'Sender’s job title.', 'Senior Account Executive'],
  ]),
  group('company', 'Company', [
    // Values come from Settings > Company profile through `issuerFor(tenant)` (see `companyContext`);
    // the samples here are only a fallback, the picker and previews show the tenant's real values.
    ['name', 'Name', 'Our trade name, as customers know us (falls back to the workspace name).', 'Your Company'],
    ['legal_name', 'Legal name', 'Our registered company name, as on the trade licence.', 'Your Company LLC'],
    ['phone', 'Phone', 'Our main phone number.', '+000 0 000 0000'],
    ['email', 'Email', 'Our main email address.', 'hello@yourcompany.com'],
    ['website', 'Website', 'Our website.', 'yourcompany.com'],
    ['address', 'Address', 'Our address on one line.', 'Business district, Your city'],
    ['tax_label', 'Tax label', 'What the tax number is called in our country (TRN, VAT number…).', 'TRN'],
    ['tax_number', 'Tax number', 'Our tax registration number.', '100XXXXXXXXXXXX'],
  ]),
  group('quotation', 'Quotation', [
    ['number', 'Number', 'Quotation number.', 'QT-2026-0012'],
    ['title', 'Title', 'Quotation title.', 'Website redesign and SEO retainer'],
    ['total', 'Total', 'Grand total including VAT.', '48,300'],
    ['validUntil', 'Valid until', 'Last day the quotation is valid.', '17 Dec 2026'],
    ['link', 'Link', 'Link to view the quotation online.', 'https://yourcompany.com/q/QT-2026-0012'],
  ]),
  group('event', 'Event', [
    // Filled when a bulk email is linked to an event (Events › Invite an audience / Send follow-up).
    ['name', 'Name', 'The event’s name.', 'GITEX Global 2027'],
    ['date', 'Date', 'When the event takes place (company time).', 'Mon 12 Oct 2027 · 09:00–17:00'],
    ['location', 'Location', 'Where it takes place (or “Online”).', 'Dubai World Trade Centre'],
    ['registration_url', 'Registration link', 'The event’s public registration page.', 'https://yourcompany.com/e/abcdefghijklmnopqrst'],
    ['survey_url', 'Feedback survey link', 'The recipient’s own feedback survey (attendees only).', 'https://yourcompany.com/s/abcdefghijklmnopqrstuvwx'],
  ]),
  group('date', 'Date', [['today', 'Today', 'Today’s date when the message is sent.', '17 Nov 2026']]),
]

/** The canonical variables (what the picker offers). Deprecated aliases are not listed. */
export const VARIABLES: TemplateVariable[] = VARIABLE_GROUPS.flatMap((g) => g.variables)

/**
 * Deprecated spellings that still render (templates saved before the snake_case company keys).
 * Hidden from the picker; resolved to their canonical key everywhere else.
 */
export const VARIABLE_ALIASES: Readonly<Record<string, string>> = {
  'company.legalName': 'company.legal_name',
  'company.taxLabel': 'company.tax_label',
  'company.taxNumber': 'company.tax_number',
}

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]))

/** The canonical key for a key or a deprecated alias (`company.legalName` → `company.legal_name`). */
export function canonicalKey(key: string): string {
  return VARIABLE_ALIASES[key] ?? key
}

export function isKnownVariable(key: string): boolean {
  return BY_KEY.has(canonicalKey(key))
}

/** The variable for a key; an alias returns its canonical variable. */
export function getVariable(key: string): TemplateVariable | undefined {
  return BY_KEY.get(canonicalKey(key))
}

/** `{{lead.company}}`. */
export function token(key: string): string {
  return `{{${key}}}`
}

/** Best guess for a mistyped key (`lead.Company`, `company`, `lead.compny`), or null. */
export function suggestVariable(key: string): TemplateVariable | null {
  const k = key.trim().toLowerCase()
  if (!k) return null
  const exact = VARIABLES.find((v) => v.key.toLowerCase() === k)
  if (exact) return exact
  // `company.LegalName`, `company.legal-name`, `company.taxnumber`: same key once separators go.
  const squash = (x: string) => x.replace(/[_\s-]/g, '')
  const loose = VARIABLES.find((v) => squash(v.key.toLowerCase()) === squash(k))
  if (loose) return loose
  const field = k.includes('.') ? k.split('.').pop()! : k
  const groupPart = k.includes('.') ? k.split('.')[0] : ''
  const sameField = VARIABLES.filter((v) => v.field.toLowerCase() === field)
  if (sameField.length) return sameField.find((v) => v.group === groupPart) ?? sameField[0]
  const close = VARIABLES.filter((v) => (!groupPart || v.group === groupPart) && distance(v.field.toLowerCase(), field) <= 2)
  return close[0] ?? null
}

/** Levenshtein distance, for short field names only. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}
