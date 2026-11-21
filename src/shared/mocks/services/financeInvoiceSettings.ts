import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { rateFor } from './financeRates'
import { addressLinesOf } from '@/modules/quotations/lib/company'
import { taxLabel } from '@/shared/lib/taxNumber'

/**
 * The invoices section's view of the finance settings (VAT number, legal names, exchange rates, payment
 * terms, default revenue account, document prefix, default notes / terms).
 *
 * Reads Finance settings (ledger core: data/financeLedger.ts `financeSettings`, services/financeRates.ts
 * `rateFor`) and falls back to the company profile (legal name, tax number, address), the regional settings
 * (base currency, country) and built-in defaults (the published USD pegs of AED and SAR, 30-day terms) when
 * a setting is empty. SEAM(settings): the KSA national address (building number, district, postal code) is
 * not in the settings or the profile yet.
 */

export interface InvoiceSettings {
  country: string
  baseCurrency: string
  /** APX / CRS: document number prefix. */
  prefix: string
  timezone: string
  legalName: string
  legalNameAr: string
  vatNumber: string
  taxLabel: string
  addressLines: string[]
  commercialRegistration: string
  /** ZATCA address parts (KSA national address). */
  address: { street: string; buildingNumber: string; district: string; city: string; postalZone: string; region: string; country: string }
  paymentTermsDays: number
  defaultRevenueAccountId: string | null
  invoiceNotes: string
  invoiceTerms: string
  currencies: string[]
}

/** Fixed pegs (central-bank published): 1 USD = 3.6725 AED = 3.75 SAR. EUR / GBP indicative only. */
const PEG_TO_USD: Record<string, number> = { AED: 3.6725, SAR: 3.75 }
const INDICATIVE_USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27 }

const PREFIX: Record<string, string> = { co_apex: 'APX', co_crest: 'CRS' }

export function invoiceSettingsFor(companyId: string): InvoiceSettings {
  const c = companyById(companyId)
  const country = c?.regional.country ?? 'AE'
  const base = c?.regional.currency ?? (country === 'SA' ? 'SAR' : 'AED')
  const p = c?.profile
  const fs = c ? financeSettings.get(companyId) : null
  const legal = fs?.legalNameEn || p?.legalName || p?.tradeName || c?.name || 'Company'
  return {
    country,
    baseCurrency: base,
    prefix: fs?.documentPrefix || PREFIX[companyId] || (c?.name ?? 'CO').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X'),
    timezone: c?.regional.timezone ?? 'Asia/Dubai',
    legalName: legal,
    // Arabic legal name (Finance settings); empty → the print shows the English name only.
    legalNameAr: fs?.legalNameAr ?? '',
    vatNumber: fs?.vatNumber || p?.taxNumber || '',
    taxLabel: taxLabel(country),
    addressLines: p ? addressLinesOf(p) : [],
    commercialRegistration: p?.commercialLicenseNo ?? '',
    address: {
      street: p?.address.line1 ?? '',
      // SEAM(settings): the KSA national address (building number, district, postal code) is not in the company profile yet.
      buildingNumber: '0000',
      district: p?.address.line2 || p?.address.city || '',
      city: p?.address.city ?? '',
      postalZone: '00000',
      region: p?.address.region ?? '',
      country,
    },
    paymentTermsDays: fs?.paymentTermsDays ?? 30,
    defaultRevenueAccountId: fs?.defaultRevenueAccountId ?? null,
    invoiceNotes: fs?.invoiceNotes ?? '',
    invoiceTerms: fs?.invoiceTerms ?? '',
    currencies: [...new Set([base, 'USD', 'EUR', 'GBP', country === 'SA' ? 'AED' : 'SAR'])],
  }
}

/**
 * Default rate from `currency` to the company's base currency on `date` (1 for the base): Finance settings ›
 * Exchange rates first, then the built-in pegs; null when unknown.
 */
export function defaultRateFor(companyId: string, currency: string, date?: string | null): number | null {
  const base = invoiceSettingsFor(companyId).baseCurrency
  if (currency === base) return 1
  if (companyById(companyId)) {
    const set = rateFor(companyId, currency, date ?? '9999-12-31')
    if (set) return set
  }
  const baseUsd = PEG_TO_USD[base]
  if (!baseUsd) return null
  const fromUsd = PEG_TO_USD[currency] ? 1 / PEG_TO_USD[currency] : INDICATIVE_USD[currency]
  if (!fromUsd) return null
  return Math.round(fromUsd * baseUsd * 1_000_000) / 1_000_000
}

/** Revenue account for a line: the given one, else service revenue for catalog lines, else the settings default / sales revenue. */
export function revenueAccountFor(companyId: string, opts: { serviceId?: string | null; eventId?: string | null }): string {
  const role = opts.serviceId ? 'service_revenue' : 'sales_revenue'
  const settingsDefault = invoiceSettingsFor(companyId).defaultRevenueAccountId
  if (!opts.serviceId && settingsDefault) return settingsDefault
  return financeAccounts.find((a) => a.companyId === companyId && a.systemRole === role && a.active)?.id ?? 'ACC-4100'
}
