/**
 * Accounts & finance › Expenses (phase 2): company expenses paid immediately, employee expense claims (out of
 * pocket, reimbursed by payment or through payroll) and petty cash funds. UI camelCase; the API speaks snake_case
 * through src/shared/api/financeExpensesMappers.ts (docs/API.md › Finance › Expenses / Expense claims / Petty cash).
 *
 * Ids (unique across companies; seed Apex from 1001, Crest from 5001):
 *   expense            EXP-<n>    number <PREFIX>-EXP-2026-0001
 *   expense category   ECAT-<n>
 *   expense claim      ECL-<n>    number <PREFIX>-ECL-2026-0001; lines ECLL-<n>
 *   petty cash fund    PCF-<n>
 *   petty expense      PCE-<n>    number <PREFIX>-PCE-2026-0001
 *   petty movement     PCM-<n>    (top-up, replenishment <PREFIX>-PCR-2026-0001, cash count)
 *
 * Amounts are in the document's currency, 2 decimals; `baseAmount` is in the company's base currency.
 */

/** Who approves a step (same values as services/financeApprovals.ts `ApproverKind`). */
export type ApproverKind = 'department_head' | 'Accountant' | 'Management' | 'Company Admin'

/** An uploaded receipt (mocked: metadata plus a small data URL). Counts against the plan's storage. */
export interface ReceiptFile {
  name: string
  sizeBytes: number
  mimeType: string
  /** A data URL for small files (≤ 256 KB), null otherwise (metadata only). */
  url: string | null
}

/* ---------------- categories & policy ---------------- */

export interface ExpenseCategory {
  id: string
  name: string
  /** The expense account it posts to (an active expense account of the chart). */
  accountId: string
  accountCode: string
  accountName: string
  description: string
  /** Per-employee monthly limit for claims, in base currency (null = no limit). */
  monthlyLimit: number | null
  active: boolean
}
export interface ExpenseCategoryInput {
  name?: string
  accountId?: string
  description?: string
  monthlyLimit?: number | null
  active?: boolean
}

export type PolicyMode = 'warn' | 'block'
export const POLICY_MODE_LABEL: Record<PolicyMode, string> = { warn: 'Warn', block: 'Block' }

export interface ExpensePolicy {
  baseCurrency: string
  /** A receipt is needed above this amount (base currency) — company expenses always; claims / petty per `receiptMode`. */
  receiptRequiredAbove: number
  receiptMode: PolicyMode
  /** Claim lines older than this (days before submission) are flagged. */
  claimMaxAgeDays: number
  ageMode: PolicyMode
  /** What happens when a claim takes an employee over a category's monthly limit. */
  limitMode: PolicyMode
  canEdit: boolean
  updatedAt: string | null
}
export type ExpensePolicyInput = Partial<Pick<ExpensePolicy, 'receiptRequiredAbove' | 'receiptMode' | 'claimMaxAgeDays' | 'ageMode' | 'limitMode'>>

export type PolicyWarningCode = 'receipt_missing' | 'over_monthly_limit' | 'too_old'
export interface PolicyWarning {
  code: PolicyWarningCode
  message: string
  /** The claim line it is about (null for the whole document). */
  lineId: string | null
  /** true = the document can't be submitted until fixed (the policy is set to block). */
  blocking: boolean
}

/* ---------------- approvals (shared view) ---------------- */

export type ApprovalStepStatus = 'approved' | 'current' | 'waiting'
export interface ApprovalStepView {
  index: number
  approver: ApproverKind
  /** "Department head (Karim Nasser)", "Accountant", "Management". */
  label: string
  status: ApprovalStepStatus
  approvedByName: string | null
  approvedAt: string | null
}

export interface DocHistoryEntry {
  at: string
  byName: string
  action: string
  note: string
}

export interface JournalRef {
  id: string
  number: string
  date: string
  status: 'posted' | 'reversed'
}

/* ---------------- expenses ---------------- */

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'void'
export const EXPENSE_STATUSES: ExpenseStatus[] = ['pending', 'approved', 'rejected', 'void']
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', void: 'Void' }

export type ExpensePaymentMethod = 'card' | 'cash' | 'bank_transfer' | 'petty_cash'
export const EXPENSE_PAYMENT_METHODS: ExpensePaymentMethod[] = ['card', 'bank_transfer', 'cash', 'petty_cash']
export const EXPENSE_PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = { card: 'Company card', cash: 'Cash', bank_transfer: 'Bank transfer', petty_cash: 'Petty cash' }

export interface Expense {
  id: string
  number: string
  status: ExpenseStatus
  date: string
  /** A supplier from the vendor directory, or free text. */
  vendorId: string | null
  payeeName: string
  /** The payee's TRN / VAT number on the tax invoice (empty = no valid tax invoice → no VAT recovered). */
  payeeVatNumber: string
  categoryId: string
  categoryName: string
  accountId: string
  accountName: string
  description: string
  /** Total paid, VAT included, in `currency`. */
  amount: number
  currency: string
  exchangeRate: number
  taxCodeId: string
  taxRate: number
  /** VAT recovered (input VAT) in `currency`; 0 when not recoverable. */
  vatAmount: number
  netAmount: number
  vatRecoverable: boolean
  /** Why VAT is / isn't recovered, e.g. "No valid TRN on the tax invoice: the full amount is the expense". */
  vatNote: string
  baseAmount: number
  paymentMethod: ExpensePaymentMethod
  /** Paid from a petty cash fund (method petty_cash): the fund's account is the paid-from account. */
  pettyFundId: string | null
  pettyFundName: string | null
  paidFromAccountId: string
  paidFromAccountName: string
  reference: string
  departmentId: string | null
  departmentName: string | null
  projectId: string | null
  projectName: string | null
  eventId: string | null
  eventName: string | null
  campaignId: string | null
  campaignName: string | null
  receipt: ReceiptFile | null
  notes: string
  steps: ApprovalStepView[]
  journal: JournalRef | null
  voidJournal: JournalRef | null
  /** Other live expenses with the same payee, amount and date. */
  duplicateOf: { id: string; number: string }[]
  history: DocHistoryEntry[]
  createdBy: string
  createdByName: string
  createdAt: string
  approvedAt: string | null
  rejectReason: string | null
  voidedAt: string | null
  voidReason: string | null
  can: { approve: boolean; reject: boolean; edit: boolean; void: boolean }
}

export interface ExpenseInput {
  date?: string
  vendorId?: string | null
  payeeName?: string
  payeeVatNumber?: string
  categoryId?: string
  description?: string
  amount?: number
  currency?: string
  exchangeRate?: number | null
  taxCodeId?: string
  paymentMethod?: ExpensePaymentMethod
  pettyFundId?: string | null
  paidFromAccountId?: string
  reference?: string
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  campaignId?: string | null
  receipt?: ReceiptFile | null
  notes?: string
}

export interface DuplicateCheckInput {
  vendorId?: string | null
  payeeName?: string
  amount?: number
  date?: string
  excludeId?: string | null
}

export interface Option {
  id: string
  name: string
}
export interface ExpensesMeta {
  baseCurrency: string
  vatRegistered: boolean
  country: string
  standardTaxCodeId: string
  receiptRequiredAbove: number
  currencies: string[]
  categories: ExpenseCategory[]
  /** Bank, card and cash accounts (accounts that hold petty cash funds are paid through `pettyFunds`). */
  paymentAccounts: { id: string; code: string; name: string }[]
  pettyFunds: Option[]
  taxCodes: { id: string; name: string; rate: number; category: string }[]
  vendors: { id: string; name: string; taxNumber: string; blocked: boolean }[]
  departments: Option[]
  projects: Option[]
  events: Option[]
  campaigns: Option[]
}

/* ---------------- employee expense claims ---------------- */

export type ClaimStatus = 'draft' | 'pending' | 'approved' | 'in_payroll' | 'reimbursed' | 'rejected'
export const CLAIM_STATUSES: ClaimStatus[] = ['draft', 'pending', 'approved', 'in_payroll', 'reimbursed', 'rejected']
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting approval',
  approved: 'Approved, to reimburse',
  in_payroll: 'In payroll',
  reimbursed: 'Reimbursed',
  rejected: 'Rejected',
}

export interface ClaimLine {
  id: string
  date: string
  categoryId: string
  categoryName: string
  description: string
  /** Where it was spent (shop, restaurant, taxi company …). */
  merchant: string
  /** The merchant's TRN / VAT number on the receipt (valid → VAT recovered at the standard rate). */
  merchantVatNumber: string
  amount: number
  currency: string
  exchangeRate: number
  baseAmount: number
  /** Recovered VAT in base currency (0 when not recoverable). */
  vatBase: number
  receipt: ReceiptFile | null
  projectId: string | null
  projectName: string | null
  customerId: string | null
  customerName: string | null
  eventId: string | null
  eventName: string | null
}
export interface ClaimLineInput {
  id?: string
  date?: string
  categoryId?: string
  description?: string
  merchant?: string
  merchantVatNumber?: string
  amount?: number
  currency?: string
  exchangeRate?: number | null
  receipt?: ReceiptFile | null
  projectId?: string | null
  customerId?: string | null
  eventId?: string | null
}

export type ReimbursementMethod = 'payment' | 'payroll'
export const REIMBURSEMENT_METHOD_LABEL: Record<ReimbursementMethod, string> = { payment: 'Paid now', payroll: 'Through payroll' }

export interface ClaimReimbursement {
  method: ReimbursementMethod
  /** payment: the account paid from, the date and the journal entry. */
  accountId: string | null
  accountName: string | null
  date: string | null
  journal: JournalRef | null
  /** payroll: the payroll adjustment (kind reimbursement) and its month. */
  payrollAdjustmentId: string | null
  payrollMonth: string | null
  reimbursedAt: string | null
}

export interface ExpenseClaim {
  id: string
  number: string
  status: ClaimStatus
  title: string
  employeeId: string
  employeeName: string
  departmentId: string | null
  departmentName: string | null
  /** Base currency; every line is converted at its own rate. */
  currency: string
  total: number
  vatTotal: number
  lines: ClaimLine[]
  warnings: PolicyWarning[]
  steps: ApprovalStepView[]
  /** Names of who can act on the current step (pending only). */
  waitingOn: string[]
  journal: JournalRef | null
  reimbursement: ClaimReimbursement | null
  rejectReason: string | null
  history: DocHistoryEntry[]
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  isMine: boolean
  can: { edit: boolean; submit: boolean; delete: boolean; approve: boolean; reject: boolean; reimburse: boolean }
}

export interface ClaimInput {
  title?: string
  notes?: string
  lines?: ClaimLineInput[]
}

export interface ReimburseInput {
  method?: ReimbursementMethod
  accountId?: string
  date?: string
}

export type ClaimView = 'mine' | 'approvals' | 'all'
export interface ClaimsQuery {
  view?: ClaimView
  status?: ClaimStatus | ''
  employeeId?: string
}

export interface ClaimsMeta {
  baseCurrency: string
  currencies: string[]
  categories: ExpenseCategory[]
  policy: ExpensePolicy
  projects: Option[]
  events: Option[]
  customers: Option[]
  /** The caller's employee record (null: no employee record → can't claim). */
  employee: { id: string; name: string; departmentName: string | null } | null
  /** Payment accounts for "pay now" (accounting full only; empty otherwise). */
  paymentAccounts: { id: string; code: string; name: string }[]
  /** The payroll month a reimbursement would go into now. */
  nextPayrollMonth: string
  canSeeAll: boolean
  canReimburse: boolean
}

/* ---------------- petty cash ---------------- */

export type PettyExpenseStatus = 'pending' | 'approved' | 'rejected'
export const PETTY_EXPENSE_STATUS_LABEL: Record<PettyExpenseStatus, string> = { pending: 'To replenish', approved: 'Replenished', rejected: 'Rejected' }

export type PettyMovementKind = 'top_up' | 'replenishment' | 'count'
export const PETTY_MOVEMENT_LABEL: Record<PettyMovementKind, string> = { top_up: 'Top-up', replenishment: 'Replenishment', count: 'Cash count' }

export interface PettyFund {
  id: string
  name: string
  custodianEmployeeId: string
  custodianName: string
  /** The ledger account of the cash (ACC-1115 Petty cash by default; funds may share it). */
  accountId: string
  accountName: string
  currency: string
  floatLimit: number
  /** Book balance: top-ups + replenishments − posted expenses ± count differences. */
  bookBalance: number
  /** Petty expenses recorded but not yet replenished (already spent from the box). */
  pendingTotal: number
  pendingCount: number
  /** Cash that should be in the box now (book balance − pending expenses). */
  cashExpected: number
  /** What a replenishment of every pending expense would top up from the bank. */
  replenishAmount: number
  lowBalance: boolean
  active: boolean
  lastCountAt: string | null
  lastReplenishedAt: string | null
  isMine: boolean
  can: { record: boolean; manage: boolean; replenish: boolean }
}

export interface PettyExpense {
  id: string
  number: string
  fundId: string
  date: string
  categoryId: string
  categoryName: string
  description: string
  payeeName: string
  payeeVatNumber: string
  amount: number
  vatAmount: number
  receipt: ReceiptFile | null
  status: PettyExpenseStatus
  replenishmentId: string | null
  rejectReason: string | null
  warnings: PolicyWarning[]
  createdByName: string
  createdAt: string
}

export interface PettyMovement {
  id: string
  number: string
  kind: PettyMovementKind
  date: string
  /** Effect on the book balance (signed). */
  amount: number
  /** Replenishment: expenses posted and the bank top-up. */
  expensesTotal: number
  topUp: number
  /** Cash count: counted vs expected; difference = counted − expected (to 6950 rounding / over-short). */
  counted: number | null
  expected: number | null
  difference: number | null
  reason: string
  fromAccountName: string | null
  journal: JournalRef | null
  expenseIds: string[]
  byName: string
  at: string
}

export interface PettyFundDetail extends PettyFund {
  expenses: PettyExpense[]
  movements: PettyMovement[]
}

export interface PettyFundInput {
  name?: string
  custodianEmployeeId?: string
  floatLimit?: number
  accountId?: string
  active?: boolean
  /** On create: fund the float now from this bank / cash account (optional). */
  fundFromAccountId?: string | null
  date?: string
}
export interface PettyTopUpInput {
  amount?: number
  fromAccountId?: string
  date?: string
}
export interface PettyExpenseInput {
  date?: string
  categoryId?: string
  description?: string
  payeeName?: string
  payeeVatNumber?: string
  amount?: number
  receipt?: ReceiptFile | null
}
export interface ReplenishInput {
  approveIds?: string[]
  reject?: { id: string; reason: string }[]
  fromAccountId?: string
  date?: string
}
export interface CashCountInput {
  counted?: number
  reason?: string
  date?: string
}

export interface PettyMeta {
  baseCurrency: string
  categories: ExpenseCategory[]
  /** Employees who can hold a fund (accounting full only). */
  employees: Option[]
  fundAccounts: { id: string; code: string; name: string }[]
  bankAccounts: { id: string; code: string; name: string }[]
  receiptRequiredAbove: number
  canManage: boolean
}
