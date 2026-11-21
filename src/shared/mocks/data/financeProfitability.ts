import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'
import { DEFAULT_OVERDUE_AR_ALERT_PCT, DEFAULT_STANDARD_HOURS } from '@/modules/finance/profitability/calc'

/**
 * Accounts & finance › Profitability settings, one row per company (docs/API.md › Finance › Profitability;
 * DB-ALIGNMENT F-PR1). Created on the first PUT; a company without a row reads the defaults.
 */
export interface ProfitSettingsRecord {
  standardHoursPerMonth: number
  cashAlertThreshold: number | null
  overdueReceivablesAlertPct: number
  updatedAt: string | null
  updatedBy: string | null
}

export const profitSettings = registerArray<Tenant<ProfitSettingsRecord>>('fin.profitSettings', [])

export function profitSettingsOf(companyId: string): ProfitSettingsRecord {
  return (
    profitSettings.find((s) => s.companyId === companyId) ?? {
      standardHoursPerMonth: DEFAULT_STANDARD_HOURS,
      cashAlertThreshold: null,
      overdueReceivablesAlertPct: DEFAULT_OVERDUE_AR_ALERT_PCT,
      updatedAt: null,
      updatedBy: null,
    }
  )
}
