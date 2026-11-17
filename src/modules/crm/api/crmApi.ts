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

/** CRM API. Scope (own / team / full) is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getCustomers(): Promise<CustomerRow[]> {
  return (await http.get<CustomerRow[]>('/customers')).data
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  return (await http.get<CustomerDetail>(`/customers/${enc(id)}`)).data
}

export async function updateCustomer(id: string, input: CustomerUpdateInput): Promise<CustomerRow> {
  return (await http.patch<CustomerRow>(`/customers/${enc(id)}`, input)).data
}

export async function getContacts(): Promise<ContactRow[]> {
  return (await http.get<ContactRow[]>('/contacts')).data
}

export async function createContact(input: ContactInput): Promise<ContactRow> {
  return (await http.post<ContactRow>('/contacts', input)).data
}

export async function updateContact(id: string, input: ContactUpdateInput): Promise<ContactRow> {
  return (await http.patch<ContactRow>(`/contacts/${enc(id)}`, input)).data
}

export async function getContracts(): Promise<ContractRow[]> {
  return (await http.get<ContractRow[]>('/contracts')).data
}

export async function createContract(input: ContractInput): Promise<ContractRow> {
  return (await http.post<ContractRow>('/contracts', input)).data
}

export async function updateContract(id: string, input: ContractUpdateInput): Promise<ContractRow> {
  return (await http.patch<ContractRow>(`/contracts/${enc(id)}`, input)).data
}
