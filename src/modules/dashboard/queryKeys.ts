import type { DashboardPeriod } from '@/shared/types'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (userId: string, period: DashboardPeriod) => ['dashboard', 'summary', userId, period] as const,
}
