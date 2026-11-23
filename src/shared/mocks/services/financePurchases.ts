import type { User } from '@/shared/types'
import type {
  ApAging,
  ApprovalRulesInput,
  ApprovalRulesView,
  ApprovalStepView,
  AttachmentInput,
  Bill,
  BillInput,
  BillPayment,
  BillPaymentInput,
  BillPaymentMethod,
  BillRow,
  DebitNote,
  DebitNoteInput,
  DueBill,
  EventBilledCosts,
  JournalView,
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
  SpendDocType,
  ApproverKind,
} from '@/modules/finance/purchases/types'
import { isIsoDay, toBase } from '@/modules/finance/invoices/calc'
import { isOpenBill, isValidIban, maskIban, round2 } from '@/modules/finance/purchases/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { projects } from '@/shared/mocks/data/tasks'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { financeAccounts, financeJournal, financeTaxCodes } from '@/shared/mocks/data/finance'
import { recordAudit } from '@/shared/mocks/data/audit'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import {
  finBillPayments,
  finBills,
  finDebitNotes,
  finPaymentRuns,
  finPurchaseOrders,
  finPurchasesSettings,
  finSupplierProfiles,
  finSupplierAdvances,
  type ApprovalState,
  type SupplierAdvanceRecord,
  type PaymentRunRecord,
  type BillPaymentRecord,
  type BillRecord,
  type PoRecord,
} from '@/shared/mocks/data/financePurchases'
import '@/shared/mocks/data/financePurchasesSeed'
import { finBankAccounts } from '@/shared/mocks/data/financeBanking'
import { PAYMENT_FILE_TEMPLATE_DEF, buildPaymentFile, columnsFor, defaultLocalTemplate, type PaymentFileRow, type PaymentFileTemplate } from '@/modules/finance/purchases/bankFile'
import { cleanVendor } from './eventLibraryCore'
import { SPEND_DOC_LABEL, approvalRules, assertCanApprove, departmentHeadOf, paymentAccountsOf } from './financeApprovals'
import { assertCapacity, onLifecycleTick } from './billing'
import { runFinanceHooks } from './ledger'
import { registerJournalSource } from './financeLedger'
import { baseCurrencyOf, rateFor } from './financeRates'
import { invoiceSettingsFor } from './financeInvoiceSettings'
import { isBillOverdue } from './financeBillBalance'
import {
  accountOf,
  actorOf,
  apAgingOf,
  applyTotals,
  approveBillCore,
  approvePoCore,
  billOf,
  buildLines,
  canActOn,
  canDirectPost,
  cleanCurrency,
  conflict,
  currentStep,
  approversOf,
  debitNoteCore,
  dueBillsOf,
  effectiveProfile,
  ensureProfile,
  eventBilledCostsOf,
  hist,
  isPurchaseAccount,
  linesFromPo,
  matchOf,
  newBillRecord,
  newPoRecord,
  newRunRecord,
  bad,
  paymentCore,
  payablesOverview,
  poOf,
  postBillCore,
  prefixOf,
  rateOrDefault,
  receivePoCore,
  recoverableTaxOf,
  refreshPoStatus,
  rejectBillCore,
  rejectPoCore,
  runBillDueReminders,
  statementOf,
  submitBillCore,
  submitPoCore,
  supplierBalances,
  supplierInvoiceTaken,
  taxOf,
  todayOf,
  userName,
  vendorName,
  vendorOf,
  voidBillCore,
  voidPaymentCore,
  voidDebitNoteCore,
  advanceCore,
  applyAdvanceCore,
  refundAdvanceCore,
  advanceOf,
  advanceApplied,
  advanceRefunded,
  advanceRemaining,
  unappliedAdvancesBase,
  departmentName,
  billedQtyOf,
} from './financePurchasesCore'

/**
 * Accounts & finance › Purchases & payables (docs/API.md › Finance › Suppliers, Purchase orders, Bills, Approval rules).
 * Plan module `accounting` (the /finance path gate). The company comes from the session; a foreign id answers 404 like
 * a missing one; ids in bodies (vendor, PO, bill, account, department, project, event, budget line) are looked up in
 * the caller's company only.
 *
 * ACCESS (PERMISSION_MATRIX `accounting`)
 *   full    (Company Admin, Management, Accountant) everything
 *   view    (Sales Manager) reads suppliers, POs, bills, payments, payables (no IBAN reveal, no writes)
 *   any employee (incl. hidden) — SELF-SERVICE PURCHASE REQUESTS: creates PO requests for their OWN department, sees and
 *           edits / submits / cancels / receives their own POs; a department head also sees their department's POs.
 *   approvers — whoever `canApproveStep` allows for the step waiting (department head without accounting access too):
 *           sees that PO / bill and approves or rejects it. Maker–checker: never their own request; one step per user.
 *   approval rules: read full / view; edit Company Admin and Accountant (audited).
 */

export const PURCHASES_FORBIDDEN = 'Accounts & finance is for the finance team. Ask your Company Admin for access.'
export const PURCHASES_WRITE_ONLY = 'Only a Company Admin, Management or an Accountant can do this.'
const RULE_EDITORS = new Set(['Company Admin', 'Accountant'])
const MAX_ATTACHMENT_BYTES = 512 * 1024
const ATTACHMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

export type Scope = 'full' | 'view' | 'hidden'
export function scopeOfUser(user: User): Scope {
  runFinanceHooks(tenantOf(user))
  const s = scopeOf(user.role, 'accounting')
  return s === 'full' ? 'full' : s === 'hidden' ? 'hidden' : 'view'
}
export function readCo(user: User): string {
  if (scopeOfUser(user) === 'hidden') throw new CodedApiError(PURCHASES_FORBIDDEN, 403, 'forbidden')
  return tenantOf(user)
}
export function fullCo(user: User): string {
  const s = scopeOfUser(user)
  if (s === 'hidden') throw new CodedApiError(PURCHASES_FORBIDDEN, 403, 'forbidden')
  if (s !== 'full') throw new CodedApiError(PURCHASES_WRITE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}
export const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
export const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const at = () => nowIso()
export const dateOr = (co: string, v: unknown, field: string): string => {
  if (v === undefined || v === null || v === '') return todayOf(co)
  if (!isIsoDay(v)) return bad(`${field} must be a date (yyyy-MM-dd).`, 'invalid_date')
  return v
}
export const reasonOf = (input: { reason?: unknown } | null, what: string): string => {
  const r = str(input?.reason, 500)
  if (r.length < 3) bad(`Give a reason for the ${what} (at least 3 characters).`, 'reason_required')
  return r
}
export function companyBlock(co: string) {
  const s = invoiceSettingsFor(co)
  return { name: companyById(co)?.name ?? s.legalName, legalName: s.legalName, vatNumber: s.vatNumber, address: s.addressLines.join(', ') }
}
const self = (u: User) => ({ ...actorOf(u), id: u.id })

/* ================= views ================= */

export function journalView(co: string, id: string | null): JournalView | null {
  const e = id ? financeJournal.find((x) => x.companyId === co && x.id === id) : undefined
  if (!e) return null
  return {
    id: e.id,
    number: e.number,
    date: e.date,
    status: e.status,
    memo: e.memo,
    lines: e.lines.map((l) => {
      const a = accountOf(co, l.accountId)
      return { accountId: l.accountId, accountCode: a?.code ?? '', accountName: a?.name ?? l.accountId, debit: l.debit, credit: l.credit, description: l.description }
    }),
  }
}

function approvalsView(co: string, doc: ApprovalState & { status: string }): ApprovalStepView[] {
  return doc.chain.map((s) => {
    const d = doc.decisions.find((x) => x.index === s.index)
    const waiting = !d && doc.status === 'pending_approval' && currentStep(doc)?.index === s.index
    return {
      index: s.index,
      approver: s.approver as ApproverKind,
      minAmount: s.minAmount,
      approverNames: waiting ? approversOf(co, s, doc).map((u) => u.name) : [],
      decision: d?.decision ?? null,
      decidedByName: d ? userName(co, d.by) : null,
      decidedAt: d?.at ?? null,
      reason: d?.reason ?? '',
    }
  })
}

const pendingKind = (doc: ApprovalState & { status: string }) => (doc.status === 'pending_approval' ? ((currentStep(doc)?.approver as ApproverKind | undefined) ?? null) : null)

function poRow(user: User, po: PoRecord): PoRow {
  const co = tenantOf(user)
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    vendorId: po.vendorId,
    vendorName: vendorName(co, po.vendorId),
    requesterId: po.requesterId,
    requesterName: userName(co, po.requesterId),
    departmentId: po.departmentId,
    departmentName: departmentName(co, po.departmentId),
    orderDate: po.orderDate,
    expectedDate: po.expectedDate,
    currency: po.currency,
    total: po.total,
    baseTotal: toBase(po.total, po.exchangeRate),
    pendingStep: pendingKind(po),
    awaitingMe: canActOn(user, co, po),
    mine: po.requesterId === user.id,
    createdAt: po.createdAt,
  }
}

function poDetail(user: User, po: PoRecord): PurchaseOrder {
  const co = tenantOf(user)
  const s = scopeOfUser(user)
  const full = s === 'full'
  const owner = po.requesterId === user.id
  const v = vendorOf(co, po.vendorId)
  const prof = effectiveProfile(co, po.vendorId)
  const bills = finBills.filter((b) => b.companyId === co && b.poId === po.id)
  const editable = po.status === 'draft' || po.status === 'rejected'
  const receivable = po.status === 'approved' || po.status === 'partially_received'
  const awaiting = canActOn(user, co, po)
  const advances = finSupplierAdvances.filter((a) => a.companyId === co && a.poId === po.id)
  const advanceDue = po.advancePct ? round2((po.total * po.advancePct) / 100) : 0
  const advancePaid = round2(advances.reduce((sum, a) => sum + a.amount - advanceRefunded(a), 0))
  const open = ['approved', 'partially_received', 'received'].includes(po.status)
  return {
    ...poRow(user, po),
    exchangeRate: po.exchangeRate,
    advancePct: po.advancePct,
    advanceDue,
    advancePaid,
    // Amounts of the advances are finance data: the requester / approvers without accounting access see the % only.
    advances: s === 'hidden' ? [] : advances.map((a) => ({ id: a.id, number: a.number, date: a.date, amount: a.amount, remaining: advanceRemaining(a) })),
    lines: po.lines.map((l) => ({ ...l, billedQty: billedQtyOf(co, po.id, l.id) })),
    subtotal: po.subtotal,
    taxTotal: po.taxTotal,
    notes: po.notes,
    deliveryAddress: po.deliveryAddress,
    approvals: approvalsView(co, po),
    rejectionReason: po.rejectionReason,
    cancelReason: po.cancelReason,
    receipts: po.receipts.map((r) => ({ id: r.id, date: r.date, byName: userName(co, r.by), note: r.note, lines: r.lines.map((x) => ({ lineId: x.lineId, description: po.lines.find((l) => l.id === x.lineId)?.description ?? '', quantity: x.quantity })) })),
    bills: s === 'hidden' ? [] : bills.map((b) => ({ id: b.id, number: b.number, status: b.status, total: b.total })),
    history: po.history.map((h) => ({ ...h })),
    vendorEmail: v?.email ?? '',
    vendorAddress: '',
    vendorVatNumber: prof.vatNumber,
    company: companyBlock(co),
    can: {
      edit: editable && (full || owner),
      submit: editable && (full || owner),
      approve: awaiting,
      reject: awaiting,
      cancel: ['draft', 'pending_approval', 'rejected', 'approved'].includes(po.status) && po.receipts.length === 0 && bills.every((b) => b.status === 'void') && advances.every((a) => advanceRemaining(a) === 0) && (full || owner),
      receive: receivable && (full || owner),
      close: full && open,
      bill: full && open,
      delete: po.status === 'draft' && (full || owner),
      payAdvance: full && open && !!po.advancePct && advancePaid < advanceDue - 0.005,
    },
  }
}

function billRow(user: User, b: BillRecord): BillRow {
  const co = tenantOf(user)
  const today = todayOf(co)
  const overdue = isBillOverdue(b, today)
  const po = b.poId ? poOf(co, b.poId) : undefined
  return {
    id: b.id,
    number: b.number,
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    status: b.status,
    overdue,
    daysOverdue: overdue ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.dueDate}T00:00:00Z`)) / 86_400_000) : 0,
    vendorId: b.vendorId,
    vendorName: vendorName(co, b.vendorId),
    poId: b.poId,
    poNumber: po?.number ?? null,
    billDate: b.billDate,
    dueDate: b.dueDate,
    currency: b.currency,
    exchangeRate: b.exchangeRate,
    total: b.total,
    amountPaid: b.amountPaid,
    amountCredited: b.amountCredited,
    balanceDue: b.balanceDue,
    baseTotal: toBase(b.total, b.exchangeRate),
    baseBalanceDue: toBase(b.balanceDue, b.exchangeRate),
    pendingStep: pendingKind(b),
    awaitingMe: canActOn(user, co, b),
    matchOk: b.poId ? matchOf(co, b).ok : null,
    attachmentCount: b.attachments.length,
    createdAt: b.createdAt,
  }
}

function billDetail(user: User, b: BillRecord): Bill {
  const co = tenantOf(user)
  const full = scopeOfUser(user) === 'full'
  const editable = b.status === 'draft' || b.status === 'rejected'
  const open = isOpenBill(b.status)
  const payments = finBillPayments.filter((p) => p.companyId === co && p.allocations.some((a) => a.billId === b.id))
  const dns = finDebitNotes.filter((d) => d.companyId === co && d.billId === b.id)
  const vendorAdvances = finSupplierAdvances.filter((a) => a.companyId === co && a.vendorId === b.vendorId)
  const applied = vendorAdvances.flatMap((a) => a.applications.filter((x) => x.billId === b.id).map((x) => ({ a, date: x.date, amount: x.amount })))
  const availableAdvances = full
    ? vendorAdvances.filter((a) => a.currency === b.currency && advanceRemaining(a) > 0).map((a) => ({ id: a.id, number: a.number, date: a.date, remaining: advanceRemaining(a), currency: a.currency }))
    : []
  return {
    ...billRow(user, b),
    termsDays: b.termsDays,
    lines: b.lines.map((l) => ({ ...l })),
    subtotal: b.subtotal,
    taxTotal: b.taxTotal,
    recoverableTax: recoverableTaxOf(b),
    notes: b.notes,
    vendorVatNumber: b.vendorVatNumber,
    requesterName: userName(co, b.requesterId),
    departmentId: b.departmentId,
    match: matchOf(co, b),
    approvals: approvalsView(co, b),
    rejectionReason: b.rejectionReason,
    voidReason: b.voidReason,
    journal: journalView(co, b.journalEntryId),
    voidJournal: journalView(co, b.voidJournalEntryId),
    payments: payments.map((p) => ({ id: p.id, number: p.number, date: p.date, amount: p.allocations.filter((a) => a.billId === b.id).reduce((s, a) => s + a.amount, 0), status: p.status })),
    debitNotes: dns.map((d) => ({ id: d.id, number: d.number, date: d.date, total: d.total, reason: d.reason, status: d.status ?? 'posted', canVoid: full && d.status !== 'void' && b.status !== 'void' })),
    advances: applied.map((x) => ({ advanceId: x.a.id, number: x.a.number, date: x.date, amount: x.amount })),
    unappliedAdvances: availableAdvances,
    attachments: b.attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, dataUrl: a.dataUrl, uploadedByName: userName(co, a.uploadedBy), uploadedAt: a.uploadedAt })),
    history: b.history.map((h) => ({ ...h })),
    can: {
      edit: full && editable,
      submit: full && editable,
      post: full && canDirectPost(co, b),
      approve: canActOn(user, co, b),
      reject: canActOn(user, co, b),
      void: full && (open || b.status === 'paid') && !payments.some((p) => p.status === 'posted') && applied.length === 0 && dns.every((d) => d.status === 'void'),
      applyAdvance: full && open && b.balanceDue > 0 && availableAdvances.length > 0,
      pay: full && open && b.balanceDue > 0,
      debitNote: full && open && b.balanceDue > 0,
      attach: full && b.status !== 'void',
      delete: full && editable && !b.journalEntryId,
    },
  }
}

function paymentView(co: string, p: BillPaymentRecord): BillPayment {
  const prof = effectiveProfile(co, p.vendorId)
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    vendorId: p.vendorId,
    vendorName: vendorName(co, p.vendorId),
    vendorBankName: prof.bankName,
    vendorIbanMasked: maskIban(prof.iban),
    date: p.date,
    method: p.method,
    reference: p.reference,
    paymentAccountId: p.paymentAccountId,
    paymentAccountName: accountOf(co, p.paymentAccountId)?.name ?? p.paymentAccountId,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    amount: p.amount,
    baseAmount: toBase(p.amount, p.exchangeRate),
    bankCharges: p.bankCharges,
    fxDifference: p.fxDifference,
    runId: p.runId,
    allocations: p.allocations.map((a) => {
      const b = billOf(co, a.billId)
      return { billId: a.billId, billNumber: b?.number ?? a.billId, supplierInvoiceNumber: b?.supplierInvoiceNumber ?? '', amount: a.amount }
    }),
    notes: p.notes,
    journal: journalView(co, p.journalEntryId),
    voidReason: p.voidReason,
    createdByName: userName(co, p.createdBy),
    createdAt: p.createdAt,
    company: companyBlock(co),
  }
}

function debitNoteView(co: string, d: Tenant<import('@/shared/mocks/data/financePurchases').DebitNoteRecord>): DebitNote {
  return {
    id: d.id,
    number: d.number,
    billId: d.billId,
    billNumber: billOf(co, d.billId)?.number ?? d.billId,
    vendorId: d.vendorId,
    vendorName: vendorName(co, d.vendorId),
    date: d.date,
    reason: d.reason,
    currency: d.currency,
    exchangeRate: d.exchangeRate,
    net: d.net,
    taxAmount: d.taxAmount,
    total: d.total,
    accountId: d.accountId,
    journalEntryId: d.journalEntryId,
    status: d.status ?? 'posted',
    voidReason: d.voidReason ?? null,
    voidJournalEntryId: d.voidJournalEntryId ?? null,
    createdAt: d.createdAt,
  }
}

/* ================= suppliers ================= */

function supplierRow(co: string, vendorId: string, balances = supplierBalances(co)): SupplierRow {
  const v = vendorOf(co, vendorId)!
  const stored = finSupplierProfiles.find((p) => p.companyId === co && p.vendorId === vendorId)
  const p = effectiveProfile(co, vendorId)
  const bal = balances.get(vendorId)
  return {
    id: v.id,
    name: v.name,
    category: v.category,
    vendorStatus: v.status,
    contactName: v.contactName,
    email: v.email,
    hasProfile: !!stored,
    vatNumber: p.vatNumber,
    paymentTermsDays: p.paymentTermsDays,
    currency: p.currency,
    bankName: p.bankName,
    ibanMasked: maskIban(p.iban),
    openBills: bal?.count ?? 0,
    openBalanceBase: bal?.open ?? 0,
    overdueBase: bal?.overdue ?? 0,
    lastBillDate: bal?.last ?? null,
    advancesBase: unappliedAdvancesBase(co, vendorId),
  }
}

export function listSuppliers(user: User): SupplierRow[] {
  const co = readCo(user)
  const balances = supplierBalances(co)
  return eventVendors
    .filter((v) => v.companyId === co)
    .map((v) => supplierRow(co, v.id, balances))
    .sort((a, b) => b.openBalanceBase - a.openBalanceBase || a.name.localeCompare(b.name))
}

function supplierDetail(user: User, co: string, vendorId: string): SupplierDetail {
  const v = vendorOf(co, vendorId)!
  const p = effectiveProfile(co, vendorId)
  const full = scopeOfUser(user) === 'full'
  return {
    ...supplierRow(co, vendorId),
    mobile: v.mobile,
    website: v.website,
    defaultExpenseAccountId: p.defaultExpenseAccountId,
    defaultTaxCodeId: p.defaultTaxCodeId,
    notes: p.notes,
    swiftBic: p.swiftBic ?? '',
    advances: finSupplierAdvances
      .filter((a) => a.companyId === co && a.vendorId === vendorId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map((a) => advanceView(co, a)),
    bills: finBills.filter((b) => b.companyId === co && b.vendorId === vendorId).sort((a, b) => b.billDate.localeCompare(a.billDate)).slice(0, 50).map((b) => billRow(user, b)),
    purchaseOrders: finPurchaseOrders.filter((x) => x.companyId === co && x.vendorId === vendorId).sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 50).map((x) => poRow(user, x)),
    canEdit: full,
    canReveal: full && !!p.iban,
    updatedAt: finSupplierProfiles.find((x) => x.companyId === co && x.vendorId === vendorId)?.updatedAt || null,
  }
}

export function getSupplier(user: User, id: string): SupplierDetail {
  const co = readCo(user)
  if (!vendorOf(co, id)) notFound()
  return supplierDetail(user, co, id)
}

/** Validates a profile patch onto `p` (in place); returns the changed field names. */
function applyProfile(co: string, p: ReturnType<typeof ensureProfile>, input: SupplierProfileInput | null): string[] {
  const changed: string[] = []
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => {
    if (p[k] !== v) {
      changed.push(String(k))
      p[k] = v
    }
  }
  if (!input) return changed
  if (input.vatNumber !== undefined) {
    const vat = str(input.vatNumber, 30).replace(/\s+/g, '')
    if (vat && !/^[0-9A-Z]{8,20}$/i.test(vat)) bad('The VAT number has 8–20 letters or digits.', 'invalid_vat_number')
    set('vatNumber', vat)
  }
  if (input.paymentTermsDays !== undefined) {
    const t = Number(input.paymentTermsDays)
    if (!Number.isInteger(t) || t < 0 || t > 365) bad('Payment terms are 0–365 days.', 'invalid_terms')
    set('paymentTermsDays', t)
  }
  if (input.defaultExpenseAccountId !== undefined) {
    const id = input.defaultExpenseAccountId || null
    if (id && !isPurchaseAccount(co, id)) bad('Choose an active expense or asset account.', 'invalid_account')
    set('defaultExpenseAccountId', id)
  }
  if (input.defaultTaxCodeId !== undefined) {
    const id = input.defaultTaxCodeId || null
    if (id && !taxOf(co, id)?.active) bad('Unknown or inactive tax code.', 'invalid_tax_code')
    set('defaultTaxCodeId', id)
  }
  if (input.currency !== undefined) set('currency', cleanCurrency(co, input.currency, baseCurrencyOf(co)))
  if (input.bankName !== undefined) set('bankName', str(input.bankName, 120))
  if (input.iban !== undefined) {
    const iban = str(input.iban, 50).replace(/\s+/g, '').toUpperCase()
    if (iban && !isValidIban(iban)) bad('That IBAN isn’t valid (check the country code, length and check digits).', 'invalid_iban')
    if (p.iban !== iban) {
      changed.push('iban')
      p.iban = iban
    }
  }
  if (input.swiftBic !== undefined) {
    const bic = str(input.swiftBic, 20).replace(/\s+/g, '').toUpperCase()
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) bad('A SWIFT / BIC code has 8 or 11 letters and digits (e.g. EBILAEAD).', 'invalid_bic')
    set('swiftBic', bic)
  }
  if (input.notes !== undefined) set('notes', str(input.notes, 1000))
  return changed
}

export function updateSupplier(user: User, id: string, input: SupplierProfileInput | null): SupplierDetail {
  const co = fullCo(user)
  if (!vendorOf(co, id)) notFound()
  const p = ensureProfile(co, id)
  const before = { ...p }
  try {
    const changed = applyProfile(co, p, input)
    if (changed.length) {
      p.updatedAt = at()
      p.updatedBy = user.id
      recordAudit(user, {
        action: 'update',
        entity: 'supplier',
        entityId: id,
        summary: `Updated the finance profile of ${vendorName(co, id)}`,
        changes: changed.map((f) => (f === 'iban' ? { field: 'iban', from: maskIban(before.iban), to: maskIban(p.iban) } : { field: f, from: String(before[f as keyof typeof before] ?? ''), to: String(p[f as keyof typeof p] ?? '') })),
      })
    }
  } catch (e) {
    Object.assign(p, before)
    throw e
  }
  return supplierDetail(user, co, id)
}

export function createSupplier(user: User, input: SupplierCreateInput | null): SupplierDetail {
  const co = fullCo(user)
  const clean = cleanVendor(co, { category: (input?.category as never) || 'other', name: input?.name ?? '', contactName: input?.contactName, email: input?.email, mobile: input?.mobile, taxNumber: input?.vatNumber, paymentTerms: input?.paymentTermsDays !== undefined ? `${input.paymentTermsDays} days` : '' })
  if (typeof clean === 'string') bad(clean)
  const c = clean as Exclude<typeof clean, string>
  if (eventVendors.some((v) => v.companyId === co && v.name.trim().toLowerCase() === c.name.trim().toLowerCase())) conflict(`A supplier named ${c.name} already exists.`, 'vendor_exists')
  const now = at()
  const id = `VND-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  eventVendors.push({ companyId: co, id, ...c, reviews: [], createdBy: user.id, createdAt: now, updatedAt: now })
  const p = ensureProfile(co, id)
  try {
    applyProfile(co, p, input)
  } catch (e) {
    eventVendors.splice(eventVendors.findIndex((v) => v.id === id), 1)
    finSupplierProfiles.splice(finSupplierProfiles.indexOf(p), 1)
    throw e
  }
  p.updatedAt = now
  p.updatedBy = user.id
  recordAudit(user, { action: 'create', entity: 'supplier', entityId: id, summary: `Created supplier ${c.name} (vendor directory + finance profile)` })
  return supplierDetail(user, co, id)
}

/** POST /finance/suppliers/:id/reveal-iban — accounting full only; audited. */
export function revealSupplierIban(user: User, id: string): { iban: string } {
  const co = fullCo(user)
  if (!vendorOf(co, id)) notFound()
  const iban = effectiveProfile(co, id).iban
  if (!iban) conflict('No IBAN is stored for this supplier.', 'no_iban')
  recordAudit(user, { action: 'security', entity: 'supplier', entityId: id, summary: `Revealed the IBAN of ${vendorName(co, id)} (${maskIban(iban)})` })
  return { iban }
}

export function supplierStatement(user: User, id: string, q: { from?: string | null; to?: string | null }): SupplierStatement {
  const co = readCo(user)
  if (!vendorOf(co, id)) notFound()
  const to = dateOr(co, q.to, 'to')
  const from = q.from ? dateOr(co, q.from, 'from') : `${to.slice(0, 4)}-01-01`
  if (from > to) bad('“From” is after “to”.', 'invalid_range')
  return { ...statementOf(co, id, from, to), vendorName: vendorName(co, id), vendorVatNumber: effectiveProfile(co, id).vatNumber, company: companyBlock(co) }
}

/* ================= meta ================= */

export function purchasesMeta(user: User): PurchasesMeta {
  const s = scopeOfUser(user)
  const co = tenantOf(user)
  const base = baseCurrencyOf(co)
  const today = todayOf(co)
  const currencies = [...new Set([base, 'USD', 'EUR', ...financeSettingsRates(co)])]
  return {
    baseCurrency: base,
    documentPrefix: prefixOf(co),
    today,
    scope: s,
    canManage: s === 'full',
    myDepartmentId: user.departmentId || null,
    suppliers: eventVendors
      .filter((v) => v.companyId === co && v.status !== 'blacklisted')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => {
        const p = effectiveProfile(co, v.id)
        return { id: v.id, name: v.name, status: v.status, currency: p.currency, paymentTermsDays: p.paymentTermsDays, vatNumber: p.vatNumber, defaultExpenseAccountId: p.defaultExpenseAccountId, defaultTaxCodeId: p.defaultTaxCodeId }
      }),
    accounts: financeAccounts.filter((a) => a.companyId === co && isPurchaseAccount(co, a.id)).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type })),
    paymentAccounts: s === 'hidden' ? [] : paymentAccountsOf(co).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    taxCodes: financeTaxCodes.filter((t) => t.companyId === co && t.active).map((t) => ({ id: t.id, name: t.name, rate: t.rate, category: t.category })),
    departments: departments.filter((d) => d.companyId === co && d.active !== false).map((d) => ({ id: d.id, name: d.name })),
    projects: projects.filter((p) => p.companyId === co).map((p) => ({ id: p.id, name: p.name })),
    events: events
      .filter((e) => e.companyId === co && e.status !== 'cancelled')
      .map((e) => ({ id: e.id, name: e.name, budgetLines: eventBudgetLines.filter((l) => l.companyId === co && l.eventId === e.id).map((l) => ({ id: l.id, label: `${l.category}${l.note ? ` · ${l.note}` : ''}` })) })),
    currencies,
    rates: currencies.map((c) => ({ currency: c, rate: rateFor(co, c, today) })),
    matchTolerancePct: finPurchasesSettings.get(co).matchTolerancePct,
  }
}
function financeSettingsRates(co: string): string[] {
  return [...new Set(financeAccounts.filter((a) => a.companyId === co && a.currency).map((a) => a.currency!))]
}

/* ================= purchase orders ================= */

/** May `user` see this PO? Finance (full / view) all; others their own, their department's (as its head) and the ones waiting for them or decided by them. */
function canSeePo(user: User, po: PoRecord, s: Scope): boolean {
  if (s !== 'hidden') return true
  const co = tenantOf(user)
  return po.requesterId === user.id || departmentHeadOf(co, po.departmentId) === user.id || canActOn(user, co, po) || po.decisions.some((d) => d.by === user.id)
}
function visiblePo(user: User, id: string): PoRecord {
  const s = scopeOfUser(user)
  const po = poOf(tenantOf(user), id)
  if (!po || !canSeePo(user, po, s)) notFound()
  return po!
}
function assertOwnerOrFull(user: User, po: PoRecord): void {
  if (scopeOfUser(user) !== 'full' && po.requesterId !== user.id) throw new CodedApiError('Only the requester or the finance team can do this.', 403, 'forbidden')
}

export function listPurchaseOrders(user: User, q: { status?: string | null; vendorId?: string | null; view?: string | null } = {}): PoRow[] {
  const s = scopeOfUser(user)
  const co = tenantOf(user)
  return finPurchaseOrders
    .filter((p) => p.companyId === co && canSeePo(user, p, s))
    .filter((p) => !q.status || (q.status === 'open' ? ['approved', 'partially_received', 'received'].includes(p.status) : p.status === q.status))
    .filter((p) => !q.vendorId || p.vendorId === q.vendorId)
    .filter((p) => q.view !== 'mine' || p.requesterId === user.id)
    .filter((p) => q.view !== 'awaiting' || canActOn(user, co, p))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((p) => poRow(user, p))
}

export function getPurchaseOrder(user: User, id: string): PurchaseOrder {
  return poDetail(user, visiblePo(user, id))
}

function poFields(user: User, co: string, input: Partial<PoInput> | null, existing?: PoRecord) {
  const s = scopeOfUser(user)
  const vendorId = input?.vendorId ?? existing?.vendorId
  const v = vendorOf(co, vendorId)
  if (!v) bad('Choose a supplier.', 'vendor_not_found')
  if (v!.status === 'blacklisted' && v!.id !== existing?.vendorId) bad(`${v!.name} is blacklisted in the vendor directory.`, 'vendor_blacklisted')
  let departmentId: string | null = existing ? existing.departmentId : user.departmentId || null
  if (input && input.departmentId !== undefined) {
    const want = input.departmentId || null
    if (want && !departments.some((d) => d.companyId === co && d.id === want)) bad('Department not found.', 'department_not_found')
    // Self-service: anyone outside finance requests for their OWN department only.
    if (s !== 'full' && want !== (user.departmentId || null)) throw new CodedApiError('You can request purchases for your own department only.', 403, 'own_department_only')
    departmentId = want
  }
  const orderDate = input?.orderDate !== undefined ? dateOr(co, input.orderDate, 'Order date') : (existing?.orderDate ?? todayOf(co))
  const expectedDate = input?.expectedDate !== undefined ? (input.expectedDate ? dateOr(co, input.expectedDate, 'Expected date') : null) : (existing?.expectedDate ?? null)
  const currency = cleanCurrency(co, input?.currency, existing?.currency ?? effectiveProfile(co, v!.id).currency)
  const exchangeRate = rateOrDefault(co, currency, input?.exchangeRate, orderDate)
  let advancePct = existing?.advancePct ?? null
  if (input && input.advancePct !== undefined) {
    const raw = input.advancePct
    if (raw === null || (raw as unknown) === '' || Number(raw) === 0) advancePct = null
    else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0 || n > 100) bad('The advance is 1–100 % of the order.', 'invalid_advance_pct')
      advancePct = Math.round(n * 100) / 100
    }
  }
  return { vendorId: v!.id, departmentId, orderDate, expectedDate, currency, exchangeRate, advancePct, notes: input?.notes !== undefined ? str(input.notes) : (existing?.notes ?? ''), deliveryAddress: input?.deliveryAddress !== undefined ? str(input.deliveryAddress, 500) : (existing?.deliveryAddress ?? '') }
}

/** POST /finance/purchase-orders — any employee (self-service request for their own department). */
export function createPurchaseOrder(user: User, input: PoInput | null): PurchaseOrder {
  scopeOfUser(user)
  const co = tenantOf(user)
  const f = poFields(user, co, input)
  const po = newPoRecord(co, { ...f, requester: self(user), lines: input?.lines, at: at() })
  return poDetail(user, po)
}

export function updatePurchaseOrder(user: User, id: string, input: Partial<PoInput> | null): PurchaseOrder {
  const po = visiblePo(user, id)
  assertOwnerOrFull(user, po)
  if (po.status !== 'draft' && po.status !== 'rejected') conflict('Only a draft or rejected request can be edited.', 'not_editable')
  const co = tenantOf(user)
  const f = poFields(user, co, input, po)
  const lines = input?.lines !== undefined ? buildLines(co, po.id, input.lines, { vendorId: f.vendorId, vatNumber: effectiveProfile(co, f.vendorId).vatNumber }).map(({ poLineId: _p, vatRecoverable: _v, ...l }) => ({ ...l, receivedQty: 0 })) : po.lines // eslint-disable-line @typescript-eslint/no-unused-vars
  Object.assign(po, f, { lines, updatedAt: at() })
  applyTotals(po)
  po.history.push(hist(actorOf(user), 'edited', 'Request edited', po.updatedAt))
  return poDetail(user, po)
}

export function deletePurchaseOrder(user: User, id: string): { id: string } {
  const po = visiblePo(user, id)
  assertOwnerOrFull(user, po)
  if (po.status !== 'draft') conflict('Only a draft can be deleted; cancel it instead.', 'not_draft')
  finPurchaseOrders.splice(finPurchaseOrders.indexOf(po as Tenant<PoRecord>), 1)
  return { id }
}

export function submitPurchaseOrder(user: User, id: string): PurchaseOrder {
  const po = visiblePo(user, id)
  assertOwnerOrFull(user, po)
  submitPoCore(tenantOf(user), po, actorOf(user), at())
  return poDetail(user, po)
}

function assertStep(user: User, doc: ApprovalState & { status: string }): void {
  if (doc.status !== 'pending_approval') conflict('Nothing is waiting for approval on this document.', 'not_pending')
  assertCanApprove(user, currentStep(doc)!, { companyId: tenantOf(user), requesterId: doc.requesterId, departmentId: doc.departmentId, approvedBy: doc.approvedBy })
}

export function approvePurchaseOrder(user: User, id: string): PurchaseOrder {
  const po = visiblePo(user, id)
  assertStep(user, po)
  approvePoCore(tenantOf(user), po, self(user), at())
  return poDetail(user, po)
}

export function rejectPurchaseOrder(user: User, id: string, input: { reason?: unknown } | null): PurchaseOrder {
  const po = visiblePo(user, id)
  assertStep(user, po)
  rejectPoCore(tenantOf(user), po, self(user), reasonOf(input, 'rejection'), at())
  return poDetail(user, po)
}

export function cancelPurchaseOrder(user: User, id: string, input: { reason?: unknown } | null): PurchaseOrder {
  const po = visiblePo(user, id)
  assertOwnerOrFull(user, po)
  const co = tenantOf(user)
  if (!['draft', 'pending_approval', 'rejected', 'approved'].includes(po.status)) conflict('This order can’t be cancelled any more (goods received or closed).', 'not_cancellable')
  if (po.receipts.length || finBills.some((b) => b.companyId === co && b.poId === po.id && b.status !== 'void')) conflict('An order with receipts or bills can’t be cancelled; close it instead.', 'has_activity')
  if (finSupplierAdvances.some((a) => a.companyId === co && a.poId === po.id && advanceRemaining(a) > 0)) conflict('An advance was paid on this order: have it refunded (or close the order) first.', 'has_advance')
  const reason = reasonOf(input, 'cancellation')
  po.status = 'cancelled'
  po.cancelReason = reason
  po.updatedAt = at()
  po.history.push(hist(actorOf(user), 'cancelled', `Cancelled: ${reason}`, po.updatedAt))
  return poDetail(user, po)
}

export function receivePurchaseOrder(user: User, id: string, input: { date?: unknown; note?: unknown; lines?: unknown } | null): PurchaseOrder {
  const po = visiblePo(user, id)
  assertOwnerOrFull(user, po)
  const co = tenantOf(user)
  const date = dateOr(co, input?.date, 'Receipt date')
  if (date > todayOf(co)) bad('The receipt date can’t be in the future.', 'future_date')
  if (date < po.orderDate) bad('The receipt date is before the order date.', 'invalid_date')
  const lines = Array.isArray(input?.lines) ? (input!.lines as { lineId?: unknown; quantity?: unknown }[]).map((l) => ({ lineId: String(l?.lineId ?? ''), quantity: Number(l?.quantity) })) : []
  receivePoCore(co, po, { date, note: str(input?.note, 500), lines }, self(user), at())
  return poDetail(user, po)
}

export function closePurchaseOrder(user: User, id: string): PurchaseOrder {
  const co = fullCo(user)
  const po = poOf(co, id) ?? notFound()
  if (!['approved', 'partially_received', 'received'].includes(po.status)) conflict('Only an approved order can be closed.', 'not_closable')
  po.status = 'closed'
  po.closedAt = at()
  po.updatedAt = po.closedAt
  po.history.push(hist(actorOf(user), 'closed', 'Closed (no further receipts or bills)', po.closedAt))
  return poDetail(user, po)
}

/* ================= bills ================= */

/** Finance (full / view) sees every bill; others only bills waiting for their approval step (or decided by them). */
function canSeeBill(user: User, b: BillRecord, s: Scope): boolean {
  if (s !== 'hidden') return true
  return canActOn(user, tenantOf(user), b) || b.decisions.some((d) => d.by === user.id)
}
function visibleBill(user: User, id: string): BillRecord {
  const s = scopeOfUser(user)
  const b = billOf(tenantOf(user), id)
  if (!b || !canSeeBill(user, b, s)) notFound()
  return b!
}
function fullBill(user: User, id: string): BillRecord {
  const co = fullCo(user)
  return billOf(co, id) ?? notFound()
}

export function listBills(user: User, q: { status?: string | null; vendorId?: string | null; poId?: string | null; overdue?: boolean; q?: string | null } = {}): BillRow[] {
  const s = scopeOfUser(user)
  const co = tenantOf(user)
  const today = todayOf(co)
  const text = (q.q ?? '').trim().toLowerCase()
  return finBills
    .filter((b) => b.companyId === co && canSeeBill(user, b, s))
    .filter((b) => !q.status || (q.status === 'open' ? isOpenBill(b.status) : q.status === 'awaiting' ? canActOn(user, co, b) : b.status === q.status))
    .filter((b) => !q.vendorId || b.vendorId === q.vendorId)
    .filter((b) => !q.poId || b.poId === q.poId)
    .filter((b) => !q.overdue || isBillOverdue(b, today))
    .filter((b) => !text || b.number.toLowerCase().includes(text) || b.supplierInvoiceNumber.toLowerCase().includes(text) || vendorName(co, b.vendorId).toLowerCase().includes(text))
    .sort((a, b) => b.billDate.localeCompare(a.billDate) || b.id.localeCompare(a.id))
    .map((b) => billRow(user, b))
}

export function getBill(user: User, id: string): Bill {
  return billDetail(user, visibleBill(user, id))
}

function billFields(co: string, input: BillInput | null, existing?: BillRecord) {
  let po: PoRecord | null = existing?.poId ? (poOf(co, existing.poId) ?? null) : null
  if (input?.poId !== undefined && input.poId !== (existing?.poId ?? null)) {
    if (input.poId) {
      po = poOf(co, input.poId) ?? null
      if (!po) bad('Purchase order not found.', 'po_not_found')
      if (!['approved', 'partially_received', 'received'].includes(po!.status)) conflict('Bills can be entered against an approved, open purchase order only.', 'po_not_open')
    } else po = null
  }
  const vendorId = po?.vendorId ?? input?.vendorId ?? existing?.vendorId
  const v = vendorOf(co, vendorId)
  if (!v) bad('Choose a supplier.', 'vendor_not_found')
  if (po && input?.vendorId && input.vendorId !== po.vendorId) bad('The bill’s supplier must be the purchase order’s.', 'vendor_mismatch')
  const billDate = input?.billDate !== undefined ? dateOr(co, input.billDate, 'Bill date') : (existing?.billDate ?? todayOf(co))
  if (billDate > todayOf(co)) bad('The bill date can’t be in the future.', 'future_date')
  const currency = po ? po.currency : cleanCurrency(co, input?.currency, existing?.currency ?? effectiveProfile(co, v!.id).currency)
  const exchangeRate = rateOrDefault(co, currency, input?.exchangeRate ?? (existing && existing.currency === currency ? existing.exchangeRate : undefined), billDate)
  const supplierInvoiceNumber = input?.supplierInvoiceNumber !== undefined ? str(input.supplierInvoiceNumber, 60) : (existing?.supplierInvoiceNumber ?? '')
  const dueDate = input?.dueDate !== undefined ? (input.dueDate ? dateOr(co, input.dueDate, 'Due date') : null) : null
  return { po, vendorId: v!.id, billDate, currency, exchangeRate, supplierInvoiceNumber, dueDate, notes: input?.notes !== undefined ? str(input.notes) : (existing?.notes ?? '') }
}

export function createBill(user: User, input: BillInput | null): Bill {
  const co = fullCo(user)
  const f = billFields(co, input)
  const lines = input?.lines?.length ? input.lines : f.po ? linesFromPo(co, f.po) : input?.lines
  if (f.po && !(lines as unknown[] | undefined)?.length) conflict('Everything on this purchase order is already billed.', 'nothing_to_bill')
  const bill = newBillRecord(co, { ...f, lines, creator: self(user), departmentId: f.po?.departmentId ?? (user.departmentId || null), at: at() })
  return billDetail(user, bill)
}

export function updateBill(user: User, id: string, input: BillInput | null): Bill {
  const b = fullBill(user, id)
  if (b.status !== 'draft' && b.status !== 'rejected') conflict('Only a draft or rejected bill can be edited.', 'not_editable')
  const co = tenantOf(user)
  const f = billFields(co, input, b)
  if (!f.supplierInvoiceNumber) bad('Enter the supplier’s invoice number.', 'supplier_invoice_required')
  if (supplierInvoiceTaken(co, f.vendorId, f.supplierInvoiceNumber, b.id)) conflict(`This supplier’s invoice ${f.supplierInvoiceNumber} is already entered.`, 'duplicate_supplier_invoice')
  const vat = f.vendorId === b.vendorId ? b.vendorVatNumber : effectiveProfile(co, f.vendorId).vatNumber
  const lines = input?.lines !== undefined ? buildLines(co, b.id, input.lines, { vendorId: f.vendorId, vatNumber: vat, po: f.po }) : b.lines
  const termsDays = f.vendorId === b.vendorId ? b.termsDays : effectiveProfile(co, f.vendorId).paymentTermsDays
  const dueDate = f.dueDate ?? (input?.billDate !== undefined || f.vendorId !== b.vendorId ? new Date(Date.parse(`${f.billDate}T00:00:00Z`) + termsDays * 86_400_000).toISOString().slice(0, 10) : b.dueDate)
  if (dueDate < f.billDate) bad('The due date can’t be before the bill date.', 'invalid_due_date')
  Object.assign(b, { vendorId: f.vendorId, poId: f.po?.id ?? null, billDate: f.billDate, dueDate, termsDays, currency: f.currency, exchangeRate: f.exchangeRate, supplierInvoiceNumber: f.supplierInvoiceNumber, notes: f.notes, vendorVatNumber: vat, lines, updatedAt: at() })
  applyTotals(b)
  b.balanceDue = b.total
  b.history.push(hist(actorOf(user), 'edited', 'Bill edited', b.updatedAt))
  return billDetail(user, b)
}

export function deleteBill(user: User, id: string): { id: string } {
  const b = fullBill(user, id)
  if ((b.status !== 'draft' && b.status !== 'rejected') || b.journalEntryId) conflict('Only an unposted draft can be deleted; void a posted bill.', 'not_draft')
  finBills.splice(finBills.indexOf(b as Tenant<BillRecord>), 1)
  return { id }
}

export function submitBill(user: User, id: string): Bill {
  const b = fullBill(user, id)
  submitBillCore(tenantOf(user), b, actorOf(user), at())
  return billDetail(user, b)
}

/** POST /finance/bills/:id/post — direct posting (PO-matched without exceptions, or no approval needed). */
export function postBill(user: User, id: string): Bill {
  const b = fullBill(user, id)
  const co = tenantOf(user)
  if (b.status !== 'draft' && b.status !== 'rejected') conflict('Only a draft can be posted.', 'not_draft')
  if (!canDirectPost(co, b)) conflict('This bill needs approval: submit it (it isn’t matched to an approved purchase order without exceptions).', 'approval_required')
  b.history.push(hist(actorOf(user), 'submitted', b.poId ? 'Posted directly: matched to an approved purchase order' : 'Posted directly: no approval needed for this amount', at()))
  try {
    postBillCore(co, b, actorOf(user), at())
  } catch (e) {
    b.history.pop()
    throw e
  }
  return billDetail(user, b)
}

export function approveBill(user: User, id: string): Bill {
  const b = visibleBill(user, id)
  assertStep(user, b)
  approveBillCore(tenantOf(user), b, self(user), at())
  return billDetail(user, b)
}

export function rejectBill(user: User, id: string, input: { reason?: unknown } | null): Bill {
  const b = visibleBill(user, id)
  assertStep(user, b)
  rejectBillCore(tenantOf(user), b, self(user), reasonOf(input, 'rejection'), at())
  return billDetail(user, b)
}

export function voidBill(user: User, id: string, input: { reason?: unknown } | null): Bill {
  const b = fullBill(user, id)
  voidBillCore(tenantOf(user), b, actorOf(user), reasonOf(input, 'void'), at())
  return billDetail(user, b)
}

export function addBillAttachment(user: User, id: string, input: AttachmentInput | null): Bill {
  const b = fullBill(user, id)
  const co = tenantOf(user)
  if (b.status === 'void') conflict('This bill is void.', 'already_void')
  if (b.attachments.length >= 10) conflict('A bill has at most 10 attachments.', 'too_many_attachments')
  const name = str(input?.name, 160)
  const mimeType = str(input?.mimeType, 80)
  const dataUrl = typeof input?.dataUrl === 'string' ? input.dataUrl : ''
  if (!name) bad('Give the file a name.', 'name_required')
  if (!ATTACHMENT_TYPES.has(mimeType)) bad('Attach a PDF or an image (PNG, JPEG, WebP).', 'invalid_file_type')
  const m = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!m || m[1] !== mimeType) bad('The file data is invalid.', 'invalid_file')
  const sizeBytes = Math.floor((m![2].length * 3) / 4) - (m![2].endsWith('==') ? 2 : m![2].endsWith('=') ? 1 : 0)
  if (sizeBytes > MAX_ATTACHMENT_BYTES) bad('Files can be at most 512 KB.', 'file_too_large')
  assertCapacity(co, 'storageMb', round2(sizeBytes / (1024 * 1024)))
  const now = at()
  b.attachments.push({ id: `${b.id}-A${Date.now().toString(36)}${b.attachments.length + 1}`, name, mimeType, sizeBytes, dataUrl, uploadedBy: user.id, uploadedAt: now })
  b.updatedAt = now
  b.history.push(hist(actorOf(user), 'attachment', `Attached ${name}`, now))
  return billDetail(user, b)
}

export function removeBillAttachment(user: User, id: string, attachmentId: string): Bill {
  const b = fullBill(user, id)
  const i = b.attachments.findIndex((a) => a.id === attachmentId)
  if (i < 0) notFound()
  const [gone] = b.attachments.splice(i, 1)
  b.updatedAt = at()
  b.history.push(hist(actorOf(user), 'attachment', `Removed ${gone.name}`, b.updatedAt))
  return billDetail(user, b)
}

/* ================= debit notes ================= */

export function listDebitNotes(user: User, q: { billId?: string | null; vendorId?: string | null } = {}): DebitNote[] {
  const co = readCo(user)
  return finDebitNotes
    .filter((d) => d.companyId === co && (!q.billId || d.billId === q.billId) && (!q.vendorId || d.vendorId === q.vendorId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map((d) => debitNoteView(co, d))
}

export function createDebitNote(user: User, input: DebitNoteInput | null): DebitNote {
  const co = fullCo(user)
  const b = billOf(co, input?.billId)
  if (!b) bad('Bill not found.', 'bill_not_found')
  const date = dateOr(co, input?.date, 'Date')
  if (date < b!.billDate) bad('The debit note is dated before the bill.', 'invalid_date')
  const reason = reasonOf(input as { reason?: unknown }, 'debit note')
  let accountId: string | null = null
  if (input?.accountId) {
    if (!accountOf(co, input.accountId)) bad('Account not found.', 'invalid_account')
    accountId = input.accountId
  }
  const dn = debitNoteCore(co, b!, { date, reason, amount: Number(input?.amount), accountId }, actorOf(user), at())
  return debitNoteView(co, dn)
}

/* ================= bill payments ================= */

export function paymentAccountIn(co: string, id: unknown): string {
  if (typeof id !== 'string' || !paymentAccountsOf(co).some((a) => a.id === id)) bad('Choose a cash or bank account to pay from.', 'invalid_payment_account')
  return id as string
}
const METHODS: BillPaymentMethod[] = ['bank_transfer', 'cheque', 'cash']
export const methodOf = (v: unknown): BillPaymentMethod => (v === undefined || v === null || v === '' ? 'bank_transfer' : METHODS.includes(v as BillPaymentMethod) ? (v as BillPaymentMethod) : bad('Unknown payment method.', 'invalid_method'))

export function listBillPayments(user: User, q: { vendorId?: string | null; billId?: string | null; runId?: string | null } = {}): BillPayment[] {
  const co = readCo(user)
  return finBillPayments
    .filter((p) => p.companyId === co && (!q.vendorId || p.vendorId === q.vendorId) && (!q.billId || p.allocations.some((a) => a.billId === q.billId)) && (!q.runId || p.runId === q.runId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map((p) => paymentView(co, p))
}

export function getBillPayment(user: User, id: string): BillPayment {
  const co = readCo(user)
  const p = finBillPayments.find((x) => x.companyId === co && x.id === id) ?? notFound()
  return paymentView(co, p)
}

function allocationsIn(co: string, raw: unknown): { bill: BillRecord; amount: number }[] {
  if (!Array.isArray(raw) || !raw.length) bad('Choose at least one bill to pay.', 'no_allocations')
  return (raw as { billId?: unknown; amount?: unknown }[]).map((a) => {
    const bill = billOf(co, a?.billId)
    if (!bill) bad('Bill not found.', 'bill_not_found')
    return { bill: bill!, amount: round2(Number(a?.amount)) }
  })
}

export function createBillPayment(user: User, input: BillPaymentInput | null): BillPayment {
  const co = fullCo(user)
  const v = vendorOf(co, input?.vendorId)
  if (!v) bad('Choose a supplier.', 'vendor_not_found')
  const date = dateOr(co, input?.date, 'Payment date')
  if (date > todayOf(co)) bad('The payment date can’t be in the future.', 'future_date')
  const p = paymentCore(
    co,
    {
      vendorId: v!.id,
      date,
      paymentAccountId: paymentAccountIn(co, input?.paymentAccountId),
      method: methodOf(input?.method),
      reference: str(input?.reference, 120),
      exchangeRate: input?.exchangeRate ?? null,
      bankCharges: Number(input?.bankCharges ?? 0),
      allocations: allocationsIn(co, input?.allocations),
      notes: str(input?.notes, 1000),
      runId: null,
    },
    actorOf(user),
    at(),
  )
  return paymentView(co, p)
}

/** POST /finance/bill-payments/run — pays many bills: one payment (voucher) per supplier and currency. All or nothing. */
export function createPaymentRun(user: User, input: PaymentRunInput | null): PaymentRun {
  const co = fullCo(user)
  const date = dateOr(co, input?.date, 'Payment date')
  if (date > todayOf(co)) bad('The payment date can’t be in the future.', 'future_date')
  const account = paymentAccountIn(co, input?.paymentAccountId)
  const method = methodOf(input?.method)
  const allocs = allocationsIn(co, input?.items)
  const groups = new Map<string, { bill: BillRecord; amount: number }[]>()
  for (const a of allocs) groups.set(`${a.bill.vendorId}|${a.bill.currency}`, [...(groups.get(`${a.bill.vendorId}|${a.bill.currency}`) ?? []), a])
  // Validate every group before posting anything (a later failure would leave a half run).
  for (const g of groups.values()) {
    for (const a of g) {
      if (!isOpenBill(a.bill.status)) conflict(`Bill ${a.bill.number} isn’t open.`, 'bill_not_open')
      if (!(a.amount > 0) || a.amount > a.bill.balanceDue + 1e-9) bad(`Bill ${a.bill.number}: pay more than 0 and at most ${a.bill.balanceDue.toFixed(2)} ${a.bill.currency}.`, 'exceeds_balance')
      if (a.bill.billDate > date) bad(`Bill ${a.bill.number} is dated after the payment.`, 'payment_before_bill')
    }
    if (g[0].bill.currency !== baseCurrencyOf(co)) rateOrDefault(co, g[0].bill.currency, undefined, date)
  }
  const now = at()
  const by = actorOf(user)
  const run = newRunRecord(co, date, account, by, now)
  for (const g of groups.values()) {
    const p = paymentCore(co, { vendorId: g[0].bill.vendorId, date, paymentAccountId: account, method, reference: str(input?.reference, 120) || run.number, exchangeRate: null, bankCharges: 0, allocations: g, notes: `Payment run ${run.number}`, runId: run.id }, by, now)
    run.paymentIds.push(p.id)
  }
  return runView(co, run)
}

function runView(co: string, run: Tenant<import('@/shared/mocks/data/financePurchases').PaymentRunRecord>): PaymentRun {
  const payments = run.paymentIds.map((id) => finBillPayments.find((p) => p.companyId === co && p.id === id)).filter((p): p is Tenant<BillPaymentRecord> => !!p)
  return {
    id: run.id,
    number: run.number,
    date: run.date,
    paymentAccountId: run.paymentAccountId,
    paymentIds: [...run.paymentIds],
    payments: payments.map((p) => paymentView(co, p)),
    totalBase: round2(payments.filter((p) => p.status === 'posted').reduce((s, p) => s + toBase(p.amount, p.exchangeRate), 0)),
    bankStatus: run.bankStatus ?? 'created',
    bankReference: run.bankReference ?? '',
    exportCount: (run.exports ?? []).length,
    lastExportAt: (run.exports ?? []).slice(-1)[0]?.at ?? null,
    sentAt: run.sentAt ?? null,
    sentByName: run.sentBy ? userName(co, run.sentBy) : null,
    confirmedAt: run.confirmedAt ?? null,
    confirmedByName: run.confirmedBy ? userName(co, run.confirmedBy) : null,
    bankAccountId: runBankAccount(co, run)?.id ?? null,
    paymentFileTemplate: runTemplate(co, run),
    createdByName: userName(co, run.createdBy),
    createdAt: run.createdAt,
  }
}

export function listPaymentRuns(user: User): PaymentRun[] {
  const co = readCo(user)
  return finPaymentRuns.filter((r) => r.companyId === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => runView(co, r))
}

export function voidBillPayment(user: User, id: string, input: { reason?: unknown } | null): BillPayment {
  const co = fullCo(user)
  const p = finBillPayments.find((x) => x.companyId === co && x.id === id) ?? notFound()
  voidPaymentCore(co, p, actorOf(user), reasonOf(input, 'void'), at())
  return paymentView(co, p)
}

/* ================= payables ================= */

export function apAging(user: User, q: { asOf?: string | null } = {}): ApAging {
  const co = readCo(user)
  return apAgingOf(co, dateOr(co, q.asOf, 'as_of'))
}

export function dueBills(user: User, q: { days?: string | null } = {}): DueBill[] {
  const co = readCo(user)
  const days = q.days ? Number(q.days) : 7
  if (!Number.isInteger(days) || days < 0 || days > 365) bad('days is 0–365.', 'invalid_days')
  return dueBillsOf(co, days)
}

export function getPayablesOverview(user: User): PayablesOverview {
  return payablesOverview(readCo(user))
}

export function eventCosts(user: User, q: { eventId?: string | null }): EventBilledCosts {
  const co = readCo(user)
  const e = events.find((x) => x.companyId === co && x.id === q.eventId)
  if (!e) bad('Event not found.', 'event_not_found')
  return eventBilledCostsOf(co, e!.id)
}

/* ================= approval rules ================= */

const DOC_TYPES: SpendDocType[] = ['purchase_order', 'bill', 'expense', 'expense_claim']
const APPROVERS: ApproverKind[] = ['department_head', 'Accountant', 'Management', 'Company Admin']

function rulesView(user: User, co: string): ApprovalRulesView {
  const st = finPurchasesSettings.get(co)
  return {
    baseCurrency: baseCurrencyOf(co),
    rules: approvalRules.get(co).rules.map((r) => ({ docType: r.docType, minAmount: r.minAmount, approver: r.approver })).sort((a, b) => DOC_TYPES.indexOf(a.docType) - DOC_TYPES.indexOf(b.docType) || a.minAmount - b.minAmount),
    docTypes: DOC_TYPES.map((id) => ({ id, label: SPEND_DOC_LABEL[id] })),
    matchTolerancePct: st.matchTolerancePct,
    canEdit: scopeOf(user.role, 'accounting') === 'full' && RULE_EDITORS.has(user.role),
    updatedAt: st.rulesUpdatedAt,
    updatedByName: st.rulesUpdatedBy ? userName(co, st.rulesUpdatedBy) : null,
  }
}

export function getApprovalRules(user: User): ApprovalRulesView {
  return rulesView(user, readCo(user))
}

/** PUT /finance/approval-rules { doc_type, rules: [{ min_amount, approver }], match_tolerance_pct? } — replaces one document type's bands. */
export function saveApprovalRules(user: User, input: ApprovalRulesInput | null): ApprovalRulesView {
  const co = readCo(user)
  if (scopeOf(user.role, 'accounting') !== 'full' || !RULE_EDITORS.has(user.role)) throw new CodedApiError('Only a Company Admin or an Accountant can change approval rules.', 403, 'forbidden')
  const docType = input?.docType as SpendDocType
  if (!DOC_TYPES.includes(docType)) bad(`doc_type must be one of: ${DOC_TYPES.join(', ')}.`, 'invalid_doc_type')
  if (!Array.isArray(input?.rules)) bad('rules must be a list.', 'invalid_rules')
  if (input!.rules.length > 8) bad('At most 8 steps per document type.', 'too_many_steps')
  const rules = input!.rules.map((r, i) => {
    const min = Number(r?.minAmount)
    if (!Number.isFinite(min) || min < 0 || min > 1_000_000_000) bad(`Step ${i + 1}: the amount must be 0 or more.`, 'invalid_amount')
    if (!APPROVERS.includes(r?.approver)) bad(`Step ${i + 1}: approver must be one of: ${APPROVERS.join(', ')}.`, 'invalid_approver')
    return { docType, minAmount: round2(min), approver: r.approver }
  })
  const seen = new Set(rules.map((r) => `${r.approver}`))
  if (seen.size !== rules.length) bad('Each approver appears once per document type.', 'duplicate_approver')
  let tol: number | undefined
  if (input?.matchTolerancePct !== undefined) {
    tol = Number(input.matchTolerancePct)
    if (!Number.isFinite(tol) || tol < 0 || tol > 25) bad('The match tolerance is 0–25 %.', 'invalid_tolerance')
  }
  const store = approvalRules.get(co)
  const before = store.rules.filter((r) => r.docType === docType)
  store.rules = [...store.rules.filter((r) => r.docType !== docType), ...rules.sort((a, b) => a.minAmount - b.minAmount)]
  const st = finPurchasesSettings.get(co)
  const changes: { field: string; from: string; to: string }[] = [{ field: docType, from: before.map((r) => `${r.minAmount}+ ${r.approver}`).join('; ') || 'none', to: rules.map((r) => `${r.minAmount}+ ${r.approver}`).join('; ') || 'none' }]
  if (tol !== undefined && tol !== st.matchTolerancePct) {
    changes.push({ field: 'match_tolerance_pct', from: String(st.matchTolerancePct), to: String(tol) })
    st.matchTolerancePct = round2(tol)
  }
  st.rulesUpdatedAt = at()
  st.rulesUpdatedBy = user.id
  recordAudit(user, { action: 'update', entity: 'approval_rules', entityId: docType, summary: `Changed the approval rules for ${SPEND_DOC_LABEL[docType]}`, changes })
  return rulesView(user, co)
}

/* ================= debit-note void ================= */

/** POST /finance/debit-notes/:id/void { reason } — accounting full: reverses the entry and restores the bill's balance. */
export function voidDebitNote(user: User, id: string, input: { reason?: unknown } | null): DebitNote {
  const co = fullCo(user)
  const d = finDebitNotes.find((x) => x.companyId === co && x.id === id) ?? notFound()
  voidDebitNoteCore(co, d, actorOf(user), reasonOf(input, 'void'), at())
  return debitNoteView(co, d)
}

/* ================= supplier advances ================= */

function advanceView(co: string, a: Tenant<SupplierAdvanceRecord>): SupplierAdvance {
  const remaining = advanceRemaining(a)
  const po = a.poId ? poOf(co, a.poId) : undefined
  return {
    id: a.id,
    number: a.number,
    vendorId: a.vendorId,
    vendorName: vendorName(co, a.vendorId),
    poId: a.poId,
    poNumber: po?.number ?? null,
    date: a.date,
    method: a.method,
    reference: a.reference,
    paymentAccountId: a.paymentAccountId,
    paymentAccountName: accountOf(co, a.paymentAccountId)?.name ?? a.paymentAccountId,
    currency: a.currency,
    exchangeRate: a.exchangeRate,
    amount: a.amount,
    baseAmount: toBase(a.amount, a.exchangeRate),
    applied: advanceApplied(a),
    refunded: advanceRefunded(a),
    remaining,
    remainingBase: toBase(remaining, a.exchangeRate),
    status: remaining > 0 ? 'open' : 'closed',
    applications: a.applications.map((x) => ({ id: x.id, billId: x.billId, billNumber: billOf(co, x.billId)?.number ?? x.billId, date: x.date, amount: x.amount, journalEntryId: x.journalEntryId })),
    refunds: a.refunds.map((r) => ({ id: r.id, date: r.date, amount: r.amount, reference: r.reference, accountId: r.accountId, journalEntryId: r.journalEntryId })),
    notes: a.notes,
    journal: journalView(co, a.journalEntryId),
    createdByName: userName(co, a.createdBy),
    createdAt: a.createdAt,
  }
}

/** GET /finance/supplier-advances?vendor_id=&status=open|closed&po_id= — accounting full / view. */
export function listSupplierAdvances(user: User, q: { vendorId?: string | null; status?: string | null; poId?: string | null } = {}): SupplierAdvance[] {
  const co = readCo(user)
  return finSupplierAdvances
    .filter((a) => a.companyId === co && (!q.vendorId || a.vendorId === q.vendorId) && (!q.poId || a.poId === q.poId))
    .map((a) => advanceView(co, a))
    .filter((a) => !q.status || a.status === q.status)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export function getSupplierAdvance(user: User, id: string): SupplierAdvance {
  const co = readCo(user)
  return advanceView(co, advanceOf(co, id) ?? notFound())
}

/** POST /finance/supplier-advances — accounting full: pays a supplier before the bill (Dr 1420 / Cr bank). */
export function createSupplierAdvance(user: User, input: SupplierAdvanceInput | null): SupplierAdvance {
  const co = fullCo(user)
  let vendorId = input?.vendorId
  let po: PoRecord | null = null
  if (input?.poId) {
    po = poOf(co, input.poId) ?? null
    if (!po) bad('Purchase order not found.', 'po_not_found')
    if (!['approved', 'partially_received', 'received'].includes(po!.status)) conflict('Advances can be paid on an approved, open purchase order only.', 'po_not_open')
    if (vendorId && vendorId !== po!.vendorId) bad('The advance’s supplier must be the purchase order’s.', 'vendor_mismatch')
    vendorId = po!.vendorId
  }
  const v = vendorOf(co, vendorId)
  if (!v) bad('Choose a supplier.', 'vendor_not_found')
  const date = dateOr(co, input?.date, 'Date')
  if (date > todayOf(co)) bad('The advance date can’t be in the future.', 'future_date')
  const currency = po ? po.currency : cleanCurrency(co, input?.currency, effectiveProfile(co, v!.id).currency)
  const exchangeRate = rateOrDefault(co, currency, input?.exchangeRate, date)
  const amount = input?.amount !== undefined && input?.amount !== null ? Number(input.amount) : po?.advancePct ? round2((po.total * po.advancePct) / 100) : NaN
  const a = advanceCore(
    co,
    { vendorId: v!.id, poId: po?.id ?? null, date, paymentAccountId: paymentAccountIn(co, input?.paymentAccountId), method: methodOf(input?.method), reference: str(input?.reference, 120), currency, exchangeRate, amount, notes: str(input?.notes, 1000) },
    actorOf(user),
    at(),
  )
  recordAudit(user, { action: 'create', entity: 'supplier_advance', entityId: a.id, summary: `Paid advance ${a.number} to ${vendorName(co, a.vendorId)}: ${a.currency} ${a.amount.toFixed(2)}` })
  return advanceView(co, a)
}

/** POST /finance/supplier-advances/:id/apply { bill_id, amount?, date? } — accounting full (amount default: what fits). */
export function applySupplierAdvance(user: User, id: string, input: { billId?: unknown; amount?: unknown; date?: unknown } | null): SupplierAdvance {
  const co = fullCo(user)
  const a = advanceOf(co, id) ?? notFound()
  const bill = billOf(co, input?.billId)
  if (!bill) bad('Bill not found.', 'bill_not_found')
  const amount = input?.amount !== undefined && input?.amount !== null && input?.amount !== '' ? Number(input.amount) : Math.min(advanceRemaining(a), bill!.balanceDue)
  const date = input?.date ? dateOr(co, input.date, 'Date') : [todayOf(co), a.date, bill!.billDate].sort().slice(-1)[0]
  applyAdvanceCore(co, a, bill!, amount, date, actorOf(user), at())
  return advanceView(co, a)
}

/** POST /finance/supplier-advances/:id/refund { amount, date?, account_id?, exchange_rate?, reference? } — accounting full. */
export function refundSupplierAdvance(user: User, id: string, input: { amount?: unknown; date?: unknown; accountId?: unknown; exchangeRate?: unknown; reference?: unknown } | null): SupplierAdvance {
  const co = fullCo(user)
  const a = advanceOf(co, id) ?? notFound()
  const date = dateOr(co, input?.date, 'Date')
  if (date > todayOf(co)) bad('The refund date can’t be in the future.', 'future_date')
  const accountId = input?.accountId ? paymentAccountIn(co, input.accountId) : a.paymentAccountId
  const amount = input?.amount !== undefined && input?.amount !== null && input?.amount !== '' ? Number(input.amount) : advanceRemaining(a)
  refundAdvanceCore(co, a, { amount, date, accountId, exchangeRate: rateOrDefault(co, a.currency, input?.exchangeRate, date), reference: str(input?.reference, 120) }, actorOf(user), at())
  recordAudit(user, { action: 'update', entity: 'supplier_advance', entityId: a.id, summary: `Recorded a refund of advance ${a.number}: ${a.currency} ${round2(amount).toFixed(2)}` })
  return advanceView(co, a)
}

/* ================= payment runs: bank upload file ================= */

function runBankAccount(co: string, run: PaymentRunRecord) {
  return finBankAccounts.find((b) => b.companyId === co && b.ledgerAccountId === run.paymentAccountId)
}
function runTemplate(co: string, run: PaymentRunRecord): PaymentFileTemplate {
  return runBankAccount(co, run)?.paymentFileTemplate ?? defaultLocalTemplate(companyById(co)?.regional.country ?? 'AE')
}
const ownRun = (co: string, id: string) => finPaymentRuns.find((r) => r.companyId === co && r.id === id) ?? notFound()

/**
 * POST /finance/payment-runs/:id/bank-file — accounting full; audited. The answer IS the file(s): local transfers in the
 * bank account's template (base currency), foreign-currency vouchers in the SWIFT MT103-lite CSV. Full IBANs appear only
 * here (never in a GET). Skipped: void vouchers, cheque / cash payments, suppliers without an IBAN (or a BIC for SWIFT).
 */
export function exportPaymentRunFile(user: User, id: string): PaymentRunFile {
  const co = fullCo(user)
  const run = ownRun(co, id)
  const base = baseCurrencyOf(co)
  const bank = runBankAccount(co, run)
  const localTemplate = runTemplate(co, run)
  const meta = { debitAccount: bank?.iban || bank?.accountNumber || '', purposeCode: 'SUP' }
  const skipped: PaymentRunFile['skipped'] = []
  const local: PaymentFileRow[] = []
  const foreign: PaymentFileRow[] = []
  for (const pid of run.paymentIds) {
    const p = finBillPayments.find((x) => x.companyId === co && x.id === pid)
    if (!p) continue
    const name = vendorName(co, p.vendorId)
    const prof = effectiveProfile(co, p.vendorId)
    const isForeign = p.currency !== base || PAYMENT_FILE_TEMPLATE_DEF[localTemplate].foreign
    const reason = p.status !== 'posted' ? 'Voided' : p.method !== 'bank_transfer' ? `Paid by ${p.method === 'cheque' ? 'cheque' : 'cash'}` : !prof.iban ? 'No IBAN on the supplier' : isForeign && !prof.swiftBic ? 'No SWIFT / BIC on the supplier' : null
    if (reason) {
      skipped.push({ paymentId: p.id, paymentNumber: p.number, vendorName: name, reason })
      continue
    }
    const row: PaymentFileRow = { beneficiaryName: name, iban: prof.iban, bankName: prof.bankName, swiftBic: prof.swiftBic ?? '', amount: p.amount, currency: p.currency, valueDate: run.date, reference: `${p.number} ${run.number}` }
    ;(isForeign ? foreign : local).push(row)
  }
  if (!local.length && !foreign.length) conflict('Nothing in this run can be paid by bank transfer (see the skipped payments).', 'nothing_to_export', { skipped })
  const files: PaymentRunFile['files'] = []
  const stamp = run.number.replace(/[^A-Za-z0-9-]/g, '')
  if (local.length && !PAYMENT_FILE_TEMPLATE_DEF[localTemplate].foreign) {
    const f = buildPaymentFile(localTemplate, columnsFor(localTemplate, bank?.paymentFileColumns), local, meta)
    files.push({ kind: 'local', template: localTemplate, fileName: `${stamp}-${localTemplate}.csv`, mimeType: 'text/csv', content: f.content, count: f.count, total: f.total, currency: base })
  }
  const swiftRows = PAYMENT_FILE_TEMPLATE_DEF[localTemplate].foreign ? [...local, ...foreign] : foreign
  if (swiftRows.length) {
    const cols = localTemplate === 'swift_mt103' ? columnsFor('swift_mt103', bank?.paymentFileColumns) : columnsFor('swift_mt103', null)
    const f = buildPaymentFile('swift_mt103', cols, swiftRows, meta)
    const cur = [...new Set(swiftRows.map((r) => r.currency))]
    files.push({ kind: 'swift', template: 'swift_mt103', fileName: `${stamp}-swift_mt103.csv`, mimeType: 'text/csv', content: f.content, count: f.count, total: f.total, currency: cur.length === 1 ? cur[0] : 'MIXED' })
  }
  const now = at()
  run.exports = [...(run.exports ?? []), { at: now, by: user.id, files: files.map((f) => f.fileName), count: files.reduce((s, f) => s + f.count, 0) }]
  recordAudit(user, { action: 'security', entity: 'payment_run', entityId: run.id, summary: `Exported the bank file of payment run ${run.number} (${files.map((f) => `${f.count} × ${f.template}`).join(', ')}; full bank details)`, changes: [] })
  return { runId: run.id, runNumber: run.number, files, skipped }
}

/** POST /finance/payment-runs/:id/sent { bank_reference? } — accounting full: the file was uploaded to the bank. */
export function markPaymentRunSent(user: User, id: string, input: { bankReference?: unknown } | null): PaymentRun {
  const co = fullCo(user)
  const run = ownRun(co, id)
  if ((run.bankStatus ?? 'created') !== 'created') conflict('This run is already sent to the bank.', 'already_sent')
  if (!(run.exports ?? []).length) conflict('Export the bank file first.', 'not_exported')
  run.bankStatus = 'sent'
  run.sentAt = at()
  run.sentBy = user.id
  run.bankReference = str(input?.bankReference, 80) || run.bankReference || ''
  recordAudit(user, { action: 'update', entity: 'payment_run', entityId: run.id, summary: `Marked payment run ${run.number} as sent to the bank` })
  return runView(co, run)
}

/** POST /finance/payment-runs/:id/confirm { bank_reference? } — accounting full: the bank confirmed the transfers. */
export function confirmPaymentRun(user: User, id: string, input: { bankReference?: unknown } | null): PaymentRun {
  const co = fullCo(user)
  const run = ownRun(co, id)
  if ((run.bankStatus ?? 'created') !== 'sent') conflict('Only a run sent to the bank can be confirmed.', 'not_sent')
  run.bankStatus = 'confirmed'
  run.confirmedAt = at()
  run.confirmedBy = user.id
  run.bankReference = str(input?.bankReference, 80) || run.bankReference || ''
  recordAudit(user, { action: 'update', entity: 'payment_run', entityId: run.id, summary: `Payment run ${run.number} confirmed by the bank` })
  return runView(co, run)
}

/* ================= wiring ================= */

/** How purchases documents show in the journal (bills, debit notes and payments all post as source type `bill`). */
registerJournalSource('bill', (co, id) => {
  const b = billOf(co, id)
  if (b) return { number: b.number, link: `/finance/bills/${encodeURIComponent(b.id)}` }
  const d = finDebitNotes.find((x) => x.companyId === co && x.id === id)
  if (d) return { number: d.number, link: `/finance/bills/${encodeURIComponent(d.billId)}` }
  const p = finBillPayments.find((x) => x.companyId === co && x.id === id)
  if (p) return { number: p.number, link: `/finance/bill-payments/${encodeURIComponent(p.id)}/voucher` }
  const a = advanceOf(co, id)
  if (a) return { number: a.number, link: `/finance/suppliers?supplier=${encodeURIComponent(a.vendorId)}` }
  return null
})

onLifecycleTick('finance.bill-due-reminders', (co, until) => runBillDueReminders(co, new Date(until).toISOString()))

export { payablesOverview, refreshPoStatus }
