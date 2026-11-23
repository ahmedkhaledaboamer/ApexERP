import { http, type HttpHandler } from 'msw'
import type { ApprovalRulesInput, AttachmentInput, BillInput, BillPaymentInput, DebitNoteInput, PaymentRunInput, PoInput, SupplierAdvanceInput, SupplierCreateInput, SupplierProfileInput } from '@/modules/finance/purchases/types'
import * as fin from '@/shared/mocks/services/financePurchases'
import * as m from '@/shared/api/financePurchasesMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const query = (request: Request) => new URL(request.url).searchParams
const S = `${API}/finance/suppliers`
const PO = `${API}/finance/purchase-orders`
const B = `${API}/finance/bills`
const DN = `${API}/finance/debit-notes`
const BP = `${API}/finance/bill-payments`
const P = `${API}/finance/payables`
const ADV = `${API}/finance/supplier-advances`

/**
 * Accounts & finance › Purchases & payables (docs/API.md › Finance › Suppliers, Purchase orders, Bills, Approval rules).
 * Plan module `accounting` (the /finance path gate). Purchase orders are self-service for every employee (own requests,
 * own department); approvers act on the step waiting for them; everything else needs the `accounting` column.
 * Static paths before `:id`.
 */
export const financePurchasesHandlers: HttpHandler[] = [
  /* ---- suppliers ---- */
  http.get(S, ({ request }) => respondAs(m.supplierRowMapper, () => fin.listSuppliers(userFrom(request)))),
  http.post(S, async ({ request }) => {
    const input = await body<SupplierCreateInput>(request, m.supplierCreateInputMapper)
    return respondAs(m.supplierDetailMapper, () => fin.createSupplier(userFrom(request), input))
  }),
  http.get<Id>(`${S}/:id`, ({ request, params }) => respondAs(m.supplierDetailMapper, () => fin.getSupplier(userFrom(request), params.id))),
  http.patch<Id>(`${S}/:id`, async ({ request, params }) => {
    const input = await body<SupplierProfileInput>(request, m.supplierProfileInputMapper)
    return respondAs(m.supplierDetailMapper, () => fin.updateSupplier(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${S}/:id/reveal-iban`, ({ request, params }) => respondAs(m.purchasesPlainMapper, () => fin.revealSupplierIban(userFrom(request), params.id))),
  http.get<Id>(`${S}/:id/statement`, ({ request, params }) => {
    const q = query(request)
    return respondAs(m.supplierStatementMapper, () => fin.supplierStatement(userFrom(request), params.id, { from: q.get('from'), to: q.get('to') }))
  }),

  /* ---- meta (every employee: pickers for purchase requests) ---- */
  http.get(`${API}/finance/purchases/meta`, ({ request }) => respondAs(m.purchasesMetaMapper, () => fin.purchasesMeta(userFrom(request)))),

  /* ---- purchase orders ---- */
  http.get(PO, ({ request }) => {
    const q = query(request)
    return respondAs(m.poRowMapper, () => fin.listPurchaseOrders(userFrom(request), { status: q.get('status'), vendorId: q.get('vendor_id'), view: q.get('view') }))
  }),
  http.post(PO, async ({ request }) => {
    const input = await body<PoInput>(request, m.poInputMapper)
    return respondAs(m.poMapper, () => fin.createPurchaseOrder(userFrom(request), input))
  }),
  http.get<Id>(`${PO}/:id`, ({ request, params }) => respondAs(m.poMapper, () => fin.getPurchaseOrder(userFrom(request), params.id))),
  http.patch<Id>(`${PO}/:id`, async ({ request, params }) => {
    const input = await body<Partial<PoInput>>(request, m.poInputMapper)
    return respondAs(m.poMapper, () => fin.updatePurchaseOrder(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${PO}/:id`, ({ request, params }) => respondAs(m.purchasesPlainMapper, () => fin.deletePurchaseOrder(userFrom(request), params.id))),
  http.post<Id>(`${PO}/:id/submit`, ({ request, params }) => respondAs(m.poMapper, () => fin.submitPurchaseOrder(userFrom(request), params.id))),
  http.post<Id>(`${PO}/:id/approve`, ({ request, params }) => respondAs(m.poMapper, () => fin.approvePurchaseOrder(userFrom(request), params.id))),
  http.post<Id>(`${PO}/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.poMapper, () => fin.rejectPurchaseOrder(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${PO}/:id/cancel`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.poMapper, () => fin.cancelPurchaseOrder(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${PO}/:id/receive`, async ({ request, params }) => {
    const input = await body<{ date?: unknown; note?: unknown; lines?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.poMapper, () => fin.receivePurchaseOrder(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${PO}/:id/close`, ({ request, params }) => respondAs(m.poMapper, () => fin.closePurchaseOrder(userFrom(request), params.id))),

  /* ---- bills ---- */
  http.get(B, ({ request }) => {
    const q = query(request)
    return respondAs(m.billRowMapper, () =>
      fin.listBills(userFrom(request), { status: q.get('status'), vendorId: q.get('vendor_id'), poId: q.get('po_id'), overdue: q.get('overdue') === 'true', q: q.get('q') }),
    )
  }),
  http.post(B, async ({ request }) => {
    const input = await body<BillInput>(request, m.billInputMapper)
    return respondAs(m.billMapper, () => fin.createBill(userFrom(request), input))
  }),
  http.get<Id>(`${B}/:id`, ({ request, params }) => respondAs(m.billMapper, () => fin.getBill(userFrom(request), params.id))),
  http.patch<Id>(`${B}/:id`, async ({ request, params }) => {
    const input = await body<BillInput>(request, m.billInputMapper)
    return respondAs(m.billMapper, () => fin.updateBill(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${B}/:id`, ({ request, params }) => respondAs(m.purchasesPlainMapper, () => fin.deleteBill(userFrom(request), params.id))),
  http.post<Id>(`${B}/:id/submit`, ({ request, params }) => respondAs(m.billMapper, () => fin.submitBill(userFrom(request), params.id))),
  http.post<Id>(`${B}/:id/post`, ({ request, params }) => respondAs(m.billMapper, () => fin.postBill(userFrom(request), params.id))),
  http.post<Id>(`${B}/:id/approve`, ({ request, params }) => respondAs(m.billMapper, () => fin.approveBill(userFrom(request), params.id))),
  http.post<Id>(`${B}/:id/reject`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.billMapper, () => fin.rejectBill(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${B}/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.billMapper, () => fin.voidBill(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${B}/:id/attachments`, async ({ request, params }) => {
    const input = await body<AttachmentInput>(request, m.attachmentInputMapper)
    return respondAs(m.billMapper, () => fin.addBillAttachment(userFrom(request), params.id, input))
  }),
  http.delete<{ id: string; attachmentId: string }>(`${B}/:id/attachments/:attachmentId`, ({ request, params }) =>
    respondAs(m.billMapper, () => fin.removeBillAttachment(userFrom(request), params.id, params.attachmentId)),
  ),

  /* ---- debit notes ---- */
  http.get(DN, ({ request }) => {
    const q = query(request)
    return respondAs(m.debitNoteMapper, () => fin.listDebitNotes(userFrom(request), { billId: q.get('bill_id'), vendorId: q.get('vendor_id') }))
  }),
  http.post(DN, async ({ request }) => {
    const input = await body<DebitNoteInput>(request, m.debitNoteInputMapper)
    return respondAs(m.debitNoteMapper, () => fin.createDebitNote(userFrom(request), input))
  }),
  http.post<Id>(`${DN}/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.debitNoteMapper, () => fin.voidDebitNote(userFrom(request), params.id, input))
  }),

  /* ---- supplier advances (prepayments) ---- */
  http.get(ADV, ({ request }) => {
    const q = query(request)
    return respondAs(m.supplierAdvanceMapper, () => fin.listSupplierAdvances(userFrom(request), { vendorId: q.get('vendor_id'), status: q.get('status'), poId: q.get('po_id') }))
  }),
  http.post(ADV, async ({ request }) => {
    const input = await body<SupplierAdvanceInput>(request, m.supplierAdvanceInputMapper)
    return respondAs(m.supplierAdvanceMapper, () => fin.createSupplierAdvance(userFrom(request), input))
  }),
  http.get<Id>(`${ADV}/:id`, ({ request, params }) => respondAs(m.supplierAdvanceMapper, () => fin.getSupplierAdvance(userFrom(request), params.id))),
  http.post<Id>(`${ADV}/:id/apply`, async ({ request, params }) => {
    const input = await body<{ billId?: unknown; amount?: unknown; date?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.supplierAdvanceMapper, () => fin.applySupplierAdvance(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${ADV}/:id/refund`, async ({ request, params }) => {
    const input = await body<{ amount?: unknown; date?: unknown; accountId?: unknown; exchangeRate?: unknown; reference?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.supplierAdvanceMapper, () => fin.refundSupplierAdvance(userFrom(request), params.id, input))
  }),

  /* ---- bill payments and payment runs ---- */
  http.get(BP, ({ request }) => {
    const q = query(request)
    return respondAs(m.billPaymentMapper, () => fin.listBillPayments(userFrom(request), { vendorId: q.get('vendor_id'), billId: q.get('bill_id'), runId: q.get('run_id') }))
  }),
  http.post(BP, async ({ request }) => {
    const input = await body<BillPaymentInput>(request, m.billPaymentInputMapper)
    return respondAs(m.billPaymentMapper, () => fin.createBillPayment(userFrom(request), input))
  }),
  http.post(`${BP}/run`, async ({ request }) => {
    const input = await body<PaymentRunInput>(request, m.paymentRunInputMapper)
    return respondAs(m.paymentRunMapper, () => fin.createPaymentRun(userFrom(request), input))
  }),
  http.get(`${API}/finance/payment-runs`, ({ request }) => respondAs(m.paymentRunMapper, () => fin.listPaymentRuns(userFrom(request)))),
  // The bank upload file (full IBANs): POST only, accounting full, audited.
  http.post<Id>(`${API}/finance/payment-runs/:id/bank-file`, ({ request, params }) => respondAs(m.paymentRunFileMapper, () => fin.exportPaymentRunFile(userFrom(request), params.id))),
  http.post<Id>(`${API}/finance/payment-runs/:id/sent`, async ({ request, params }) => {
    const input = await body<{ bankReference?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.paymentRunMapper, () => fin.markPaymentRunSent(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/finance/payment-runs/:id/confirm`, async ({ request, params }) => {
    const input = await body<{ bankReference?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.paymentRunMapper, () => fin.confirmPaymentRun(userFrom(request), params.id, input))
  }),
  http.get<Id>(`${BP}/:id`, ({ request, params }) => respondAs(m.billPaymentMapper, () => fin.getBillPayment(userFrom(request), params.id))),
  http.post<Id>(`${BP}/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.purchasesPlainMapper)
    return respondAs(m.billPaymentMapper, () => fin.voidBillPayment(userFrom(request), params.id, input))
  }),

  /* ---- payables ---- */
  http.get(`${P}/aging`, ({ request }) => respondAs(m.apAgingMapper, () => fin.apAging(userFrom(request), { asOf: query(request).get('as_of') }))),
  http.get(`${P}/due`, ({ request }) => respondAs(m.dueBillMapper, () => fin.dueBills(userFrom(request), { days: query(request).get('days') }))),
  http.get(`${P}/overview`, ({ request }) => respondAs(m.payablesOverviewMapper, () => fin.getPayablesOverview(userFrom(request)))),
  http.get(`${API}/finance/event-costs`, ({ request }) => respondAs(m.eventCostsMapper, () => fin.eventCosts(userFrom(request), { eventId: query(request).get('event_id') }))),

  /* ---- approval rules ---- */
  http.get(`${API}/finance/approval-rules`, ({ request }) => respondAs(m.approvalRulesMapper, () => fin.getApprovalRules(userFrom(request)))),
  http.put(`${API}/finance/approval-rules`, async ({ request }) => {
    const input = await body<ApprovalRulesInput>(request, m.approvalRulesInputMapper)
    return respondAs(m.approvalRulesMapper, () => fin.saveApprovalRules(userFrom(request), input))
  }),
]
