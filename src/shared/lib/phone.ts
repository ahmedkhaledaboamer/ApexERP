import type { CountryCode } from '@/modules/tenancy/types'

/**
 * Mobile numbers by company country. Validation and formatting follow the tenant's regional
 * settings (Settings > Company), so a Saudi workspace takes +966 numbers and a UAE one +971.
 * Server and client use the same rules.
 */

interface MobileRule {
  dialCode: string
  /** Local subscriber number (no trunk 0, no country code). */
  local: RegExp
  /** Groups for display, e.g. [2, 3, 4] → "+971 5X XXX XXXX". */
  groups: number[]
  /** Shown in hints and errors. */
  example: string
  countryName: string
}

export const MOBILE_RULES: Record<CountryCode, MobileRule> = {
  AE: { dialCode: '971', local: /^5\d{8}$/, groups: [2, 3, 4], example: '+971 5X XXX XXXX', countryName: 'UAE' },
  SA: { dialCode: '966', local: /^5\d{8}$/, groups: [2, 3, 4], example: '+966 5X XXX XXXX', countryName: 'Saudi' },
  EG: { dialCode: '20', local: /^1[0125]\d{8}$/, groups: [2, 4, 4], example: '+20 1X XXXX XXXX', countryName: 'Egyptian' },
  QA: { dialCode: '974', local: /^[3567]\d{7}$/, groups: [4, 4], example: '+974 XXXX XXXX', countryName: 'Qatari' },
  KW: { dialCode: '965', local: /^[569]\d{7}$/, groups: [4, 4], example: '+965 XXXX XXXX', countryName: 'Kuwaiti' },
  BH: { dialCode: '973', local: /^[36]\d{7}$/, groups: [4, 4], example: '+973 XXXX XXXX', countryName: 'Bahraini' },
  OM: { dialCode: '968', local: /^[79]\d{7}$/, groups: [4, 4], example: '+968 XXXX XXXX', countryName: 'Omani' },
}

/** Normalizes local forms (05X…, 9665X…, 5X…, +966 5X…) to +<dial><local>; null if it isn't a mobile for that country. */
export function normalizeMobile(value: string, country: CountryCode): string | null {
  const rule = MOBILE_RULES[country]
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  const local = digits.startsWith(rule.dialCode) ? digits.slice(rule.dialCode.length) : digits.startsWith('0') ? digits.slice(1) : digits
  return rule.local.test(local) ? `+${rule.dialCode}${local}` : null
}

export function isMobile(value: string, country: CountryCode): boolean {
  return normalizeMobile(value, country) !== null
}

/** Display form, e.g. +966 55 123 4567. Returns the input unchanged if it isn't valid. */
export function formatMobile(value: string, country: CountryCode): string {
  const n = normalizeMobile(value, country)
  if (!n) return value
  const rule = MOBILE_RULES[country]
  let rest = n.slice(rule.dialCode.length + 1)
  const parts: string[] = []
  for (const size of rule.groups) {
    parts.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  return `+${rule.dialCode} ${parts.join(' ')}`
}

/**
 * Display form of a stored mobile from any supported country (+971 55 908 7766); numbers from other
 * countries (+17028920711) are shown as stored. For lists that mix countries (venues, vendors, speakers).
 */
export function displayMobile(value: string | null | undefined): string {
  if (!value) return ''
  const compact = value.replace(/\s/g, '')
  for (const country of Object.keys(MOBILE_RULES) as CountryCode[]) {
    if (compact.startsWith(`+${MOBILE_RULES[country].dialCode}`) && normalizeMobile(compact, country)) return formatMobile(compact, country)
  }
  return value
}

export function mobileExample(country: CountryCode): string {
  return MOBILE_RULES[country].example
}

const SAMPLE_LOCAL: Record<CountryCode, string> = {
  AE: '501234567',
  SA: '501234567',
  EG: '1012345678',
  QA: '33123456',
  KW: '50123456',
  BH: '36123456',
  OM: '91234567',
}

/** A realistic number for input placeholders, e.g. "+966 50 123 4567". */
export function mobileSample(country: CountryCode): string {
  return formatMobile(`+${MOBILE_RULES[country].dialCode}${SAMPLE_LOCAL[country]}`, country)
}

/** Validation message, e.g. "Enter a Saudi mobile: +966 5X XXX XXXX." */
export function mobileError(country: CountryCode): string {
  const rule = MOBILE_RULES[country]
  return `Enter a ${rule.countryName} mobile: ${rule.example}.`
}

/* ---- Company phones (landline or mobile), e.g. Settings > Company profile ---- */

/** Local landline numbers (no trunk 0, no country code), by country. */
const LANDLINE: Record<CountryCode, RegExp> = {
  AE: /^[2-9]\d{7}$/,
  SA: /^1\d{8}$/,
  EG: /^[2-9]\d{7,8}$/,
  QA: /^4\d{7}$/,
  KW: /^2\d{7}$/,
  BH: /^1\d{7}$/,
  OM: /^2\d{7}$/,
}

/** Normalizes a mobile or landline number of the country to +<dial><local>; null if it's neither. */
export function normalizePhone(value: string, country: CountryCode): string | null {
  const mobile = normalizeMobile(value, country)
  if (mobile) return mobile
  const rule = MOBILE_RULES[country]
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  const local = digits.startsWith(rule.dialCode) ? digits.slice(rule.dialCode.length) : digits.startsWith('0') ? digits.slice(1) : digits
  return LANDLINE[country].test(local) ? `+${rule.dialCode}${local}` : null
}

export function isPhone(value: string, country: CountryCode): boolean {
  return normalizePhone(value, country) !== null
}

/** Display form: mobiles as formatMobile, landlines as "+966 11 455 2200" / "+971 4 123 4567". */
export function formatPhone(value: string, country: CountryCode): string {
  if (isMobile(value, country)) return formatMobile(value, country)
  const n = normalizePhone(value, country)
  if (!n) return value
  const local = n.slice(MOBILE_RULES[country].dialCode.length + 1)
  const area = local.length === 9 ? 2 : local.length === 8 && /^[2-9]/.test(local) && (country === 'AE') ? 1 : 0
  const head = area ? `${local.slice(0, area)} ` : ''
  const rest = local.slice(area)
  const mid = rest.length > 4 ? `${rest.slice(0, rest.length - 4)} ${rest.slice(-4)}` : rest
  return `+${MOBILE_RULES[country].dialCode} ${head}${mid}`
}

/** Validation message for a company phone. */
export function phoneError(country: CountryCode): string {
  return `Enter a ${MOBILE_RULES[country].countryName} phone number with country code, e.g. ${mobileExample(country)}.`
}

/* ---- UAE wrappers, kept so older call sites compile; prefer the country-aware functions. ---- */

/** @deprecated use isMobile(value, country) */
export const UAE_MOBILE = /^\+971\s?5\d\s?\d{3}\s?\d{4}$/
/** @deprecated use isMobile(value, country) */
export const isUaeMobile = (value: string) => isMobile(value, 'AE')
/** @deprecated use normalizeMobile(value, country) */
export const normalizeUaeMobile = (value: string) => normalizeMobile(value, 'AE')
/** @deprecated use formatMobile(value, country) */
export const formatUaeMobile = (value: string) => formatMobile(value, 'AE')
