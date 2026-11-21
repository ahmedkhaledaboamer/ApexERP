import type { Account, AccountType, SystemAccountRole, TaxCode } from '@/modules/finance/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'

/**
 * Default chart of accounts per country (UAE / KSA) and VAT codes. A starting template the
 * accountant edits; not tax advice. Account ids are `ACC-<code>` — stable, so every finance seed can
 * reference them (the same code exists in both companies; records are company-scoped).
 */

type Row = [code: string, name: string, type: AccountType, subtype: string, parent: string | null, role?: SystemAccountRole, header?: boolean]

const COMMON: Row[] = [
  ['1000', 'Assets', 'asset', 'header', null, undefined, true],
  ['1100', 'Cash and bank', 'asset', 'current_asset', '1000', undefined, true],
  ['1110', 'Cash on hand', 'asset', 'current_asset', '1100', 'cash'],
  ['1120', 'Main bank account', 'asset', 'current_asset', '1100', 'bank_default'],
  ['1130', 'Undeposited funds', 'asset', 'current_asset', '1100', 'undeposited_funds'],
  ['1140', 'Payment gateway clearing', 'asset', 'current_asset', '1100', 'payment_gateway_clearing'],
  ['1200', 'Accounts receivable', 'asset', 'current_asset', '1000', 'accounts_receivable'],
  ['1210', 'Post-dated cheques receivable', 'asset', 'current_asset', '1000', 'pdc_receivable'],
  ['1300', 'VAT recoverable (input)', 'asset', 'current_asset', '1000', 'vat_input'],
  ['1400', 'Prepaid expenses', 'asset', 'current_asset', '1000'],
  ['1500', 'Fixed assets', 'asset', 'fixed_asset', '1000', undefined, true],
  ['1510', 'IT equipment', 'asset', 'fixed_asset', '1500'],
  ['1520', 'Furniture and fittings', 'asset', 'fixed_asset', '1500'],
  ['1530', 'Vehicles', 'asset', 'fixed_asset', '1500'],
  ['1590', 'Accumulated depreciation', 'asset', 'fixed_asset', '1500'],
  ['2000', 'Liabilities', 'liability', 'header', null, undefined, true],
  ['2100', 'Accounts payable', 'liability', 'current_liability', '2000', 'accounts_payable'],
  ['2200', 'VAT payable (output)', 'liability', 'current_liability', '2000', 'vat_output'],
  ['2300', 'Customer advances and credits', 'liability', 'current_liability', '2000', 'customer_advances'],
  ['2400', 'Salaries payable', 'liability', 'current_liability', '2000'],
  ['2500', 'End-of-service benefits provision', 'liability', 'non_current_liability', '2000'],
  ['2600', 'Accrued expenses', 'liability', 'current_liability', '2000'],
  ['3000', 'Equity', 'equity', 'header', null, undefined, true],
  ['3100', 'Share capital', 'equity', 'equity', '3000'],
  ['3200', 'Retained earnings', 'equity', 'equity', '3000', 'retained_earnings'],
  ['3300', 'Opening balance equity', 'equity', 'equity', '3000', 'opening_balance_equity'],
  ['4000', 'Income', 'income', 'header', null, undefined, true],
  ['4100', 'Sales revenue', 'income', 'operating_income', '4000', 'sales_revenue'],
  ['4200', 'Service revenue', 'income', 'operating_income', '4000', 'service_revenue'],
  ['4300', 'Event revenue', 'income', 'operating_income', '4000'],
  ['4800', 'Sales discounts', 'income', 'operating_income', '4000', 'sales_discounts'],
  ['4900', 'Other income', 'income', 'other_income', '4000'],
  ['5000', 'Cost of sales', 'expense', 'header', null, undefined, true],
  ['5100', 'Direct project costs', 'expense', 'cost_of_sales', '5000'],
  ['5200', 'Subcontractors', 'expense', 'cost_of_sales', '5000'],
  ['6000', 'Operating expenses', 'expense', 'header', null, undefined, true],
  ['6100', 'Salaries and wages', 'expense', 'operating_expense', '6000'],
  ['6110', 'Allowances', 'expense', 'operating_expense', '6000'],
  ['6120', 'End-of-service benefits', 'expense', 'operating_expense', '6000'],
  ['6200', 'Rent', 'expense', 'operating_expense', '6000'],
  ['6300', 'Utilities and telecom', 'expense', 'operating_expense', '6000'],
  ['6400', 'Marketing and advertising', 'expense', 'operating_expense', '6000'],
  ['6450', 'Events', 'expense', 'operating_expense', '6000'],
  ['6500', 'Travel', 'expense', 'operating_expense', '6000'],
  ['6600', 'Software and subscriptions', 'expense', 'operating_expense', '6000'],
  ['6700', 'Professional fees', 'expense', 'operating_expense', '6000'],
  ['6800', 'Bank charges', 'expense', 'operating_expense', '6000'],
  ['6850', 'Depreciation', 'expense', 'operating_expense', '6000'],
  ['6900', 'Exchange gain / loss', 'expense', 'other_expense', '6000', 'fx_gain_loss'],
  ['6950', 'Rounding differences', 'expense', 'other_expense', '6000', 'rounding'],
]

const UAE_ONLY: Row[] = [
  ['2410', 'Pension contributions payable (GPSSA)', 'liability', 'current_liability', '2000'],
  ['2700', 'Corporate tax payable', 'liability', 'current_liability', '2000'],
  ['6130', 'Pension contributions (employer)', 'expense', 'operating_expense', '6000'],
  ['6140', 'Visa and labour fees', 'expense', 'operating_expense', '6000'],
]
const KSA_ONLY: Row[] = [
  ['2410', 'GOSI payable', 'liability', 'current_liability', '2000'],
  ['2700', 'Zakat payable', 'liability', 'current_liability', '2000'],
  ['6130', 'GOSI (employer)', 'expense', 'operating_expense', '6000'],
  ['6140', 'Iqama and government fees', 'expense', 'operating_expense', '6000'],
]

const SEED_AT = '2026-01-01T00:00:00.000Z'

function chart(companyId: string, rows: Row[]): Tenant<Account>[] {
  return rows
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, name, type, subtype, parent, role, header]) => ({
      companyId,
      id: `ACC-${code}`,
      code,
      name,
      type,
      subtype,
      parentId: parent ? `ACC-${parent}` : null,
      systemRole: role ?? null,
      isHeader: !!header,
      active: true,
      currency: null,
      description: '',
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    }))
}

function taxCodes(companyId: string, standardRate: number): Tenant<TaxCode>[] {
  return [
    { companyId, id: `VAT${standardRate}`, name: `VAT ${standardRate}%`, category: 'standard', rate: standardRate, active: true },
    { companyId, id: 'ZR', name: 'Zero-rated (0%)', category: 'zero_rated', rate: 0, active: true },
    { companyId, id: 'EX', name: 'Exempt', category: 'exempt', rate: 0, active: true },
    { companyId, id: 'OOS', name: 'Out of scope', category: 'out_of_scope', rate: 0, active: true },
  ]
}

/** Standard VAT code id per company (VAT5 for UAE, VAT15 for KSA). */
export const standardTaxCodeId = (companyId: string) => (companyId === CREST_ID ? 'VAT15' : 'VAT5')

/** Seed for the stores in data/finance.ts (both companies). */
export const seedAccounts = (): Tenant<Account>[] => [...chart(APEX_ID, [...COMMON, ...UAE_ONLY]), ...chart(CREST_ID, [...COMMON, ...KSA_ONLY])]
export const seedTaxCodes = (): Tenant<TaxCode>[] => [...taxCodes(APEX_ID, 5), ...taxCodes(CREST_ID, 15)]

/** Chart template rows for a new company by country (used when a company enables accounting). */
export function chartTemplateFor(companyId: string, country: string): Tenant<Account>[] {
  return chart(companyId, [...COMMON, ...(country === 'SA' ? KSA_ONLY : UAE_ONLY)])
}
export function taxCodesTemplateFor(companyId: string, country: string): Tenant<TaxCode>[] {
  return taxCodes(companyId, country === 'SA' ? 15 : 5)
}
