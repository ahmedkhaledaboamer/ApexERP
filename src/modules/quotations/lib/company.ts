import type { BankDetails, Company, CompanyProfile, GeoPoint, RegionalSettings } from '@/modules/tenancy/types'
import { COUNTRY_NAMES } from '@/modules/tenancy/regionDefaults'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { formatPhone } from '@/shared/lib/phone'
import { formatIban, taxLabel } from '@/shared/lib/taxNumber'

export { COUNTRY_NAMES }

/**
 * The issuer of a commercial document: printed on quotation headers and footers, offered to
 * templates and email signatures as `{{company.*}}`, and THE single source for future invoices
 * (an invoice must call `issuerFor(tenant)` too, never read the company record directly).
 * Everything comes from Settings > Company profile (`Company.profile`) plus the regional
 * settings (tax label by country). Empty values are skipped when printing.
 */
/**
 * Three names, never mixed:
 *  - workspace name (`workspaceNameOf`): the app header, the workspace switcher, the platform
 *    console. Not printed on customer documents unless no trade name is set.
 *  - trade name (`Issuer.name`): what customers see on emails, WhatsApp openers and the quotation
 *    letterhead. Falls back to the workspace name.
 *  - legal name (`Issuer.legalName`): printed with the tax number on quotations ("From" block and
 *    legal footer), contracts and invoices. Falls back to the trade name.
 */
export function workspaceNameOf(company: Pick<Company, 'name' | 'branding'>): string {
  return company.branding?.displayName || company.name
}

export interface Issuer {
  /** Trade name: letterhead, emails, signatures (falls back to the workspace name). */
  name: string
  /** Registered name: "From" block and legal footer, contracts, invoices (with the tax number). */
  legalName: string
  /** Street, city/region, country: one printed line each. */
  addressLines: string[]
  email: string
  website: string
  phone: string
  /** "TRN", "VAT number", "Tax ID"… for the company country. */
  taxLabel: string
  /** Printed only when set. */
  taxNumber: string
  commercialLicenseNo: string
  bank: BankDetails | null
  location: GeoPoint | null
}

/** Address of a profile as printed lines ("Business Bay", "Dubai, Dubai", "United Arab Emirates"). */
export function addressLinesOf(profile: Pick<CompanyProfile, 'address'>): string[] {
  const a = profile.address
  const cityLine = [a.city, a.region && a.region !== a.city ? a.region : ''].filter(Boolean).join(', ')
  return [a.line1, a.line2, cityLine, COUNTRY_NAMES[a.country]?.name ?? a.country].map((s) => s?.trim()).filter(Boolean) as string[]
}

/** "https://…" link for a website typed as "example.com". */
export function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

/** Map link for a pin (opens OpenStreetMap; no API key needed). */
export function mapLink(location: GeoPoint): string {
  return `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`
}

/**
 * Issuer for a tenant; a neutral placeholder before the tenant has loaded. Pass `profile` to
 * preview unsaved values (Settings > Company profile) with the exact output documents get.
 */
export function issuerFor(company: Company | null, profile: CompanyProfile | null = company?.profile ?? null): Issuer {
  if (!company || !profile) {
    return {
      name: company ? workspaceNameOf(company) : 'Your company',
      legalName: company ? workspaceNameOf(company) : '',
      addressLines: [],
      email: '',
      website: '',
      phone: '',
      taxLabel: taxLabel(company?.regional.country ?? DEFAULT_REGION.country),
      taxNumber: '',
      commercialLicenseNo: '',
      bank: null,
      location: null,
    }
  }
  const country = company.regional.country
  const bank = profile.bank && profile.bank.iban ? { ...profile.bank, iban: formatIban(profile.bank.iban) } : null
  return {
    name: profile.tradeName || workspaceNameOf(company),
    legalName: profile.legalName || profile.tradeName || workspaceNameOf(company),
    addressLines: addressLinesOf(profile),
    email: profile.email || company.branding.emailSenderAddress,
    website: profile.website,
    phone: profile.phone ? formatPhone(profile.phone, country) : '',
    taxLabel: taxLabel(country),
    taxNumber: profile.taxNumber,
    commercialLicenseNo: profile.commercialLicenseNo,
    bank,
    location: profile.location,
  }
}

/** One line for footers and signatures: "Business Bay, Dubai, United Arab Emirates". */
export function issuerAddress(issuer: Pick<Issuer, 'addressLines'>): string {
  return issuer.addressLines.join(', ')
}

/**
 * Standard Notes / Terms for a new quotation when Settings > Templates has no default
 * "Quotation cover" / "Quotation terms" template (the editor prefers those), and the
 * "Standard text" choice in the editor's Insert template menu.
 */
export function defaultTerms(region: RegionalSettings): string {
  const country = COUNTRY_NAMES[region.country]?.short ?? region.country
  return [
    '50% advance on acceptance, 50% on delivery.',
    'Invoices are payable within 15 days by bank transfer.',
    `Prices are in ${region.currency}. VAT is charged at ${region.vatPct}% under ${country} law.`,
    'Monthly services are billed in advance and can be cancelled with 30 days’ notice.',
  ].join('\n')
}

export function defaultNotes(displayName: string): string {
  return `Thank you for considering ${displayName}. We look forward to working with you.`
}

/** Seed text of the default (Apex Aora, UAE) workspace; used by the mock quotation data. */
export const DEFAULT_TERMS = defaultTerms(DEFAULT_REGION)
export const DEFAULT_NOTES = defaultNotes('Apex Aora')
