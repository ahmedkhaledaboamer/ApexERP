/** CRM query keys. Keys include the user id so a role switch never shows stale scope. */
export const crmKeys = {
  all: ['crm'] as const,
  customers: (userId: string) => ['crm', 'customers', userId] as const,
  customer: (userId: string, id: string) => ['crm', 'customer', userId, id] as const,
  contacts: (userId: string) => ['crm', 'contacts', userId] as const,
  contracts: (userId: string) => ['crm', 'contracts', userId] as const,
}
