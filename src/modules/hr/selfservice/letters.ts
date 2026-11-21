/**
 * HR letters: pure rules shared by the mock API (services/hrLetters.ts) and the screens (template editor preview).
 *
 *   - the placeholder catalogue ({{employee.fullName}} …) and which ones only salary letters may use,
 *   - renderTemplate: one pass, no recursive expansion (a value that contains "{{x}}" stays literal text), missing
 *     values become a visible blank "________" and are reported, unknown placeholders are left as written and reported,
 *   - validateTemplate: what HR may save (known placeholders only; salary ones only in salary letter types),
 *   - letterReference: the per-company yearly sequence number (APX-HRL-2026-0001),
 *   - makeVerificationCode: a random code to check a letter's authenticity (GET /hr/letters/verify),
 *   - the seeded English templates per company (currency through {{salary.currency}}: AED / SAR).
 *
 * The output is PLAIN TEXT. Screens render it as text (React escapes it), never as HTML, so a value such as
 * "<b>x</b>" prints literally.
 */

import type { LetterCode } from './types'

export interface PlaceholderDef {
  key: string
  label: string
  /** Only salary letter types (salary certificate, salary transfer) may use it. */
  salary?: boolean
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: 'employee.fullName', label: 'Employee full name' },
  { key: 'employee.salutation', label: 'Mr. / Ms. (from gender; blank when unknown)' },
  { key: 'employee.pronoun', label: 'he / she / they' },
  { key: 'employee.possessive', label: 'his / her / their' },
  { key: 'employee.object', label: 'him / her / them' },
  { key: 'employee.employeeNo', label: 'Employee number' },
  { key: 'employee.jobTitle', label: 'Job title' },
  { key: 'employee.department', label: 'Department' },
  { key: 'employee.nationality', label: 'Nationality (country name)' },
  { key: 'employee.hireDate', label: 'Hire date' },
  { key: 'employee.exitDate', label: 'Last working day' },
  { key: 'employee.employmentType', label: 'Employment type (full time …)' },
  { key: 'salary.basic', label: 'Basic salary (monthly)', salary: true },
  { key: 'salary.housing', label: 'Housing allowance', salary: true },
  { key: 'salary.transport', label: 'Transport allowance', salary: true },
  { key: 'salary.other', label: 'Other allowances', salary: true },
  { key: 'salary.allowances', label: 'All allowances together', salary: true },
  { key: 'salary.total', label: 'Total monthly salary', salary: true },
  { key: 'salary.currency', label: 'Salary currency (AED / SAR)', salary: true },
  { key: 'bank.name', label: 'Employee’s bank name', salary: true },
  { key: 'bank.ibanLast4', label: 'Last 4 characters of the employee’s IBAN (never the full IBAN)', salary: true },
  { key: 'company.name', label: 'Company name (trade name)' },
  { key: 'company.legalName', label: 'Company legal name' },
  { key: 'company.address', label: 'Company address (one line)' },
  { key: 'company.country', label: 'Company country' },
  { key: 'letter.date', label: 'Issue date' },
  { key: 'letter.referenceNo', label: 'Reference number' },
  { key: 'addressee', label: 'Addressee (from the request)' },
  { key: 'purpose', label: 'Purpose (from the request)' },
  { key: 'noc.purpose', label: 'NOC purpose: travel / visa application / other' },
  { key: 'signatory.name', label: 'Signatory (the approving HR user)' },
  { key: 'signatory.title', label: 'Signatory’s job title' },
]

export const PLACEHOLDER_KEYS = new Set(PLACEHOLDERS.map((p) => p.key))
export const SALARY_PLACEHOLDER_KEYS = new Set(PLACEHOLDERS.filter((p) => p.salary).map((p) => p.key))

export type LetterValues = Partial<Record<string, string | number | null | undefined>>

/** Shown in place of a value that is missing; the HR reviewer sees the gap before issuing. */
export const MISSING_VALUE = '________'

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?)\s*\}\}/g
const MAX_VALUE = 500

/** Control characters out, whitespace runs kept (line breaks matter in an address). */
function cleanValue(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_VALUE)
}

export interface RenderResult {
  text: string
  /** Known placeholders with no value (rendered as MISSING_VALUE). */
  missing: string[]
  /** Placeholders that aren't in the catalogue (left as written). */
  unknown: string[]
}

/**
 * Fills `{{key}}` placeholders in one pass. Values are inserted literally: a value is never scanned again, so
 * "{{salary.total}}" typed into an addressee can't pull the salary into an employment certificate.
 */
export function renderTemplate(template: string, values: LetterValues): RenderResult {
  const missing = new Set<string>()
  const unknown = new Set<string>()
  // The optional trailing space is captured so an optional placeholder left empty doesn't leave a double space.
  const withSpace = new RegExp(`${PLACEHOLDER.source}( ?)`, 'g')
  const text = template.replace(withSpace, (whole, key: string, space: string) => {
    if (!PLACEHOLDER_KEYS.has(key)) {
      unknown.add(key)
      return whole
    }
    const raw = values[key]
    const v = raw === null || raw === undefined ? '' : cleanValue(String(raw)).trim()
    if (!v) {
      if (OPTIONAL_KEYS.has(key)) return ''
      missing.add(key)
      return MISSING_VALUE + space
    }
    return v + space
  })
  return { text, missing: [...missing], unknown: [...unknown] }
}

/** Placeholders that may legitimately be empty (rendered as nothing, not as a gap). */
export const OPTIONAL_KEYS = new Set(['employee.salutation'])

/** Every placeholder key used in a template (in order, unique). */
export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

export const TEMPLATE_MAX = 10_000

/** Problems with a template HR wants to save (empty = fine). */
export function validateTemplate(body: string, includesSalary: boolean): string[] {
  const problems: string[] = []
  const t = body ?? ''
  if (!t.trim()) problems.push('The template is empty.')
  if (t.length > TEMPLATE_MAX) problems.push(`The template is too long (at most ${TEMPLATE_MAX.toLocaleString('en-US')} characters).`)
  const used = placeholdersIn(t)
  const unknown = used.filter((k) => !PLACEHOLDER_KEYS.has(k))
  if (unknown.length) problems.push(`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((k) => `{{${k}}}`).join(', ')}.`)
  const salary = used.filter((k) => SALARY_PLACEHOLDER_KEYS.has(k))
  if (!includesSalary && salary.length) problems.push(`Only salary letters may show pay or bank details: remove ${salary.map((k) => `{{${k}}}`).join(', ')}.`)
  // A "{{" that doesn't form a placeholder is almost always a typo ({{employee.fullName} …).
  const stray = t.replace(PLACEHOLDER, '')
  if (/\{\{|\}\}/.test(stray)) problems.push('A placeholder is not closed: write it as {{employee.fullName}}.')
  return problems
}

/* ---------------- numbering, codes, formatting ---------------- */

/** APX-HRL-2026-0001: company prefix, "HRL", the issue year (company calendar) and the yearly sequence. */
export function letterReference(prefix: string, year: number, seq: number): string {
  const p = (prefix || 'HR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'HR'
  return `${p}-HRL-${year}-${String(seq).padStart(4, '0')}`
}

/** No 0/O, 1/I: easy to read over the phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/** XXXX-XXXX-XXXX from a random source (crypto by default). */
export function makeVerificationCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(12)
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

/** Normalises what someone typed ("abcd efgh jkmn", lower case, spaces) to the stored form, or null. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length !== 12) return null
  const code = `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`
  return CODE.test(code) ? code : null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 2026-11-20 → "20 November 2026" (no timezone math: the date is already a company calendar day). */
export function letterDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return ''
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** 12500 → "12,500.00". */
export function letterMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* ---------------- seeded templates ---------------- */

export interface LetterTypeSeed {
  code: LetterCode
  name: string
  description: string
  includesSalary: boolean
  body: string
}

/** Synthetic English templates (review with HR / legal before use). `country` only changes wording. */
export function defaultLetterTypes(country: string): LetterTypeSeed[] {
  const where = country === 'SA' ? 'the Kingdom of Saudi Arabia' : 'the United Arab Emirates'
  return [
    {
      code: 'salary_certificate',
      name: 'Salary certificate',
      description: 'Confirms employment and the current monthly salary (bank, landlord, embassy).',
      includesSalary: true,
      body: [
        'To: {{addressee}}',
        '',
        'Dear Sir / Madam,',
        '',
        'This is to certify that {{employee.salutation}} {{employee.fullName}}, a national of {{employee.nationality}}, employee number {{employee.employeeNo}}, has been employed with {{company.legalName}} since {{employee.hireDate}} and currently holds the position of {{employee.jobTitle}} in the {{employee.department}} department.',
        '',
        'The current monthly salary is as follows:',
        '',
        'Basic salary: {{salary.currency}} {{salary.basic}}',
        'Allowances: {{salary.currency}} {{salary.allowances}}',
        'Total monthly salary: {{salary.currency}} {{salary.total}}',
        '',
        `This certificate is issued at the employee’s request for {{purpose}}, without any financial or legal liability on the part of the company. It is valid for use in ${where}.`,
      ].join('\n'),
    },
    {
      code: 'salary_transfer',
      name: 'Salary transfer letter',
      description: 'Addressed to a bank: confirms the salary and the undertaking to transfer it to the employee’s account.',
      includesSalary: true,
      body: [
        'To: {{addressee}}',
        '',
        'Subject: Salary transfer – {{employee.fullName}}',
        '',
        'Dear Sir / Madam,',
        '',
        'We confirm that {{employee.salutation}} {{employee.fullName}}, employee number {{employee.employeeNo}}, has been employed with {{company.legalName}} as {{employee.jobTitle}} since {{employee.hireDate}}, with a total monthly salary of {{salary.currency}} {{salary.total}} (basic salary {{salary.currency}} {{salary.basic}}).',
        '',
        'At the employee’s request, we undertake to transfer the monthly salary to the account ending {{bank.ibanLast4}} held with your bank, and not to change this arrangement without a clearance letter from you. Should the employment end, we will transfer the end-of-service benefits due to the same account.',
        '',
        'This letter is issued without any further financial liability on the part of the company.',
      ].join('\n'),
    },
    {
      code: 'employment_certificate',
      name: 'Employment certificate',
      description: 'Confirms employment, position and start date. No salary.',
      includesSalary: false,
      body: [
        'To: {{addressee}}',
        '',
        'Dear Sir / Madam,',
        '',
        'This is to certify that {{employee.salutation}} {{employee.fullName}}, a national of {{employee.nationality}}, employee number {{employee.employeeNo}}, has been employed with {{company.legalName}} since {{employee.hireDate}} and currently holds the position of {{employee.jobTitle}} ({{employee.employmentType}}) in the {{employee.department}} department.',
        '',
        'This certificate is issued at the employee’s request for {{purpose}}, without any financial or legal liability on the part of the company.',
      ].join('\n'),
    },
    {
      code: 'experience_letter',
      name: 'Experience letter',
      description: 'For leavers: the period of employment and the last position held. No salary.',
      includesSalary: false,
      body: [
        'To: {{addressee}}',
        '',
        'This is to certify that {{employee.salutation}} {{employee.fullName}}, employee number {{employee.employeeNo}}, was employed with {{company.legalName}} from {{employee.hireDate}} to {{employee.exitDate}}. The last position held was {{employee.jobTitle}} in the {{employee.department}} department.',
        '',
        'During this period {{employee.pronoun}} carried out {{employee.possessive}} duties to our satisfaction. We wish {{employee.object}} every success in the future.',
      ].join('\n'),
    },
    {
      code: 'noc',
      name: 'No objection certificate (NOC)',
      description: 'The company has no objection to the employee’s travel, visa application or another stated purpose. No salary.',
      includesSalary: false,
      body: [
        'To: {{addressee}}',
        '',
        'Subject: No objection certificate – {{noc.purpose}}',
        '',
        'Dear Sir / Madam,',
        '',
        `This is to certify that {{employee.salutation}} {{employee.fullName}}, a national of {{employee.nationality}}, employee number {{employee.employeeNo}}, is employed with {{company.legalName}} in ${where} as {{employee.jobTitle}} since {{employee.hireDate}}.`,
        '',
        'The company has no objection to {{employee.possessive}} request: {{purpose}}. The employee will resume work after the approved period.',
        '',
        'This certificate is issued without any financial or legal liability on the part of the company.',
      ].join('\n'),
    },
  ]
}
