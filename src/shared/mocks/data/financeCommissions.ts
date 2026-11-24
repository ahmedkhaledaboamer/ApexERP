import type { Role } from '@/shared/types'
import type { CommissionApproval, CommissionBasis, CommissionLine, CommissionStatus, CommissionTier } from '@/modules/finance/commissions/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › Sales commissions stores (services/financeCommissions.ts). Ids unique across companies
 * (financeSeq: CPL-, CST-). Seeded lazily per company on the first finance access. Synthetic data only.
 */

export interface CommissionPlanRecord {
  id: string
  name: string
  basis: CommissionBasis
  rate: number
  tiers: CommissionTier[]
  capPerMonth: number | null
  clawback: boolean
  roles: Role[]
  userIds: string[]
  effectiveFrom: string
  active: boolean
  createdAt: string
  createdBy: string | null
  updatedAt: string
}

export interface CommissionStatementRecord {
  id: string
  number: string
  userId: string
  month: string
  planId: string
  basis: CommissionBasis
  currency: string
  achievement: number
  rate: number
  baseTotal: number
  gross: number
  capped: boolean
  clawback: number
  total: number
  status: CommissionStatus
  lines: CommissionLine[]
  approvals: Omit<CommissionApproval, 'userName'>[]
  rejectedReason: string | null
  journalEntryId: string | null
  payrollAdjustmentId: string | null
  payrollMonth: string | null
  payrollNote: string | null
  alertMarks: string[]
  createdAt: string
  createdBy: string | null
}

export const finCommissionPlans = registerArray<Tenant<CommissionPlanRecord>>('fin.commissionPlans', [])
export const finCommissionStatements = registerArray<Tenant<CommissionStatementRecord>>('fin.commissionStatements', [])
export const finCommissionsMeta = registerObject('fin.commissionsMeta', { seeded: [] as string[] })
