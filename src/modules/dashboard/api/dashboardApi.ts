import type { DashboardPeriod, DashboardSummary } from '@/shared/types'
import { http } from '@/shared/lib/axios'

export async function getDashboardSummary(period: DashboardPeriod): Promise<DashboardSummary> {
  return (await http.get<DashboardSummary>('/dashboard/summary', { params: { period } })).data
}
