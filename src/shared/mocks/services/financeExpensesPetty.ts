import type { User } from '@/shared/types'
import type {
  CashCountInput,
  PettyExpense,
  PettyExpenseInput,
  PettyFund,
  PettyFundDetail,
  PettyFundInput,
  PettyMeta,
  PettyMovement,
  PettyMovementKind,
  PettyTopUpInput,
  ReplenishInput,
} from '@/modules/finance/expenses/types'
import { countDifference, fundFigures, policyWarnings, replenishment, round2, vatSplit } from '@/modules/finance/expenses/calc'
import type { JournalLine } from '@/modules/finance/types'
import { nowIso } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { employeeById, employeeForUser, employeesOf } from '@/shared/mocks/data/hrEmployees'
import {
  finExpenseCategories,
  finExpenses,
  finPettyExpenses,
  finPettyFunds,
  finPettyMovements,
  type PettyExpenseRecord,
  type PettyFundRecord,
  type PettyMovementRecord,
} from '@/shared/mocks/data/financeExpenses'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { paymentAccountsOf } from './financeApprovals'
import { docNumber, nextId, postJournal, systemAccount } from './ledger'
import {
  EXPENSES_LINK,
  PETTY_CASH_ACCOUNT,
  accountName,
  accountantIds,
  activeCategory,
  amountOf,
  assertExpenseFull,
  bad,
  baseCurrencyOf,
  categoryIn,
  categoryView,
  chargeReceipts,
  conflict,
  countryOf,
  dateOf,
  expenseAccessOf,
  isFull,
  journalRef,
  notFound,
  notify,
  policyOf,
  prefixOf,
  receiptOf,
  standardTaxCode,
  str,
  todayOf,
  userName,
  vatRegisteredOf,
} from './financeExpensesCore'

/**
 * Accounts & finance › Expenses › Petty cash (docs/API.md › Finance › Petty cash). Imprest funds held by a custodian
 * (an employee) with a float limit.
 *
 * LEDGER: a fund's cash sits in a cash account under 1100 — ACC-1115 Petty cash by default. Funds may share 1115
 * (its balance is then the sum of the funds); a company that wants one GL account per fund adds a sub-account under
 * 1100 Cash and bank and picks it when creating the fund. The fund's own book balance is kept from its movements:
 *   top-up         Dr fund account / Cr bank                                   (+ amount)
 *   replenishment  Dr expense accounts (+ Dr VAT input) / Cr fund account (the approved expenses)
 *                  Dr fund account / Cr bank (back to the float)               (− expenses + top-up)
 *   cash count     short: Dr 6950 rounding (over/short) / Cr fund; over: Dr fund / Cr 6950   (± difference)
 *   company expenses paid by petty cash (services/financeExpenses.ts) post Cr fund account when approved (−).
 * The custodian records petty expenses (not posted: the cash is already out of the box), so
 *   cash expected = book balance − pending petty expenses; low balance = cash expected < 20% of the float.
 *
 * ACCESS: accounting full — every fund, all actions (not replenishing a fund they hold: maker–checker); a custodian
 * (any role) — their own fund: read and record expenses; everyone else sees no fund.
 */

/* ---------------- figures ---------------- */

const fundIn = (co: string, id: unknown) => (typeof id === 'string' ? finPettyFunds.find((f) => f.companyId === co && f.id === id) : undefined)

/** Accounts that hold an active fund (company expenses can't be paid from them directly). */
export function fundAccountIds(co: string): Set<string> {
  return new Set(finPettyFunds.filter((f) => f.companyId === co && f.active).map((f) => f.accountId))
}

function bookBalance(f: Tenant<PettyFundRecord>): number {
  let b = 0
  for (const m of finPettyMovements) if (m.companyId === f.companyId && m.fundId === f.id) b += m.amount
  for (const e of finExpenses) if (e.companyId === f.companyId && e.pettyFundId === f.id && e.status === 'approved') b -= e.amount
  return round2(b)
}
const pendingOf = (f: Tenant<PettyFundRecord>) => finPettyExpenses.filter((e) => e.companyId === f.companyId && e.fundId === f.id && e.status === 'pending')

export function figuresOf(f: Tenant<PettyFundRecord>) {
  const pending = pendingOf(f)
  return { ...fundFigures(f.floatLimit, bookBalance(f), pending.reduce((s, e) => s + e.amount, 0)), pendingCount: pending.length }
}

const custodianUserId = (f: Tenant<PettyFundRecord>) => employeeById(f.companyId, f.custodianEmployeeId)?.userId ?? null
const isCustodian = (user: User, f: Tenant<PettyFundRecord>) => custodianUserId(f) === user.id

/** Low-balance alert (custodian + accountants), once until the fund is back above 20%. */
export function checkLowFund(co: string, fundId: string): void {
  const f = fundIn(co, fundId)
  if (!f) return
  const fig = figuresOf(f)
  if (!fig.lowBalance) {
    f.lowAlerted = false
    return
  }
  if (f.lowAlerted || !f.active) return
  f.lowAlerted = true
  const cust = custodianUserId(f)
  notify(co, [...(cust ? [cust] : []), ...accountantIds(co)], `Petty cash “${f.name}” is running low`, `${baseCurrencyOf(co)} ${fig.cashExpected.toFixed(2)} left of a ${f.floatLimit.toFixed(2)} float: replenish it.`, `${EXPENSES_LINK}?tab=petty&fund=${encodeURIComponent(f.id)}`)
}

/* ---------------- views ---------------- */

function fundView(user: User, f: Tenant<PettyFundRecord>): PettyFund {
  const co = f.companyId
  const fig = figuresOf(f)
  const full = isFull(user)
  const mine = isCustodian(user, f)
  const moves = finPettyMovements.filter((m) => m.companyId === co && m.fundId === f.id)
  const last = (k: PettyMovementKind) => moves.filter((m) => m.kind === k).map((m) => m.createdAt).sort().slice(-1)[0] ?? null
  return {
    id: f.id,
    name: f.name,
    custodianEmployeeId: f.custodianEmployeeId,
    custodianName: employeeById(co, f.custodianEmployeeId)?.fullName ?? 'Unknown employee',
    accountId: f.accountId,
    accountName: accountName(co, f.accountId),
    currency: baseCurrencyOf(co),
    floatLimit: f.floatLimit,
    bookBalance: fig.bookBalance,
    pendingTotal: fig.pendingTotal,
    pendingCount: fig.pendingCount,
    cashExpected: fig.cashExpected,
    replenishAmount: fig.replenishAmount,
    lowBalance: fig.lowBalance,
    active: f.active,
    lastCountAt: last('count'),
    lastReplenishedAt: last('replenishment'),
    isMine: mine,
    can: { record: f.active && (mine || full), manage: full, replenish: full && !mine && f.active },
  }
}

function pettyExpenseView(p: Tenant<PettyExpenseRecord>): PettyExpense {
  const co = p.companyId
  const pol = policyOf(co)
  const cat = categoryIn(co, p.categoryId)
  const warnings =
    p.status === 'pending'
      ? policyWarnings([{ id: p.id, date: p.date, categoryId: p.categoryId, baseAmount: p.amount, hasReceipt: !!p.receipt }], p.date, pol, new Map(), new Map(), baseCurrencyOf(co)).filter((w) => w.code === 'receipt_missing')
      : []
  return {
    id: p.id,
    number: p.number,
    fundId: p.fundId,
    date: p.date,
    categoryId: p.categoryId,
    categoryName: cat?.name ?? 'Unknown category',
    description: p.description,
    payeeName: p.payeeName,
    payeeVatNumber: p.payeeVatNumber,
    amount: p.amount,
    vatAmount: p.vatAmount,
    receipt: p.receipt ? { ...p.receipt } : null,
    status: p.status,
    replenishmentId: p.replenishmentId,
    rejectReason: p.rejectReason,
    warnings,
    createdByName: userName(co, p.createdBy),
    createdAt: p.createdAt,
  }
}

function movementView(m: Tenant<PettyMovementRecord>): PettyMovement {
  const co = m.companyId
  return {
    id: m.id,
    number: m.number,
    kind: m.kind,
    date: m.date,
    amount: m.amount,
    expensesTotal: m.expensesTotal,
    topUp: m.topUp,
    counted: m.counted,
    expected: m.expected,
    difference: m.difference,
    reason: m.reason,
    fromAccountName: m.fromAccountId ? accountName(co, m.fromAccountId) : null,
    journal: journalRef(co, m.journalEntryId),
    expenseIds: [...m.expenseIds],
    byName: userName(co, m.createdBy),
    at: m.createdAt,
  }
}

function detailView(user: User, f: Tenant<PettyFundRecord>): PettyFundDetail {
  const co = f.companyId
  return {
    ...fundView(user, f),
    expenses: finPettyExpenses
      .filter((e) => e.companyId === co && e.fundId === f.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map(pettyExpenseView),
    movements: finPettyMovements
      .filter((m) => m.companyId === co && m.fundId === f.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map(movementView),
  }
}

/* ---------------- reads ---------------- */

/** Funds the caller sees: accounting full — all; a custodian — their own; others — none. */
function visibleFund(user: User, f: Tenant<PettyFundRecord>): boolean {
  return isFull(user) || isCustodian(user, f)
}

/** GET /finance/petty-cash/funds */
export async function listFunds(user: User): Promise<PettyFund[]> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  return delay(
    finPettyFunds
      .filter((f) => f.companyId === co && visibleFund(user, f))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((f) => fundView(user, f)),
  )
}

function seeFund(user: User, id: string): Tenant<PettyFundRecord> {
  expenseAccessOf(user)
  const f = fundIn(tenantOf(user), id)
  if (!f || !visibleFund(user, f)) return notFound()
  return f
}

/** GET /finance/petty-cash/funds/:id */
export async function getFund(user: User, id: string): Promise<PettyFundDetail> {
  return delay(detailView(user, seeFund(user, id)))
}

/** GET /finance/petty-cash/meta */
export async function pettyMeta(user: User): Promise<PettyMeta> {
  expenseAccessOf(user)
  const co = tenantOf(user)
  const full = isFull(user)
  const accounts = paymentAccountsOf(co)
  return delay({
    baseCurrency: baseCurrencyOf(co),
    categories: finExpenseCategories.filter((c) => c.companyId === co && c.active).sort((a, b) => a.name.localeCompare(b.name)).map(categoryView),
    employees: full ? employeesOf(co).filter((e) => e.status !== 'terminated').map((e) => ({ id: e.id, name: e.fullName })) : [],
    fundAccounts: full ? accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })) : [],
    bankAccounts: full ? accounts.filter((a) => !fundAccountIds(co).has(a.id) && a.id !== PETTY_CASH_ACCOUNT).map((a) => ({ id: a.id, code: a.code, name: a.name })) : [],
    receiptRequiredAbove: policyOf(co).receiptRequiredAbove,
    canManage: full,
  })
}

/* ---------------- writes (store level, used by the endpoints and the seed) ---------------- */

const SERIES: Record<PettyMovementKind, string> = { top_up: 'PCT', replenishment: 'PCR', count: 'PCC' }

function newMovement(f: Tenant<PettyFundRecord>, kind: PettyMovementKind, date: string, by: string, fields: Partial<PettyMovementRecord>, at = nowIso()): Tenant<PettyMovementRecord> {
  const m: Tenant<PettyMovementRecord> = {
    companyId: f.companyId,
    id: nextId('pettyMovement', 'PCM'),
    number: docNumber(f.companyId, prefixOf(f.companyId), SERIES[kind], date.slice(0, 4)),
    fundId: f.id,
    kind,
    date,
    amount: 0,
    expensesTotal: 0,
    topUp: 0,
    counted: null,
    expected: null,
    difference: null,
    reason: '',
    fromAccountId: null,
    journalEntryId: null,
    expenseIds: [],
    createdBy: by,
    createdAt: at,
    ...fields,
  }
  return m
}

function bankAccount(co: string, f: Tenant<PettyFundRecord> | null, id: unknown): string {
  const acc = paymentAccountsOf(co).find((a) => a.id === id)
  if (!acc) return bad('Pick the bank or cash account the money comes from.', 'invalid_payment_account')
  if (f && acc.id === f.accountId) bad('The money comes from another account than the fund’s own.', 'invalid_payment_account')
  return acc.id
}

export function topUpCore(f: Tenant<PettyFundRecord>, amount: number, fromAccountId: string, date: string, by: string, at = nowIso()): Tenant<PettyMovementRecord> {
  const m = newMovement(f, 'top_up', date, by, { amount, topUp: amount, fromAccountId }, at)
  const e = postJournal(f.companyId, {
    date,
    memo: `Petty cash top-up · ${f.name}`,
    sourceType: 'expense',
    sourceId: m.id,
    createdBy: by,
    lines: [
      { accountId: f.accountId, debit: amount, credit: 0, description: `Top-up ${f.name}` },
      { accountId: fromAccountId, debit: 0, credit: amount, description: `Top-up ${f.name}` },
    ],
  })
  m.journalEntryId = e.id
  finPettyMovements.push(m)
  checkLowFund(f.companyId, f.id)
  return m
}

export function newFund(co: string, fields: { name: string; custodianEmployeeId: string; accountId: string; floatLimit: number }, by: string, at = nowIso()): Tenant<PettyFundRecord> {
  const f: Tenant<PettyFundRecord> = { companyId: co, id: nextId('pettyFund', 'PCF'), ...fields, active: true, lowAlerted: false, createdBy: by, createdAt: at, updatedAt: at }
  finPettyFunds.push(f)
  return f
}

export function recordPettyCore(f: Tenant<PettyFundRecord>, i: PettyExpenseInput, by: string, at = nowIso()): Tenant<PettyExpenseRecord> {
  const co = f.companyId
  const date = dateOf(i.date ?? todayOf(co), 'Date', { notFutureOf: co })
  const cat = activeCategory(co, i.categoryId)
  const amount = amountOf(i.amount)
  const payeeName = str(i.payeeName, 200)
  if (!payeeName) bad('Where was it spent? Type the payee.', 'payee_required')
  const payeeVatNumber = str(i.payeeVatNumber, 30).replace(/\s/g, '')
  const receipt = receiptOf(i.receipt)
  const pol = policyOf(co)
  if (!receipt && amount > pol.receiptRequiredAbove && pol.receiptMode === 'block') bad(`Attach the receipt: it is required above ${baseCurrencyOf(co)} ${pol.receiptRequiredAbove}.`, 'receipt_required', { threshold: pol.receiptRequiredAbove })
  const fig = figuresOf(f)
  if (amount > fig.cashExpected) bad(`Only ${baseCurrencyOf(co)} ${fig.cashExpected.toFixed(2)} should be in the fund: ask for a replenishment first.`, 'insufficient_cash', { cash_expected: fig.cashExpected })
  const std = standardTaxCode(co)
  const split = vatSplit({ amount, rate: std?.rate ?? 0, category: std?.category ?? 'out_of_scope', payeeVatNumber, country: countryOf(co), vatRegistered: vatRegisteredOf(co) })
  const p: Tenant<PettyExpenseRecord> = {
    companyId: co,
    id: nextId('pettyExpense', 'PCE'),
    number: docNumber(co, prefixOf(co), 'PCE', date.slice(0, 4)),
    fundId: f.id,
    date,
    categoryId: cat.id,
    description: str(i.description, 500),
    payeeName,
    payeeVatNumber,
    amount,
    vatAmount: split.vat,
    receipt,
    status: 'pending',
    replenishmentId: null,
    rejectReason: null,
    createdBy: by,
    createdAt: at,
  }
  finPettyExpenses.push(p)
  checkLowFund(co, f.id)
  return p
}

/** Posts the approved expenses and tops the fund back to its float (one journal entry). */
export function replenishCore(
  f: Tenant<PettyFundRecord>,
  approve: Tenant<PettyExpenseRecord>[],
  reject: { e: Tenant<PettyExpenseRecord>; reason: string }[],
  fromAccountId: string,
  date: string,
  by: string,
  at = nowIso(),
): Tenant<PettyMovementRecord> {
  const co = f.companyId
  const approvedTotal = round2(approve.reduce((s, e) => s + e.amount, 0))
  const r = replenishment(f.floatLimit, bookBalance(f), approvedTotal)
  const m = newMovement(f, 'replenishment', date, by, { amount: round2(r.topUp - r.expensesTotal), expensesTotal: r.expensesTotal, topUp: r.topUp, fromAccountId, expenseIds: approve.map((e) => e.id) }, at)
  const lines: JournalLine[] = []
  for (const e of approve) {
    const cat = categoryIn(co, e.categoryId)!
    const desc = `${e.number} · ${e.payeeName}${e.description ? ` · ${e.description}` : ''}`.slice(0, 200)
    lines.push({ accountId: cat.accountId, debit: round2(e.amount - e.vatAmount), credit: 0, description: desc })
    if (e.vatAmount > 0) lines.push({ accountId: systemAccount(co, 'vat_input'), debit: e.vatAmount, credit: 0, description: `Input VAT · ${e.number}`, taxCode: standardTaxCode(co)?.id ?? null })
  }
  if (r.expensesTotal > 0) lines.push({ accountId: f.accountId, debit: 0, credit: r.expensesTotal, description: `Petty expenses · ${f.name}` })
  if (r.topUp > 0) {
    lines.push({ accountId: f.accountId, debit: r.topUp, credit: 0, description: `Replenishment ${f.name}` })
    lines.push({ accountId: fromAccountId, debit: 0, credit: r.topUp, description: `Replenishment ${f.name}` })
  }
  if (lines.length) {
    const entry = postJournal(co, { date, memo: `Petty cash replenishment ${m.number} · ${f.name}`, sourceType: 'expense', sourceId: m.id, lines, createdBy: by })
    m.journalEntryId = entry.id
  }
  for (const e of approve) {
    e.status = 'approved'
    e.replenishmentId = m.id
  }
  for (const { e, reason } of reject) {
    e.status = 'rejected'
    e.rejectReason = reason
  }
  finPettyMovements.push(m)
  checkLowFund(co, f.id)
  return m
}

export function countCore(f: Tenant<PettyFundRecord>, counted: number, reason: string, date: string, by: string, at = nowIso()): Tenant<PettyMovementRecord> {
  const co = f.companyId
  const expected = figuresOf(f).cashExpected
  const diff = countDifference(counted, expected)
  if (diff !== 0 && !reason) bad('The count doesn’t match: say why (it posts to over / short).', 'reason_required', { difference: diff })
  const m = newMovement(f, 'count', date, by, { amount: diff, counted: round2(counted), expected, difference: diff, reason }, at)
  if (diff !== 0) {
    const os = systemAccount(co, 'rounding')
    const a = Math.abs(diff)
    const desc = `Cash count ${f.name}: ${diff < 0 ? 'short' : 'over'} · ${reason}`.slice(0, 200)
    const entry = postJournal(co, {
      date,
      memo: `Petty cash count ${m.number} · ${f.name}`,
      sourceType: 'expense',
      sourceId: m.id,
      createdBy: by,
      lines: diff < 0 ? [{ accountId: os, debit: a, credit: 0, description: desc }, { accountId: f.accountId, debit: 0, credit: a, description: desc }] : [{ accountId: f.accountId, debit: a, credit: 0, description: desc }, { accountId: os, debit: 0, credit: a, description: desc }],
    })
    m.journalEntryId = entry.id
  }
  finPettyMovements.push(m)
  checkLowFund(co, f.id)
  return m
}

/* ---------------- endpoints ---------------- */

function fundFields(co: string, i: PettyFundInput, base: Tenant<PettyFundRecord> | null) {
  const name = i.name !== undefined ? str(i.name, 80) : (base?.name ?? '')
  if (!name) bad('Give the fund a name.', 'name_required')
  if (finPettyFunds.some((f) => f.companyId === co && f.id !== base?.id && f.name.toLowerCase() === name.toLowerCase())) conflict(`A fund “${name}” already exists.`, 'duplicate_name')
  const custodianEmployeeId = i.custodianEmployeeId !== undefined ? i.custodianEmployeeId : base?.custodianEmployeeId
  const emp = typeof custodianEmployeeId === 'string' ? employeeById(co, custodianEmployeeId) : undefined
  if (!emp) return bad('Pick the employee who holds the cash.', 'employee_not_found')
  if (emp.status === 'terminated') bad(`${emp.fullName} has left the company.`, 'employee_inactive')
  const floatIn = i.floatLimit !== undefined ? i.floatLimit : base?.floatLimit
  const floatLimit = amountOf(floatIn, 'The float')
  let accountId = base?.accountId ?? PETTY_CASH_ACCOUNT
  if (i.accountId !== undefined) {
    if (base && i.accountId !== base.accountId && finPettyMovements.some((m) => m.companyId === co && m.fundId === base.id)) conflict('The fund already has movements on its account: keep the account.', 'fund_account_locked')
    const acc = paymentAccountsOf(co).find((a) => a.id === i.accountId)
    if (!acc) return bad('A fund’s cash sits in an active cash account under 1100 Cash and bank.', 'invalid_account')
    accountId = acc.id
  }
  return { name, custodianEmployeeId: emp.id, accountId, floatLimit }
}

/** POST /finance/petty-cash/funds — optional `fund_from_account_id` tops the float up now. */
export async function createFund(user: User, input: PettyFundInput | null): Promise<PettyFundDetail> {
  const co = assertExpenseFull(user)
  const i = input ?? {}
  const fields = fundFields(co, i, null)
  const from = i.fundFromAccountId ? bankAccount(co, null, i.fundFromAccountId) : null
  if (from && from === fields.accountId) bad('The money comes from another account than the fund’s own.', 'invalid_payment_account')
  const date = from ? dateOf(i.date ?? todayOf(co), 'Date', { notFutureOf: co }) : todayOf(co)
  const f = newFund(co, fields, user.id)
  if (from) {
    try {
      topUpCore(f, f.floatLimit, from, date, user.id)
    } catch (err) {
      finPettyFunds.splice(finPettyFunds.indexOf(f), 1)
      throw err
    }
  }
  recordAudit(user, { action: 'create', entity: 'petty_cash_fund', entityId: f.id, summary: `Opened the petty cash fund ${f.name}`, changes: [] })
  return delay(detailView(user, f))
}

function manageFund(user: User, id: string): Tenant<PettyFundRecord> {
  const co = assertExpenseFull(user)
  return fundIn(co, id) ?? notFound()
}

/** PATCH /finance/petty-cash/funds/:id */
export async function updateFund(user: User, id: string, input: PettyFundInput | null): Promise<PettyFundDetail> {
  const f = manageFund(user, id)
  const i = input ?? {}
  Object.assign(f, fundFields(f.companyId, i, f))
  if (i.active !== undefined) {
    if (!i.active && figuresOf(f).pendingCount) conflict('Replenish or reject the pending expenses before closing the fund.', 'fund_has_pending')
    f.active = !!i.active
  }
  f.updatedAt = nowIso()
  checkLowFund(f.companyId, f.id)
  return delay(detailView(user, f))
}

/** POST /finance/petty-cash/funds/:id/top-up */
export async function topUpFund(user: User, id: string, input: PettyTopUpInput | null): Promise<PettyFundDetail> {
  const f = manageFund(user, id)
  if (!f.active) conflict('This fund is closed.', 'fund_closed')
  const i = input ?? {}
  const amount = amountOf(i.amount)
  const from = bankAccount(f.companyId, f, i.fromAccountId)
  const date = dateOf(i.date ?? todayOf(f.companyId), 'Date', { notFutureOf: f.companyId })
  topUpCore(f, amount, from, date, user.id)
  return delay(detailView(user, f))
}

/** POST /finance/petty-cash/funds/:id/expenses — the custodian (or accounting full) records a petty expense. */
export async function recordPettyExpense(user: User, id: string, input: PettyExpenseInput | null): Promise<PettyFundDetail> {
  const f = seeFund(user, id)
  if (!f.active) conflict('This fund is closed.', 'fund_closed')
  const receipt = receiptOf(input?.receipt)
  chargeReceipts(f.companyId, [receipt])
  recordPettyCore(f, { ...(input ?? {}), receipt }, user.id)
  return delay(detailView(user, f))
}

/** POST /finance/petty-cash/funds/:id/replenish — accounting full, not the custodian (maker–checker). */
export async function replenishFund(user: User, id: string, input: ReplenishInput | null): Promise<PettyFundDetail> {
  const f = manageFund(user, id)
  if (!f.active) conflict('This fund is closed.', 'fund_closed')
  if (isCustodian(user, f)) throw new CodedApiError('You hold this fund: another accountant replenishes it.', 403, 'own_fund')
  const co = f.companyId
  const i = input ?? {}
  const pending = pendingOf(f)
  const byId = (pid: unknown) => pending.find((e) => e.id === pid)
  const reject = (Array.isArray(i.reject) ? i.reject : []).map((r) => {
    const e = byId(r?.id)
    if (!e) return bad('That petty expense isn’t pending on this fund.', 'expense_not_found')
    const reason = str(r?.reason, 300)
    if (!reason) bad(`Say why ${e.number} is rejected.`, 'reason_required')
    return { e, reason }
  })
  const rejected = new Set(reject.map((r) => r.e.id))
  const approve = Array.isArray(i.approveIds)
    ? i.approveIds.map((pid) => {
        const e = byId(pid)
        if (!e) return bad('That petty expense isn’t pending on this fund.', 'expense_not_found')
        if (rejected.has(e.id)) bad(`${e.number} is both approved and rejected.`, 'validation_failed')
        return e
      })
    : pending.filter((e) => !rejected.has(e.id))
  const from = bankAccount(co, f, i.fromAccountId)
  const date = dateOf(i.date ?? todayOf(co), 'Date', { notFutureOf: co })
  const m = replenishCore(f, approve, reject, from, date, user.id)
  const cust = custodianUserId(f)
  if (cust && cust !== user.id) {
    notify(co, [cust], `Petty cash “${f.name}” replenished`, `${approve.length} expense(s) approved${reject.length ? `, ${reject.length} rejected` : ''}; ${baseCurrencyOf(co)} ${m.topUp.toFixed(2)} topped up.`, `${EXPENSES_LINK}?tab=petty&fund=${encodeURIComponent(f.id)}`)
  }
  recordAudit(user, { action: 'update', entity: 'petty_cash_fund', entityId: f.id, summary: `Replenished ${f.name} (${m.number})`, changes: [] })
  return delay(detailView(user, f))
}

/** POST /finance/petty-cash/funds/:id/count — accounting full; a difference posts to 6950 over / short with a reason. */
export async function countFund(user: User, id: string, input: CashCountInput | null): Promise<PettyFundDetail> {
  const f = manageFund(user, id)
  const i = input ?? {}
  const n = Number(i.counted)
  if (i.counted === undefined || i.counted === null || !Number.isFinite(n) || n < 0) bad('Type the cash counted (0 or more).', 'invalid_amount')
  const date = dateOf(i.date ?? todayOf(f.companyId), 'Date', { notFutureOf: f.companyId })
  countCore(f, round2(n), str(i.reason, 300), date, user.id)
  return delay(detailView(user, f))
}

/** The custodian's own fund(s) — for the My HR card / "My expense claims" tab. */
export function fundsOfUser(co: string, userId: string): Tenant<PettyFundRecord>[] {
  const emp = employeeForUser(co, userId)
  return emp ? finPettyFunds.filter((f) => f.companyId === co && f.custodianEmployeeId === emp.id && f.active) : []
}
