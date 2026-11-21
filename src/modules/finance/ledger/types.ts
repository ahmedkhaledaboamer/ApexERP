import type { Account, AccountType, CurrencyCode, JournalEntry, JournalLine, JournalSourceType, SystemAccountRole } from '@/modules/finance/types'

/**
 * Accounts & finance › ledger core and setup (docs/API.md › Finance › Ledger & settings): finance settings,
 * exchange rates, lock date, chart of accounts with balances, journal, trial balance, account ledger and the
 * finance overview. The core records (Account, JournalEntry…) are in ../types.ts; these are the screens' shapes.
 */

/* ---------------- settings ---------------- */

export interface ExchangeRate {
  id: string
  currency: CurrencyCode
  /** 1 unit of `currency` = `rate` units of the base currency. */
  rate: number
  effectiveDate: string // yyyy-MM-dd
  createdAt: string
  createdByName: string | null
}

export interface FinanceSettings {
  /** From the company's regional settings; read-only. */
  baseCurrency: CurrencyCode
  country: string
  /** 1 = January … 12 = December. */
  fiscalYearStartMonth: number
  vatRegistered: boolean
  /** TRN (UAE) / VAT number (KSA); validated by country. */
  vatNumber: string
  /** "TRN" / "VAT number". */
  vatLabel: string
  legalNameEn: string
  /** Arabic legal name, printed on KSA tax invoices. */
  legalNameAr: string
  /** Company document prefix (APX, CRS) printed in invoice / receipt numbers; read-only. */
  documentPrefix: string
  paymentTermsDays: number
  invoiceNotes: string
  invoiceTerms: string
  defaultRevenueAccountId: string | null
  defaultBankAccountId: string | null
  exchangeRates: ExchangeRate[]
  /** No posting on or before this date (null = open). */
  lockDate: string | null
  lockDateSetAt: string | null
  lockDateSetByName: string | null
  /** The caller may move the lock date (Company Admin, Accountant). */
  canMoveLockDate: boolean
  canEdit: boolean
  updatedAt: string | null
}

export interface FinanceSettingsInput {
  fiscalYearStartMonth?: number
  vatRegistered?: boolean
  vatNumber?: string
  legalNameEn?: string
  legalNameAr?: string
  paymentTermsDays?: number
  invoiceNotes?: string
  invoiceTerms?: string
  defaultRevenueAccountId?: string | null
  defaultBankAccountId?: string | null
}

export interface ExchangeRateInput {
  currency: string
  rate: number
  effectiveDate: string
}

/* ---------------- chart of accounts ---------------- */

export interface AccountRow extends Account {
  /** Sums of posted lines (base currency) up to `as_of`; headers roll up their descendants. */
  debit: number
  credit: number
  /** Natural-side balance: debit − credit for asset / expense, credit − debit otherwise. */
  balance: number
  hasPostings: boolean
  depth: number
}

export interface AccountInput {
  code?: string
  name?: string
  type?: AccountType
  subtype?: string
  parentId?: string | null
  isHeader?: boolean
  description?: string
  active?: boolean
  /** Moves a system role to this account (taken from its current holder). */
  systemRole?: SystemAccountRole | null
}

/* ---------------- journal ---------------- */

export interface JournalRow {
  id: string
  number: string
  date: string
  memo: string
  sourceType: JournalSourceType
  sourceId: string | null
  sourceNumber: string | null
  sourceLink: string | null
  status: JournalEntry['status']
  reversalOf: string | null
  reversedBy: string | null
  total: number
  lineCount: number
  accountNames: string[]
  createdBy: string | null
  createdByName: string
  createdAt: string
}

export interface JournalLineView extends JournalLine {
  accountCode: string
  accountName: string
  departmentName: string | null
  projectName: string | null
  eventName: string | null
  customerName: string | null
}

export interface JournalDetail extends JournalRow {
  lines: JournalLineView[]
  reversalOfNumber: string | null
  reversedByNumber: string | null
  canReverse: boolean
  reverseBlockedReason: string | null
}

export interface ManualLineInput {
  accountId: string
  debit: number
  credit: number
  description?: string
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  customerId?: string | null
}

export interface ManualJournalInput {
  date: string
  memo: string
  lines: ManualLineInput[]
}

export interface OpeningBalanceInput {
  date: string
  memo?: string
  lines: { accountId: string; debit: number; credit: number }[]
}

export interface JournalFilters {
  from?: string
  to?: string
  sourceType?: string
  accountId?: string
  q?: string
}

export interface DimensionOption {
  id: string
  name: string
}
export interface JournalDimensions {
  departments: DimensionOption[]
  projects: DimensionOption[]
  events: DimensionOption[]
  customers: DimensionOption[]
}

/* ---------------- reports ---------------- */

export interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: AccountType
  debit: number
  credit: number
}
export interface TrialBalance {
  asOf: string
  currency: CurrencyCode
  rows: TrialBalanceRow[]
  totals: { debit: number; credit: number }
  balanced: boolean
}

export interface LedgerRow {
  entryId: string
  number: string
  date: string
  memo: string
  description: string
  sourceType: JournalSourceType
  debit: number
  credit: number
  /** Running natural-side balance after this line. */
  balance: number
}
export interface AccountLedger {
  account: Pick<Account, 'id' | 'code' | 'name' | 'type'>
  currency: CurrencyCode
  from: string | null
  to: string | null
  openingBalance: number
  rows: LedgerRow[]
  totals: { debit: number; credit: number }
  closingBalance: number
}

export interface FinanceOverview {
  currency: CurrencyCode
  today: string
  cash: { accountId: string; code: string; name: string; balance: number }[]
  cashTotal: number
  receivables: { total: number; overdue: number; openCount: number; overdueCount: number }
  revenue: { thisMonth: number; lastMonth: number; month: string; previousMonth: string }
  vat: { output: number; input: number; payable: number }
  latest: JournalRow[]
  lockDate: string | null
}

export const SOURCE_TYPE_LABEL: Record<JournalSourceType, string> = {
  manual: 'Manual',
  invoice: 'Invoice',
  credit_note: 'Credit note',
  payment: 'Payment',
  payment_refund: 'Refund',
  pdc: 'Post-dated cheque',
  opening_balance: 'Opening balance',
  payroll: 'Payroll',
  bill: 'Bill',
  expense: 'Expense',
  bank: 'Bank',
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const SYSTEM_ROLE_LABEL: Record<SystemAccountRole, string> = {
  accounts_receivable: 'Accounts receivable',
  accounts_payable: 'Accounts payable',
  vat_output: 'VAT output (payable)',
  vat_input: 'VAT input (recoverable)',
  sales_revenue: 'Sales revenue',
  service_revenue: 'Service revenue',
  sales_discounts: 'Sales discounts',
  bank_default: 'Default bank',
  cash: 'Cash',
  undeposited_funds: 'Undeposited funds',
  pdc_receivable: 'PDC receivable',
  customer_advances: 'Customer advances',
  payment_gateway_clearing: 'Payment gateway clearing',
  fx_gain_loss: 'Exchange gain / loss',
  rounding: 'Rounding',
  retained_earnings: 'Retained earnings',
  opening_balance_equity: 'Opening balance equity',
}

/** The account type each system role must sit on. */
export const SYSTEM_ROLE_TYPE: Record<SystemAccountRole, AccountType> = {
  accounts_receivable: 'asset',
  accounts_payable: 'liability',
  vat_output: 'liability',
  vat_input: 'asset',
  sales_revenue: 'income',
  service_revenue: 'income',
  sales_discounts: 'income',
  bank_default: 'asset',
  cash: 'asset',
  undeposited_funds: 'asset',
  pdc_receivable: 'asset',
  customer_advances: 'liability',
  payment_gateway_clearing: 'asset',
  fx_gain_loss: 'expense',
  rounding: 'expense',
  retained_earnings: 'equity',
  opening_balance_equity: 'equity',
}

export const ACCOUNT_SUBTYPES: Record<AccountType, { id: string; label: string }[]> = {
  asset: [
    { id: 'current_asset', label: 'Current asset' },
    { id: 'fixed_asset', label: 'Fixed asset' },
    { id: 'other_asset', label: 'Other asset' },
  ],
  liability: [
    { id: 'current_liability', label: 'Current liability' },
    { id: 'non_current_liability', label: 'Non-current liability' },
  ],
  equity: [{ id: 'equity', label: 'Equity' }],
  income: [
    { id: 'operating_income', label: 'Operating income' },
    { id: 'other_income', label: 'Other income' },
  ],
  expense: [
    { id: 'cost_of_sales', label: 'Cost of sales' },
    { id: 'operating_expense', label: 'Operating expense' },
    { id: 'other_expense', label: 'Other expense' },
  ],
}
