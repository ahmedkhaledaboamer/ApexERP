import { perTenant } from '@/shared/mocks/tenant'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'

/**
 * Accounts & finance › settings per company (ledger core). One record per company, lazily created with the country
 * defaults on first read (`perTenant:fin.settings`). Exchange rates and the lock date live here too.
 * Synthetic data only.
 */

export interface ExchangeRateRecord {
  id: string
  currency: string
  rate: number
  effectiveDate: string
  createdAt: string
  createdBy: string | null
}

export interface FinanceSettingsRecord {
  fiscalYearStartMonth: number
  vatRegistered: boolean
  vatNumber: string
  legalNameEn: string
  legalNameAr: string
  documentPrefix: string
  paymentTermsDays: number
  invoiceNotes: string
  invoiceTerms: string
  defaultRevenueAccountId: string | null
  defaultBankAccountId: string | null
  exchangeRates: ExchangeRateRecord[]
  lockDate: string | null
  lockDateSetAt: string | null
  lockDateSetBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

const SEED_AT = '2026-01-01T00:00:00.000Z'

/** The company's document prefix (APX, CRS): the employee-number prefix, else the subdomain's first letters. */
export function companyDocPrefix(companyId: string): string {
  const fromNo = hrEmployees.find((e) => e.companyId === companyId)?.employeeNo.match(/^([A-Z]+)-/)?.[1]
  return fromNo ?? (companyById(companyId)?.subdomain ?? 'CO').slice(0, 3).toUpperCase()
}

const rate = (id: string, currency: string, value: number, effectiveDate: string): ExchangeRateRecord => ({ id, currency, rate: value, effectiveDate, createdAt: SEED_AT, createdBy: null })

function seedSettings(companyId: string): FinanceSettingsRecord {
  const c = companyById(companyId)
  const ksa = c?.regional.country === 'SA'
  const base: FinanceSettingsRecord = {
    fiscalYearStartMonth: 1,
    vatRegistered: !!c?.profile.taxNumber,
    vatNumber: c?.profile.taxNumber ?? '',
    legalNameEn: c?.profile.legalName ?? c?.name ?? '',
    legalNameAr: '',
    documentPrefix: companyDocPrefix(companyId),
    paymentTermsDays: 30,
    invoiceNotes: '',
    invoiceTerms: '',
    defaultRevenueAccountId: 'ACC-4200',
    defaultBankAccountId: 'ACC-1120',
    exchangeRates: [],
    lockDate: null,
    lockDateSetAt: null,
    lockDateSetBy: null,
    updatedAt: null,
    updatedBy: null,
  }
  if (companyId === APEX_ID) {
    return {
      ...base,
      vatRegistered: true,
      vatNumber: '100234567800003',
      legalNameAr: 'أبكس أورا لتقنية المعلومات ذ.م.م',
      invoiceNotes: 'Thank you for your business.',
      invoiceTerms: 'Payment by bank transfer within 30 days of the invoice date. Late payments may incur charges.',
      exchangeRates: [rate('FXR-101', 'USD', 3.6725, '2026-01-01'), rate('FXR-102', 'EUR', 3.98, '2026-01-01'), rate('FXR-103', 'EUR', 4.05, '2026-07-01'), rate('FXR-104', 'SAR', 0.9793, '2026-01-01')],
    }
  }
  if (companyId === CREST_ID) {
    return {
      ...base,
      legalNameAr: 'شركة كرست للخدمات اللوجستية',
      paymentTermsDays: 45,
      invoiceNotes: 'All amounts in Saudi riyals unless stated otherwise.',
      invoiceTerms: 'Payment within 45 days by bank transfer to the account shown.',
      defaultRevenueAccountId: 'ACC-4100',
      exchangeRates: [rate('FXR-501', 'USD', 3.75, '2026-01-01'), rate('FXR-502', 'AED', 1.0211, '2026-01-01'), rate('FXR-503', 'EUR', 4.12, '2026-03-01')],
      // The 2025 books are closed.
      lockDate: '2025-12-31',
      lockDateSetAt: '2026-01-15T08:00:00.000Z',
      lockDateSetBy: 'u101',
    }
  }
  // Another company: country defaults (KSA standard VAT revenue on sales).
  return ksa ? { ...base, defaultRevenueAccountId: 'ACC-4100' } : base
}

export const financeSettings = perTenant(seedSettings, 'fin.settings')
