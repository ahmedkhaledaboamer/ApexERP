import type { DashboardPeriod, DashboardSummary } from '@/shared/types'
import { http } from '@/shared/lib/axios'
import { dashboardMapper } from '@/shared/api/mappers'

export async function getDashboardSummary(period: DashboardPeriod): Promise<DashboardSummary> {
  return dashboardMapper.fromApi((await http.get<unknown>('/dashboard/summary', { params: { period } })).data)
}
