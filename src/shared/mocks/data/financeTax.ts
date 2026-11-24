import type { TaxAdjustmentLine, VatBox, VatFrequency, VatItem, VatLayout, VatReturnStatus, VatTotals } from '@/modules/finance/tax/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { perTenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { companyById } from '@/shared/mocks/data/tenancy'

/**
 * Accounts & finance › Tax stores (docs/API.md › Finance › VAT returns, Corporate tax & zakat).
 *  - `fin.vatReturns`: one row per filing period (created when the period list is read; drafts are recomputed live,
 *    filed rows keep the frozen snapshot taken at filing and the journal entries they counted).
 *  - `perTenant:fin.taxSettings`: filing frequency, the first tracked period, manual estimate adjustments.
 *  - `fin.taxMeta`: companies whose past VAT returns the seed has filed and paid (once).
 * Synthetic data only.
 */

export interface VatSnapshot {
  layout: VatLayout
  boxes: VatBox[]
  totals: VatTotals
  items: VatItem[]
  warnings: string[]
  assumptions: string[]
}

export interface VatReturnRecord {
  id: string
  periodKey: string
  label: string
  frequency: VatFrequency
  from: string
  to: string
  status: VatReturnStatus
  /** Frozen at filing. */
  snapshot: VatSnapshot | null
  /** Journal entries the filed return reported (late entries of its period then show as corrections in a later return). */
  countedEntryIds: string[]
  filingReference: string | null
  filedDate: string | null
  filedAt: string | null
  filedBy: string | null
  settlementEntryId: string | null
  /** A credit (negative payable) of this return used by a later return. */
  creditUsedBy: string | null
  /** The earlier return whose credit this one brought forward. */
  creditFrom: string | null
  paidDate: string | null
  paidAt: string | null
  paidBy: string | null
  paymentAccountId: string | null
  paymentReference: string | null
  paymentEntryId: string | null
  createdAt: string
}

export interface TaxSettingsRecord {
  vatFrequency: VatFrequency
  /** First day of the first tracked period (start of the fiscal year the module was opened in). */
  trackingFrom: string
  adjustments: { kind: 'corporate_tax' | 'zakat'; year: number; lines: TaxAdjustmentLine[] }[]
  updatedAt: string | null
  updatedBy: string | null
}

export const finVatReturns = registerArray<Tenant<VatReturnRecord>>('fin.vatReturns', [])

function seedTaxSettings(companyId: string): TaxSettingsRecord {
  const year = new Date().getUTCFullYear()
  // Crest (KSA) files monthly in the seed, Apex (UAE) quarterly; any other company quarterly.
  const ksa = companyById(companyId)?.regional.country === 'SA'
  return { vatFrequency: ksa ? 'monthly' : 'quarterly', trackingFrom: `${year}-01-01`, adjustments: [], updatedAt: null, updatedBy: null }
}

export const finTaxSettings = perTenant(seedTaxSettings, 'fin.taxSettings')

export const finTaxMeta = registerObject('fin.taxMeta', { seeded: [] as string[] })
