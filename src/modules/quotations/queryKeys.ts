/** Quotation query keys. Keys include the user id so a role switch never shows stale scope. */
export const quotationKeys = {
  all: ['quotations'] as const,
  lists: () => ['quotations', 'list'] as const,
  list: (userId: string, leadId?: string) => ['quotations', 'list', userId, leadId ?? 'all'] as const,
  detail: (userId: string, id: string) => ['quotations', 'detail', userId, id] as const,
}
