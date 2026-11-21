/**
 * Accounts & finance — core contract shared by every finance section (ledger, invoices, payments,
 * later bills / expenses / banking / reports). Field names are the UI's camelCase; the API speaks
 * snake_case through the mapping layer (src/shared/api/mapping.ts), like every other module.
 * Records are company-scoped (Tenant<T> on the server); the client never sends company_id.
 *
 * Money: amounts are numbers in the document's currency, rounded to 2 decimals with `round2`
 * (src/shared/mocks/services/ledger.ts). Every document also stores `exchangeRate` to the company's
 * base currency (AED for Apex, SAR for Crest; 1 when the same), so reports can sum in base currency.
 *
 * ID / number conventions (stable, per company):
 *   accounts       ACC-<code>            (e.g. ACC-1100); `code` is the human chart number
 *   journal entry  JE-<n>                number JV-2026-0001 (yearly sequence per company)
 *   invoice        INV-<n>               number <PREFIX>-INV-2026-0001 (APX / CRS prefix)
 *   credit note    CN-<n>                number <PREFIX>-CN-2026-0001
 *   payment        PAY-<n>               number <PREFIX>-RCT-2026-0001 (receipt)
 * `<n>` is unique across companies (seed: Apex from 1001, Crest from 5001) so an id never names two records.
 */

export type CurrencyCode = string // ISO 4217: AED, SAR, USD, EUR …

/* ---------------- chart of accounts ---------------- */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
}
/** Natural balance side: assets and expenses are debit-normal; the rest credit-normal. */
export const DEBIT_NORMAL: Record<AccountType, boolean> = { asset: true, expense: true, liability: false, equity: false, income: false }

/**
 * System roles let services post without knowing a company's account codes. Every company's chart
 * has exactly one active account per role (the ledger resolves it with `systemAccount(companyId, role)`).
 */
export type SystemAccountRole =
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'vat_output' // VAT payable on sales
  | 'vat_input' // VAT recoverable on purchases
  | 'sales_revenue'
  | 'service_revenue'
  | 'sales_discounts'
  | 'bank_default'
  | 'cash'
  | 'undeposited_funds' // received, not yet in the bank
  | 'pdc_receivable' // post-dated cheques held
  | 'customer_advances' // unapplied customer credit / overpayments
  | 'payment_gateway_clearing'
  | 'fx_gain_loss'
  | 'rounding'
  | 'retained_earnings'
  | 'opening_balance_equity'

export interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  /** Finer grouping for statements, e.g. current_asset, fixed_asset, current_liability, cost_of_sales, operating_expense. */
  subtype: string
  parentId: string | null
  systemRole: SystemAccountRole | null
  /** Header accounts group children and can't be posted to. */
  isHeader: boolean
  active: boolean
  currency: CurrencyCode | null // null = base currency
  description: string
  createdAt: string
  updatedAt: string
}

/* ---------------- journal (general ledger) ---------------- */

/** What created the entry; `sourceId` is that document's id. Manual entries have sourceType 'manual'. */
export type JournalSourceType = 'manual' | 'invoice' | 'credit_note' | 'payment' | 'payment_refund' | 'pdc' | 'opening_balance' | 'payroll' | 'bill' | 'expense' | 'bank'

export interface JournalLine {
  accountId: string
  /** Base-currency amounts; exactly one of debit / credit is > 0. */
  debit: number
  credit: number
  description: string
  /** Optional dimensions for reports. */
  customerId?: string | null
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  taxCode?: string | null
}

export type JournalStatus = 'posted' | 'reversed'

export interface JournalEntry {
  id: string
  number: string
  date: string // yyyy-MM-dd, company-local
  memo: string
  sourceType: JournalSourceType
  sourceId: string | null
  lines: JournalLine[]
  status: JournalStatus
  /** For a reversal: the entry it reverses (and on the original, the reversing entry). */
  reversalOf: string | null
  reversedBy: string | null
  createdBy: string | null // user id; null = system
  createdAt: string
}

/* ---------------- tax ---------------- */

/** VAT treatment of a line. UAE 5%, KSA 15% standard; zero-rated exports; exempt; out of scope. */
export type TaxCategory = 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope'
export interface TaxCode {
  id: string // e.g. VAT5, VAT15, ZR, EX, OOS
  name: string
  category: TaxCategory
  rate: number // percent
  active: boolean
}

/* ---------------- invoices (sales) ---------------- */

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void'
/** "Overdue" is derived: issued / partially_paid with dueDate < company today and balanceDue > 0. */

export interface InvoiceLine {
  id: string
  description: string
  serviceId: string | null
  quantity: number
  unitPrice: number
  discount: number // amount, not percent
  taxCodeId: string
  /** Computed: (qty × unitPrice − discount), tax, and total. */
  net: number
  taxAmount: number
  total: number
  revenueAccountId: string
}

export interface Invoice {
  id: string
  number: string // assigned on issue; drafts show "Draft"
  kind: 'tax_invoice' | 'simplified' // KSA: B2B standard vs B2C simplified
  status: InvoiceStatus
  customerId: string
  /** Where it came from (any may be null). */
  quotationId: string | null
  contractId: string | null
  leadId: string | null
  projectId: string | null
  eventId: string | null
  recurringId: string | null
  issueDate: string | null // yyyy-MM-dd
  dueDate: string | null
  currency: CurrencyCode
  exchangeRate: number
  lines: InvoiceLine[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  /** Kept current by the payments section through `applyToInvoice` (services/financeInvoiceBalance.ts). */
  amountPaid: number
  amountCredited: number
  balanceDue: number
  notes: string
  terms: string
  journalEntryId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  issuedAt: string | null
  voidedAt: string | null
  voidReason: string | null
}
