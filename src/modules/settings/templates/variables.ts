/**
 * The variables a template may use, written `{{group.field}}`. One catalog for the Settings
 * editor, the server-side validation and every renderer (follow-ups, quotations, AI agent).
 */

export type VariableGroupId = 'lead' | 'agent' | 'company' | 'quotation' | 'date'

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
    ['email', 'Email', 'Sender’s work email.', 'sara.khalil@apexaorainnovations.com'],
    ['mobile', 'Mobile', 'Sender’s mobile number.', '+971 50 123 4567'],
    ['title', 'Job title', 'Sender’s job title.', 'Senior Account Executive'],
  ]),
  group('company', 'Company', [
    ['name', 'Name', 'Our company name.', 'Apex Aora Innovations'],
    ['website', 'Website', 'Our website.', 'apexaorainnovations.com'],
    ['phone', 'Phone', 'Our main phone number.', '+971 4 000 0000'],
  ]),
  group('quotation', 'Quotation', [
    ['number', 'Number', 'Quotation number.', 'QT-2026-0012'],
    ['title', 'Title', 'Quotation title.', 'Website redesign and SEO retainer'],
    ['total', 'Total', 'Grand total including VAT.', 'AED 48,300'],
    ['validUntil', 'Valid until', 'Last day the quotation is valid.', '17 Dec 2026'],
    ['link', 'Link', 'Link to view the quotation online.', 'https://apexaorainnovations.com/q/QT-2026-0012'],
  ]),
  group('date', 'Date', [['today', 'Today', 'Today’s date when the message is sent.', '17 Nov 2026']]),
]

export const VARIABLES: TemplateVariable[] = VARIABLE_GROUPS.flatMap((g) => g.variables)

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]))

export function isKnownVariable(key: string): boolean {
  return BY_KEY.has(key)
}

export function getVariable(key: string): TemplateVariable | undefined {
  return BY_KEY.get(key)
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
