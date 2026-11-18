import { http } from '@/shared/lib/axios'
import type { Quotation, QuotationDecision, QuotationInput, QuotationUpdateInput } from '@/modules/quotations/types'
import { QUOTATION_QUERY, quotationInputMapper, quotationMapper } from '@/shared/api/mappers'

/**
 * Quotations API. Scope follows the lead's owner and is decided by the server from the auth token.
 * The API speaks the quotations / quotation_items columns (lead_id, valid_until, unit_price…); every
 * function maps both ways (shared/api/mappers.ts).
 */

const enc = encodeURIComponent

export async function getQuotations(params: { leadId?: string } = {}): Promise<Quotation[]> {
  const query = params.leadId ? { [QUOTATION_QUERY.leadId]: params.leadId } : undefined
  return quotationMapper.fromApiList((await http.get<unknown>('/quotations', { params: query })).data)
}

export async function getQuotation(id: string): Promise<Quotation> {
  return quotationMapper.fromApi((await http.get<unknown>(`/quotations/${enc(id)}`)).data)
}

export async function createQuotation(input: QuotationInput): Promise<Quotation> {
  return quotationMapper.fromApi((await http.post<unknown>('/quotations', quotationInputMapper.toApi(input))).data)
}

/** Only Draft quotations can be changed. */
export async function updateQuotation(id: string, input: QuotationUpdateInput): Promise<Quotation> {
  return quotationMapper.fromApi((await http.patch<unknown>(`/quotations/${enc(id)}`, quotationInputMapper.toApi(input))).data)
}

/** Draft → Sent. Moves an earlier-stage lead to Proposal and logs the email on the lead. */
export async function sendQuotation(id: string): Promise<Quotation> {
  return quotationMapper.fromApi((await http.post<unknown>(`/quotations/${enc(id)}/send`)).data)
}

export async function setQuotationStatus(id: string, status: QuotationDecision): Promise<Quotation> {
  return quotationMapper.fromApi((await http.post<unknown>(`/quotations/${enc(id)}/status`, { status })).data)
}

/** The client opened the shared document (mock "Open as customer"): sent → viewed. */
export async function markQuotationViewed(id: string): Promise<Quotation> {
  return quotationMapper.fromApi((await http.post<unknown>(`/quotations/${enc(id)}/viewed`)).data)
}

/** Copies a quotation into a new Draft with fresh validity. */
export async function duplicateQuotation(id: string): Promise<Quotation> {
  return quotationMapper.fromApi((await http.post<unknown>(`/quotations/${enc(id)}/duplicate`)).data)
}
