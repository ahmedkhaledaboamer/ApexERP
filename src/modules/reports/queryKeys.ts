import type { CustomReportInput, SalesReportQuery } from '@/modules/reports/types'

/** Report query keys. Keys include the user id so a role switch never shows stale scope. */
export const reportKeys = {
  all: ['reports'] as const,
  sales: (userId: string, q: SalesReportQuery) =>
    ['reports', 'sales', userId, q.from, q.to, q.ownerId ?? '', q.departmentId ?? ''] as const,
  custom: (userId: string, input: CustomReportInput) =>
    ['reports', 'custom', userId, input.dimension, input.measure, input.from, input.to, input.ownerId ?? '', input.departmentId ?? ''] as const,
  schedules: (userId: string) => ['reports', 'schedules', userId] as const,
}
