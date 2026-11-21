import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeCollectionsMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type {
  ApplyCreditInput,
  CollectionsSettingsInput,
  CustomerCreditInput,
  DunningPauseInput,
  PaymentInput,
  PaymentLinkInput,
  PdcActionInput,
  PdcInput,
  PublicPayInput,
  RefundInput,
} from './types'

/** Accounts & finance › Collections (docs/API.md › Finance › Payments, PDC, Receivables, Payment links). */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const F = '/finance'

export interface PaymentFilter {
  customerId?: string
  invoiceId?: string
  method?: string
  status?: string
  from?: string
  to?: string
  q?: string
}

export const collectionsApi = {
  payments: async (f: PaymentFilter = {}) =>
    m.paymentMapper.fromApiList((await http.get<unknown>(`${F}/payments${qs({ customer_id: f.customerId, invoice_id: f.invoiceId, method: f.method, status: f.status, from: f.from, to: f.to, q: f.q })}`)).data),
  payment: async (id: string) => m.paymentMapper.fromApi((await http.get<unknown>(`${F}/payments/${enc(id)}`)).data),
  receipt: async (id: string) => m.receiptMapper.fromApi((await http.get<unknown>(`${F}/payments/${enc(id)}/receipt`)).data),
  createPayment: async (input: PaymentInput) => m.paymentMapper.fromApi((await http.post<unknown>(`${F}/payments`, m.paymentInputMapper.toApi(input))).data),
  applyCredit: async (id: string, input: ApplyCreditInput) => m.paymentMapper.fromApi((await http.post<unknown>(`${F}/payments/${enc(id)}/apply-credit`, m.applyCreditInputMapper.toApi(input))).data),
  refund: async (id: string, input: RefundInput) => m.paymentMapper.fromApi((await http.post<unknown>(`${F}/payments/${enc(id)}/refund`, m.refundInputMapper.toApi(input))).data),
  applyCreditNote: async (id: string, input: ApplyCreditInput = {}) => m.creditNoteCreditMapper.fromApi((await http.post<unknown>(`${F}/credit-note-credits/${enc(id)}/apply`, m.applyCreditInputMapper.toApi(input))).data),
  refundCreditNote: async (id: string, input: RefundInput) => m.creditNoteCreditMapper.fromApi((await http.post<unknown>(`${F}/credit-note-credits/${enc(id)}/refund`, m.refundInputMapper.toApi(input))).data),
  voidPayment: async (id: string, reason: string) => m.paymentMapper.fromApi((await http.post<unknown>(`${F}/payments/${enc(id)}/void`, { reason })).data),
  depositAccounts: async () => m.depositAccountMapper.fromApiList((await http.get<unknown>(`${F}/deposit-accounts`)).data),
  openItems: async (customerId: string) => m.openItemsMapper.fromApi((await http.get<unknown>(`${F}/customers/${enc(customerId)}/open-items`)).data),

  pdcs: async (f: { status?: string; customerId?: string } = {}) => m.pdcMapper.fromApiList((await http.get<unknown>(`${F}/pdcs${qs({ status: f.status, customer_id: f.customerId })}`)).data),
  createPdc: async (input: PdcInput) => m.pdcMapper.fromApi((await http.post<unknown>(`${F}/pdcs`, m.pdcInputMapper.toApi(input))).data),
  pdcAction: async (id: string, action: 'deposit' | 'clear' | 'bounce', input: PdcActionInput = {}) =>
    m.pdcMapper.fromApi((await http.post<unknown>(`${F}/pdcs/${enc(id)}/${action}`, m.pdcActionInputMapper.toApi(input))).data),

  links: async (f: { invoiceId?: string } = {}) => m.paymentLinkMapper.fromApiList((await http.get<unknown>(`${F}/payment-links${qs({ invoice_id: f.invoiceId })}`)).data),
  createLink: async (input: PaymentLinkInput) => m.paymentLinkMapper.fromApi((await http.post<unknown>(`${F}/payment-links`, m.paymentLinkInputMapper.toApi(input))).data),
  voidLink: async (id: string) => m.paymentLinkMapper.fromApi((await http.post<unknown>(`${F}/payment-links/${enc(id)}/void`)).data),

  aging: async (asOf?: string) => m.agingReportMapper.fromApi((await http.get<unknown>(`${F}/receivables/aging${qs({ as_of: asOf })}`)).data),
  agingDetail: async (customerId: string, asOf?: string) => m.agingDetailMapper.fromApi((await http.get<unknown>(`${F}/receivables/aging/${enc(customerId)}${qs({ as_of: asOf })}`)).data),
  customers: async () => m.customerCreditMapper.fromApiList((await http.get<unknown>(`${F}/customers`)).data),
  credit: async (customerId: string) => m.customerCreditMapper.fromApi((await http.get<unknown>(`${F}/customers/${enc(customerId)}/credit`)).data),
  saveCredit: async (customerId: string, input: CustomerCreditInput) => m.customerCreditMapper.fromApi((await http.patch<unknown>(`${F}/customers/${enc(customerId)}/credit`, m.customerCreditInputMapper.toApi(input))).data),
  statement: async (customerId: string, from?: string, to?: string) => m.statementMapper.fromApi((await http.get<unknown>(`${F}/customers/${enc(customerId)}/statement${qs({ from, to })}`)).data),
  emailStatement: async (customerId: string, body: { from?: string; to?: string; email?: string }) =>
    m.finPlainMapper.fromApi((await http.post<unknown>(`${F}/customers/${enc(customerId)}/statement/email`, body)).data) as { sentTo: string; closingBalance: number },
  creditCheck: async (q: { leadId?: string; customerId?: string; amount?: number; currency?: string }) =>
    m.creditCheckMapper.fromApi((await http.get<unknown>(`${F}/credit-check${qs({ lead_id: q.leadId, customer_id: q.customerId, amount: q.amount, currency: q.currency })}`)).data),

  settings: async () => m.collectionsSettingsMapper.fromApi((await http.get<unknown>(`${F}/collections/settings`)).data),
  saveSettings: async (input: CollectionsSettingsInput) => m.collectionsSettingsMapper.fromApi((await http.patch<unknown>(`${F}/collections/settings`, m.collectionsSettingsInputMapper.toApi(input))).data),
  dunningLog: async (f: { invoiceId?: string; customerId?: string } = {}) => m.dunningLogMapper.fromApiList((await http.get<unknown>(`${F}/dunning/log${qs({ invoice_id: f.invoiceId, customer_id: f.customerId })}`)).data),
  pause: async (input: DunningPauseInput) => m.finPlainMapper.fromApi((await http.post<unknown>(`${F}/dunning/pause`, m.dunningPauseInputMapper.toApi(input))).data),

  publicPayment: async (token: string) => m.publicPaymentMapper.fromApi((await http.get<unknown>(`/public/pay/${enc(token)}`)).data),
  payPublic: async (token: string, input: PublicPayInput) => m.publicPayResultMapper.fromApi((await http.post<unknown>(`/public/pay/${enc(token)}`, m.publicPayInputMapper.toApi(input))).data),
}

/* ---------------- hooks ---------------- */

/** Every collections query sits under ['finance', 'collections', uid]. */
function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | object | undefined)[]) => ['finance', 'collections', uid, ...rest] as const
}

/** The caller's accounting scope: `full` records and changes; `view` reads; hidden never reaches the pages. */
export function useFinanceScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'accounting') : 'hidden'
  return { scope, canWrite: scope === 'full', canRead: scope !== 'hidden' }
}

function useOn(enabled = true) {
  const ent = useEntitlements()
  const { canRead } = useFinanceScope()
  return enabled && canRead && ent.hasModule('accounting')
}

export function useInvalidateCollections() {
  const qc = useQueryClient()
  return () => {
    // Payments move invoice balances and the ledger too: refresh every finance query and the bell.
    void qc.invalidateQueries({ queryKey: ['finance'] })
    void qc.invalidateQueries({ queryKey: ['alerts'] })
  }
}

export function useCollectionsMutation<A, R>(fn: (args: A) => Promise<R>) {
  const invalidate = useInvalidateCollections()
  return useMutation({ mutationFn: fn, onSuccess: invalidate })
}

export function usePayments(f: PaymentFilter = {}, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('payments', f), queryFn: () => collectionsApi.payments(f), enabled: useOn(enabled), retry: false })
}
export function usePayment(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('payment', id ?? ''), queryFn: () => collectionsApi.payment(id!), enabled: useOn(!!id), retry: false })
}
export function useReceipt(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('receipt', id), queryFn: () => collectionsApi.receipt(id), enabled: useOn(!!id), retry: false })
}
export function useDepositAccounts(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('deposit-accounts'), queryFn: collectionsApi.depositAccounts, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
export function useOpenItems(customerId: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('open-items', customerId ?? ''), queryFn: () => collectionsApi.openItems(customerId!), enabled: useOn(!!customerId), retry: false })
}
export function usePdcs(f: { status?: string } = {}, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('pdcs', f), queryFn: () => collectionsApi.pdcs(f), enabled: useOn(enabled), retry: false })
}
export function usePaymentLinks(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('links'), queryFn: () => collectionsApi.links(), enabled: useOn(enabled), retry: false })
}
export function useAging(asOf: string | undefined, enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('aging', asOf ?? ''), queryFn: () => collectionsApi.aging(asOf), enabled: useOn(enabled), retry: false })
}
export function useAgingDetail(customerId: string | null, asOf: string | undefined) {
  const key = useKey()
  return useQuery({ queryKey: key('aging-detail', customerId ?? '', asOf ?? ''), queryFn: () => collectionsApi.agingDetail(customerId!, asOf), enabled: useOn(!!customerId), retry: false })
}
export function useCustomerCredits(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('customers'), queryFn: collectionsApi.customers, enabled: useOn(enabled), retry: false })
}
export function useCustomerCredit(customerId: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('credit', customerId ?? ''), queryFn: () => collectionsApi.credit(customerId!), enabled: useOn(!!customerId), retry: false })
}
export function useStatement(customerId: string | null, from?: string, to?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('statement', customerId ?? '', from ?? '', to ?? ''), queryFn: () => collectionsApi.statement(customerId!, from, to), enabled: useOn(!!customerId), retry: false })
}
export function useCollectionsSettings(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('settings'), queryFn: collectionsApi.settings, enabled: useOn(enabled), retry: false })
}
export function useDunningLog(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('dunning-log'), queryFn: () => collectionsApi.dunningLog(), enabled: useOn(enabled), retry: false })
}
/** The quotation form's credit check: any sales or accounting role; quiet when the plan has no accounting. */
export function useCreditCheck(q: { leadId?: string; amount: number; currency?: string }) {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  const ent = useEntitlements()
  const amount = Math.round(q.amount)
  return useQuery({
    queryKey: ['finance', 'credit-check', uid, q.leadId ?? '', amount, q.currency ?? ''],
    queryFn: () => collectionsApi.creditCheck({ leadId: q.leadId, amount, currency: q.currency }),
    enabled: !!q.leadId && ent.hasModule('accounting'),
    retry: false,
    staleTime: 30_000,
  })
}
