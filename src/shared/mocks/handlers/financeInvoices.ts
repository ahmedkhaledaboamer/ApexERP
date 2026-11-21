import { http, type HttpHandler } from 'msw'
import type { CreditNoteInput, InvoiceFromSourceInput, InvoiceInput, RecurringInput, RecurringUpdate, SendInput } from '@/modules/finance/invoices/types'
import * as fin from '@/shared/mocks/services/financeInvoices'
import * as m from '@/shared/api/financeInvoicesMappers'
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
const I = `${API}/finance/invoices`
const CN = `${API}/finance/credit-notes`
const R = `${API}/finance/recurring-invoices`

/**
 * Accounts & finance › Invoices, credit notes, recurring invoices and ZATCA data (docs/API.md › Finance).
 * Plan module `accounting` (the /finance path gate); `accounting` column: full writes, view reads, hidden 403.
 * Static paths before `:id`. Replaces the old billing stub of GET /finance/invoices.
 */
export const financeInvoicesHandlers: HttpHandler[] = [
  /* ---- invoices ---- */
  http.get(I, ({ request }) => {
    const q = query(request)
    return respondAs(m.invoiceRowMapper, () =>
      fin.listInvoices(userFrom(request), {
        status: q.get('status') ?? undefined,
        customerId: q.get('customer_id') ?? undefined,
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
        overdue: q.get('overdue') === 'true',
        q: q.get('q') ?? undefined,
      }),
    )
  }),
  http.post(I, async ({ request }) => {
    const input = await body<InvoiceInput>(request, m.invoiceInputMapper)
    return respondAs(m.invoiceDetailMapper, () => fin.createInvoice(userFrom(request), input))
  }),
  http.get(`${I}/meta`, ({ request }) => respondAs(m.invoiceMetaMapper, () => fin.invoiceMeta(userFrom(request)))),
  http.get(`${I}/sources`, ({ request }) => respondAs(m.invoiceSourcesMapper, () => fin.invoiceSources(userFrom(request)))),
  http.post(`${I}/from-source`, async ({ request }) => {
    const input = await body<InvoiceFromSourceInput>(request, m.invoiceFromSourceMapper)
    return respondAs(m.invoiceDetailMapper, () => fin.createFromSource(userFrom(request), input))
  }),
  http.get<Id>(`${I}/:id`, ({ request, params }) => respondAs(m.invoiceDetailMapper, () => fin.getInvoice(userFrom(request), params.id))),
  http.patch<Id>(`${I}/:id`, async ({ request, params }) => {
    const input = await body<Partial<InvoiceInput>>(request, m.invoiceInputMapper)
    return respondAs(m.invoiceDetailMapper, () => fin.updateInvoice(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${I}/:id`, ({ request, params }) => respondAs(m.financePlainMapper, () => fin.deleteInvoice(userFrom(request), params.id))),
  http.post<Id>(`${I}/:id/issue`, ({ request, params }) => respondAs(m.invoiceDetailMapper, () => fin.issueInvoice(userFrom(request), params.id))),
  http.post<Id>(`${I}/:id/void`, async ({ request, params }) => {
    const input = await body<{ reason?: unknown }>(request, m.financePlainMapper)
    return respondAs(m.invoiceDetailMapper, () => fin.voidInvoice(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${I}/:id/send`, async ({ request, params }) => {
    const input = await body<SendInput>(request, m.invoiceSendMapper)
    return respondAs(m.invoiceDetailMapper, () => fin.sendInvoice(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${I}/:id/zatca-xml`, ({ request, params }) => respondAs(m.xmlFileMapper, () => fin.invoiceXml(userFrom(request), params.id))),

  /* ---- credit notes ---- */
  http.get(CN, ({ request }) => respondAs(m.creditNoteMapper, () => fin.listCreditNotes(userFrom(request), { invoiceId: query(request).get('invoice_id') }))),
  http.post(CN, async ({ request }) => {
    const input = await body<CreditNoteInput>(request, m.creditNoteInputMapper)
    return respondAs(m.creditNoteMapper, () => fin.createCreditNote(userFrom(request), input))
  }),
  http.get<Id>(`${CN}/:id`, ({ request, params }) => respondAs(m.creditNoteMapper, () => fin.getCreditNote(userFrom(request), params.id))),
  http.post<Id>(`${CN}/:id/zatca-xml`, ({ request, params }) => respondAs(m.xmlFileMapper, () => fin.creditNoteXml(userFrom(request), params.id))),

  /* ---- recurring invoices ---- */
  http.get(R, ({ request }) => respondAs(m.recurringMapper, () => fin.listRecurring(userFrom(request)))),
  http.post(R, async ({ request }) => {
    const input = await body<RecurringInput>(request, m.recurringInputMapper)
    return respondAs(m.recurringMapper, () => fin.createRecurring(userFrom(request), input))
  }),
  http.get<Id>(`${R}/:id`, ({ request, params }) => respondAs(m.recurringMapper, () => fin.getRecurring(userFrom(request), params.id))),
  http.patch<Id>(`${R}/:id`, async ({ request, params }) => {
    const input = await body<RecurringUpdate>(request, m.recurringUpdateMapper)
    return respondAs(m.recurringMapper, () => fin.updateRecurring(userFrom(request), params.id, input))
  }),
]
