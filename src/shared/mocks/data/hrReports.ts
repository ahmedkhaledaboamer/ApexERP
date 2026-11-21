import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * HR › Reports settings, one row per company (docs/API.md › HR › HR reports; DB-ALIGNMENT H-RP1):
 *   nationalisationTargetPct  the company's own Emiratisation / Saudization target (internal tracker), null = not set
 *   trainingBudgets           the training budget per calendar year (company currency)
 * Created on the first PUT; a company without a row reads the defaults (no target, no budget).
 */
export interface ReportSettingsRecord {
  nationalisationTargetPct: number | null
  trainingBudgets: { year: number; amount: number }[]
  updatedAt: string | null
  updatedBy: string | null
}

export const hrReportSettings = registerArray<Tenant<ReportSettingsRecord>>('hr.reportSettings', [])

export function reportSettingsOf(companyId: string): ReportSettingsRecord {
  return hrReportSettings.find((s) => s.companyId === companyId) ?? { nationalisationTargetPct: null, trainingBudgets: [], updatedAt: null, updatedBy: null }
}
