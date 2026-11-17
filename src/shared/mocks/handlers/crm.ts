import { http, type HttpHandler } from 'msw'
import type { ContactInput, ContactUpdateInput, ContractInput, ContractUpdateInput, CustomerUpdateInput } from '@/modules/crm/types'
import * as svc from '@/shared/mocks/services/crm'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

/** CRM endpoints: customers (360° profile), contacts across leads and customers, contracts. */
export const crmHandlers: HttpHandler[] = [
  http.get(`${API}/customers`, ({ request }) => respond(() => svc.getCustomers(userFrom(request)))),
  http.get<Params>(`${API}/customers/:id`, ({ request, params }) =>
    respond(() => svc.getCustomer(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/customers/:id`, async ({ request, params }) => {
    const body = (await request.json()) as CustomerUpdateInput
    return respond(() => svc.updateCustomer(userFrom(request), params.id, body))
  }),

  http.get(`${API}/contacts`, ({ request }) => respond(() => svc.getContacts(userFrom(request)))),
  http.post(`${API}/contacts`, async ({ request }) => {
    const body = (await request.json()) as ContactInput
    return respond(() => svc.createContact(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/contacts/:id`, async ({ request, params }) => {
    const body = (await request.json()) as ContactUpdateInput
    return respond(() => svc.updateContact(userFrom(request), params.id, body))
  }),

  http.get(`${API}/contracts`, ({ request }) => respond(() => svc.getContracts(userFrom(request)))),
  http.post(`${API}/contracts`, async ({ request }) => {
    const body = (await request.json()) as ContractInput
    return respond(() => svc.createContract(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/contracts/:id`, async ({ request, params }) => {
    const body = (await request.json()) as ContractUpdateInput
    return respond(() => svc.updateContract(userFrom(request), params.id, body))
  }),
]
