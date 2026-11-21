import type { User } from '@/shared/types'
import type {
  DuplicateCheckInput,
  Expense,
  ExpenseCategory,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpensePaymentMethod,
  ExpensePolicy,
  ExpensePolicyInput,
  ExpensesMeta,
  ExpenseStatus,
} from '@/modules/finance/expenses/types'
import { EXPENSE_PAYMENT_METHODS, EXPENSE_STATUSES } from '@/modules/finance/expenses/types'
import { baseSplit, round2, toBase, vatSplit } from '@/modules/finance/expenses/calc'
import type { JournalLine } from '@/modules/finance/types'
import { nowIso } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { financeTaxCodes } from '@/shared/mocks/data/finance'
import { finExpenseCategories, finExpenses, finPettyFunds, type CategoryRecord, type ExpenseRecord } from '@/shared/mocks/data/financeExpenses'
import { delay } from '@/shared/mocks/server'
import { tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCanApprove, paymentAccountsOf } from './financeApprovals'
import { docNumber, nextId, postJournal, reverseJournal, systemAccount } from './ledger'
import {
  EXPENSES_LINK,
  accountIn,
  accountName,
  activeCategory,
  amountOf,
  assertExpenseFull,
  assertExpenseRead,
  bad,
  baseCurrencyOf,
  campaignIn,
  campaignOptions,
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
  approvalDoc,
  dateOf,
  departmentIn,
  departmentOptions,
  eventIn,
  eventOptions,
  expenseAccessOf,
  freezeChain,
  historyEntry,
  isFull,
  isMode,
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
  taxCodeIn,
  todayOf,
  userName,
  vatRegisteredOf,
  vendorIn,
} from './financeExpensesCore'
import { checkLowFund, fundAccountIds } from './financeExpensesPetty'
import { finExpensePolicy } from '@/shared/mocks/data/financeExpenses'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'

/**
 * Accounts & finance › Expenses — company spend paid immediately (card, bank transfer, cash, petty cash), expense
 * categories and the expense policy (docs/API.md › Finance › Expenses).
 *
 * Flow: create (= submit) → approval chain `expense` by base amount (services/financeApprovals.ts; maker–checker) →
 * on the last approval the expense posts:
 *     Dr category's expense account (net, with dimensions)   Dr VAT input (recoverable VAT only)
 *     Cr paid-from account (gross)                           — all in base currency (services/ledger.ts postJournal)
 * Void: pending → void (nothing posted); approved → the entry is reversed on the company's today.
 * VAT is recovered only with a valid tax invoice (payee TRN / VAT number present and valid; modules/finance/expenses/calc.ts).
 * A receipt is required above the policy amount. Same payee + amount + date as a live expense → `duplicate_of` warning.
 */

/* ---------------- categories ---------------- */

/** GET /finance/expense-categories — every role (claims need them); accounting full also sees inactive ones. */
export async function listCategories(user: User, q: { includeInactive?: string | null } = {}): Promise<ExpenseCategory[]> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  const all = isFull(user) && q.includeInactive === 'true'
  return delay(
    finExpenseCategories
      .filter((c) => c.companyId === co && (all || c.active))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(categoryView),
  )
}

function expenseAccount(co: string, id: unknown): string {
  const a = accountIn(co, id)
  if (!a) return bad('That account doesn’t exist.', 'account_not_found')
  if (a.type !== 'expense' || a.isHeader || !a.active) return bad('A category posts to an active expense account (not a header).', 'invalid_account')
  return a.id
}

function limitOf(v: unknown): number | null {
  if (v === null || v === '' || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return bad('The monthly limit must be 0 or more (empty = no limit).', 'invalid_limit')
  return round2(n)
}

/** POST /finance/expense-categories */
export async function createCategory(user: User, input: ExpenseCategoryInput | null): Promise<ExpenseCategory> {
  const co = assertExpenseFull(user)
  const i = input ?? {}
  const name = str(i.name, 80)
  if (!name) bad('Give the category a name.', 'name_required')
  if (finExpenseCategories.some((c) => c.companyId === co && c.name.toLowerCase() === name.toLowerCase())) conflict(`A category “${name}” already exists.`, 'duplicate_name')
  const at = nowIso()
  const c: Tenant<CategoryRecord> = {
    companyId: co,
    id: nextId('expenseCategory', 'ECAT'),
    name,
    accountId: expenseAccount(co, i.accountId),
    description: str(i.description, 300),
    monthlyLimit: limitOf(i.monthlyLimit),
    active: i.active === undefined ? true : !!i.active,
    createdAt: at,
    updatedAt: at,
  }
  finExpenseCategories.push(c)
  recordAudit(user, { action: 'create', entity: 'expense_category', entityId: c.id, summary: `Added the expense category ${c.name}`, changes: [] })
  return delay(categoryView(c))
}

/** PATCH /finance/expense-categories/:id */
export async function updateCategory(user: User, id: string, input: ExpenseCategoryInput | null): Promise<ExpenseCategory> {
  const co = assertExpenseFull(user)
  const c = categoryIn(co, id) ?? notFound()
  const i = input ?? {}
  if (i.name !== undefined) {
    const name = str(i.name, 80)
    if (!name) bad('Give the category a name.', 'name_required')
    if (finExpenseCategories.some((x) => x.companyId === co && x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) conflict(`A category “${name}” already exists.`, 'duplicate_name')
    c.name = name
  }
  if (i.accountId !== undefined) c.accountId = expenseAccount(co, i.accountId)
  if (i.description !== undefined) c.description = str(i.description, 300)
  if (i.monthlyLimit !== undefined) c.monthlyLimit = limitOf(i.monthlyLimit)
  if (i.active !== undefined) c.active = !!i.active
  c.updatedAt = nowIso()
  return delay(categoryView(c))
}

/* ---------------- policy ---------------- */

/** GET /finance/expense-policy — every role (the claim form shows the rules). */
export async function getPolicy(user: User): Promise<ExpensePolicy> {
  expenseAccessOf(user)
  return delay(policyView(tenantOf(user), isFull(user)))
}

/** PATCH /finance/expense-policy */
export async function updatePolicy(user: User, input: ExpensePolicyInput | null): Promise<ExpensePolicy> {
  const co = assertExpenseFull(user)
  const i = input ?? {}
  const p = { ...policyOf(co) }
  if (i.receiptRequiredAbove !== undefined) {
    const n = Number(i.receiptRequiredAbove)
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) bad('The receipt threshold must be 0 or more.', 'invalid_threshold')
    p.receiptRequiredAbove = round2(n)
  }
  if (i.claimMaxAgeDays !== undefined) {
    const n = Number(i.claimMaxAgeDays)
    if (!Number.isInteger(n) || n < 1 || n > 365) bad('The claim age limit is 1 to 365 days.', 'invalid_age')
    p.claimMaxAgeDays = n
  }
  for (const k of ['receiptMode', 'ageMode', 'limitMode'] as const) {
    if (i[k] !== undefined) {
      if (!isMode(i[k])) bad('Each rule either warns or blocks.', 'invalid_mode')
      p[k] = i[k]!
    }
  }
  p.updatedAt = nowIso()
  p.updatedBy = user.id
  finExpensePolicy.set(co, p)
  recordAudit(user, { action: 'update', entity: 'expense_policy', entityId: co, summary: 'Updated the expense policy', changes: [] })
  return delay(policyView(co, true))
}

/* ---------------- expenses: views ---------------- */

const expenseIn = (co: string, id: unknown) => (typeof id === 'string' ? finExpenses.find((e) => e.companyId === co && e.id === id) : undefined)
const live = (e: ExpenseRecord) => e.status !== 'void' && e.status !== 'rejected'
const samePayee = (a: { vendorId: string | null; payeeName: string }, b: { vendorId: string | null; payeeName: string }) =>
  a.vendorId && b.vendorId ? a.vendorId === b.vendorId : a.payeeName.trim().toLowerCase() === b.payeeName.trim().toLowerCase()

function duplicatesOf(co: string, d: { id?: string | null; vendorId: string | null; payeeName: string; amount: number; date: string }) {
  return finExpenses.filter((e) => e.companyId === co && e.id !== d.id && live(e) && e.date === d.date && e.amount === d.amount && samePayee(e, d)).map((e) => ({ id: e.id, number: e.number }))
}

const docOf = (e: Tenant<ExpenseRecord>) => ({ companyId: e.companyId, requesterId: e.createdBy, departmentId: e.departmentId, approval: e.approval })

function expenseView(user: User, e: Tenant<ExpenseRecord>): Expense {
  const co = e.companyId
  const full = isFull(user)
  const pending = e.status === 'pending'
  const canAct = pending && full && canActNow(user, docOf(e))
  return {
    id: e.id,
    number: e.number,
    status: e.status,
    date: e.date,
    vendorId: e.vendorId,
    payeeName: e.payeeName,
    payeeVatNumber: e.payeeVatNumber,
    categoryId: e.categoryId,
    categoryName: categoryIn(co, e.categoryId)?.name ?? 'Unknown category',
    accountId: e.accountId,
    accountName: accountName(co, e.accountId),
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    exchangeRate: e.exchangeRate,
    taxCodeId: e.taxCodeId,
    taxRate: e.taxRate,
    vatAmount: e.vatAmount,
    netAmount: e.netAmount,
    vatRecoverable: e.vatRecoverable,
    vatNote: e.vatNote,
    baseAmount: toBase(e.amount, e.exchangeRate),
    paymentMethod: e.paymentMethod,
    pettyFundId: e.pettyFundId,
    pettyFundName: e.pettyFundId ? (finPettyFunds.find((f) => f.companyId === co && f.id === e.pettyFundId)?.name ?? null) : null,
    paidFromAccountId: e.paidFromAccountId,
    paidFromAccountName: accountName(co, e.paidFromAccountId),
    reference: e.reference,
    departmentId: e.departmentId,
    departmentName: departmentIn(co, e.departmentId)?.name ?? null,
    projectId: e.projectId,
    projectName: projectIn(co, e.projectId)?.name ?? null,
    eventId: e.eventId,
    eventName: eventIn(co, e.eventId)?.name ?? null,
    campaignId: e.campaignId,
    campaignName: campaignIn(co, e.campaignId)?.name ?? null,
    receipt: e.receipt ? { ...e.receipt } : null,
    notes: e.notes,
    steps: stepViews(docOf(e), pending),
    journal: journalRef(co, e.journalEntryId),
    voidJournal: journalRef(co, e.voidJournalEntryId),
    duplicateOf: live(e) ? duplicatesOf(co, e) : [],
    history: e.history.map((h) => ({ ...h })),
    createdBy: e.createdBy,
    createdByName: userName(co, e.createdBy),
    createdAt: e.createdAt,
    approvedAt: e.approvedAt,
    rejectReason: e.rejectReason,
    voidedAt: e.voidedAt,
    voidReason: e.voidReason,
    can: { approve: canAct, reject: canAct, edit: full && pending && e.approval.approvals.length === 0, void: full && (e.status === 'pending' || e.status === 'approved') },
  }
}

/* ---------------- expenses: reads ---------------- */

export interface ExpenseListQuery {
  status?: string | null
  categoryId?: string | null
  vendorId?: string | null
  paymentMethod?: string | null
  from?: string | null
  to?: string | null
  q?: string | null
}

/** GET /finance/expenses — accounting full / view. */
export async function listExpenses(user: User, f: ExpenseListQuery = {}): Promise<Expense[]> {
  const co = assertExpenseRead(user)
  const q = (f.q ?? '').trim().toLowerCase()
  const rows = finExpenses
    .filter((e) => e.companyId === co)
    .filter((e) => !f.status || !EXPENSE_STATUSES.includes(f.status as ExpenseStatus) || e.status === f.status)
    .filter((e) => !f.categoryId || e.categoryId === f.categoryId)
    .filter((e) => !f.vendorId || e.vendorId === f.vendorId)
    .filter((e) => !f.paymentMethod || e.paymentMethod === f.paymentMethod)
    .filter((e) => !f.from || e.date >= f.from)
    .filter((e) => !f.to || e.date <= f.to)
    .filter((e) => !q || `${e.number} ${e.payeeName} ${e.description} ${e.reference}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return delay(rows.map((e) => expenseView(user, e)))
}

/** GET /finance/expenses/:id */
export async function getExpense(user: User, id: string): Promise<Expense> {
  const co = assertExpenseRead(user)
  return delay(expenseView(user, expenseIn(co, id) ?? notFound()))
}

/** GET /finance/expenses/meta — what the expense form offers (caller's company only). */
export async function expensesMeta(user: User): Promise<ExpensesMeta> {
  const co = assertExpenseRead(user)
  const funds = fundAccountIds(co)
  return delay({
    baseCurrency: baseCurrencyOf(co),
    vatRegistered: vatRegisteredOf(co),
    country: countryOf(co),
    standardTaxCodeId: standardTaxCode(co)?.id ?? '',
    receiptRequiredAbove: policyOf(co).receiptRequiredAbove,
    currencies: currenciesOf(co),
    categories: finExpenseCategories.filter((c) => c.companyId === co && c.active).sort((a, b) => a.name.localeCompare(b.name)).map(categoryView),
    paymentAccounts: paymentAccountsOf(co).filter((a) => !funds.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    pettyFunds: finPettyFunds.filter((f) => f.companyId === co && f.active).map((f) => ({ id: f.id, name: f.name })),
    taxCodes: financeTaxCodes.filter((t) => t.companyId === co && t.active).map((t) => ({ id: t.id, name: t.name, rate: t.rate, category: t.category })),
    vendors: eventVendors.filter((v) => v.companyId === co).map((v) => ({ id: v.id, name: v.name, taxNumber: v.taxNumber, blocked: v.status === 'blacklisted' })),
    departments: departmentOptions(co),
    projects: projectOptions(co),
    events: eventOptions(co),
    campaigns: campaignOptions(co),
  })
}

/** POST /finance/expenses/check-duplicate — live expenses with the same payee, amount and date. */
export async function checkDuplicate(user: User, input: DuplicateCheckInput | null): Promise<{ duplicates: { id: string; number: string; date: string; payeeName: string; amount: number; currency: string; status: ExpenseStatus }[] }> {
  const co = assertExpenseRead(user)
  const i = input ?? {}
  const vendor = i.vendorId ? vendorIn(co, i.vendorId) : undefined
  const payeeName = vendor?.name ?? str(i.payeeName, 200)
  const amount = Number(i.amount)
  if (!payeeName || !Number.isFinite(amount) || typeof i.date !== 'string') return delay({ duplicates: [] })
  const ids = new Set(duplicatesOf(co, { id: i.excludeId ?? null, vendorId: vendor?.id ?? null, payeeName, amount: round2(amount), date: i.date }).map((d) => d.id))
  return delay({
    duplicates: finExpenses.filter((e) => e.companyId === co && ids.has(e.id)).map((e) => ({ id: e.id, number: e.number, date: e.date, payeeName: e.payeeName, amount: e.amount, currency: e.currency, status: e.status })),
  })
}

/* ---------------- expenses: writes ---------------- */

type Fields = Omit<ExpenseRecord, 'id' | 'number' | 'status' | 'approval' | 'journalEntryId' | 'voidJournalEntryId' | 'history' | 'createdBy' | 'createdAt' | 'updatedAt' | 'approvedAt' | 'rejectReason' | 'voidedAt' | 'voidReason' | 'alertMarks'>

/** Validates and computes an expense's fields (base = the stored record on an update). */
export function expenseFields(co: string, i: ExpenseInput, base: Fields | null): Fields {
  const pick = <K extends keyof ExpenseInput>(k: K) => (i[k] !== undefined ? i[k] : base ? (base as unknown as Record<string, unknown>)[k] : undefined)
  const date = dateOf(pick('date'), 'Date', { notFutureOf: co })
  const vendorId = optionalRef(pick('vendorId'), (id) => vendorIn(co, id), 'vendor_not_found', 'supplier')
  const vendor = vendorId ? vendorIn(co, vendorId) : undefined
  const payeeName = vendor?.name ?? str(pick('payeeName'), 200)
  if (!payeeName) bad('Who was paid? Pick a supplier or type the payee.', 'payee_required')
  const vatIn = pick('payeeVatNumber')
  const payeeVatNumber = (vatIn !== undefined ? str(vatIn, 30) : vendor?.taxNumber ?? '').replace(/\s/g, '')
  const category = activeCategory(co, pick('categoryId'))
  const amount = amountOf(pick('amount'))
  const methodIn = pick('paymentMethod') ?? 'bank_transfer'
  if (!EXPENSE_PAYMENT_METHODS.includes(methodIn as ExpensePaymentMethod)) bad('Pick how it was paid: company card, bank transfer, cash or petty cash.', 'invalid_payment_method')
  const paymentMethod = methodIn as ExpensePaymentMethod
  let currency = currencyOf(co, pick('currency'))
  let pettyFundId: string | null = null
  let paidFromAccountId: string
  const funds = fundAccountIds(co)
  if (paymentMethod === 'petty_cash') {
    const f = finPettyFunds.find((x) => x.companyId === co && x.id === pick('pettyFundId'))
    if (!f) return bad('Pick the petty cash fund it was paid from.', 'fund_not_found')
    if (!f.active) return bad(`The fund “${f.name}” is closed.`, 'fund_closed')
    if (currency !== baseCurrencyOf(co)) bad(`Petty cash is in ${baseCurrencyOf(co)}.`, 'invalid_currency')
    currency = baseCurrencyOf(co)
    pettyFundId = f.id
    paidFromAccountId = f.accountId
  } else {
    const acc = paymentAccountsOf(co).find((a) => a.id === pick('paidFromAccountId'))
    if (!acc) return bad('Pick the bank, card or cash account it was paid from.', 'invalid_payment_account')
    if (funds.has(acc.id)) bad('That account holds petty cash funds: record the expense as paid by petty cash and pick the fund.', 'use_petty_fund')
    paidFromAccountId = acc.id
  }
  const exchangeRate = rateOf(co, currency, date, i.exchangeRate !== undefined ? i.exchangeRate : base && base.currency === currency ? base.exchangeRate : undefined)
  const tax = taxCodeIn(co, pick('taxCodeId') ?? standardTaxCode(co)?.id)
  if (!tax || !tax.active) return bad('That tax code doesn’t exist.', 'tax_code_not_found')
  const split = vatSplit({ amount, rate: tax.rate, category: tax.category, payeeVatNumber, country: countryOf(co), vatRegistered: vatRegisteredOf(co) })
  const receipt = i.receipt !== undefined ? receiptOf(i.receipt) : (base?.receipt ?? null)
  const baseAmount = toBase(amount, exchangeRate)
  const limit = policyOf(co).receiptRequiredAbove
  if (!receipt && baseAmount > limit) bad(`Attach the receipt: it is required above ${baseCurrencyOf(co)} ${limit}.`, 'receipt_required', { threshold: limit })
  return {
    date,
    vendorId,
    payeeName,
    payeeVatNumber,
    categoryId: category.id,
    accountId: category.accountId,
    description: str(pick('description'), 500),
    amount,
    currency,
    exchangeRate,
    taxCodeId: tax.id,
    taxRate: tax.rate,
    vatAmount: split.vat,
    netAmount: split.net,
    vatRecoverable: split.recoverable,
    vatNote: split.note,
    paymentMethod,
    pettyFundId,
    paidFromAccountId,
    reference: str(pick('reference'), 100),
    departmentId: optionalRef(pick('departmentId'), (id) => departmentIn(co, id), 'department_not_found', 'department'),
    projectId: optionalRef(pick('projectId'), (id) => projectIn(co, id), 'project_not_found', 'project'),
    eventId: optionalRef(pick('eventId'), (id) => eventIn(co, id), 'event_not_found', 'event'),
    campaignId: optionalRef(pick('campaignId'), (id) => campaignIn(co, id), 'campaign_not_found', 'campaign'),
    receipt,
    notes: str(pick('notes'), 2000),
  }
}

/** The posting of an approved expense (base currency; balances exactly). */
export function expenseLines(e: ExpenseRecord & { companyId: string }): JournalLine[] {
  const b = baseSplit(e.amount, e.vatAmount, e.exchangeRate)
  const memo = `${e.payeeName}${e.description ? ` · ${e.description}` : ''}`.slice(0, 200)
  const dims = { departmentId: e.departmentId, projectId: e.projectId, eventId: e.eventId }
  const lines: JournalLine[] = [{ accountId: e.accountId, debit: b.net, credit: 0, description: memo, ...dims, taxCode: e.vatRecoverable ? null : e.taxCodeId }]
  if (b.vat > 0) lines.push({ accountId: systemAccount(e.companyId, 'vat_input'), debit: b.vat, credit: 0, description: `Input VAT · ${e.payeeName}`.slice(0, 200), taxCode: e.taxCodeId })
  lines.push({ accountId: e.paidFromAccountId, debit: 0, credit: b.gross, description: memo })
  return lines
}

/** Approves the current step (or posts straight away when the chain is complete). Store level: no permission checks. */
export function finishExpense(e: Tenant<ExpenseRecord>, by: { id: string; name: string }, at = nowIso()): void {
  const entry = postJournal(e.companyId, { date: e.date, memo: `Expense ${e.number}`, sourceType: 'expense', sourceId: e.id, lines: expenseLines(e), createdBy: by.id })
  e.journalEntryId = entry.id
  e.status = 'approved'
  e.approvedAt = at
  e.history.push(historyEntry(by.name, 'posted', `Journal ${entry.number}`, at))
  if (e.pettyFundId) checkLowFund(e.companyId, e.pettyFundId)
}

function notifyApprovers(e: Tenant<ExpenseRecord>): void {
  const step = currentStep(e.approval)
  if (!step) return
  notifyOnce(e, `step:${step.index}`, currentApprovers(docOf(e)).filter((id) => id !== e.createdBy), `Expense ${e.number} needs your approval`, `${e.payeeName} · ${e.currency} ${e.amount.toFixed(2)}`, `${EXPENSES_LINK}?expense=${encodeURIComponent(e.id)}`)
}

/** Store-level create used by the endpoint and the seed: freezes the chain; no steps → posts now. */
export function newExpense(co: string, fields: Fields, by: { id: string; name: string }, at = nowIso()): Tenant<ExpenseRecord> {
  const e: Tenant<ExpenseRecord> = {
    companyId: co,
    id: nextId('expense', 'EXP'),
    number: docNumber(co, prefixOf(co), 'EXP', fields.date.slice(0, 4)),
    status: 'pending',
    ...fields,
    approval: freezeChain(co, 'expense', toBase(fields.amount, fields.exchangeRate)),
    journalEntryId: null,
    voidJournalEntryId: null,
    history: [historyEntry(by.name, 'created', '', at)],
    createdBy: by.id,
    createdAt: at,
    updatedAt: at,
    approvedAt: null,
    rejectReason: null,
    voidedAt: null,
    voidReason: null,
    alertMarks: [],
  }
  finExpenses.push(e)
  if (!e.approval.steps.length) finishExpense(e, by, at)
  else notifyApprovers(e)
  return e
}

/** POST /finance/expenses — records (and submits) an expense; returns it with any duplicates. */
export async function createExpense(user: User, input: ExpenseInput | null): Promise<Expense> {
  const co = assertExpenseFull(user)
  const fields = expenseFields(co, input ?? {}, null)
  chargeReceipts(co, [fields.receipt])
  const e = newExpense(co, fields, { id: user.id, name: user.name })
  recordAudit(user, { action: 'create', entity: 'expense', entityId: e.id, summary: `Recorded expense ${e.number} (${e.payeeName}, ${e.currency} ${e.amount})`, changes: [] })
  return delay(expenseView(user, e))
}

function ownExpense(user: User, id: string): Tenant<ExpenseRecord> {
  const co = assertExpenseFull(user)
  return expenseIn(co, id) ?? notFound()
}

/** PATCH /finance/expenses/:id — while pending and nobody has approved yet; the chain is re-frozen. */
export async function updateExpense(user: User, id: string, input: ExpenseInput | null): Promise<Expense> {
  const e = ownExpense(user, id)
  if (e.status !== 'pending' || e.approval.approvals.length) conflict('Only an expense nobody has approved yet can be edited. Void it and record a new one.', 'expense_locked')
  const fields = expenseFields(e.companyId, input ?? {}, e)
  chargeReceipts(e.companyId, [fields.receipt], [e.receipt])
  Object.assign(e, fields)
  e.approval = freezeChain(e.companyId, 'expense', toBase(e.amount, e.exchangeRate))
  e.alertMarks = []
  e.updatedAt = nowIso()
  e.history.push(historyEntry(user.name, 'edited'))
  if (!e.approval.steps.length) finishExpense(e, { id: user.id, name: user.name })
  else notifyApprovers(e)
  return delay(expenseView(user, e))
}

/** POST /finance/expenses/:id/approve — the current step (maker–checker: never the creator; one step per user). */
export async function approveExpense(user: User, id: string): Promise<Expense> {
  const e = ownExpense(user, id)
  if (e.status !== 'pending') conflict('This expense isn’t awaiting approval.', 'not_pending')
  const step = currentStep(e.approval)!
  assertCanApprove(user, step, approvalDoc(docOf(e)))
  const at = nowIso()
  e.approval.approvals.push({ userId: user.id, at })
  e.history.push(historyEntry(user.name, 'approved', `Step ${step.index + 1} of ${e.approval.steps.length}`, at))
  if (e.approval.approvals.length >= e.approval.steps.length) {
    try {
      finishExpense(e, { id: user.id, name: user.name }, at)
    } catch (err) {
      e.approval.approvals.pop()
      e.history.pop()
      throw err
    }
    notifyOnce(e, 'approved', [e.createdBy].filter((x) => x !== user.id), `Expense ${e.number} approved`, `${e.payeeName} · posted to the ledger`, `${EXPENSES_LINK}?expense=${encodeURIComponent(e.id)}`)
  } else notifyApprovers(e)
  e.updatedAt = at
  return delay(expenseView(user, e))
}

/** POST /finance/expenses/:id/reject — by an approver of the current step; a reason is required. */
export async function rejectExpense(user: User, id: string, input: { reason?: unknown } | null): Promise<Expense> {
  const e = ownExpense(user, id)
  if (e.status !== 'pending') conflict('This expense isn’t awaiting approval.', 'not_pending')
  assertCanApprove(user, currentStep(e.approval)!, approvalDoc(docOf(e)))
  const reason = str(input?.reason, 500)
  if (!reason) bad('Say why it is rejected.', 'reason_required')
  e.status = 'rejected'
  e.rejectReason = reason
  e.updatedAt = nowIso()
  e.history.push(historyEntry(user.name, 'rejected', reason))
  notifyOnce(e, 'rejected', [e.createdBy], `Expense ${e.number} rejected`, reason, `${EXPENSES_LINK}?expense=${encodeURIComponent(e.id)}`)
  return delay(expenseView(user, e))
}

/** POST /finance/expenses/:id/void — pending: nothing posted; approved: the entry is reversed on the company's today. */
export async function voidExpense(user: User, id: string, input: { reason?: unknown } | null): Promise<Expense> {
  const e = ownExpense(user, id)
  if (e.status !== 'pending' && e.status !== 'approved') conflict(e.status === 'void' ? 'This expense is already void.' : 'A rejected expense can’t be voided.', 'not_voidable')
  const reason = str(input?.reason, 500)
  if (!reason) bad('Say why it is voided.', 'reason_required')
  const at = nowIso()
  if (e.status === 'approved' && e.journalEntryId) {
    const rev = reverseJournal(e.companyId, e.journalEntryId, todayOf(e.companyId), `Void of expense ${e.number}: ${reason}`.slice(0, 200), user.id)
    e.voidJournalEntryId = rev.id
  }
  e.status = 'void'
  e.voidedAt = at
  e.voidReason = reason
  e.updatedAt = at
  e.history.push(historyEntry(user.name, 'voided', reason, at))
  if (e.pettyFundId) checkLowFund(e.companyId, e.pettyFundId)
  recordAudit(user, { action: 'update', entity: 'expense', entityId: e.id, summary: `Voided expense ${e.number}: ${reason}`, changes: [] })
  return delay(expenseView(user, e))
}
