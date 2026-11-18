import { http, type HttpHandler } from 'msw'
import type { QuotationDecision, QuotationInput, QuotationUpdateInput } from '@/modules/quotations/types'
import * as svc from '@/shared/mocks/services/quotations'
import { QUOTATION_QUERY, quotationInputMapper, quotationMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

/** Quotations speak the quotations / quotation_items columns on the wire (shared/api/mappers.ts). */
export const quotationsHandlers: HttpHandler[] = [
  http.get(`${API}/quotations`, ({ request }) => {
    const leadId = new URL(request.url).searchParams.get(QUOTATION_QUERY.leadId) ?? undefined
    return respondAs(quotationMapper, () => svc.getQuotations(userFrom(request), { leadId }))
  }),
  http.post(`${API}/quotations`, async ({ request }) => {
    const body = await bodyAs<QuotationInput>(request, quotationInputMapper)
    return respondAs(quotationMapper, () => svc.createQuotation(userFrom(request), body))
  }),
  http.get<Params>(`${API}/quotations/:id`, ({ request, params }) =>
    respondAs(quotationMapper, () => svc.getQuotation(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/quotations/:id`, async ({ request, params }) => {
    const body = await bodyAs<QuotationUpdateInput>(request, quotationInputMapper)
    return respondAs(quotationMapper, () => svc.updateQuotation(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/quotations/:id/send`, ({ request, params }) =>
    respondAs(quotationMapper, () => svc.sendQuotation(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/quotations/:id/status`, async ({ request, params }) => {
    const { status } = (await request.json()) as { status: QuotationDecision }
    return respondAs(quotationMapper, () => svc.setQuotationStatus(userFrom(request), params.id, status))
  }),
  // The client opened the shared document (mock "Open as customer"): sent → viewed.
  http.post<Params>(`${API}/quotations/:id/viewed`, ({ request, params }) =>
    respondAs(quotationMapper, () => svc.markQuotationViewed(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/quotations/:id/duplicate`, ({ request, params }) =>
    respondAs(quotationMapper, () => svc.duplicateQuotation(userFrom(request), params.id)),
  ),
]
