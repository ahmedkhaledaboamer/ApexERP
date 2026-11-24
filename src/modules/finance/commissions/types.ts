import type { Role } from '@/shared/types'

/**
 * Accounts & finance › Sales commissions (docs/API.md › Finance › Commissions).
 *
 * A plan says WHO earns (roles and / or named users), on WHAT basis — collected revenue (net, before VAT, of invoices
 * fully paid in the month whose customer the rep owns) or won deal value (leads the rep owns won in the month) — at what
 * rate (optionally tiered by the month's sales-target achievement), with an optional monthly cap and clawback (a paid
 * invoice later credited / refunded takes its commission back on the next statement).
 *
 * Monthly statements per rep: Sales Manager approves, then Accountant (maker–checker: two different users, never the
 * rep). On approval: Dr 6150 Sales commissions / Cr 2400 Salaries payable, and a payroll adjustment (kind commission)
 * for the next run — once per statement.
 */

export type CommissionBasis = 'collected_revenue' | 'won_deals'
export const COMMISSION_BASIS_LABEL: Record<CommissionBasis, string> = { collected_revenue: 'Collected revenue', won_deals: 'Won deal value' }

export interface CommissionTier {
  /** Target achievement (%) from which the rate applies (inclusive). */
  minAchievement: number
  rate: number
}

export interface CommissionPlan {
  id: string
  name: string
  basis: CommissionBasis
  /** Base rate (%) when no tier applies. */
  rate: number
  tiers: CommissionTier[]
  /** Max commission per rep per month (base currency); null = no cap. */
  capPerMonth: number | null
  clawback: boolean
  roles: Role[]
  userIds: string[]
  userNames: string[]
  effectiveFrom: string // yyyy-MM
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CommissionPlanInput {
  name?: string
  basis?: CommissionBasis
  rate?: number
  tiers?: CommissionTier[]
  capPerMonth?: number | null
  clawback?: boolean
  roles?: Role[]
  userIds?: string[]
  effectiveFrom?: string
  active?: boolean
}

export type CommissionLineKind = 'invoice' | 'deal' | 'clawback'
export interface CommissionLine {
  kind: CommissionLineKind
  refId: string
  refNumber: string
  customerName: string
  date: string
  /** Base-currency net amount (invoice net of credits, or deal value); for a clawback the amount no longer earned. */
  baseAmount: number
  rate: number
  commission: number
  note: string
}

export type CommissionStatus = 'pending_manager' | 'pending_accountant' | 'approved' | 'rejected'
export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending_manager: 'Awaiting Sales Manager',
  pending_accountant: 'Awaiting Accountant',
  approved: 'Approved',
  rejected: 'Rejected',
}

export interface CommissionApproval {
  step: 'sales_manager' | 'accountant'
  userId: string
  userName: string
  at: string
}

export interface CommissionStatement {
  id: string
  number: string
  userId: string
  userName: string
  month: string
  planId: string
  planName: string
  basis: CommissionBasis
  currency: string
  /** Sales-target completion of the month (%), used to pick the tier. */
  achievement: number
  rate: number
  baseTotal: number
  gross: number
  capped: boolean
  clawback: number
  total: number
  status: CommissionStatus
  lines: CommissionLine[]
  approvals: CommissionApproval[]
  rejectedReason: string | null
  journalEntryId: string | null
  journalNumber: string | null
  payrollAdjustmentId: string | null
  payrollMonth: string | null
  payrollNote: string | null
  canApprove: boolean
  approveBlockedReason: string | null
  createdAt: string
}

export interface MyCommissions {
  plan: CommissionPlan | null
  statements: CommissionStatement[]
}
