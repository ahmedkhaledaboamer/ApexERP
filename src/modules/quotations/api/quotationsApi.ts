import { http } from '@/shared/lib/axios'
import type { Quotation, QuotationDecision, QuotationInput, QuotationUpdateInput } from '@/modules/quotations/types'

/** Quotations API. Scope follows the lead's owner and is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getQuotations(params: { leadId?: string } = {}): Promise<Quotation[]> {
  const query = params.leadId ? { leadId: params.leadId } : undefined
  return (await http.get<Quotation[]>('/quotations', { params: query })).data
}

export async function getQuotation(id: string): Promise<Quotation> {
  return (await http.get<Quotation>(`/quotations/${enc(id)}`)).data
}

export async function createQuotation(input: QuotationInput): Promise<Quotation> {
  return (await http.post<Quotation>('/quotations', input)).data
}

/** Only Draft quotations can be changed. */
export async function updateQuotation(id: string, input: QuotationUpdateInput): Promise<Quotation> {
  return (await http.patch<Quotation>(`/quotations/${enc(id)}`, input)).data
}

/** Draft → Sent. Moves an earlier-stage lead to Proposal and logs the email on the lead. */
export async function sendQuotation(id: string): Promise<Quotation> {
  return (await http.post<Quotation>(`/quotations/${enc(id)}/send`)).data
}

export async function setQuotationStatus(id: string, status: QuotationDecision): Promise<Quotation> {
  return (await http.post<Quotation>(`/quotations/${enc(id)}/status`, { status })).data
}

/** Copies a quotation into a new Draft with fresh validity. */
export async function duplicateQuotation(id: string): Promise<Quotation> {
  return (await http.post<Quotation>(`/quotations/${enc(id)}/duplicate`)).data
}
