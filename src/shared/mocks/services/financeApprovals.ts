import type { Role, User } from '@/shared/types'
import type { Account } from '@/modules/finance/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { CodedApiError, perTenant } from '@/shared/mocks/tenant'
import { departments } from '@/shared/mocks/data/departments'
import { financeAccounts } from '@/shared/mocks/data/finance'

/**
 * Accounts & finance — shared contract for spending (phase 2): amount-based approval rules for purchase
 * orders, supplier bills, expenses and employee expense claims, and the accounts money can be paid from.
 * Every spending section uses `approvalChain` / `assertCanApprove` so the rules live in one place and are
 * edited on one settings screen (owned by the purchases section; stored per company).
 *
 * A chain is the ordered list of steps whose `minAmount` ≤ the document's amount in base currency.
 * Step approvers: the requester's department head ('department_head'), or a role. The requester can never
 * approve their own document (maker–checker), and one user approves at most one step of a document.
 */

export type SpendDocType = 'purchase_order' | 'bill' | 'expense' | 'expense_claim'
export const SPEND_DOC_LABEL: Record<SpendDocType, string> = {
  purchase_order: 'Purchase orders',
  bill: 'Supplier bills',
  expense: 'Expenses',
  expense_claim: 'Employee expense claims',
}

export type ApproverKind = 'department_head' | Extract<Role, 'Accountant' | 'Management' | 'Company Admin'>

export interface ApprovalRule {
  docType: SpendDocType
  /** Base-currency amount from which this step applies (inclusive). */
  minAmount: number
  approver: ApproverKind
}

export interface ApprovalStep {
  index: number
  approver: ApproverKind
  minAmount: number
}

/** Default bands (AED and SAR are close enough to share them). Editable per company. */
const DEFAULT_RULES: ApprovalRule[] = [
  { docType: 'purchase_order', minAmount: 0, approver: 'department_head' },
  { docType: 'purchase_order', minAmount: 10_000, approver: 'Accountant' },
  { docType: 'purchase_order', minAmount: 50_000, approver: 'Management' },
  { docType: 'bill', minAmount: 0, approver: 'Accountant' },
  { docType: 'bill', minAmount: 50_000, approver: 'Management' },
  { docType: 'expense', minAmount: 0, approver: 'Accountant' },
  { docType: 'expense', minAmount: 20_000, approver: 'Management' },
  { docType: 'expense_claim', minAmount: 0, approver: 'department_head' },
  { docType: 'expense_claim', minAmount: 0, approver: 'Accountant' },
  { docType: 'expense_claim', minAmount: 5_000, approver: 'Management' },
]

export const approvalRules = perTenant<{ rules: ApprovalRule[] }>(() => ({ rules: DEFAULT_RULES.map((r) => ({ ...r })) }), 'fin.approvalRules')

/** The steps a document of `amountBase` needs, in order (empty = no approval needed). */
export function approvalChain(companyId: string, docType: SpendDocType, amountBase: number): ApprovalStep[] {
  return approvalRules
    .get(companyId)
    .rules.filter((r) => r.docType === docType && amountBase >= r.minAmount)
    .sort((a, b) => a.minAmount - b.minAmount)
    .map((r, index) => ({ index, approver: r.approver, minAmount: r.minAmount }))
}

/** Head of the department (or of its nearest ancestor with a head), as a user id. */
export function departmentHeadOf(companyId: string, departmentId: string | null): string | null {
  let d = departmentId ? departments.find((x) => x.companyId === companyId && x.id === departmentId) : undefined
  for (let guard = 0; d && guard < 20; guard++) {
    if (d.headId) return d.headId
    d = d.parentId ? departments.find((x) => x.companyId === companyId && x.id === d!.parentId) : undefined
  }
  return null
}

/** Whether `user` may act on `step` for a document requested by `requesterId` in `departmentId`. */
export function canApproveStep(user: User, step: ApprovalStep, doc: { companyId: string; requesterId: string; departmentId: string | null; approvedBy: string[] }): boolean {
  if (user.companyId !== doc.companyId || user.id === doc.requesterId || doc.approvedBy.includes(user.id)) return false
  if (step.approver === 'department_head') {
    const head = departmentHeadOf(doc.companyId, doc.departmentId)
    // No head (or the head is the requester): a Company Admin / Management user stands in.
    if (!head || head === doc.requesterId) return user.role === 'Company Admin' || user.role === 'Management'
    return user.id === head
  }
  // Company Admin can act on any role step; Management also covers Accountant steps.
  if (user.role === 'Company Admin') return true
  if (step.approver === 'Accountant') return user.role === 'Accountant' || user.role === 'Management'
  return user.role === step.approver
}

export function assertCanApprove(user: User, step: ApprovalStep, doc: { companyId: string; requesterId: string; departmentId: string | null; approvedBy: string[] }): void {
  if (user.id === doc.requesterId) throw new CodedApiError('You can’t approve your own request.', 403, 'own_request')
  if (doc.approvedBy.includes(user.id)) throw new CodedApiError('You already approved a step of this request.', 403, 'already_approved_step')
  if (!canApproveStep(user, step, doc)) throw new CodedApiError('This step needs another approver.', 403, 'not_your_step', { approver: step.approver })
}

/** Accounts money can be paid from / received into: active postable accounts under 1100 Cash and bank. */
export function paymentAccountsOf(companyId: string): Tenant<Account>[] {
  const isUnder = (a: Tenant<Account>): boolean => {
    let p = a.parentId
    for (let guard = 0; p && guard < 10; guard++) {
      if (p === 'ACC-1100') return true
      p = financeAccounts.find((x) => x.companyId === companyId && x.id === p)?.parentId ?? null
    }
    return false
  }
  return financeAccounts.filter(
    (a) => a.companyId === companyId && a.active && !a.isHeader && isUnder(a) && a.systemRole !== 'undeposited_funds' && a.systemRole !== 'payment_gateway_clearing',
  )
}
