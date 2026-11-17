import { http, type HttpHandler } from 'msw'
import type { QuotationDecision, QuotationInput, QuotationUpdateInput } from '@/modules/quotations/types'
import * as svc from '@/shared/mocks/services/quotations'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

export const quotationsHandlers: HttpHandler[] = [
  http.get(`${API}/quotations`, ({ request }) => {
    const leadId = new URL(request.url).searchParams.get('leadId') ?? undefined
    return respond(() => svc.getQuotations(userFrom(request), { leadId }))
  }),
  http.post(`${API}/quotations`, async ({ request }) => {
    const body = (await request.json()) as QuotationInput
    return respond(() => svc.createQuotation(userFrom(request), body))
  }),
  http.get<Params>(`${API}/quotations/:id`, ({ request, params }) =>
    respond(() => svc.getQuotation(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/quotations/:id`, async ({ request, params }) => {
    const body = (await request.json()) as QuotationUpdateInput
    return respond(() => svc.updateQuotation(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/quotations/:id/send`, ({ request, params }) =>
    respond(() => svc.sendQuotation(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/quotations/:id/status`, async ({ request, params }) => {
    const { status } = (await request.json()) as { status: QuotationDecision }
    return respond(() => svc.setQuotationStatus(userFrom(request), params.id, status))
  }),
  http.post<Params>(`${API}/quotations/:id/duplicate`, ({ request, params }) =>
    respond(() => svc.duplicateQuotation(userFrom(request), params.id)),
  ),
]
