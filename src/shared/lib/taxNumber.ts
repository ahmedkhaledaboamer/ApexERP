import type { CountryCode } from '@/modules/tenancy/types'

/**
 * Tax registration numbers by company country (`regional.country`). The label printed on
 * quotations and invoices, and the format check, follow the tenant's regional settings, so a UAE
 * workspace asks for a TRN and a Saudi one for a VAT number. Server and client use the same rules.
 */

interface TaxRule {
  /** Printed before the number: "TRN 100…", "VAT number 3…". */
  label: string
  pattern: RegExp
  /** Shown in hints and errors. */
  format: string
  example: string
}

/** Generic rule for countries without a fixed national format here: 8–15 letters or digits. */
const GENERIC = /^[A-Z0-9]{8,15}$/

export const TAX_RULES: Record<CountryCode, TaxRule> = {
  AE: { label: 'TRN', pattern: /^100\d{12}$/, format: '15 digits starting with 100', example: '100XXXXXXXXXXXX' },
  SA: { label: 'VAT number', pattern: /^3\d{13}3$/, format: '15 digits, starting and ending with 3', example: '3XXXXXXXXXXXXX3' },
  EG: { label: 'Tax ID', pattern: /^\d{9}$/, format: '9 digits', example: 'XXXXXXXXX' },
  QA: { label: 'Tax card number', pattern: GENERIC, format: '8–15 letters or digits', example: 'XXXXXXXXXX' },
  KW: { label: 'Tax ID', pattern: GENERIC, format: '8–15 letters or digits', example: 'XXXXXXXXXX' },
  BH: { label: 'VAT account number', pattern: GENERIC, format: '8–15 letters or digits', example: 'XXXXXXXXXXXXXXX' },
  OM: { label: 'VATIN', pattern: GENERIC, format: '8–15 letters or digits', example: 'OMXXXXXXXXXX' },
}

/** "TRN", "VAT number", "Tax ID"… for the company country. */
export function taxLabel(country: CountryCode): string {
  return TAX_RULES[country]?.label ?? 'Tax number'
}

/** Strips spaces, dashes and dots and upper-cases letters ("100 1234-5678…" → "1001234…"). */
export function normalizeTaxNumber(value: string): string {
  return String(value ?? '')
    .replace(/[\s.-]/g, '')
    .toUpperCase()
}

/** Does the (normalized) number match the country's format? Empty is not valid; callers decide if the field is optional. */
export function isValidTaxNumber(value: string, country: CountryCode): boolean {
  const rule = TAX_RULES[country]
  const v = normalizeTaxNumber(value)
  return !!rule && !!v && rule.pattern.test(v)
}

/** Validation message, e.g. "Enter a TRN: 15 digits starting with 100." */
export function taxNumberError(country: CountryCode): string {
  const rule = TAX_RULES[country]
  return `Enter a valid ${rule.label}: ${rule.format}.`
}

/* ---------------- IBAN ---------------- */

/** Removes spaces and upper-cases. */
export function normalizeIban(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

/** Basic IBAN check: shape (2 letters, 2 digits, 11–30 letters/digits) and the ISO 7064 mod-97 checksum. */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const ch of rearranged) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of n) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}

/** "SA0810000012345678900001" → "SA08 1000 0012 3456 7890 0001". */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim()
}
