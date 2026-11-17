/** Lead query keys. Keys include the user id so a role switch never shows stale scope. */
export const leadKeys = {
  all: ['leads'] as const,
  list: (userId: string) => ['leads', 'list', userId] as const,
  detail: (userId: string, id: string) => ['leads', 'detail', userId, id] as const,
  activities: (userId: string, id: string) => ['leads', 'activities', userId, id] as const,
  notes: (userId: string, id: string) => ['leads', 'notes', userId, id] as const,
  tasks: (userId: string, id: string) => ['leads', 'tasks', userId, id] as const,
  duplicates: (company: string, email: string) => ['leads', 'duplicates', company, email] as const,
}
