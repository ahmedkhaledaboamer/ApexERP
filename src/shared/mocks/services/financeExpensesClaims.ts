import type { User } from '@/shared/types'
import type { ClaimInput, ClaimLineInput, ClaimsMeta, ClaimsQuery, ClaimStatus, ExpenseClaim, PolicyWarning, ReimburseInput } from '@/modules/finance/expenses/types'
import { CLAIM_STATUSES } from '@/modules/finance/expenses/types'
import { policyWarnings, round2, toBase, vatSplit } from '@/modules/finance/expenses/calc'
import type { JournalLine } from '@/modules/finance/types'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { employeeById, employeeForUser } from '@/shared/mocks/data/hrEmployees'
import { hrPayAdjustments, hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { finExpenseCategories, finExpenseClaims, type ClaimLineRecord, type ClaimRecord } from '@/shared/mocks/data/financeExpenses'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCanApprove, departmentHeadOf, paymentAccountsOf } from './financeApprovals'
import { docNumber, nextId, postJournal, systemAccount } from './ledger'
import { onPayrollEvent, upsertSystemAdjustment } from './hrPayroll'
import { onFinanceAccess } from './ledger'
import {
  EXPENSES_LINK,
  REIMBURSEMENTS_PAYABLE,
  accountName,
  activeCategory,
  amountOf,
  approvalDoc,
  bad,
  baseCurrencyOf,
  canActNow,
  categoryIn,
  categoryView,
  chargeReceipts,
  conflict,
  countryOf,
  currenciesOf,
  currencyOf,
  currentApprovers,
  currentStep,
  customerIn,
  dateOf,
  departmentIn,
  eventIn,
  eventOptions,
  expenseAccessOf,
  freezeChain,
  historyEntry,
  isFull,
  journalRef,
  notFound,
  notifyOnce,
  optionalRef,
  policyOf,
  policyView,
  prefixOf,
  projectIn,
  projectOptions,
  rateOf,
  receiptOf,
  standardTaxCode,
  stepViews,
  str,
  todayOf,
  userName,
  vatRegisteredOf,
} from './financeExpensesCore'
import { fundAccountIds } from './financeExpensesPetty'

/**
 * Accounts & finance › Expenses › Employee expense claims (docs/API.md › Finance › Expense claims). Self-service for
 * every employee with a login (any role, like leave requests): draft → submit → chain `expense_claim` by total in
 * base currency (department head → accountant → management by amount; maker–checker) → on the last approval:
 *     Dr category expense accounts (net, per line, with project / customer / event)   Dr VAT input (valid tax invoices)
 *     Cr 2450 Employee reimbursements payable (total)
 * Reimbursement (accounting full): pay now — Dr 2450 / Cr bank (status reimbursed); or through payroll — a one-off
 * payroll adjustment of kind `reimbursement` (services/hrPayroll.ts upsertSystemAdjustment, sourceRef `claim:<id>`,
 * not taxable, outside gross) → status in_payroll → reimbursed once that run is paid (payroll event `run_paid`, and
 * a lazy re-sync on every finance access).
 *
 * SEAM (payroll → ledger, services/financePayrollGl.ts): when a run with `reimbursement` items posts, clear 2450 for
 * them (Dr 2450 / Cr net pay payable) — `claimForPayrollAdjustment(co, adjustmentId)` names the claim.
 *
 * VISIBILITY: own claims; claims the user can act on now (department head, step approver); claims of the user's
 * department when they head it; accounting full — every claim.
 */

/* ---------------- payroll seam ---------------- */

export interface PayrollClaimRef {
  claimId: string
  number: string
  employeeId: string
  amount: number
  /** The liability the payroll posting clears (ACC-2450 Employee reimbursements payable). */
  liabilityAccountId: string
}

/** The claim behind a payroll adjustment of kind `reimbursement` (null for any other adjustment). */
export function claimForPayrollAdjustment(co: string, adjustmentId: string): PayrollClaimRef | null {
  const c = finExpenseClaims.find((x) => x.companyId === co && x.reimbursement?.payrollAdjustmentId === adjustmentId)
  return c ? { claimId: c.id, number: c.number, employeeId: c.employeeId, amount: totalOf(c), liabilityAccountId: REIMBURSEMENTS_PAYABLE } : null
}

/** Claims in payroll whose adjustment is in a paid run become reimbursed (idempotent). */
export function syncPayrollClaims(co: string): void {
  for (const c of finExpenseClaims) {
    if (c.companyId !== co || c.status !== 'in_payroll' || !c.reimbursement?.payrollAdjustmentId) continue
    const adj = hrPayAdjustments.find((a) => a.companyId === co && a.id === c.reimbursement!.payrollAdjustmentId)
    const runId = adj?.paidRunIds[0]
    if (!runId) continue
    const run = hrPayrollRuns.find((r) => r.companyId === co && r.id === runId)
    const at = run?.paidAt ?? nowIso()
    c.status = 'reimbursed'
    c.reimbursement.reimbursedAt = at
    c.updatedAt = at
    c.history.push(historyEntry('System', 'reimbursed', `Paid with the payroll of ${adj!.month}`, at))
    notifyOnce(c, 'reimbursed', [c.requesterId], `Expense claim ${c.number} reimbursed`, `${baseCurrencyOf(co)} ${totalOf(c).toFixed(2)} paid with your salary`, linkOf(c))
  }
}
onPayrollEvent('financeExpenseClaims', (e) => {
  if (e.type === 'run_paid') syncPayrollClaims(e.companyId)
})
onFinanceAccess('financeExpenseClaims', syncPayrollClaims)

/* ---------------- helpers ---------------- */

const linkOf = (c: { id: string }) => `${EXPENSES_LINK}?tab=claims&claim=${encodeURIComponent(c.id)}`
export const totalOf = (c: ClaimRecord) => round2(c.lines.reduce((s, l) => s + l.baseAmount, 0))
const vatTotalOf = (c: ClaimRecord) => round2(c.lines.reduce((s, l) => s + l.vatBase, 0))
const claimIn = (co: string, id: unknown) => (typeof id === 'string' ? finExpenseClaims.find((c) => c.companyId === co && c.id === id) : undefined)
const docOf = (c: Tenant<ClaimRecord>) => ({ companyId: c.companyId, requesterId: c.requesterId, departmentId: c.departmentId, approval: c.approval })

function canSee(user: User, c: Tenant<ClaimRecord>): boolean {
  if (c.requesterId === user.id || isFull(user)) return true
  if (c.status === 'draft') return false
  if (departmentHeadOf(c.companyId, c.departmentId) === user.id) return true
  if (c.approval.approvals.some((a) => a.userId === user.id)) return true
  return c.status === 'pending' && canActNow(user, docOf(c))
}

/** Lines of the same employee's other live claims, per `<categoryId>:<yyyy-MM>` (monthly limits). */
function priorSpend(c: Tenant<ClaimRecord>): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of finExpenseClaims) {
    if (o.companyId !== c.companyId || o.id === c.id || o.employeeId !== c.employeeId || o.status === 'draft' || o.status === 'rejected') continue
    for (const l of o.lines) {
      const k = `${l.categoryId}:${l.date.slice(0, 7)}`
      m.set(k, round2((m.get(k) ?? 0) + l.baseAmount))
    }
  }
  return m
}

export function warningsOf(c: Tenant<ClaimRecord>, today = todayOf(c.companyId)): PolicyWarning[] {
  const co = c.companyId
  const cats = new Map(finExpenseCategories.filter((x) => x.companyId === co).map((x) => [x.id, { name: x.name, monthlyLimit: x.monthlyLimit }]))
  return policyWarnings(
    c.lines.map((l) => ({ id: l.id, date: l.date, categoryId: l.categoryId, baseAmount: l.baseAmount, hasReceipt: !!l.receipt })),
    c.submittedAt ? c.submittedAt.slice(0, 10) : today,
    policyOf(co),
    cats,
    priorSpend(c),
    baseCurrencyOf(co),
  )
}

function claimView(user: User, c: Tenant<ClaimRecord>): ExpenseClaim {
  const co = c.companyId
  const mine = c.requesterId === user.id
  const full = isFull(user)
  const pending = c.status === 'pending'
  const act = pending && canActNow(user, docOf(c))
  const r = c.reimbursement
  return {
    id: c.id,
    number: c.number,
    status: c.status,
    title: c.title,
    employeeId: c.employeeId,
    employeeName: employeeById(co, c.employeeId)?.fullName ?? userName(co, c.requesterId),
    departmentId: c.departmentId,
    departmentName: departmentIn(co, c.departmentId)?.name ?? null,
    currency: baseCurrencyOf(co),
    total: totalOf(c),
    vatTotal: vatTotalOf(c),
    lines: c.lines.map((l) => ({
      ...l,
      receipt: l.receipt ? { ...l.receipt } : null,
      categoryName: categoryIn(co, l.categoryId)?.name ?? 'Unknown category',
      projectName: projectIn(co, l.projectId)?.name ?? null,
      customerName: customerIn(co, l.customerId)?.name ?? null,
      eventName: eventIn(co, l.eventId)?.name ?? null,
    })),
    warnings: c.status === 'draft' || pending ? warningsOf(c) : [],
    steps: stepViews(docOf(c), pending),
    waitingOn: pending ? currentApprovers(docOf(c)).map((id) => userName(co, id)) : [],
    journal: journalRef(co, c.journalEntryId),
    reimbursement: r
      ? { method: r.method, accountId: r.accountId, accountName: r.accountId ? accountName(co, r.accountId) : null, date: r.date, journal: journalRef(co, r.journalEntryId), payrollAdjustmentId: r.payrollAdjustmentId, payrollMonth: r.payrollMonth, reimbursedAt: r.reimbursedAt }
      : null,
    rejectReason: c.rejectReason,
    history: c.history.map((h) => ({ ...h })),
    submittedAt: c.submittedAt,
    approvedAt: c.approvedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    isMine: mine,
    can: { edit: mine && c.status === 'draft', submit: mine && c.status === 'draft', delete: mine && c.status === 'draft', approve: act, reject: act, reimburse: full && c.status === 'approved' },
  }
}

/* ---------------- reads ---------------- */

/** GET /finance/expense-claims?view=mine|approvals|all&status=&employee_id= */
export async function listClaims(user: User, q: ClaimsQuery = {}): Promise<ExpenseClaim[]> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  syncPayrollClaims(co)
  const view = q.view === 'approvals' || q.view === 'all' ? q.view : 'mine'
  const rows = finExpenseClaims
    .filter((c) => c.companyId === co)
    .filter((c) => (view === 'mine' ? c.requesterId === user.id : view === 'approvals' ? c.status === 'pending' && canActNow(user, docOf(c)) : canSee(user, c)))
    .filter((c) => !q.status || !CLAIM_STATUSES.includes(q.status as ClaimStatus) || c.status === q.status)
    .filter((c) => !q.employeeId || c.employeeId === q.employeeId)
    .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))
  return delay(rows.map((c) => claimView(user, c)))
}

function seeClaim(user: User, id: string): Tenant<ClaimRecord> {
  expenseAccessOf(user)
  const c = claimIn(tenantOf(user), id)
  if (!c || !canSee(user, c)) return notFound()
  return c
}

/** GET /finance/expense-claims/:id */
export async function getClaim(user: User, id: string): Promise<ExpenseClaim> {
  const c = seeClaim(user, id)
  syncPayrollClaims(c.companyId)
  return delay(claimView(user, c))
}

/** The payroll month a reimbursement goes into now: the company's month, or the one after the last approved / paid run. */
export function nextPayrollMonth(co: string): string {
  const cur = todayOf(co).slice(0, 7)
  const locked = hrPayrollRuns.filter((r) => r.companyId === co && (r.status === 'paid' || r.status === 'approved')).map((r) => r.month).sort().slice(-1)[0]
  if (!locked || locked < cur) return cur
  const [y, m] = locked.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** GET /finance/expense-claims/meta */
export async function claimsMeta(user: User): Promise<ClaimsMeta> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  const full = isFull(user)
  const emp = employeeForUser(co, user.id)
  const sales = scopeOf(user.role, 'sales')
  const funds = fundAccountIds(co)
  return delay({
    baseCurrency: baseCurrencyOf(co),
    currencies: currenciesOf(co),
    categories: finExpenseCategories.filter((c) => c.companyId === co && c.active).sort((a, b) => a.name.localeCompare(b.name)).map(categoryView),
    policy: policyView(co, full),
    projects: projectOptions(co),
    events: eventOptions(co),
    // Customers the caller may see in Sales (own scope: their own customers).
    customers: sales === 'hidden' ? [] : customers.filter((c) => c.companyId === co && (sales !== 'own' || c.ownerId === user.id)).map((c) => ({ id: c.id, name: c.name })),
    employee: emp ? { id: emp.id, name: emp.fullName, departmentName: departmentIn(co, emp.departmentId)?.name ?? null } : null,
    paymentAccounts: full ? paymentAccountsOf(co).filter((a) => !funds.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name })) : [],
    nextPayrollMonth: nextPayrollMonth(co),
    canSeeAll: full,
    canReimburse: full,
  })
}

/* ---------------- writes ---------------- */

/** Validates claim lines (caller's company refs only); keeps line ids of an update. */
export function claimLines(co: string, input: unknown, prev: ClaimLineRecord[] = []): ClaimLineRecord[] {
  if (!Array.isArray(input)) return bad('Add at least one expense line.', 'lines_required')
  if (input.length > 50) bad('A claim has up to 50 lines.', 'too_many_lines')
  const std = standardTaxCode(co)
  return (input as ClaimLineInput[]).map((l, idx) => {
    const n = `Line ${idx + 1}`
    const date = dateOf(l?.date, `${n}: date`, { notFutureOf: co })
    const cat = activeCategory(co, l?.categoryId)
    const amount = amountOf(l?.amount, `${n}: amount`)
    const currency = currencyOf(co, l?.currency)
    const exchangeRate = rateOf(co, currency, date, l?.exchangeRate)
    const merchantVatNumber = str(l?.merchantVatNumber, 30).replace(/\s/g, '')
    const split = vatSplit({ amount, rate: std?.rate ?? 0, category: std?.category ?? 'out_of_scope', payeeVatNumber: merchantVatNumber, country: countryOf(co), vatRegistered: vatRegisteredOf(co) })
    const description = str(l?.description, 300)
    if (!description) bad(`${n}: say what it was for.`, 'purpose_required')
    const keep = typeof l?.id === 'string' ? prev.find((p) => p.id === l.id) : undefined
    return {
      id: keep?.id ?? nextId('claimLine', 'ECLL'),
      date,
      categoryId: cat.id,
      description,
      merchant: str(l?.merchant, 200),
      merchantVatNumber,
      amount,
      currency,
      exchangeRate,
      baseAmount: toBase(amount, exchangeRate),
      vatBase: toBase(split.vat, exchangeRate),
      receipt: l?.receipt !== undefined ? receiptOf(l.receipt) : (keep?.receipt ?? null),
      projectId: optionalRef(l?.projectId, (id) => projectIn(co, id), 'project_not_found', 'project'),
      customerId: optionalRef(l?.customerId, (id) => customerIn(co, id), 'customer_not_found', 'customer'),
      eventId: optionalRef(l?.eventId, (id) => eventIn(co, id), 'event_not_found', 'event'),
    }
  })
}

/** Store level: a draft claim for an employee (endpoint + seed). */
export function newClaim(co: string, emp: { id: string; userId: string; departmentId: string | null }, title: string, lines: ClaimLineRecord[], at = nowIso(), notes = ''): Tenant<ClaimRecord> {
  const c: Tenant<ClaimRecord> = {
    companyId: co,
    id: nextId('claim', 'ECL'),
    number: docNumber(co, prefixOf(co), 'ECL', at.slice(0, 4)),
    status: 'draft',
    title,
    notes,
    employeeId: emp.id,
    requesterId: emp.userId,
    departmentId: emp.departmentId,
    lines,
    approval: { steps: [], approvals: [] },
    journalEntryId: null,
    reimbursement: null,
    rejectReason: null,
    history: [historyEntry(userName(co, emp.userId), 'created', '', at)],
    submittedAt: null,
    approvedAt: null,
    createdAt: at,
    updatedAt: at,
    alertMarks: [],
  }
  finExpenseClaims.push(c)
  return c
}

function myEmployee(user: User) {
  const co = tenantOf(user)
  const e = employeeForUser(co, user.id)
  if (!e) throw new CodedApiError('You have no employee record, so you can’t claim expenses. Ask HR to add you.', 422, 'no_employee_record')
  return { id: e.id, userId: user.id, departmentId: e.departmentId ?? null }
}

/** POST /finance/expense-claims — a draft of the caller's own claim. */
export async function createClaim(user: User, input: ClaimInput | null): Promise<ExpenseClaim> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  const emp = myEmployee(user)
  const i = input ?? {}
  const lines = claimLines(co, i.lines ?? [])
  chargeReceipts(co, lines.map((l) => l.receipt))
  const title = str(i.title, 120) || `Expenses ${todayOf(co).slice(0, 7)}`
  const c = newClaim(co, emp, title, lines, nowIso(), str(i.notes, 1000))
  return delay(claimView(user, c))
}

function ownDraft(user: User, id: string): Tenant<ClaimRecord> {
  const c = seeClaim(user, id)
  if (c.requesterId !== user.id) throw new CodedApiError('Only the employee who made the claim can change it.', 403, 'not_owner')
  if (c.status !== 'draft') conflict('Only a draft claim can be changed.', 'claim_locked')
  return c
}

/** PATCH /finance/expense-claims/:id — the owner's draft. */
export async function updateClaim(user: User, id: string, input: ClaimInput | null): Promise<ExpenseClaim> {
  const c = ownDraft(user, id)
  const i = input ?? {}
  if (i.title !== undefined) c.title = str(i.title, 120) || c.title
  if (i.notes !== undefined) c.notes = str(i.notes, 1000)
  if (i.lines !== undefined) {
    const lines = claimLines(c.companyId, i.lines, c.lines)
    chargeReceipts(c.companyId, lines.map((l) => l.receipt), c.lines.map((l) => l.receipt))
    c.lines = lines
  }
  c.updatedAt = nowIso()
  return delay(claimView(user, c))
}

/** DELETE /finance/expense-claims/:id — the owner's draft. */
export async function deleteClaim(user: User, id: string): Promise<{ id: string }> {
  const c = ownDraft(user, id)
  finExpenseClaims.splice(finExpenseClaims.indexOf(c), 1)
  return delay({ id: c.id })
}

/** The approval posting: Dr expense per line (+ VAT input) / Cr 2450 (base currency). */
export function claimLinesPosting(c: Tenant<ClaimRecord>): JournalLine[] {
  const co = c.companyId
  const lines: JournalLine[] = []
  for (const l of c.lines) {
    const cat = categoryIn(co, l.categoryId)!
    const desc = `${c.number} · ${l.description}`.slice(0, 200)
    lines.push({ accountId: cat.accountId, debit: round2(l.baseAmount - l.vatBase), credit: 0, description: desc, departmentId: c.departmentId, projectId: l.projectId, eventId: l.eventId, customerId: l.customerId })
    if (l.vatBase > 0) lines.push({ accountId: systemAccount(co, 'vat_input'), debit: l.vatBase, credit: 0, description: `Input VAT · ${desc}`.slice(0, 200), taxCode: standardTaxCode(co)?.id ?? null })
  }
  lines.push({ accountId: REIMBURSEMENTS_PAYABLE, debit: 0, credit: totalOf(c), description: `${c.number} · ${employeeById(co, c.employeeId)?.fullName ?? ''}`.slice(0, 200) })
  return lines
}

function finishClaim(c: Tenant<ClaimRecord>, by: { id: string | null; name: string }, at = nowIso()): void {
  const entry = postJournal(c.companyId, { date: todayOf(c.companyId), memo: `Expense claim ${c.number}`, sourceType: 'expense', sourceId: c.id, lines: claimLinesPosting(c), createdBy: by.id })
  c.journalEntryId = entry.id
  c.status = 'approved'
  c.approvedAt = at
  c.history.push(historyEntry(by.name, 'posted', `Journal ${entry.number}`, at))
  notifyOnce(c, 'approved', [c.requesterId], `Expense claim ${c.number} approved`, `${baseCurrencyOf(c.companyId)} ${totalOf(c).toFixed(2)} will be reimbursed`, linkOf(c))
}

function notifyStep(c: Tenant<ClaimRecord>): void {
  const step = currentStep(c.approval)
  if (!step) return
  notifyOnce(c, `step:${step.index}`, currentApprovers(docOf(c)), `Expense claim ${c.number} needs your approval`, `${employeeById(c.companyId, c.employeeId)?.fullName ?? 'An employee'} · ${baseCurrencyOf(c.companyId)} ${totalOf(c).toFixed(2)}`, linkOf(c))
}

/** Store level submit (endpoint + seed): checks the policy, freezes the chain, notifies step 1. */
export function submitCore(c: Tenant<ClaimRecord>, at = nowIso()): void {
  if (!c.lines.length) bad('Add at least one expense line.', 'lines_required')
  const blocking = warningsOf(c, todayOf(c.companyId)).filter((w) => w.blocking)
  if (blocking.length) throw new CodedApiError(blocking.map((w) => w.message).join(' '), 422, 'policy_blocked', { warnings: blocking })
  c.status = 'pending'
  c.submittedAt = at
  c.updatedAt = at
  c.approval = freezeChain(c.companyId, 'expense_claim', totalOf(c))
  c.history.push(historyEntry(userName(c.companyId, c.requesterId), 'submitted', '', at))
  if (!c.approval.steps.length) finishClaim(c, { id: null, name: 'System' }, at)
  else notifyStep(c)
}

/** POST /finance/expense-claims/:id/submit */
export async function submitClaim(user: User, id: string): Promise<ExpenseClaim> {
  const c = ownDraft(user, id)
  submitCore(c)
  return delay(claimView(user, c))
}

/** Store level approve of the current step (endpoint + seed). */
export function approveCore(c: Tenant<ClaimRecord>, user: User, at = nowIso()): void {
  if (c.status !== 'pending') conflict('This claim isn’t awaiting approval.', 'not_pending')
  const step = currentStep(c.approval)!
  assertCanApprove(user, step, approvalDoc(docOf(c)))
  c.approval.approvals.push({ userId: user.id, at })
  c.history.push(historyEntry(user.name, 'approved', `Step ${step.index + 1} of ${c.approval.steps.length}`, at))
  c.updatedAt = at
  if (c.approval.approvals.length >= c.approval.steps.length) {
    try {
      finishClaim(c, { id: user.id, name: user.name }, at)
    } catch (err) {
      c.approval.approvals.pop()
      c.history.pop()
      throw err
    }
  } else notifyStep(c)
}

/** POST /finance/expense-claims/:id/approve — whoever can act on the current step (any role; maker–checker). */
export async function approveClaim(user: User, id: string): Promise<ExpenseClaim> {
  const c = seeClaim(user, id)
  approveCore(c, user)
  return delay(claimView(user, c))
}

export function rejectCore(c: Tenant<ClaimRecord>, user: User, reason: string, at = nowIso()): void {
  if (c.status !== 'pending') conflict('This claim isn’t awaiting approval.', 'not_pending')
  assertCanApprove(user, currentStep(c.approval)!, approvalDoc(docOf(c)))
  if (!reason) bad('Say why it is rejected.', 'reason_required')
  c.status = 'rejected'
  c.rejectReason = reason
  c.updatedAt = at
  c.history.push(historyEntry(user.name, 'rejected', reason, at))
  notifyOnce(c, 'rejected', [c.requesterId], `Expense claim ${c.number} rejected`, reason, linkOf(c))
}

/** POST /finance/expense-claims/:id/reject */
export async function rejectClaim(user: User, id: string, input: { reason?: unknown } | null): Promise<ExpenseClaim> {
  const c = seeClaim(user, id)
  rejectCore(c, user, str(input?.reason, 500))
  return delay(claimView(user, c))
}

/** Store level reimbursement (endpoint + seed). */
export function reimburseCore(c: Tenant<ClaimRecord>, by: { id: string; name: string }, i: { method: 'payment' | 'payroll'; accountId?: string; date?: string }, at = nowIso()): void {
  const co = c.companyId
  if (c.status !== 'approved') conflict(c.status === 'in_payroll' || c.status === 'reimbursed' ? 'This claim is already being reimbursed.' : 'Only an approved claim can be reimbursed.', 'not_approved')
  const total = totalOf(c)
  if (i.method === 'payment') {
    const funds = fundAccountIds(co)
    const acc = paymentAccountsOf(co).find((a) => a.id === i.accountId && !funds.has(a.id))
    if (!acc) return bad('Pick the bank or cash account the employee is paid from.', 'invalid_payment_account')
    const date = dateOf(i.date ?? todayOf(co), 'Date', { notFutureOf: co })
    const name = employeeById(co, c.employeeId)?.fullName ?? ''
    const entry = postJournal(co, {
      date,
      memo: `Reimbursement of expense claim ${c.number}`,
      sourceType: 'expense',
      sourceId: c.id,
      createdBy: by.id,
      lines: [
        { accountId: REIMBURSEMENTS_PAYABLE, debit: total, credit: 0, description: `${c.number} · ${name}`.slice(0, 200) },
        { accountId: acc.id, debit: 0, credit: total, description: `${c.number} · ${name}`.slice(0, 200) },
      ],
    })
    c.reimbursement = { method: 'payment', accountId: acc.id, date, journalEntryId: entry.id, payrollAdjustmentId: null, payrollMonth: null, reimbursedAt: at, by: by.id }
    c.status = 'reimbursed'
    c.history.push(historyEntry(by.name, 'reimbursed', `Paid from ${acc.name}`, at))
    notifyOnce(c, 'reimbursed', [c.requesterId], `Expense claim ${c.number} reimbursed`, `${baseCurrencyOf(co)} ${total.toFixed(2)} paid to you`, linkOf(c))
  } else if (i.method === 'payroll') {
    const emp = employeeById(co, c.employeeId)
    if (!emp || emp.status === 'terminated') conflict('The employee is no longer on the payroll: pay the claim now instead.', 'not_on_payroll')
    const adj = upsertSystemAdjustment(co, { employeeId: c.employeeId, kind: 'reimbursement', label: `Expense claim ${c.number}`, amount: total, month: nextPayrollMonth(co), notes: c.title, sourceRef: `claim:${c.id}` }, by.id)
    c.reimbursement = { method: 'payroll', accountId: null, date: null, journalEntryId: null, payrollAdjustmentId: adj.id, payrollMonth: adj.month, reimbursedAt: null, by: by.id }
    c.status = 'in_payroll'
    c.history.push(historyEntry(by.name, 'sent to payroll', `Payroll of ${adj.month}`, at))
    notifyOnce(c, 'in_payroll', [c.requesterId], `Expense claim ${c.number} goes with your salary`, `${baseCurrencyOf(co)} ${total.toFixed(2)} in the payroll of ${adj.month}`, linkOf(c))
  } else bad('Pay now or through payroll?', 'invalid_method')
  c.updatedAt = at
}

/** POST /finance/expense-claims/:id/reimburse — accounting full. */
export async function reimburseClaim(user: User, id: string, input: ReimburseInput | null): Promise<ExpenseClaim> {
  const c = seeClaim(user, id)
  if (!isFull(user)) throw new CodedApiError('Only a Company Admin, Management or an Accountant reimburses claims.', 403, 'forbidden')
  const i = input ?? {}
  reimburseCore(c, { id: user.id, name: user.name }, { method: i.method as 'payment' | 'payroll', accountId: i.accountId, date: i.date })
  recordAudit(user, { action: 'update', entity: 'expense_claim', entityId: c.id, summary: `Reimbursed expense claim ${c.number} (${c.reimbursement?.method})`, changes: [] })
  return delay(claimView(user, c))
}
