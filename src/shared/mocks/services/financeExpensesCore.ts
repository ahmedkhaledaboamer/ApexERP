import type { User } from '@/shared/types'
import type { ApprovalStepView, DocHistoryEntry, ExpenseCategory, ExpensePolicy, JournalRef, PolicyMode, ReceiptFile } from '@/modules/finance/expenses/types'
import { round2 } from '@/modules/finance/expenses/calc'
import { scopeOf } from '@/shared/lib/permissions'
import { customers, users } from '@/shared/mocks/db'
import { nowIso } from '@/shared/mocks/clock'
import { departments } from '@/shared/mocks/data/departments'
import { events } from '@/shared/mocks/data/events'
import { campaigns } from '@/shared/mocks/data/marketing'
import { projects } from '@/shared/mocks/data/tasks'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal, financeTaxCodes } from '@/shared/mocks/data/finance'
import { companyDocPrefix } from '@/shared/mocks/data/financeLedger'
import {
  finExpenseCategories,
  finExpenseClaims,
  finExpensePolicy,
  finExpenses,
  finPettyFunds,
  finPettyMovements,
  type ApprovalState,
  type CategoryRecord,
  type PolicyRecord,
} from '@/shared/mocks/data/financeExpenses'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity } from './billing'
import { approvalChain, canApproveStep, departmentHeadOf, type ApprovalStep, type SpendDocType } from './financeApprovals'
import { financeSettingsOf, registerJournalSource } from './financeLedger'
import { rateFor } from './financeRates'
import { runFinanceHooks } from './ledger'
import { accountantIds, baseCurrencyOf, bad, conflict, isIsoDate, notFound, notify, str, todayOf } from './financeCollectionsCore'

/**
 * Shared rules of Accounts & finance › Expenses (services/financeExpenses.ts, financeExpensesClaims.ts,
 * financeExpensesPetty.ts): access, lookups in the caller's company, receipts, categories and policy, the approval
 * chain (services/financeApprovals.ts), journal references and notifications.
 *
 * ACCESS (PERMISSION_MATRIX `accounting`): full (Company Admin, Management, Accountant) — every expense, claim and
 * fund, all writes; view (Sales Manager) — reads company expenses; hidden — no company expenses. Employee expense
 * claims are self-service for EVERY role (like leave requests): own claims, plus the claims a department head (or an
 * approver of the current step) has to act on. A petty-cash custodian sees and records on their own fund only.
 * Plan module `accounting` (the /finance path gate) for everything.
 */

export { bad, conflict, notFound, str, isIsoDate, todayOf, baseCurrencyOf, accountantIds, notify }

export const EXPENSES_FORBIDDEN = 'Company expenses are for the finance team. Ask your Company Admin for access.'
export const EXPENSES_WRITE_ONLY = 'Only a Company Admin, Management or an Accountant can change expenses.'
export const EXPENSES_LINK = '/finance/expenses'
export const REIMBURSEMENTS_PAYABLE = 'ACC-2450'
export const PETTY_CASH_ACCOUNT = 'ACC-1115'

export type ExpenseAccess = 'full' | 'view' | 'none'

/** The caller's accounting scope for expenses; runs the finance hooks (every section sees the same data). */
export function expenseAccessOf(user: User): ExpenseAccess {
  runFinanceHooks(tenantOf(user))
  const s = scopeOf(user.role, 'accounting')
  return s === 'full' ? 'full' : s === 'hidden' ? 'none' : 'view'
}
export function assertExpenseRead(user: User): string {
  if (expenseAccessOf(user) === 'none') throw new CodedApiError(EXPENSES_FORBIDDEN, 403, 'forbidden')
  return tenantOf(user)
}
export function assertExpenseFull(user: User): string {
  const a = expenseAccessOf(user)
  if (a === 'none') throw new CodedApiError(EXPENSES_FORBIDDEN, 403, 'forbidden')
  if (a !== 'full') throw new CodedApiError(EXPENSES_WRITE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}
export const isFull = (user: User) => scopeOf(user.role, 'accounting') === 'full'

/* ---------------- company context ---------------- */

export const countryOf = (co: string) => companyById(co)?.regional.country ?? 'AE'
export const vatRegisteredOf = (co: string) => financeSettingsOf(co).vatRegistered
export const prefixOf = (co: string) => companyDocPrefix(co)
export const userName = (co: string, id: string | null | undefined): string => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : 'System')
export const activeUser = (co: string, id: string) => users.find((u) => u.id === id && u.companyId === co && u.active !== false)

/** The company's currencies with a rate (base first). */
export function currenciesOf(co: string): string[] {
  const base = baseCurrencyOf(co)
  return [base, ...new Set(financeSettingsOf(co).exchangeRates.map((r) => r.currency).filter((c) => c !== base))]
}

/** The rate to base for a document: base → 1; a typed rate wins; else the Finance settings rate (422 when none). */
export function rateOf(co: string, currency: string, date: string, typed: unknown): number {
  if (currency === baseCurrencyOf(co)) return 1
  if (typed !== undefined && typed !== null && typed !== '') {
    const n = Number(typed)
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) return bad('Exchange rate must be a positive number.', 'invalid_rate')
    return Math.round(n * 1_000_000) / 1_000_000
  }
  const r = rateFor(co, currency, date)
  if (r === null) return bad(`No exchange rate for ${currency} on or before ${date}. Add one in Finance settings › Exchange rates, or type the rate.`, 'missing_exchange_rate', { currency, date })
  return r
}

export function currencyOf(co: string, v: unknown): string {
  const c = typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : baseCurrencyOf(co)
  if (!/^[A-Z]{3}$/.test(c)) return bad('Currency must be a 3-letter ISO code.', 'invalid_currency')
  return c
}

export function amountOf(v: unknown, field = 'Amount'): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || round2(n) <= 0) return bad(`${field} must be more than 0.`, 'invalid_amount')
  if (n > 10_000_000) return bad(`${field} is too large.`, 'invalid_amount')
  return round2(n)
}

export function dateOf(v: unknown, field = 'Date', opts: { notFutureOf?: string } = {}): string {
  if (!isIsoDate(v)) return bad(`${field} must be a date (yyyy-MM-dd).`, 'invalid_date')
  if (opts.notFutureOf && v > todayOf(opts.notFutureOf)) return bad(`${field} can’t be in the future.`, 'future_date')
  return v
}

/* ---------------- lookups (caller's company only; a foreign id answers like a missing one) ---------------- */

export const accountIn = (co: string, id: unknown) => (typeof id === 'string' ? financeAccounts.find((a) => a.companyId === co && a.id === id) : undefined)
export const accountName = (co: string, id: string | null | undefined) => (id ? (accountIn(co, id)?.name ?? id) : '')
export const taxCodeIn = (co: string, id: unknown) => (typeof id === 'string' ? financeTaxCodes.find((t) => t.companyId === co && t.id === id) : undefined)
export function standardTaxCode(co: string) {
  return financeTaxCodes.find((t) => t.companyId === co && t.active && t.category === 'standard') ?? financeTaxCodes.find((t) => t.companyId === co && t.active)
}
export const vendorIn = (co: string, id: unknown) => (typeof id === 'string' ? eventVendors.find((v) => v.companyId === co && v.id === id) : undefined)
export const departmentIn = (co: string, id: unknown) => (typeof id === 'string' ? departments.find((d) => d.companyId === co && d.id === id) : undefined)
export const projectIn = (co: string, id: unknown) => (typeof id === 'string' ? projects.find((p) => p.companyId === co && p.id === id) : undefined)
export const eventIn = (co: string, id: unknown) => (typeof id === 'string' ? events.find((e) => e.companyId === co && e.id === id) : undefined)
export const campaignIn = (co: string, id: unknown) => (typeof id === 'string' ? campaigns.find((c) => c.companyId === co && c.id === id) : undefined)
export const customerIn = (co: string, id: unknown) => (typeof id === 'string' ? customers.find((c) => c.companyId === co && c.id === id) : undefined)

/** An optional id of the caller's company: null / '' → null; unknown or foreign → 422 `<code>`. */
export function optionalRef<T>(v: unknown, find: (id: unknown) => T | undefined, code: string, what: string): string | null {
  if (v === undefined || v === null || v === '') return null
  if (!find(v)) return bad(`That ${what} doesn’t exist.`, code)
  return v as string
}

/* ---------------- receipts ---------------- */

const MAX_RECEIPT = 10 * 1024 * 1024

/** A receipt from a body (metadata + small data URL), or null. */
export function receiptOf(v: unknown): ReceiptFile | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'object') return bad('The receipt is not a valid file.', 'invalid_receipt')
  const f = v as Record<string, unknown>
  const name = String(f.name ?? '').trim()
  const sizeBytes = Number(f.sizeBytes)
  if (!name || name.length > 200) return bad('The receipt needs a file name (200 characters max).', 'invalid_receipt')
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RECEIPT) return bad('Receipts can be up to 10 MB.', 'invalid_receipt')
  const mimeType = String(f.mimeType || 'application/octet-stream').slice(0, 100)
  if (!/^(image\/|application\/pdf)/.test(mimeType)) return bad('A receipt is an image or a PDF.', 'invalid_receipt')
  const url = typeof f.url === 'string' && f.url.startsWith('data:') && f.url.length <= 360_000 ? f.url : null
  return { name, sizeBytes: Math.round(sizeBytes), mimeType, url }
}

/** Plan storage: only the bytes new receipts add (replacing one with the same file adds nothing). */
export function chargeReceipts(co: string, next: (ReceiptFile | null)[], prev: (ReceiptFile | null)[] = []): void {
  const key = (r: ReceiptFile) => `${r.name}:${r.sizeBytes}`
  const had = new Set(prev.filter((r): r is ReceiptFile => !!r).map(key))
  const added = next.filter((r): r is ReceiptFile => !!r && !had.has(key(r))).reduce((s, r) => s + r.sizeBytes, 0)
  if (added > 0) assertCapacity(co, 'storageMb', added / (1024 * 1024))
}

/* ---------------- categories & policy ---------------- */

export const categoryIn = (co: string, id: unknown) => (typeof id === 'string' ? finExpenseCategories.find((c) => c.companyId === co && c.id === id) : undefined)

export function categoryView(c: Tenant<CategoryRecord>): ExpenseCategory {
  const a = accountIn(c.companyId, c.accountId)
  return { id: c.id, name: c.name, accountId: c.accountId, accountCode: a?.code ?? '', accountName: a?.name ?? c.accountId, description: c.description, monthlyLimit: c.monthlyLimit, active: c.active }
}

/** An active category of the caller's company (422 `category_not_found` otherwise). */
export function activeCategory(co: string, id: unknown): Tenant<CategoryRecord> {
  const c = categoryIn(co, id)
  if (!c) return bad('That expense category doesn’t exist.', 'category_not_found')
  if (!c.active) return bad(`The category “${c.name}” is no longer in use.`, 'category_inactive')
  const a = accountIn(co, c.accountId)
  if (!a || !a.active || a.isHeader) return conflict(`The category “${c.name}” posts to an account that is inactive. Fix it in Categories & policy.`, 'category_account_inactive')
  return c
}

export const policyOf = (co: string): PolicyRecord => finExpensePolicy.get(co)

export function policyView(co: string, canEdit: boolean): ExpensePolicy {
  const p = policyOf(co)
  return {
    baseCurrency: baseCurrencyOf(co),
    receiptRequiredAbove: p.receiptRequiredAbove,
    receiptMode: p.receiptMode,
    claimMaxAgeDays: p.claimMaxAgeDays,
    ageMode: p.ageMode,
    limitMode: p.limitMode,
    canEdit,
    updatedAt: p.updatedAt,
  }
}
export const isMode = (v: unknown): v is PolicyMode => v === 'warn' || v === 'block'

/* ---------------- approvals ---------------- */

export function freezeChain(co: string, docType: SpendDocType, amountBase: number): ApprovalState {
  return { steps: approvalChain(co, docType, amountBase).map((s) => ({ approver: s.approver, minAmount: s.minAmount })), approvals: [] }
}

export function currentStep(state: ApprovalState): ApprovalStep | null {
  const i = state.approvals.length
  const s = state.steps[i]
  return s ? { index: i, approver: s.approver, minAmount: s.minAmount } : null
}

export interface ApprovalDoc {
  companyId: string
  requesterId: string
  departmentId: string | null
  approval: ApprovalState
}
const docFor = (d: ApprovalDoc) => ({ companyId: d.companyId, requesterId: d.requesterId, departmentId: d.departmentId, approvedBy: d.approval.approvals.map((a) => a.userId) })
export const approvalDoc = docFor

/** Whether `user` can act on the document's current step. */
export function canActNow(user: User, d: ApprovalDoc): boolean {
  const step = currentStep(d.approval)
  return !!step && canApproveStep(user, step, docFor(d))
}

/** Active users of the company who can act on the current step (notifications, "waiting on"). */
export function currentApprovers(d: ApprovalDoc): string[] {
  const step = currentStep(d.approval)
  if (!step) return []
  return users.filter((u) => u.companyId === d.companyId && u.active !== false && canApproveStep(u as User, step, docFor(d))).map((u) => u.id)
}

const APPROVER_LABEL: Record<string, string> = { department_head: 'Department head', Accountant: 'Accountant', Management: 'Management', 'Company Admin': 'Company Admin' }

export function stepViews(d: ApprovalDoc, pending: boolean): ApprovalStepView[] {
  const head = departmentHeadOf(d.companyId, d.departmentId)
  return d.approval.steps.map((s, index) => {
    const done = d.approval.approvals[index]
    const headName = s.approver === 'department_head' && head && head !== d.requesterId ? ` (${userName(d.companyId, head)})` : ''
    return {
      index,
      approver: s.approver,
      label: `${APPROVER_LABEL[s.approver] ?? s.approver}${headName}`,
      status: done ? 'approved' : pending && index === d.approval.approvals.length ? 'current' : 'waiting',
      approvedByName: done ? userName(d.companyId, done.userId) : null,
      approvedAt: done?.at ?? null,
    }
  })
}

export function historyEntry(by: string, action: string, note = '', at = nowIso()): DocHistoryEntry {
  return { at, byName: by, action, note }
}

/* ---------------- journal ---------------- */

export function journalRef(co: string, id: string | null): JournalRef | null {
  if (!id) return null
  const e = financeJournal.find((x) => x.companyId === co && x.id === id)
  return e ? { id: e.id, number: e.number, date: e.date, status: e.status } : null
}

// Expenses, claims and petty cash post with sourceType 'expense': the journal shows their number and links here.
registerJournalSource('expense', (co, id) => {
  const exp = finExpenses.find((x) => x.companyId === co && x.id === id)
  if (exp) return { number: exp.number, link: `${EXPENSES_LINK}?expense=${encodeURIComponent(exp.id)}` }
  const claim = finExpenseClaims.find((x) => x.companyId === co && x.id === id)
  if (claim) return { number: claim.number, link: `${EXPENSES_LINK}?tab=claims&claim=${encodeURIComponent(claim.id)}` }
  const mv = finPettyMovements.find((x) => x.companyId === co && x.id === id)
  if (mv) return { number: mv.number, link: `${EXPENSES_LINK}?tab=petty&fund=${encodeURIComponent(mv.fundId)}` }
  const fund = finPettyFunds.find((x) => x.companyId === co && x.id === id)
  if (fund) return { number: fund.name, link: `${EXPENSES_LINK}?tab=petty&fund=${encodeURIComponent(fund.id)}` }
  return null
})

/* ---------------- notifications (stored, type `finance`, once per record and event) ---------------- */

/** Sends once per `mark` on the record (`alertMarks`); returns whether it was sent now. */
export function notifyOnce(rec: { companyId: string; alertMarks: string[] }, mark: string, userIds: string[], title: string, body: string, link: string): boolean {
  if (rec.alertMarks.includes(mark)) return false
  rec.alertMarks.push(mark)
  notify(rec.companyId, userIds, title, body, link)
  return true
}

/* ---------------- options for forms ---------------- */

export const departmentOptions = (co: string) => departments.filter((d) => d.companyId === co && d.active !== false).map((d) => ({ id: d.id, name: d.name }))
export const projectOptions = (co: string) => projects.filter((p) => p.companyId === co).map((p) => ({ id: p.id, name: p.name }))
export const eventOptions = (co: string) => events.filter((e) => e.companyId === co && e.status !== 'cancelled').map((e) => ({ id: e.id, name: e.name }))
export const campaignOptions = (co: string) => campaigns.filter((c) => c.companyId === co).map((c) => ({ id: c.id, name: c.name }))
export const employeeName = (co: string, id: string) => employeeById(co, id)?.fullName ?? 'Unknown employee'
