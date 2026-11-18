import type { CompanyProfile, CountryCode } from '@/modules/tenancy/types'
import { isCountryCode } from '@/modules/tenancy/regionDefaults'
import { formatPhone, isPhone, phoneError } from '@/shared/lib/phone'
import { isValidIban, isValidTaxNumber, normalizeIban, normalizeTaxNumber, taxNumberError } from '@/shared/lib/taxNumber'

/**
 * Settings > Company profile: the rules shared by the form (inline errors) and the mock API
 * (422). The tax number and phone are checked against the company country (`regional.country`).
 */

/** PATCH /settings/company-profile body: any top-level field; `address` merges; `bank`/`location` null clears. */
export type CompanyProfilePatch = Partial<Omit<CompanyProfile, 'address' | 'bank' | 'location'>> & {
  address?: Partial<CompanyProfile['address']>
  bank?: Partial<NonNullable<CompanyProfile['bank']>> | null
  location?: { lat: number | string; lng: number | string } | null
}

/** Field errors keyed by dotted path (`address.city`, `bank.iban`…). */
export type ProfileErrors = Partial<Record<string, string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const WEBSITE = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i
const SWIFT = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/** Applies a patch to the stored profile (trimmed, normalized). Never reads a company id. */
export function mergeProfile(current: CompanyProfile, patch: CompanyProfilePatch): CompanyProfile {
  const p = (patch ?? {}) as CompanyProfilePatch & Record<string, unknown>
  const next: CompanyProfile = structuredClone(current)
  for (const k of ['legalName', 'tradeName', 'commercialLicenseNo', 'phone', 'email', 'website'] as const) {
    if (k in p) next[k] = str(p[k])
  }
  if ('taxNumber' in p) next.taxNumber = normalizeTaxNumber(str(p.taxNumber))
  if (p.address && typeof p.address === 'object') {
    for (const k of ['line1', 'line2', 'city', 'region'] as const) if (k in p.address) next.address[k] = str(p.address[k])
    if ('country' in p.address) next.address.country = str(p.address.country) as CountryCode
  }
  if ('location' in p) {
    const l = p.location
    next.location =
      l == null || (str(l.lat) === '' && str(l.lng) === '') ? null : { lat: Number(str(l.lat)), lng: Number(str(l.lng)) }
  }
  if ('bank' in p) {
    const b = p.bank
    next.bank =
      b == null
        ? null
        : {
            bankName: str(b.bankName ?? next.bank?.bankName),
            accountName: str(b.accountName ?? next.bank?.accountName),
            iban: normalizeIban(str(b.iban ?? next.bank?.iban)),
            swift: str(b.swift ?? next.bank?.swift).toUpperCase(),
          }
  }
  return next
}

/** Every problem with a profile, for a company in `country`. Empty object = valid. */
export function validateProfile(p: CompanyProfile, country: CountryCode): ProfileErrors {
  const e: ProfileErrors = {}
  if (!p.legalName) e.legalName = 'Enter the legal name.'
  else if (p.legalName.length > 120) e.legalName = 'Use 120 characters or fewer.'
  if (!p.tradeName) e.tradeName = 'Enter the trade name.'
  else if (p.tradeName.length > 80) e.tradeName = 'Use 80 characters or fewer.'
  if (!p.address.line1) e['address.line1'] = 'Enter the street address.'
  if (!p.address.city) e['address.city'] = 'Enter the city.'
  if (!isCountryCode(p.address.country)) e['address.country'] = 'Choose a country.'
  if (p.location) {
    const { lat, lng } = p.location
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) e['location.lat'] = 'Latitude must be between -90 and 90.'
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) e['location.lng'] = 'Longitude must be between -180 and 180.'
  }
  if (p.taxNumber && !isValidTaxNumber(p.taxNumber, country)) e.taxNumber = taxNumberError(country)
  if (p.commercialLicenseNo.length > 40) e.commercialLicenseNo = 'Use 40 characters or fewer.'
  if (p.phone && !isPhone(p.phone, country)) e.phone = phoneError(country)
  if (p.email && !EMAIL.test(p.email)) e.email = 'Enter a valid email address.'
  if (p.website && !WEBSITE.test(p.website)) e.website = 'Enter a website like example.com.'
  if (p.bank) {
    if (!p.bank.bankName) e['bank.bankName'] = 'Enter the bank name.'
    if (!p.bank.accountName) e['bank.accountName'] = 'Enter the account name.'
    if (!p.bank.iban) e['bank.iban'] = 'Enter the IBAN.'
    else if (!isValidIban(p.bank.iban)) e['bank.iban'] = 'Enter a valid IBAN (country code, check digits, account number).'
    if (p.bank.swift && !SWIFT.test(p.bank.swift)) e['bank.swift'] = 'Enter an 8 or 11 character SWIFT/BIC code.'
  }
  return e
}

/** Stored form of a valid profile (phone in display format for the country). */
export function finalizeProfile(p: CompanyProfile, country: CountryCode): CompanyProfile {
  return { ...p, phone: p.phone ? formatPhone(p.phone, country) : '' }
}

/** Is the profile complete enough for documents (onboarding "Complete your company profile")? */
export function isProfileComplete(p: CompanyProfile): boolean {
  return !!(p.legalName && p.address.line1 && p.address.city && p.phone && p.email && p.taxNumber)
}
