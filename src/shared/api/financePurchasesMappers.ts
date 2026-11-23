import { defineMapper } from './mapping'
import type {
  ApAging,
  ApprovalRulesInput,
  ApprovalRulesView,
  AttachmentInput,
  Bill,
  BillInput,
  BillPayment,
  BillPaymentInput,
  BillRow,
  DebitNote,
  DebitNoteInput,
  DueBill,
  EventBilledCosts,
  PayablesOverview,
  PaymentRun,
  PaymentRunInput,
  PoInput,
  PoRow,
  PurchaseOrder,
  PurchasesMeta,
  SupplierCreateInput,
  SupplierDetail,
  SupplierProfileInput,
  SupplierRow,
  SupplierStatement,
  SupplierAdvance,
  SupplierAdvanceInput,
  PaymentRunFile,
} from '@/modules/finance/purchases/types'

/**
 * Wire names of Accounts & finance › Purchases & payables (docs/API.md › Finance › Suppliers / Purchase orders / Bills /
 * Approval rules): plain snake_case at any depth (vendor_id, po_line_id, supplier_invoice_number, payment_account_id…).
 * No maps keyed by data.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const supplierRowMapper = deep<SupplierRow>()
export const supplierDetailMapper = deep<SupplierDetail>()
export const supplierProfileInputMapper = deep<SupplierProfileInput>()
export const supplierCreateInputMapper = deep<SupplierCreateInput>()
export const supplierStatementMapper = deep<SupplierStatement>()
export const purchasesMetaMapper = deep<PurchasesMeta>()
export const poRowMapper = deep<PoRow>()
export const poMapper = deep<PurchaseOrder>()
export const poInputMapper = deep<PoInput>()
export const billRowMapper = deep<BillRow>()
export const billMapper = deep<Bill>()
export const billInputMapper = deep<BillInput>()
export const attachmentInputMapper = deep<AttachmentInput>()
export const debitNoteMapper = deep<DebitNote>()
export const debitNoteInputMapper = deep<DebitNoteInput>()
export const billPaymentMapper = deep<BillPayment>()
export const billPaymentInputMapper = deep<BillPaymentInput>()
export const paymentRunMapper = deep<PaymentRun>()
export const paymentRunInputMapper = deep<PaymentRunInput>()
export const apAgingMapper = deep<ApAging>()
export const dueBillMapper = deep<DueBill>()
export const payablesOverviewMapper = deep<PayablesOverview>()
export const approvalRulesMapper = deep<ApprovalRulesView>()
export const approvalRulesInputMapper = deep<ApprovalRulesInput>()
export const eventCostsMapper = deep<EventBilledCosts>()
export const supplierAdvanceMapper = deep<SupplierAdvance>()
export const supplierAdvanceInputMapper = deep<SupplierAdvanceInput>()
export const paymentRunFileMapper = deep<PaymentRunFile>()
/** Small bodies / answers ({ reason }, { iban }, { id }, receipts). */
export const purchasesPlainMapper = deep<Record<string, unknown>>()
