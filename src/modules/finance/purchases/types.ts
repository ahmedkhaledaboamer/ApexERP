import type { CurrencyCode } from '@/modules/finance/types'

/**
 * Accounts & finance › Purchases & payables (phase 2): suppliers (the event vendor directory + a finance profile),
 * purchase orders with approvals and goods receipts, supplier bills with 2-/3-way matching, debit notes, bill payments
 * and payment runs, AP aging / statements, and the approval-rule settings. UI camelCase; the wire is snake_case
 * (src/shared/api/financePurchasesMappers.ts). Records are company-scoped; the client never sends company_id.
 *
 * ID / number conventions (per company, yearly numbers):
 *   purchase order  PO-<n>     number <PREFIX>-PO-2026-0001
 *   bill            BILL-<n>   number <PREFIX>-BILL-2026-0001 (ours; the supplier's own number is `supplierInvoiceNumber`)
 *   debit note      DN-<n>     number <PREFIX>-DN-2026-0001
 *   bill payment    BPAY-<n>   number <PREFIX>-PV-2026-0001 (payment voucher)
 *   payment run     PRUN-<n>   number <PREFIX>-PRUN-2026-0001
 */

export type SpendDocType = 'purchase_order' | 'bill' | 'expense' | 'expense_claim'
export type ApproverKind = 'department_head' | 'Accountant' | 'Management' | 'Company Admin'
export const APPROVER_LABEL: Record<ApproverKind, string> = {
  department_head: 'Department head',
  Accountant: 'Accountant',
  Management: 'Management',
  'Company Admin': 'Company Admin',
}

/* ---------------- approvals (shared by POs and bills) ---------------- */

export interface ApprovalStepView {
  index: number
  approver: ApproverKind
  minAmount: number
  /** Who can act (names), for the timeline. */
  approverNames: string[]
  decision: 'approved' | 'rejected' | null
  decidedByName: string | null
  decidedAt: string | null
  reason: string
}

export interface HistoryEntry {
  at: string
  byName: string
  action: string
  summary: string
}

/* ---------------- suppliers ---------------- */

export interface SupplierRow {
  id: string // the vendor id (VND-…)
  name: string
  category: string
  vendorStatus: 'preferred' | 'approved' | 'blacklisted'
  contactName: string
  email: string
  hasProfile: boolean
  vatNumber: string
  paymentTermsDays: number
  currency: CurrencyCode
  bankName: string
  /** "•••• 1234" or '' (the full IBAN is only served by the audited reveal). */
  ibanMasked: string
  openBills: number
  openBalanceBase: number
  overdueBase: number
  lastBillDate: string | null
}

export interface SupplierDetail extends SupplierRow {
  mobile: string
  website: string
  defaultExpenseAccountId: string | null
  defaultTaxCodeId: string | null
  notes: string
  bills: BillRow[]
  purchaseOrders: PoRow[]
  canEdit: boolean
  canReveal: boolean
  updatedAt: string | null
}

export interface SupplierProfileInput {
  vatNumber?: string
  paymentTermsDays?: number
  defaultExpenseAccountId?: string | null
  defaultTaxCodeId?: string | null
  currency?: string
  bankName?: string
  /** Full IBAN; '' clears it; omitted keeps it. */
  iban?: string
  notes?: string
}

export interface SupplierCreateInput extends SupplierProfileInput {
  name: string
  category?: string
  contactName?: string
  email?: string
  mobile?: string
}

/* ---------------- meta (pickers; every signed-in user of the company) ---------------- */

export interface PurchasesMeta {
  baseCurrency: string
  documentPrefix: string
  today: string
  /** accounting scope of the caller: full writes everything, view reads, hidden = requester / approver only. */
  scope: 'full' | 'view' | 'hidden'
  canManage: boolean
  myDepartmentId: string | null
  suppliers: { id: string; name: string; status: string; currency: string; paymentTermsDays: number; vatNumber: string; defaultExpenseAccountId: string | null; defaultTaxCodeId: string | null }[]
  accounts: { id: string; code: string; name: string; type: string }[]
  paymentAccounts: { id: string; code: string; name: string }[]
  taxCodes: { id: string; name: string; rate: number; category: string }[]
  departments: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  events: { id: string; name: string; budgetLines: { id: string; label: string }[] }[]
  currencies: string[]
  /** Rate to base currency today per currency code (null when none). */
  rates: { currency: string; rate: number | null }[]
  matchTolerancePct: number
}

/* ---------------- purchase orders ---------------- */

export type PoStatus = 'draft' | 'pending_approval' | 'rejected' | 'approved' | 'partially_received' | 'received' | 'closed' | 'cancelled'
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  rejected: 'Rejected',
  approved: 'Approved',
  partially_received: 'Partially received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

export interface PoLineInput {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  taxCodeId?: string | null
  accountId?: string | null
  departmentId?: string | null
  projectId?: string | null
  eventId?: string | null
  budgetLineId?: string | null
}

export interface PoLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  taxCodeId: string
  accountId: string
  departmentId: string | null
  projectId: string | null
  eventId: string | null
  budgetLineId: string | null
  net: number
  taxAmount: number
  total: number
  receivedQty: number
  billedQty: number
}

export interface PoInput {
  vendorId: string
  departmentId?: string | null
  orderDate?: string
  expectedDate?: string | null
  currency?: string
  exchangeRate?: number | null
  notes?: string
  deliveryAddress?: string
  lines: PoLineInput[]
}

export interface PoRow {
  id: string
  number: string
  status: PoStatus
  vendorId: string
  vendorName: string
  requesterId: string
  requesterName: string
  departmentId: string | null
  departmentName: string
  orderDate: string
  expectedDate: string | null
  currency: string
  total: number
  baseTotal: number
  /** Index of the step waiting for a decision (pending only), its approver kind, and whether the caller can act. */
  pendingStep: ApproverKind | null
  awaitingMe: boolean
  mine: boolean
  createdAt: string
}

export interface PoReceipt {
  id: string
  date: string
  byName: string
  note: string
  lines: { lineId: string; description: string; quantity: number }[]
}

export interface PurchaseOrder extends Omit<PoRow, 'pendingStep'> {
  pendingStep: ApproverKind | null
  exchangeRate: number
  lines: PoLine[]
  subtotal: number
  taxTotal: number
  notes: string
  deliveryAddress: string
  approvals: ApprovalStepView[]
  rejectionReason: string | null
  cancelReason: string | null
  receipts: PoReceipt[]
  bills: { id: string; number: string; status: BillStatus; total: number }[]
  history: HistoryEntry[]
  vendorEmail: string
  vendorAddress: string
  vendorVatNumber: string
  company: { name: string; legalName: string; vatNumber: string; address: string }
  can: { edit: boolean; submit: boolean; approve: boolean; reject: boolean; cancel: boolean; receive: boolean; close: boolean; bill: boolean; delete: boolean }
}

/* ---------------- bills ---------------- */

export type BillStatus = 'draft' | 'pending_approval' | 'rejected' | 'open' | 'partially_paid' | 'paid' | 'void'
export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  rejected: 'Rejected',
  open: 'Open',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
}

export interface BillLineInput extends PoLineInput {
  poLineId?: string | null
}

export interface BillLine extends Omit<PoLine, 'receivedQty' | 'billedQty'> {
  poLineId: string | null
  /** VAT goes to VAT input only when the supplier has a VAT number and the tax code is standard; else it is part of the cost. */
  vatRecoverable: boolean
}

export type MatchKind = 'none' | 'two_way' | 'three_way'
export interface MatchIssue {
  lineId: string
  description: string
  kind: 'price' | 'quantity' | 'not_received'
  message: string
}
export interface MatchResult {
  kind: MatchKind
  ok: boolean
  tolerancePct: number
  issues: MatchIssue[]
}

export interface BillInput {
  vendorId?: string
  poId?: string | null
  supplierInvoiceNumber?: string
  billDate?: string
  dueDate?: string | null
  currency?: string
  exchangeRate?: number | null
  notes?: string
  lines?: BillLineInput[]
}

export interface BillRow {
  id: string
  number: string
  supplierInvoiceNumber: string
  status: BillStatus
  overdue: boolean
  daysOverdue: number
  vendorId: string
  vendorName: string
  poId: string | null
  poNumber: string | null
  billDate: string
  dueDate: string
  currency: string
  exchangeRate: number
  total: number
  amountPaid: number
  amountCredited: number
  balanceDue: number
  baseTotal: number
  baseBalanceDue: number
  pendingStep: ApproverKind | null
  awaitingMe: boolean
  matchOk: boolean | null
  attachmentCount: number
  createdAt: string
}

export interface BillAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
  uploadedByName: string
  uploadedAt: string
}

export interface JournalView {
  id: string
  number: string
  date: string
  status: 'posted' | 'reversed'
  memo: string
  lines: { accountId: string; accountCode: string; accountName: string; debit: number; credit: number; description: string }[]
}

export interface Bill extends BillRow {
  termsDays: number
  lines: BillLine[]
  subtotal: number
  taxTotal: number
  recoverableTax: number
  notes: string
  vendorVatNumber: string
  requesterName: string
  departmentId: string | null
  match: MatchResult
  approvals: ApprovalStepView[]
  rejectionReason: string | null
  voidReason: string | null
  journal: JournalView | null
  voidJournal: JournalView | null
  payments: { id: string; number: string; date: string; amount: number; status: 'posted' | 'void' }[]
  debitNotes: { id: string; number: string; date: string; total: number; reason: string }[]
  attachments: BillAttachment[]
  history: HistoryEntry[]
  can: { edit: boolean; submit: boolean; post: boolean; approve: boolean; reject: boolean; void: boolean; pay: boolean; debitNote: boolean; attach: boolean; delete: boolean }
}

export interface AttachmentInput {
  name: string
  mimeType: string
  dataUrl: string
}

/* ---------------- debit notes ---------------- */

export interface DebitNoteInput {
  billId: string
  date?: string
  reason: string
  /** Gross amount (incl. VAT) in the bill's currency; ≤ the bill's balance. */
  amount: number
  accountId?: string | null
}

export interface DebitNote {
  id: string
  number: string
  billId: string
  billNumber: string
  vendorId: string
  vendorName: string
  date: string
  reason: string
  currency: string
  exchangeRate: number
  net: number
  taxAmount: number
  total: number
  accountId: string
  journalEntryId: string | null
  createdAt: string
}

/* ---------------- bill payments ---------------- */

export type BillPaymentMethod = 'bank_transfer' | 'cheque' | 'cash'
export const BILL_PAYMENT_METHOD_LABEL: Record<BillPaymentMethod, string> = { bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' }

export interface BillPaymentInput {
  vendorId: string
  date?: string
  paymentAccountId: string
  method?: BillPaymentMethod
  reference?: string
  /** Rate of the bills' currency on the payment date (default: Finance settings). */
  exchangeRate?: number | null
  /** Bank charges in base currency (Dr bank charges / Cr the payment account). */
  bankCharges?: number
  allocations: { billId: string; amount: number }[]
  notes?: string
}

export interface PaymentRunInput {
  date?: string
  paymentAccountId: string
  method?: BillPaymentMethod
  reference?: string
  items: { billId: string; amount: number }[]
}

export interface BillPayment {
  id: string
  number: string
  status: 'posted' | 'void'
  vendorId: string
  vendorName: string
  vendorBankName: string
  vendorIbanMasked: string
  date: string
  method: BillPaymentMethod
  reference: string
  paymentAccountId: string
  paymentAccountName: string
  currency: string
  exchangeRate: number
  amount: number
  baseAmount: number
  bankCharges: number
  fxDifference: number
  runId: string | null
  allocations: { billId: string; billNumber: string; supplierInvoiceNumber: string; amount: number }[]
  notes: string
  journal: JournalView | null
  voidReason: string | null
  createdByName: string
  createdAt: string
  company: { name: string; legalName: string; vatNumber: string; address: string }
}

export interface PaymentRun {
  id: string
  number: string
  date: string
  paymentAccountId: string
  paymentIds: string[]
  payments: BillPayment[]
  totalBase: number
  createdByName: string
  createdAt: string
}

/* ---------------- payables ---------------- */

export type ApBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90'
export const AP_BUCKETS: ApBucket[] = ['current', 'd30', 'd60', 'd90', 'over90']
export const AP_BUCKET_LABEL: Record<ApBucket, string> = { current: 'Current', d30: '1–30', d60: '31–60', d90: '61–90', over90: '90+' }
export type ApAmounts = Record<ApBucket, number> & { total: number }

export interface ApAgingRow extends ApAmounts {
  vendorId: string
  vendorName: string
  bills: { id: string; number: string; supplierInvoiceNumber: string; dueDate: string; currency: string; balance: number; balanceBase: number; daysOverdue: number; bucket: ApBucket }[]
}

export interface ApAging {
  asOf: string
  baseCurrency: string
  rows: ApAgingRow[]
  totals: ApAmounts
}

export interface DueBill {
  id: string
  number: string
  supplierInvoiceNumber: string
  vendorId: string
  vendorName: string
  dueDate: string
  currency: string
  balanceDue: number
  baseBalanceDue: number
  overdue: boolean
}

export interface SupplierStatement {
  vendorId: string
  vendorName: string
  vendorVatNumber: string
  from: string
  to: string
  baseCurrency: string
  openingBalance: number
  lines: { date: string; type: 'bill' | 'payment' | 'debit_note' | 'void'; reference: string; description: string; debit: number; credit: number; balance: number }[]
  closingBalance: number
  company: { name: string; legalName: string; vatNumber: string; address: string }
}

export interface PayablesOverview {
  baseCurrency: string
  openBase: number
  openCount: number
  overdueBase: number
  overdueCount: number
  dueThisWeekBase: number
  dueThisWeekCount: number
  pendingBillApprovals: number
  pendingPoApprovals: number
  openPoCount: number
}

/* ---------------- approval rules (settings) ---------------- */

export interface ApprovalRulesView {
  baseCurrency: string
  rules: { docType: SpendDocType; minAmount: number; approver: ApproverKind }[]
  docTypes: { id: SpendDocType; label: string }[]
  matchTolerancePct: number
  canEdit: boolean
  updatedAt: string | null
  updatedByName: string | null
}

export interface ApprovalRulesInput {
  docType: SpendDocType
  rules: { minAmount: number; approver: ApproverKind }[]
  matchTolerancePct?: number
}

/* ---------------- event costs (seam with Events › budget) ---------------- */

export interface EventBilledCosts {
  eventId: string
  baseCurrency: string
  lines: { budgetLineId: string; label: string; planned: number; actual: number; billed: number }[]
  unlinkedBilled: number
  totalBilled: number
}
