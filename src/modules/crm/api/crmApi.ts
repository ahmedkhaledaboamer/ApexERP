import { http } from '@/shared/lib/axios'
import type {
  ContactInput,
  ContactRow,
  ContactUpdateInput,
  ContractInput,
  ContractRow,
  ContractUpdateInput,
  CustomerDetail,
  CustomerRow,
  CustomerUpdateInput,
} from '@/modules/crm/types'
import { contactInputMapper, contactRowMapper, customerDetailMapper, customerRowMapper, customerUpdateMapper, contractInputMapper, contractRowMapper } from '@/shared/api/mappers'

/** CRM API. Scope (own / team / full) is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getCustomers(): Promise<CustomerRow[]> {
  return customerRowMapper.fromApiList((await http.get<unknown>('/customers')).data)
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  return customerDetailMapper.fromApi((await http.get<unknown>(`/customers/${enc(id)}`)).data)
}

export async function updateCustomer(id: string, input: CustomerUpdateInput): Promise<CustomerRow> {
  return customerRowMapper.fromApi((await http.patch<unknown>(`/customers/${enc(id)}`, customerUpdateMapper.toApi(input))).data)
}

/** Contacts come in the contacts table's column names (snake_case) and are mapped to the UI shape. */
export async function getContacts(): Promise<ContactRow[]> {
  return contactRowMapper.fromApiList((await http.get<unknown>('/contacts')).data)
}

export async function createContact(input: ContactInput): Promise<ContactRow> {
  return contactRowMapper.fromApi((await http.post<unknown>('/contacts', contactInputMapper.toApi(input))).data)
}

export async function updateContact(id: string, input: ContactUpdateInput): Promise<ContactRow> {
  return contactRowMapper.fromApi((await http.patch<unknown>(`/contacts/${enc(id)}`, contactInputMapper.toApi(input))).data)
}

export async function getContracts(): Promise<ContractRow[]> {
  return contractRowMapper.fromApiList((await http.get<unknown>('/contracts')).data)
}

export async function createContract(input: ContractInput): Promise<ContractRow> {
  return contractRowMapper.fromApi((await http.post<unknown>('/contracts', contractInputMapper.toApi(input))).data)
}

export async function updateContract(id: string, input: ContractUpdateInput): Promise<ContractRow> {
  return contractRowMapper.fromApi((await http.patch<unknown>(`/contracts/${enc(id)}`, contractInputMapper.toApi(input))).data)
}
