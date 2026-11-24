import { defineMapper } from './mapping'
import type { CompanyPerformance } from '@/modules/reports/performance/types'
import type { ReportsHub } from '@/modules/reports/hub/types'

/**
 * Reports › Company performance and Reports hub (docs/API.md › Reports). Mechanical snake_case at any depth: arrays
 * only (no data-keyed maps), so no data value is ever renamed.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const companyPerformanceMapper = deep<CompanyPerformance>()
export const reportsHubMapper = deep<ReportsHub>()
export const hubRecentInputMapper = deep<{ reportId: string }>()
