import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › year-end close records (services/financeStatements.ts). One row per close of a fiscal year;
 * a re-open keeps the row (status `reopened`) and a new close adds a new row. Ids `YEC-<n>` are unique across
 * companies (financeSeq). No seed: both demo companies start with no closed year. Synthetic data only.
 */
export interface YearEndCloseRecord {
  id: string
  fiscalYearStart: string
  fiscalYearEnd: string
  status: 'closed' | 'reopened'
  netProfit: number
  /** The closing entry (null when the year had no income or expense to close). */
  journalEntryId: string | null
  /** The lock date before the close (restored on re-open). */
  previousLockDate: string | null
  note: string
  closedAt: string
  closedBy: string
  reopenedAt: string | null
  reopenedBy: string | null
  reopenReason: string | null
  reversalEntryId: string | null
}

export const finYearEndCloses = registerArray<Tenant<YearEndCloseRecord>>('fin.yearEndCloses', [])
