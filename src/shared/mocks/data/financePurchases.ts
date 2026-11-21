import type { ApprovalStep } from '@/shared/mocks/services/financeApprovals'
import type { BillLine, BillPaymentMethod, BillStatus, HistoryEntry, PoLine, PoStatus } from '@/modules/finance/purchases/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { perTenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › Purchases & payables stores (docs/API.md › Finance › Suppliers / Purchase orders / Bills).
 * Suppliers ARE the event vendor directory (data/eventLibrary.ts `eventVendors`); this section only keeps a finance
 * profile per vendor id. The IBAN is stored in full and served masked ("•••• 1234"); the audited reveal is the only
 * place it leaves the server. Synthetic data only.
 */

export interface SupplierProfileRecord {
  vendorId: string
  vatNumber: string
  paymentTermsDays: number
  defaultExpenseAccountId: string | null
  defaultTaxCodeId: string | null
  currency: string
  bankName: string
  iban: string
  notes: string
  updatedAt: string
  updatedBy: string | null
}

export interface ApprovalDecision {
  index: number
  decision: 'approved' | 'rejected'
  by: string
  at: string
  reason: string
}

/** Approval state shared by POs and bills: the chain is frozen when the document is submitted. */
export interface ApprovalState {
  requesterId: string
  departmentId: string | null
  chain: ApprovalStep[]
  decisions: ApprovalDecision[]
  approvedBy: string[]
  /** `${index}` marks of steps whose approvers were notified (once only). */
  notifiedSteps: number[]
}

export interface PoReceiptRecord {
  id: string
  date: string
  by: string
  note: string
  lines: { lineId: string; quantity: number }[]
}

export interface PoRecord extends ApprovalState {
  id: string
  number: string
  status: PoStatus
  vendorId: string
  orderDate: string
  expectedDate: string | null
  currency: string
  exchangeRate: number
  lines: Omit<PoLine, 'billedQty'>[]
  subtotal: number
  taxTotal: number
  total: number
  notes: string
  deliveryAddress: string
  rejectionReason: string | null
  cancelReason: string | null
  receipts: PoReceiptRecord[]
  history: HistoryEntry[]
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  approvedAt: string | null
  closedAt: string | null
}

export interface BillAttachmentRecord {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
  uploadedBy: string
  uploadedAt: string
}

export interface BillRecord extends ApprovalState {
  id: string
  number: string
  supplierInvoiceNumber: string
  status: BillStatus
  vendorId: string
  poId: string | null
  billDate: string
  dueDate: string
  termsDays: number
  currency: string
  exchangeRate: number
  /** VAT number of the supplier when the bill was entered (decides VAT recoverability). */
  vendorVatNumber: string
  lines: BillLine[]
  subtotal: number
  taxTotal: number
  total: number
  /** Kept current only through `applyToBill` (services/financeBillBalance.ts). */
  amountPaid: number
  amountCredited: number
  balanceDue: number
  notes: string
  journalEntryId: string | null
  voidJournalEntryId: string | null
  rejectionReason: string | null
  voidReason: string | null
  attachments: BillAttachmentRecord[]
  history: HistoryEntry[]
  dueSoonNotifiedAt: string | null
  createdAt: string
  updatedAt: string
  postedAt: string | null
  voidedAt: string | null
}

export interface DebitNoteRecord {
  id: string
  number: string
  billId: string
  vendorId: string
  date: string
  reason: string
  currency: string
  exchangeRate: number
  net: number
  taxAmount: number
  total: number
  accountId: string
  journalEntryId: string | null
  createdBy: string | null
  createdAt: string
}

export interface BillPaymentRecord {
  id: string
  number: string
  status: 'posted' | 'void'
  vendorId: string
  date: string
  method: BillPaymentMethod
  reference: string
  paymentAccountId: string
  currency: string
  exchangeRate: number
  amount: number
  bankCharges: number
  fxDifference: number
  runId: string | null
  allocations: { billId: string; amount: number }[]
  notes: string
  journalEntryId: string | null
  voidJournalEntryId: string | null
  voidReason: string | null
  voidedAt: string | null
  createdBy: string | null
  createdAt: string
}

export interface PaymentRunRecord {
  id: string
  number: string
  date: string
  paymentAccountId: string
  paymentIds: string[]
  createdBy: string | null
  createdAt: string
}

export const finSupplierProfiles = registerArray<Tenant<SupplierProfileRecord>>('fin.supplierProfiles', [])
export const finPurchaseOrders = registerArray<Tenant<PoRecord>>('fin.purchaseOrders', [])
export const finBills = registerArray<Tenant<BillRecord>>('fin.bills', [])
export const finDebitNotes = registerArray<Tenant<DebitNoteRecord>>('fin.debitNotes', [])
export const finBillPayments = registerArray<Tenant<BillPaymentRecord>>('fin.billPayments', [])
export const finPaymentRuns = registerArray<Tenant<PaymentRunRecord>>('fin.paymentRuns', [])

/** Per-company purchases settings: match tolerance and who last edited the approval rules. */
export const finPurchasesSettings = perTenant(
  () => ({ matchTolerancePct: 2, rulesUpdatedAt: null as string | null, rulesUpdatedBy: null as string | null }),
  'fin.purchasesSettings',
)

/** Bytes of bill attachments of a company: part of the plan's storageMb (services/billing.ts). */
export function purchasesStorageBytes(companyId: string): number {
  let bytes = 0
  for (const b of finBills) if (b.companyId === companyId) for (const a of b.attachments) bytes += a.sizeBytes
  return bytes
}
