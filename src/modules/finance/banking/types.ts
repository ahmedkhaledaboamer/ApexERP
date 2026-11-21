import type { CurrencyCode } from '@/modules/finance/types'

/**
 * Accounts & finance › Banking (docs/API.md › Finance › Bank accounts, Reconciliation, Payroll posting).
 *
 * A bank account is a record ON TOP of the ledger: it points at one postable ledger account under 1100 Cash and bank
 * (`ledgerAccountId`), and every balance comes from the journal lines posted to that account. Account numbers / IBANs
 * are stored in full and served masked (`•••• 1234`); accounting-full users can reveal them (POST, audited).
 *
 * Amounts of a bank account are in ITS currency. The journal holds base-currency amounts; for a foreign-currency bank
 * account the account-currency amount of a line is the one banking recorded when it posted (transfers, opening balance,
 * entries from statement lines), otherwise base ÷ the exchange rate of the line's date (docs/DB-ALIGNMENT.md F-B2).
 *
 * Journal lines have no ids of their own: a line is named `<entry id>:L<index>` (e.g. `JE-1042:L1`).
 */

export const BANK_ACCOUNT_KINDS = ['current', 'savings', 'deposit', 'cash', 'card'] as const
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number]
export const BANK_ACCOUNT_KIND_LABEL: Record<BankAccountKind, string> = { current: 'Current account', savings: 'Savings account', deposit: 'Fixed deposit', cash: 'Cash', card: 'Company card' }

export interface BankAccount {
  id: string
  name: string
  bankName: string
  kind: BankAccountKind
  /** Masked: "•••• 1234" (full only through POST /finance/bank-accounts/:id/reveal). */
  accountNumberMasked: string
  ibanMasked: string
  currency: CurrencyCode
  ledgerAccountId: string
  ledgerAccountCode: string
  ledgerAccountName: string
  active: boolean
  isDefault: boolean
  /** Book balance in the account's currency (journal lines on the ledger account, all dates up to today). */
  bookBalance: number
  /** The same in base currency (what the trial balance shows). */
  bookBalanceBase: number
  /** Last imported statement line's running balance (null: no statement yet / no balance column). */
  statementBalance: number | null
  statementBalanceDate: string | null
  lastReconciledDate: string | null
  lastReconciledBalance: number | null
  unmatchedLines: number
  /** Journal lines before this date are treated as cleared (the opening position of the first statement). */
  reconcileFrom: string | null
  openingBalance: number
  openingDate: string | null
  notes: string
  createdAt: string
}

export interface BankAccountInput {
  name?: string
  bankName?: string
  kind?: BankAccountKind
  accountNumber?: string
  iban?: string
  currency?: string
  /** An existing postable account under 1100 (left empty: a new one is created under 1100). */
  ledgerAccountId?: string | null
  openingBalance?: number
  openingDate?: string
  reconcileFrom?: string | null
  active?: boolean
  notes?: string
}

export interface BankAccountReveal {
  id: string
  accountNumber: string
  iban: string
}

/* ---------------- transfers ---------------- */

export type TransferStatus = 'posted' | 'void'
export interface BankTransfer {
  id: string
  number: string
  date: string
  fromBankAccountId: string
  fromName: string
  toBankAccountId: string
  toName: string
  /** Leaves `from`, in its currency. */
  amountFrom: number
  fromCurrency: CurrencyCode
  /** Arrives in `to`, in its currency (same as amountFrom when both currencies match). */
  amountTo: number
  toCurrency: CurrencyCode
  /** Charged by the bank on the `from` account, in its currency (posted to bank charges). */
  fee: number
  /** Base-currency exchange difference posted to fx gain / loss (+ loss, − gain). */
  fxDifference: number
  reference: string
  memo: string
  status: TransferStatus
  journalEntryId: string
  journalNumber: string
  voidJournalEntryId: string | null
  createdByName: string | null
  createdAt: string
}

export interface TransferInput {
  date?: string
  fromBankAccountId?: string
  toBankAccountId?: string
  amountFrom?: number
  amountTo?: number
  fee?: number
  reference?: string
  memo?: string
}

/* ---------------- statements ---------------- */

export const DATE_FORMATS = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy', 'd MMM yyyy'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

/** Column mapping of a CSV statement: column indexes (0-based) or null. Amount: one signed column, or debit + credit. */
export interface CsvMapping {
  date: number
  description: number
  reference: number | null
  amount: number | null
  debit: number | null
  credit: number | null
  balance: number | null
  dateFormat: DateFormat
  hasHeader: boolean
  /** A signed amount column where a positive number is money OUT (some banks export it that way). */
  invertSign?: boolean
  delimiter?: ',' | ';' | '\t'
}

export interface ParsedLine {
  row: number
  date: string
  description: string
  reference: string
  /** Signed, account currency: + money in (deposit), − money out (payment). */
  amount: number
  balance: number | null
  /** Same date + amount + description + reference as a line already imported for this account, or earlier in this file. */
  duplicate: boolean
  error: string | null
}

export interface StatementPreview {
  columns: string[]
  sample: string[][]
  suggestedMapping: CsvMapping
  lines: ParsedLine[]
  errors: number
  duplicates: number
  totalIn: number
  totalOut: number
  startDate: string | null
  endDate: string | null
  closingBalance: number | null
}

export interface StatementImportInput {
  fileName?: string
  csv?: string
  mapping?: Partial<CsvMapping>
  /** Import lines flagged as duplicates too (default false: skipped). */
  includeDuplicates?: boolean
}

export interface StatementLine {
  id: string
  statementId: string
  date: string
  description: string
  reference: string
  amount: number
  balance: number | null
  matchId: string | null
  reconciled: boolean
  /** The first bank rule whose "description contains" fits (unmatched lines): the account an entry would post to. */
  ruleId: string | null
  ruleAccountId: string | null
}

export interface BankStatement {
  id: string
  bankAccountId: string
  fileName: string
  startDate: string
  endDate: string
  lineCount: number
  matchedCount: number
  skippedDuplicates: number
  closingBalance: number | null
  importedByName: string | null
  importedAt: string
}

export interface BankStatementDetail extends BankStatement {
  lines: StatementLine[]
  canDelete: boolean
}

/* ---------------- reconciliation ---------------- */

export interface BookLine {
  /** `<entry id>:L<index>` */
  id: string
  entryId: string
  entryNumber: string
  date: string
  memo: string
  description: string
  sourceType: string
  sourceNumber: string | null
  /** Signed, account currency: + into the bank (debit), − out (credit). */
  amount: number
  matchId: string | null
  reconciled: boolean
}

export interface MatchSuggestion {
  statementLineId: string
  journalLineIds: string[]
  /** 0–100: amount (50), date distance (≤ 30), reference / document number in the description (20). */
  score: number
  reasons: string[]
}

export interface BankMatch {
  id: string
  statementLineIds: string[]
  journalLineIds: string[]
  kind: 'manual' | 'auto' | 'created'
  amount: number
  reconciliationId: string | null
  createdByName: string | null
  createdAt: string
}

export interface ReconcileWorkspace {
  bankAccount: BankAccount
  /** Unmatched statement lines up to `to` (all when no date). */
  statementLines: StatementLine[]
  /** Unmatched journal lines on the ledger account (from `reconcileFrom`). */
  bookLines: BookLine[]
  matches: (BankMatch & { statementLines: StatementLine[]; bookLines: BookLine[] })[]
  suggestions: MatchSuggestion[]
  /** For the finish dialog: */
  statementDate: string | null
  statementBalance: number | null
  clearedBalance: number
  difference: number
  lastReconciliation: BankReconciliation | null
}

export interface MatchInput {
  statementLineIds?: string[]
  journalLineIds?: string[]
}

export interface CreateFromLineInput {
  accountId?: string
  memo?: string
  description?: string
  /** Save "description contains X → this account" as a bank rule. */
  saveRule?: boolean
  ruleContains?: string
}

export interface BankRule {
  id: string
  name: string
  /** Case-insensitive "description contains". */
  contains: string
  direction: 'any' | 'in' | 'out'
  accountId: string
  accountCode: string
  accountName: string
  /** Optional: only for this bank account. */
  bankAccountId: string | null
  active: boolean
  createdAt: string
}

export interface BankRuleInput {
  name?: string
  contains?: string
  direction?: 'any' | 'in' | 'out'
  accountId?: string
  bankAccountId?: string | null
  active?: boolean
}

export interface FinishReconciliationInput {
  statementDate?: string
  statementBalance?: number
}

export interface BankReconciliation {
  id: string
  bankAccountId: string
  bankAccountName: string
  statementDate: string
  statementBalance: number
  clearedBalance: number
  difference: number
  status: 'finished' | 'undone'
  matchCount: number
  journalLineCount: number
  finishedByName: string | null
  finishedAt: string
  undoneAt: string | null
}

export interface ReconciliationReport extends BankReconciliation {
  currency: CurrencyCode
  /** Book balance (account currency) on the statement date. */
  bookBalance: number
  /** Money in the books not yet on the statement. */
  outstandingDeposits: BookLine[]
  outstandingPayments: BookLine[]
  /** Statement lines on or before the date that are still unmatched. */
  unmatchedStatementLines: StatementLine[]
  /** bookBalance − deposits + payments = statementBalance (when all is explained). */
  adjustedBookBalance: number
  canUndo: boolean
}

/* ---------------- payroll posting ---------------- */

export type PayrollPostingStatus = 'not_posted' | 'accrued' | 'paid' | 'reversed' | 'skipped_locked' | 'error'

export interface PayrollPosting {
  runId: string
  month: string
  runStatus: string
  currency: CurrencyCode
  status: PayrollPostingStatus
  accrualEntryId: string | null
  accrualEntryNumber: string | null
  paymentEntryId: string | null
  paymentEntryNumber: string | null
  reversalEntryIds: string[]
  paidFromAccountId: string | null
  paidFromAccountName: string | null
  totals: { gross: number; net: number; employeeSocialInsurance: number; employerSocialInsurance: number; loanRepayments: number; otherDeductions: number; bankPaid: number; cashPaid: number }
  note: string | null
  runLink: string
}
