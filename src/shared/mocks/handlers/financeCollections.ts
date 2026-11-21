import { http, type HttpHandler } from 'msw'
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
} from '@/modules/finance/collections/types'
import * as pay from '@/shared/mocks/services/financeCollections'
import * as rec from '@/shared/mocks/services/financeReceivables'
import * as m from '@/shared/api/financeCollectionsMappers'
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
const F = `${API}/finance`

/**
 * Accounts & finance › Collections (docs/API.md › Finance › Payments, PDC, Receivables, Payment links). Plan module
 * `accounting` (the `/finance` path gate); `accounting` column: full writes, view reads, hidden 403. The public pay
 * page (/public/pay/:token) needs no sign-in. Static paths before `:id`.
 */
export const financeCollectionsHandlers: HttpHandler[] = [
  /* ---- payments ---- */
  http.get(`${F}/payments`, ({ request }) => {
    const q = query(request)
    return respondAs(m.paymentMapper, () =>
      pay.listPayments(userFrom(request), { customerId: q.get('customer_id'), invoiceId: q.get('invoice_id'), method: q.get('method'), status: q.get('status'), from: q.get('from'), to: q.get('to'), q: q.get('q') }),
    )
  }),
  http.post(`${F}/payments`, async ({ request }) => {
    const input = await body<PaymentInput>(request, m.paymentInputMapper)
    return respondAs(m.paymentMapper, () => pay.createPayment(userFrom(request), input))
  }),
  http.get(`${F}/deposit-accounts`, ({ request }) => respondAs(m.depositAccountMapper, () => pay.listDepositAccounts(userFrom(request)))),
  http.get<Id>(`${F}/payments/:id`, ({ request, params }) => respondAs(m.paymentMapper, () => pay.getPayment(userFrom(request), params.id))),
  http.get<Id>(`${F}/payments/:id/receipt`, ({ request, params }) => respondAs(m.receiptMapper, () => pay.getReceipt(userFrom(request), params.id))),
  http.post<Id>(`${F}/payments/:id/apply-credit`, async ({ request, params }) => {
    const input = await body<ApplyCreditInput>(request, m.applyCreditInputMapper)
    return respondAs(m.paymentMapper, () => pay.applyCredit(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/payments/:id/refund`, async ({ request, params }) => {
    const input = await body<RefundInput>(request, m.refundInputMapper)
    return respondAs(m.paymentMapper, () => pay.refundPayment(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/payments/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.finPlainMapper)
    return respondAs(m.paymentMapper, () => pay.voidPayment(userFrom(request), params.id, input))
  }),


  /* ---- credit-note excess (customer credit) ---- */
  http.post<Id>(`${F}/credit-note-credits/:id/apply`, async ({ request, params }) => {
    const input = await body<ApplyCreditInput>(request, m.applyCreditInputMapper)
    return respondAs(m.creditNoteCreditMapper, () => pay.applyCreditNote(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${F}/credit-note-credits/:id/refund`, async ({ request, params }) => {
    const input = await body<RefundInput>(request, m.refundInputMapper)
    return respondAs(m.creditNoteCreditMapper, () => pay.refundCreditNote(userFrom(request), params.id, input))
  }),
  /* ---- post-dated cheques ---- */
  http.get(`${F}/pdcs`, ({ request }) => {
    const q = query(request)
    return respondAs(m.pdcMapper, () => pay.listPdcs(userFrom(request), { status: q.get('status'), customerId: q.get('customer_id') }))
  }),
  http.post(`${F}/pdcs`, async ({ request }) => {
    const input = await body<PdcInput>(request, m.pdcInputMapper)
    return respondAs(m.pdcMapper, () => pay.createPdc(userFrom(request), input))
  }),
  http.get<Id>(`${F}/pdcs/:id`, ({ request, params }) => respondAs(m.pdcMapper, () => pay.getPdc(userFrom(request), params.id))),
  ...(['deposit', 'clear', 'bounce'] as const).map((action) =>
    http.post<Id>(`${F}/pdcs/:id/${action}`, async ({ request, params }) => {
      const input = await body<PdcActionInput>(request, m.pdcActionInputMapper)
      const fn = action === 'deposit' ? pay.depositPdc : action === 'clear' ? pay.clearPdc : pay.bouncePdc
      return respondAs(m.pdcMapper, () => fn(userFrom(request), params.id, input))
    }),
  ),

  /* ---- payment links ---- */
  http.get(`${F}/payment-links`, ({ request }) => {
    const q = query(request)
    return respondAs(m.paymentLinkMapper, () => pay.listPaymentLinks(userFrom(request), { invoiceId: q.get('invoice_id'), status: q.get('status') }))
  }),
  http.post(`${F}/payment-links`, async ({ request }) => {
    const input = await body<PaymentLinkInput>(request, m.paymentLinkInputMapper)
    return respondAs(m.paymentLinkMapper, () => pay.createPaymentLink(userFrom(request), input))
  }),
  http.post<Id>(`${F}/payment-links/:id/void`, ({ request, params }) => respondAs(m.paymentLinkMapper, () => pay.voidPaymentLink(userFrom(request), params.id))),

  /* ---- receivables ---- */
  http.get(`${F}/receivables/aging`, ({ request }) => respondAs(m.agingReportMapper, () => rec.getAging(userFrom(request), { asOf: query(request).get('as_of') }))),
  http.get<Id>(`${F}/receivables/aging/:id`, ({ request, params }) => respondAs(m.agingDetailMapper, () => rec.getAgingDetail(userFrom(request), params.id, { asOf: query(request).get('as_of') }))),
  http.get(`${F}/customers`, ({ request }) => respondAs(m.customerCreditMapper, () => rec.listCustomerCredit(userFrom(request)))),
  http.get<Id>(`${F}/customers/:id/credit`, ({ request, params }) => respondAs(m.customerCreditMapper, () => rec.getCustomerCredit(userFrom(request), params.id))),
  http.patch<Id>(`${F}/customers/:id/credit`, async ({ request, params }) => {
    const input = await body<CustomerCreditInput>(request, m.customerCreditInputMapper)
    return respondAs(m.customerCreditMapper, () => rec.updateCustomerCredit(userFrom(request), params.id, input))
  }),
  http.get<Id>(`${F}/customers/:id/open-items`, ({ request, params }) => respondAs(m.openItemsMapper, () => pay.getOpenItems(userFrom(request), params.id))),
  http.get<Id>(`${F}/customers/:id/statement`, ({ request, params }) => {
    const q = query(request)
    return respondAs(m.statementMapper, () => rec.getStatement(userFrom(request), params.id, { from: q.get('from'), to: q.get('to') }))
  }),
  http.post<Id>(`${F}/customers/:id/statement/email`, async ({ request, params }) => {
    const input = await body<{ from?: unknown; to?: unknown; email?: unknown }>(request, m.finPlainMapper)
    return respondAs(m.finPlainMapper, () => rec.emailStatement(userFrom(request), params.id, input))
  }),
  http.get(`${F}/credit-check`, ({ request }) => {
    const q = query(request)
    return respondAs(m.creditCheckMapper, () => rec.creditCheck(userFrom(request), { leadId: q.get('lead_id'), customerId: q.get('customer_id'), amount: q.get('amount'), currency: q.get('currency') }))
  }),

  /* ---- dunning & settings ---- */
  http.get(`${F}/collections/settings`, ({ request }) => respondAs(m.collectionsSettingsMapper, () => pay.getCollectionsSettings(userFrom(request)))),
  http.patch(`${F}/collections/settings`, async ({ request }) => {
    const input = await body<CollectionsSettingsInput>(request, m.collectionsSettingsInputMapper)
    return respondAs(m.collectionsSettingsMapper, () => pay.updateCollectionsSettings(userFrom(request), input))
  }),
  http.get(`${F}/dunning/log`, ({ request }) => {
    const q = query(request)
    return respondAs(m.dunningLogMapper, () => rec.listDunningLog(userFrom(request), { invoiceId: q.get('invoice_id'), customerId: q.get('customer_id') }))
  }),
  http.post(`${F}/dunning/pause`, async ({ request }) => {
    const input = await body<DunningPauseInput>(request, m.dunningPauseInputMapper)
    return respondAs(m.finPlainMapper, () => rec.setDunningPause(userFrom(request), input))
  }),

  /* ---- public pay page (no auth) ---- */
  http.get<{ token: string }>(`${API}/public/pay/:token`, ({ params }) => respondAs(m.publicPaymentMapper, () => pay.getPublicPayment(params.token))),
  http.post<{ token: string }>(`${API}/public/pay/:token`, async ({ request, params }) => {
    const input = await body<PublicPayInput>(request, m.publicPayInputMapper)
    const client = request.headers.get('X-Client-Id')?.trim() || 'anonymous'
    return respondAs(m.publicPayResultMapper, () => pay.payPublic(params.token, input, client))
  }),
]
