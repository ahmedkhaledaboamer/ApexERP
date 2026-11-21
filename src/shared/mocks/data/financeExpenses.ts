import type {
  ClaimStatus,
  DocHistoryEntry,
  ExpensePaymentMethod,
  ExpenseStatus,
  PettyExpenseStatus,
  PettyMovementKind,
  PolicyMode,
  ReceiptFile,
  ReimbursementMethod,
} from '@/modules/finance/expenses/types'
import type { ApproverKind } from '@/shared/mocks/services/financeApprovals'
import type { Tenant } from '@/shared/mocks/tenant'
import { perTenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › Expenses stores (phase 2): expense categories and policy, company expenses, employee expense
 * claims, petty cash funds with their expenses and movements. Seeds: data/financeExpensesSeed.ts.
 * Receipts are mocked files (metadata + a small data URL) counted against the plan's storage (`expenseStorageBytes`).
 * Synthetic data only.
 */

/** The approval chain frozen when a document is submitted, and who approved each step (in order). */
export interface ApprovalState {
  steps: { approver: ApproverKind; minAmount: number }[]
  approvals: { userId: string; at: string }[]
}

export interface CategoryRecord {
  id: string
  name: string
  accountId: string
  description: string
  monthlyLimit: number | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PolicyRecord {
  receiptRequiredAbove: number
  receiptMode: PolicyMode
  claimMaxAgeDays: number
  ageMode: PolicyMode
  limitMode: PolicyMode
  updatedAt: string | null
  updatedBy: string | null
}

export interface ExpenseRecord {
  id: string
  number: string
  status: ExpenseStatus
  date: string
  vendorId: string | null
  payeeName: string
  payeeVatNumber: string
  categoryId: string
  accountId: string
  description: string
  amount: number
  currency: string
  exchangeRate: number
  taxCodeId: string
  taxRate: number
  vatAmount: number
  netAmount: number
  vatRecoverable: boolean
  vatNote: string
  paymentMethod: ExpensePaymentMethod
  pettyFundId: string | null
  paidFromAccountId: string
  reference: string
  departmentId: string | null
  projectId: string | null
  eventId: string | null
  campaignId: string | null
  receipt: ReceiptFile | null
  notes: string
  approval: ApprovalState
  journalEntryId: string | null
  voidJournalEntryId: string | null
  history: DocHistoryEntry[]
  createdBy: string
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  rejectReason: string | null
  voidedAt: string | null
  voidReason: string | null
  /** Notifications already sent (once-only keys). */
  alertMarks: string[]
}

export interface ClaimLineRecord {
  id: string
  date: string
  categoryId: string
  description: string
  merchant: string
  merchantVatNumber: string
  amount: number
  currency: string
  exchangeRate: number
  baseAmount: number
  vatBase: number
  receipt: ReceiptFile | null
  projectId: string | null
  customerId: string | null
  eventId: string | null
}

export interface ClaimReimbursementRecord {
  method: ReimbursementMethod
  accountId: string | null
  date: string | null
  journalEntryId: string | null
  payrollAdjustmentId: string | null
  payrollMonth: string | null
  reimbursedAt: string | null
  by: string
}

export interface ClaimRecord {
  id: string
  number: string
  status: ClaimStatus
  title: string
  notes: string
  employeeId: string
  /** The user who owns the claim (the employee's login). */
  requesterId: string
  departmentId: string | null
  lines: ClaimLineRecord[]
  approval: ApprovalState
  journalEntryId: string | null
  reimbursement: ClaimReimbursementRecord | null
  rejectReason: string | null
  history: DocHistoryEntry[]
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  alertMarks: string[]
}

export interface PettyFundRecord {
  id: string
  name: string
  custodianEmployeeId: string
  accountId: string
  floatLimit: number
  active: boolean
  /** The low-balance alert was sent (cleared once the fund is back above the threshold). */
  lowAlerted: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface PettyExpenseRecord {
  id: string
  number: string
  fundId: string
  date: string
  categoryId: string
  description: string
  payeeName: string
  payeeVatNumber: string
  amount: number
  vatAmount: number
  receipt: ReceiptFile | null
  status: PettyExpenseStatus
  replenishmentId: string | null
  rejectReason: string | null
  createdBy: string
  createdAt: string
}

export interface PettyMovementRecord {
  id: string
  number: string
  fundId: string
  kind: PettyMovementKind
  date: string
  amount: number
  expensesTotal: number
  topUp: number
  counted: number | null
  expected: number | null
  difference: number | null
  reason: string
  fromAccountId: string | null
  journalEntryId: string | null
  expenseIds: string[]
  createdBy: string
  createdAt: string
}

/** Defaults (AED and SAR are close: one default for both). */
export const DEFAULT_POLICY = (): PolicyRecord => ({
  receiptRequiredAbove: 100,
  receiptMode: 'block',
  claimMaxAgeDays: 60,
  ageMode: 'warn',
  limitMode: 'warn',
  updatedAt: null,
  updatedBy: null,
})

export const finExpenseCategories = registerArray<Tenant<CategoryRecord>>('fin.expenseCategories', [])
export const finExpensePolicy = perTenant<PolicyRecord>(DEFAULT_POLICY, 'fin.expensePolicy')
export const finExpenses = registerArray<Tenant<ExpenseRecord>>('fin.expenses', [])
export const finExpenseClaims = registerArray<Tenant<ClaimRecord>>('fin.expenseClaims', [])
export const finPettyFunds = registerArray<Tenant<PettyFundRecord>>('fin.pettyFunds', [])
export const finPettyExpenses = registerArray<Tenant<PettyExpenseRecord>>('fin.pettyExpenses', [])
export const finPettyMovements = registerArray<Tenant<PettyMovementRecord>>('fin.pettyMovements', [])

/** Bytes of expense receipts (company expenses, claim lines, petty expenses) of a company: part of the plan's storageMb. */
export function expenseStorageBytes(companyId: string): number {
  let bytes = 0
  for (const e of finExpenses) if (e.companyId === companyId && e.receipt) bytes += e.receipt.sizeBytes
  for (const c of finExpenseClaims) if (c.companyId === companyId) for (const l of c.lines) if (l.receipt) bytes += l.receipt.sizeBytes
  for (const p of finPettyExpenses) if (p.companyId === companyId && p.receipt) bytes += p.receipt.sizeBytes
  return bytes
}
