import type { CountryCode, RegionalSettings } from '@/modules/tenancy/types'

/**
 * Regional settings a new workspace starts with, by country (sign-up). The company can change
 * them later; the server applies the same table.
 */
export const COUNTRY_DEFAULTS: Record<CountryCode, Omit<RegionalSettings, 'country' | 'language'>> = {
  AE: { currency: 'AED', timezone: 'Asia/Dubai', dateFormat: 'd MMM yyyy', weekStartsOn: 1, weekend: [0, 6], vatPct: 5 },
  SA: { currency: 'SAR', timezone: 'Asia/Riyadh', dateFormat: 'dd/MM/yyyy', weekStartsOn: 0, weekend: [5, 6], vatPct: 15 },
  EG: { currency: 'EGP', timezone: 'Africa/Cairo', dateFormat: 'dd/MM/yyyy', weekStartsOn: 6, weekend: [5, 6], vatPct: 14 },
  QA: { currency: 'QAR', timezone: 'Asia/Qatar', dateFormat: 'dd/MM/yyyy', weekStartsOn: 0, weekend: [5, 6], vatPct: 0 },
  KW: { currency: 'KWD', timezone: 'Asia/Kuwait', dateFormat: 'dd/MM/yyyy', weekStartsOn: 0, weekend: [5, 6], vatPct: 0 },
  BH: { currency: 'BHD', timezone: 'Asia/Bahrain', dateFormat: 'dd/MM/yyyy', weekStartsOn: 0, weekend: [5, 6], vatPct: 10 },
  OM: { currency: 'OMR', timezone: 'Asia/Muscat', dateFormat: 'dd/MM/yyyy', weekStartsOn: 0, weekend: [5, 6], vatPct: 5 },
}

export const COUNTRY_NAMES: Record<CountryCode, { name: string; short: string }> = {
  AE: { name: 'United Arab Emirates', short: 'UAE' },
  SA: { name: 'Saudi Arabia', short: 'Saudi' },
  EG: { name: 'Egypt', short: 'Egyptian' },
  QA: { name: 'Qatar', short: 'Qatari' },
  KW: { name: 'Kuwait', short: 'Kuwaiti' },
  BH: { name: 'Bahrain', short: 'Bahraini' },
  OM: { name: 'Oman', short: 'Omani' },
}

export const COUNTRY_CODES = Object.keys(COUNTRY_DEFAULTS) as CountryCode[]

export function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === 'string' && (COUNTRY_CODES as string[]).includes(v)
}

/** Full regional settings for a new company in `country`. */
export function regionalDefaults(country: CountryCode): RegionalSettings {
  const d = COUNTRY_DEFAULTS[country]
  return { country, language: 'en', ...d, weekend: [...d.weekend] }
}
