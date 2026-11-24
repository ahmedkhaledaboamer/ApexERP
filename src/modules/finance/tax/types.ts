import type { TaxCategory } from '@/modules/finance/types'

/**
 * Accounts & finance › Tax (phase 3): VAT returns (UAE FTA VAT 201 / KSA ZATCA), the UAE corporate tax estimate and
 * the KSA zakat estimate. UI camelCase; the wire is plain snake_case at any depth (src/shared/api/financeTaxMappers.ts).
 * Records are company-scoped; the client never sends company_id.
 *
 * ids: VAT return `VATR-<n>` (one per filing period, created when the period list is read), unique across companies.
 */

export type VatFrequency = 'monthly' | 'quarterly'
export const VAT_FREQUENCY_LABEL: Record<VatFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly' }

export type VatReturnStatus = 'draft' | 'filed' | 'paid'
export const VAT_STATUS_LABEL: Record<VatReturnStatus, string> = { draft: 'Draft', filed: 'Filed', paid: 'Paid' }

/** `uae_vat201`: FTA VAT 201 (Apex). `ksa_zatca`: ZATCA VAT return (Crest). */
export type VatLayout = 'uae_vat201' | 'ksa_zatca'

export type VatSide = 'sales' | 'purchases'
export type VatDocKind = 'invoice' | 'credit_note' | 'bill' | 'debit_note' | 'expense' | 'journal'
export const VAT_DOC_KIND_LABEL: Record<VatDocKind, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit note',
  bill: 'Bill',
  debit_note: 'Debit note',
  expense: 'Expense',
  journal: 'Journal entry',
}

/**
 * One taxable line feeding the return, in base currency. Signed: credit notes, debit notes and reversals (voids) are
 * negative. Classified from the journal entry that posted it (its date decides the period) and, for documents, from
 * the document's lines (tax code → category, net amount).
 */
export interface VatItem {
  entryId: string
  entryNumber: string
  date: string
  side: VatSide
  kind: VatDocKind
  docId: string | null
  docNumber: string
  link: string | null
  counterparty: string
  category: TaxCategory
  taxCode: string | null
  net: number
  vat: number
  /** Purchases: false = VAT not recoverable (no valid tax invoice / supplier not VAT registered): excluded from the return. */
  recoverable: boolean
  /** UAE sales: the customer's emirate, else the company's (`emirateAssumed`). */
  emirate: string
  emirateAssumed: boolean
  /** KSA: a zero-rated sale treated as an export (foreign-currency invoice). */
  export: boolean
  /** A late entry of an already filed period, reported in this return's corrections / adjustment column. */
  correction: boolean
  /** Box it feeds (`excluded` when it is not reported). */
  box: string
}

export interface VatBox {
  key: string
  label: string
  /** Net value (UAE "Amount", KSA "Amount"). */
  amount: number
  /** UAE: VAT adjustment (late corrections). KSA: amount adjustment (credit / debit notes). */
  adjustment: number
  vat: number
  kind: 'line' | 'total' | 'result'
  /** Items can be listed (GET …/boxes/:box). */
  drill: boolean
  note: string | null
}

export interface VatTotals {
  /** Output VAT (sales, incl. corrections). */
  outputVat: number
  /** Recoverable input VAT (purchases, incl. corrections). */
  inputVat: number
  /** Net VAT corrections from earlier periods (KSA box 14; UAE the adjustment columns). */
  corrections: number
  /** Output − input for this period (the settlement posted when filed). */
  netVat: number
  /** Credit (negative net) of the previous filed return carried into this one. */
  creditBroughtForward: number
  /** What is paid to the authority (negative = credit to carry forward / refund). */
  payable: number
}

export interface VatReturnRow {
  id: string
  periodKey: string
  label: string
  frequency: VatFrequency
  from: string
  to: string
  dueDate: string
  status: VatReturnStatus
  /** Period not ended yet (can't be filed). */
  inProgress: boolean
  overdue: boolean
  payable: number
  filingReference: string | null
  filedDate: string | null
  paidDate: string | null
}

export interface VatReturnDetail extends VatReturnRow {
  layout: VatLayout
  currency: string
  adjustmentLabel: string
  boxes: VatBox[]
  totals: VatTotals
  itemCount: number
  excludedCount: number
  correctionCount: number
  warnings: string[]
  assumptions: string[]
  seller: { legalName: string; legalNameAr: string; vatNumber: string; address: string }
  settlementEntry: { id: string; number: string } | null
  paymentEntry: { id: string; number: string } | null
  filedAt: string | null
  filedByName: string | null
  paidByName: string | null
  paymentReference: string | null
  /** Filed returns serve the frozen snapshot taken at filing. */
  frozen: boolean
  can: { file: boolean; pay: boolean }
  fileBlockedReason: string | null
}

export interface VatBoxItems {
  returnId: string
  box: string
  label: string
  items: VatItem[]
}

export interface FileVatReturnInput {
  filingReference: string
  filedDate?: string
}
export interface PayVatReturnInput {
  date?: string
  accountId?: string
  reference?: string
}

export interface TaxSettings {
  country: string
  layout: VatLayout
  currency: string
  vatFrequency: VatFrequency
  trackingFrom: string
  companyEmirate: string
  vatNumber: string
  vatRegistered: boolean
  canEdit: boolean
  /** Bank / cash accounts a VAT payment can be made from. */
  paymentAccounts: { id: string; code: string; name: string }[]
  fiscalYearStartMonth: number
  fiscalYears: number[]
}

export interface TaxAdjustmentLine {
  label: string
  /** + adds to taxable income / zakat base; − deducts. */
  amount: number
}

export interface EstimateLine {
  key: string
  label: string
  amount: number
  note: string | null
}

export interface CorporateTaxEstimate {
  kind: 'corporate_tax'
  fiscalYear: number
  from: string
  to: string
  asOf: string
  currency: string
  revenue: number
  expenses: number
  accountingProfit: number
  adjustments: EstimateLine[]
  manualAdjustments: TaxAdjustmentLine[]
  taxableIncome: number
  threshold: number
  rate: number
  bands: { label: string; amount: number; rate: number; tax: number }[]
  tax: number
  /** Simple straight-line projection of the year to date to 12 months. */
  projectedProfit: number
  projectedTax: number
  provided: number
  toProvide: number
  source: 'ledger' | 'statements'
  notes: string[]
  canPost: boolean
}

export interface ZakatEstimate {
  kind: 'zakat'
  fiscalYear: number
  from: string
  to: string
  asOf: string
  currency: string
  equity: number
  unclosedProfit: number
  longTermLiabilities: number
  fixedAssetsNet: number
  manualAdjustments: TaxAdjustmentLine[]
  baseByBalanceSheet: number
  adjustedNetProfit: number
  base: number
  method: 'balance_sheet' | 'net_profit'
  rate: number
  zakat: number
  provided: number
  toProvide: number
  lines: EstimateLine[]
  notes: string[]
  canPost: boolean
}

export interface ProvisionInput {
  kind: 'corporate_tax' | 'zakat'
  year: number
  date?: string
}
export interface ProvisionResult {
  entry: { id: string; number: string; amount: number }
  estimate: CorporateTaxEstimate | ZakatEstimate
}

export interface TaxAdjustmentsInput {
  kind: 'corporate_tax' | 'zakat'
  year: number
  lines: TaxAdjustmentLine[]
}
