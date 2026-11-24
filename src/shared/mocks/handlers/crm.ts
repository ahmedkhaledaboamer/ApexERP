import { http, type HttpHandler } from 'msw'
import type { ContactInput, ContactUpdateInput, ContractInput, ContractUpdateInput, CustomerCreateInput, CustomerUpdateInput } from '@/modules/crm/types'
import * as svc from '@/shared/mocks/services/crm'
import { contactInputMapper, contactRowMapper, customerCreateMapper, customerDetailMapper, customerRowMapper, customerUpdateMapper, contractInputMapper, contractRowMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

/** CRM endpoints: customers (360° profile), contacts across leads and customers, contracts. */
export const crmHandlers: HttpHandler[] = [
  http.get(`${API}/customers`, ({ request }) => respondAs(customerRowMapper, () => svc.getCustomers(userFrom(request)))),
  http.post(`${API}/customers`, async ({ request }) => {
    const body = await bodyAs<CustomerCreateInput>(request, customerCreateMapper)
    return respondAs(customerRowMapper, () => svc.createCustomer(userFrom(request), body))
  }),
  http.get<Params>(`${API}/customers/:id`, ({ request, params }) =>
    respondAs(customerDetailMapper, () => svc.getCustomer(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/customers/:id`, async ({ request, params }) => {
    const body = await bodyAs<CustomerUpdateInput>(request, customerUpdateMapper)
    return respondAs(customerRowMapper, () => svc.updateCustomer(userFrom(request), params.id, body))
  }),

  // Contacts speak the contacts table's columns (lead_id, is_decision_maker…) on the wire.
  http.get(`${API}/contacts`, ({ request }) => respondAs(contactRowMapper, () => svc.getContacts(userFrom(request)))),
  http.post(`${API}/contacts`, async ({ request }) => {
    const body = await bodyAs<ContactInput>(request, contactInputMapper)
    return respondAs(contactRowMapper, () => svc.createContact(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/contacts/:id`, async ({ request, params }) => {
    const body = await bodyAs<ContactUpdateInput>(request, contactInputMapper)
    return respondAs(contactRowMapper, () => svc.updateContact(userFrom(request), params.id, body))
  }),

  http.get(`${API}/contracts`, ({ request }) => respondAs(contractRowMapper, () => svc.getContracts(userFrom(request)))),
  http.post(`${API}/contracts`, async ({ request }) => {
    const body = await bodyAs<ContractInput>(request, contractInputMapper)
    return respondAs(contractRowMapper, () => svc.createContract(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/contracts/:id`, async ({ request, params }) => {
    const body = await bodyAs<ContractUpdateInput>(request, contractInputMapper)
    return respondAs(contractRowMapper, () => svc.updateContract(userFrom(request), params.id, body))
  }),
]
