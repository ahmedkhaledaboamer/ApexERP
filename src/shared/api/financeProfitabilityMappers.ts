import { defineMapper } from './mapping'
import type {
  CustomerProfitability,
  DepartmentPnl,
  EventProfitability,
  ProfitExport,
  ProfitOptions,
  ProfitSettings,
  ProfitSettingsInput,
  ProjectProfitability,
  ProjectProfitDetail,
} from '@/modules/finance/profitability/types'

/**
 * Accounts & finance › Profitability (docs/API.md › Finance › Profitability). Mechanical snake_case at any depth: every
 * answer holds arrays only (no data-keyed maps), so no data value is ever renamed. Export `rows` are arrays of cells.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const profitOptionsMapper = deep<ProfitOptions>()
export const projectProfitabilityMapper = deep<ProjectProfitability>()
export const projectProfitDetailMapper = deep<ProjectProfitDetail>()
export const eventProfitabilityMapper = deep<EventProfitability>()
export const customerProfitabilityMapper = deep<CustomerProfitability>()
export const departmentPnlMapper = deep<DepartmentPnl>()
export const profitExportMapper = deep<ProfitExport>()
export const profitSettingsMapper = deep<ProfitSettings>()
export const profitSettingsInputMapper = deep<ProfitSettingsInput>()
