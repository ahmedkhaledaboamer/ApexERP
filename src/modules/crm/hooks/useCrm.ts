import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { crmKeys } from '@/modules/crm/queryKeys'
import { leadKeys } from '@/modules/leads/queryKeys'
import {
  createContact,
  createContract,
  getContacts,
  getContracts,
  getCustomer,
  getCustomers,
  updateContact,
  updateContract,
  updateCustomer,
} from '@/modules/crm/api/crmApi'
import type { ContactInput, ContactUpdateInput, ContractInput, ContractUpdateInput, CustomerUpdateInput } from '@/modules/crm/types'
import { scopeOf } from '@/shared/lib/permissions'
import { getUsers } from '@/modules/auth/api/authApi'
import { useCurrentUser } from '@/store/hooks'

/** The signed-in user; CRM hooks are only mounted inside the protected app. */
function useUserOrThrow() {
  const user = useCurrentUser()
  if (!user) throw new Error('CRM hooks need a signed-in user.')
  return user
}

export function useCustomersQuery() {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: crmKeys.customers(user.id),
    queryFn: getCustomers,
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
    // A lead won elsewhere should show up here straight away.
    staleTime: 0,
  })
}

export function useCustomerQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({ queryKey: crmKeys.customer(user.id, id), queryFn: () => getCustomer(id) })
}

export function useContactsQuery() {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: crmKeys.contacts(user.id),
    queryFn: getContacts,
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
    staleTime: 0,
  })
}

export function useContractsQuery() {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: crmKeys.contracts(user.id),
    queryFn: getContracts,
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CustomerUpdateInput }) => updateCustomer(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.all }),
  })
}

/** Contacts also show on the lead page, so lead caches refresh too. */
export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ContactInput) => createContact(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.all })
      qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ContactUpdateInput }) => updateContact(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmKeys.all })
      qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}

export function useCreateContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ContractInput) => createContract(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.all }),
  })
}

export function useUpdateContract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ContractUpdateInput }) => updateContract(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.all }),
  })
}

/** Everyone in the company, for owner pickers. */
export function useUsersQuery() {
  return useQuery({ queryKey: ['users', 'list'] as const, queryFn: getUsers, staleTime: 5 * 60_000 })
}
