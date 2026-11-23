import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › End-of-service (EOSB) provision (docs/API.md › Finance › EOSB provision; DB-ALIGNMENT F-B5).
 * One record per company and month (plus the `opening` catch-up at the first fiscal year the provision starts):
 * each employee's target provision (the gratuity owed if the contract ended that day) and the month's charge
 * (target − the employee's provision so far). Uses: the provision consumed by a paid final settlement.
 * Synthetic data only.
 */

export interface EosbRowRecord {
  employeeId: string
  departmentId: string | null
  /** Provision the employee should have at the period end (base currency). */
  target: number
  /** Posted for the period: target − provision before (negative = release). */
  charge: number
}

export interface EosbPeriodRecord {
  kind: 'opening' | 'month'
  /** yyyy-MM: the accrued month (opening: the first month of the fiscal year). */
  month: string
  /** Posting date: the month end (opening: the fiscal year start). */
  date: string
  status: 'posted' | 'nothing' | 'skipped_locked'
  entryId: string | null
  rows: EosbRowRecord[]
  note: string | null
  postedAt: string
  postedBy: string | null
}

export interface EosbUseRecord {
  employeeId: string
  settlementId: string
  date: string
  /** Provision consumed (Dr 2500). */
  amount: number
  /** Gratuity paid; gratuity − amount went to 6120 (negative = a release). */
  gratuity: number
}

export const finEosbPeriods = registerArray<Tenant<EosbPeriodRecord>>('fin.eosbPeriods', [])
export const finEosbUses = registerArray<Tenant<EosbUseRecord>>('fin.eosbUses', [])
