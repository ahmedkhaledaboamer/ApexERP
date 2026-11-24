import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financePurchasesMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type {
  ApprovalRulesInput,
  AttachmentInput,
  BillInput,
  BillPaymentInput,
  DebitNoteInput,
  PaymentRunInput,
  PoInput,
  SupplierCreateInput,
  SupplierProfileInput,
  SupplierAdvanceInput,
} from './types'

/** Accounts & finance › Purchases & payables (docs/API.md › Finance › Suppliers / Purchase orders / Bills / Approval rules). */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '' && v !== false) s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const S = '/finance/suppliers'
const PO = '/finance/purchase-orders'
const B = '/finance/bills'
const BP = '/finance/bill-payments'
const reason = (r: string) => m.purchasesPlainMapper.toApi({ reason: r })

export const purchasesApi = {
  meta: async () => m.purchasesMetaMapper.fromApi((await http.get<unknown>('/finance/purchases/meta')).data),
  /* suppliers */
  suppliers: async () => m.supplierRowMapper.fromApiList((await http.get<unknown>(S)).data),
  supplier: async (id: string) => m.supplierDetailMapper.fromApi((await http.get<unknown>(`${S}/${enc(id)}`)).data),
  createSupplier: async (input: SupplierCreateInput) => m.supplierDetailMapper.fromApi((await http.post<unknown>(S, m.supplierCreateInputMapper.toApi(input))).data),
  updateSupplier: async (id: string, input: SupplierProfileInput) => m.supplierDetailMapper.fromApi((await http.patch<unknown>(`${S}/${enc(id)}`, m.supplierProfileInputMapper.toApi(input))).data),
  revealIban: async (id: string) => (m.purchasesPlainMapper.fromApi((await http.post<unknown>(`${S}/${enc(id)}/reveal-iban`)).data) as { iban: string }).iban,
  statement: async (id: string, from?: string, to?: string) => m.supplierStatementMapper.fromApi((await http.get<unknown>(`${S}/${enc(id)}/statement${qs({ from, to })}`)).data),
  /* purchase orders */
  pos: async (q: { status?: string; vendorId?: string; view?: string } = {}) => m.poRowMapper.fromApiList((await http.get<unknown>(`${PO}${qs({ status: q.status, vendor_id: q.vendorId, view: q.view })}`)).data),
  po: async (id: string) => m.poMapper.fromApi((await http.get<unknown>(`${PO}/${enc(id)}`)).data),
  createPo: async (input: PoInput) => m.poMapper.fromApi((await http.post<unknown>(PO, m.poInputMapper.toApi(input))).data),
  updatePo: async (id: string, input: Partial<PoInput>) => m.poMapper.fromApi((await http.patch<unknown>(`${PO}/${enc(id)}`, m.poInputMapper.toApi(input as PoInput))).data),
  deletePo: async (id: string) => void (await http.delete(`${PO}/${enc(id)}`)),
  poAction: async (id: string, action: 'submit' | 'approve' | 'close') => m.poMapper.fromApi((await http.post<unknown>(`${PO}/${enc(id)}/${action}`)).data),
  rejectPo: async (id: string, r: string) => m.poMapper.fromApi((await http.post<unknown>(`${PO}/${enc(id)}/reject`, reason(r))).data),
  cancelPo: async (id: string, r: string) => m.poMapper.fromApi((await http.post<unknown>(`${PO}/${enc(id)}/cancel`, reason(r))).data),
  receivePo: async (id: string, input: { date?: string; note?: string; lines: { lineId: string; quantity: number }[] }) =>
    m.poMapper.fromApi((await http.post<unknown>(`${PO}/${enc(id)}/receive`, m.purchasesPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  /* bills */
  bills: async (q: { status?: string; vendorId?: string; poId?: string; overdue?: boolean; q?: string } = {}) =>
    m.billRowMapper.fromApiList((await http.get<unknown>(`${B}${qs({ status: q.status, vendor_id: q.vendorId, po_id: q.poId, overdue: q.overdue, q: q.q })}`)).data),
  bill: async (id: string) => m.billMapper.fromApi((await http.get<unknown>(`${B}/${enc(id)}`)).data),
  createBill: async (input: BillInput) => m.billMapper.fromApi((await http.post<unknown>(B, m.billInputMapper.toApi(input))).data),
  updateBill: async (id: string, input: BillInput) => m.billMapper.fromApi((await http.patch<unknown>(`${B}/${enc(id)}`, m.billInputMapper.toApi(input))).data),
  deleteBill: async (id: string) => void (await http.delete(`${B}/${enc(id)}`)),
  billAction: async (id: string, action: 'submit' | 'post' | 'approve') => m.billMapper.fromApi((await http.post<unknown>(`${B}/${enc(id)}/${action}`)).data),
  rejectBill: async (id: string, r: string) => m.billMapper.fromApi((await http.post<unknown>(`${B}/${enc(id)}/reject`, reason(r))).data),
  voidBill: async (id: string, r: string) => m.billMapper.fromApi((await http.post<unknown>(`${B}/${enc(id)}/void`, reason(r))).data),
  attach: async (id: string, input: AttachmentInput) => m.billMapper.fromApi((await http.post<unknown>(`${B}/${enc(id)}/attachments`, m.attachmentInputMapper.toApi(input))).data),
  detach: async (id: string, attachmentId: string) => m.billMapper.fromApi((await http.delete<unknown>(`${B}/${enc(id)}/attachments/${enc(attachmentId)}`)).data),
  /* debit notes */
  debitNotes: async (q: { billId?: string; vendorId?: string } = {}) => m.debitNoteMapper.fromApiList((await http.get<unknown>(`/finance/debit-notes${qs({ bill_id: q.billId, vendor_id: q.vendorId })}`)).data),
  createDebitNote: async (input: DebitNoteInput) => m.debitNoteMapper.fromApi((await http.post<unknown>('/finance/debit-notes', m.debitNoteInputMapper.toApi(input))).data),
  voidDebitNote: async (id: string, r: string) => m.debitNoteMapper.fromApi((await http.post<unknown>(`/finance/debit-notes/${enc(id)}/void`, reason(r))).data),
  /* supplier advances */
  advances: async (q: { vendorId?: string; status?: string; poId?: string } = {}) => m.supplierAdvanceMapper.fromApiList((await http.get<unknown>(`/finance/supplier-advances${qs({ vendor_id: q.vendorId, status: q.status, po_id: q.poId })}`)).data),
  createAdvance: async (input: SupplierAdvanceInput) => m.supplierAdvanceMapper.fromApi((await http.post<unknown>('/finance/supplier-advances', m.supplierAdvanceInputMapper.toApi(input))).data),
  applyAdvance: async (id: string, input: { billId: string; amount?: number; date?: string }) =>
    m.supplierAdvanceMapper.fromApi((await http.post<unknown>(`/finance/supplier-advances/${enc(id)}/apply`, m.purchasesPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  refundAdvance: async (id: string, input: { amount?: number; date?: string; accountId?: string; reference?: string }) =>
    m.supplierAdvanceMapper.fromApi((await http.post<unknown>(`/finance/supplier-advances/${enc(id)}/refund`, m.purchasesPlainMapper.toApi(input as unknown as Record<string, unknown>))).data),
  /* payment-run bank file */
  runBankFile: async (id: string) => m.paymentRunFileMapper.fromApi((await http.post<unknown>(`/finance/payment-runs/${enc(id)}/bank-file`)).data),
  runStatus: async (id: string, action: 'sent' | 'confirm', bankReference?: string) =>
    m.paymentRunMapper.fromApi((await http.post<unknown>(`/finance/payment-runs/${enc(id)}/${action}`, m.purchasesPlainMapper.toApi({ bankReference: bankReference ?? '' }))).data),
  /* payments */
  payments: async (q: { vendorId?: string; billId?: string } = {}) => m.billPaymentMapper.fromApiList((await http.get<unknown>(`${BP}${qs({ vendor_id: q.vendorId, bill_id: q.billId })}`)).data),
  payment: async (id: string) => m.billPaymentMapper.fromApi((await http.get<unknown>(`${BP}/${enc(id)}`)).data),
  pay: async (input: BillPaymentInput) => m.billPaymentMapper.fromApi((await http.post<unknown>(BP, m.billPaymentInputMapper.toApi(input))).data),
  run: async (input: PaymentRunInput) => m.paymentRunMapper.fromApi((await http.post<unknown>(`${BP}/run`, m.paymentRunInputMapper.toApi(input))).data),
  runs: async () => m.paymentRunMapper.fromApiList((await http.get<unknown>('/finance/payment-runs')).data),
  voidPayment: async (id: string, r: string) => m.billPaymentMapper.fromApi((await http.post<unknown>(`${BP}/${enc(id)}/void`, reason(r))).data),
  /* payables */
  aging: async (asOf?: string) => m.apAgingMapper.fromApi((await http.get<unknown>(`/finance/payables/aging${qs({ as_of: asOf })}`)).data),
  due: async (days = 7) => m.dueBillMapper.fromApiList((await http.get<unknown>(`/finance/payables/due${qs({ days })}`)).data),
  overview: async () => m.payablesOverviewMapper.fromApi((await http.get<unknown>('/finance/payables/overview')).data),
  eventCosts: async (eventId: string) => m.eventCostsMapper.fromApi((await http.get<unknown>(`/finance/event-costs${qs({ event_id: eventId })}`)).data),
  /* approval rules */
  rules: async () => m.approvalRulesMapper.fromApi((await http.get<unknown>('/finance/approval-rules')).data),
  saveRules: async (input: ApprovalRulesInput) => m.approvalRulesMapper.fromApi((await http.put<unknown>('/finance/approval-rules', m.approvalRulesInputMapper.toApi(input))).data),
}

/* ---------------- hooks ---------------- */

/** Every purchases query sits under ['finance', 'purchases', uid] (the ['finance'] invalidation refreshes them too). */
function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | boolean | object | undefined)[]) => ['finance', 'purchases', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

/** `full` writes; `view` reads; `hidden` = self-service purchase requests and approvals only. */
export function usePurchasesScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'accounting') : 'hidden'
  return { scope, canWrite: scope === 'full', canRead: scope === 'full' || scope === 'view', canEditRules: scope === 'full' && (user?.role === 'Company Admin' || user?.role === 'Accountant') }
}

export function usePurchasesMeta() {
  const key = useKey()
  return useQuery({ queryKey: key('meta'), queryFn: purchasesApi.meta, enabled: useOn(), retry: false, staleTime: 60_000 })
}
export function useSuppliers(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('suppliers'), queryFn: purchasesApi.suppliers, enabled: useOn(enabled), retry: false })
}
export function useSupplier(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('supplier', id ?? ''), queryFn: () => purchasesApi.supplier(id!), enabled: useOn(!!id), retry: false })
}
export function useSupplierStatement(id: string, from?: string, to?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('statement', id, from ?? '', to ?? ''), queryFn: () => purchasesApi.statement(id, from, to), enabled: useOn(!!id), retry: false })
}
export function usePurchaseOrders(q: { status?: string; vendorId?: string; view?: string } = {}) {
  const key = useKey()
  return useQuery({ queryKey: key('pos', q), queryFn: () => purchasesApi.pos(q), enabled: useOn(), retry: false })
}
export function usePurchaseOrder(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('po', id ?? ''), queryFn: () => purchasesApi.po(id!), enabled: useOn(!!id), retry: false })
}
export function useBills(q: { status?: string; vendorId?: string; poId?: string; overdue?: boolean; q?: string } = {}, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('bills', q), queryFn: () => purchasesApi.bills(q), enabled: useOn(enabled), retry: false })
}
export function useBill(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('bill', id ?? ''), queryFn: () => purchasesApi.bill(id!), enabled: useOn(!!id), retry: false })
}
export function useDebitNotes(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('debit-notes'), queryFn: () => purchasesApi.debitNotes(), enabled: useOn(enabled), retry: false })
}
export function useBillPayments(q: { vendorId?: string; billId?: string } = {}, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('payments', q), queryFn: () => purchasesApi.payments(q), enabled: useOn(enabled), retry: false })
}
export function useBillPayment(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('payment', id ?? ''), queryFn: () => purchasesApi.payment(id!), enabled: useOn(!!id), retry: false })
}
export function useApAging(asOf?: string, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('aging', asOf ?? ''), queryFn: () => purchasesApi.aging(asOf), enabled: useOn(enabled), retry: false })
}
export function useDueBills(days = 7, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('due', days), queryFn: () => purchasesApi.due(days), enabled: useOn(enabled), retry: false })
}
export function usePayablesOverview(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('overview'), queryFn: purchasesApi.overview, enabled: useOn(enabled), retry: false })
}
export function usePaymentRuns(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('runs'), queryFn: purchasesApi.runs, enabled: useOn(enabled), retry: false })
}
export function useSupplierAdvances(q: { vendorId?: string; status?: string; poId?: string } = {}, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('advances', q), queryFn: () => purchasesApi.advances(q), enabled: useOn(enabled), retry: false })
}

/** Saves a text file the API returned (bank upload files: never cached, never re-fetched by a GET). */
export function downloadTextFile(fileName: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useApprovalRules(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('rules'), queryFn: purchasesApi.rules, enabled: useOn(enabled), retry: false })
}

/** A mutation that refreshes every finance query and the bell on success. */
export function usePurchasesMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
