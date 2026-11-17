/** Target query keys. Keys include the user id so a role switch never shows stale scope. */
export const targetKeys = {
  all: ['targets'] as const,
  month: (userId: string, month: string) => ['targets', 'month', userId, month] as const,
  defaults: ['targets', 'defaults'] as const,
}
