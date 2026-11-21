import type { PolicyMode, PolicyWarning } from './types'

/**
 * Pure rules of Accounts & finance › Expenses, shared by the mock API (services/financeExpenses*.ts) and the forms.
 *
 *   VAT recoverability  input VAT is recovered only when (1) the tax code is standard-rated, (2) the company is VAT
 *                       registered and (3) a valid tax invoice exists — the payee's TRN / VAT number is on it
 *                       (UAE TRN: 15 digits starting 100; KSA VAT number: 15 digits starting and ending with 3).
 *                       Otherwise the full amount is the expense. Amounts are VAT-inclusive (what was paid).
 *   Base currency       gross = round2(amount × rate); VAT = round2(vat × rate); net = gross − VAT, so the posting
 *                       always balances in base currency.
 *   Petty cash (imprest) book balance = Σ movements; cash expected = book − pending expenses; a replenishment
 *                       posts the approved expenses and tops the fund back to its float:
 *                       top-up = max(0, float − (book − approved)). A count's difference = counted − expected.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export const LOW_FUND_PCT = 20

/** A TRN / VAT number of the country's format (spaces and dashes ignored). */
export function isValidTaxNumber(country: string, value: string | null | undefined): boolean {
  const v = String(value ?? '').replace(/[\s-]/g, '')
  if (!/^\d{15}$/.test(v)) return false
  if (country === 'SA') return v.startsWith('3') && v.endsWith('3')
  return v.startsWith('100')
}

export interface VatSplit {
  vat: number
  net: number
  recoverable: boolean
  note: string
}

/** Splits a VAT-inclusive amount into recoverable VAT and the expense (document currency). */
export function vatSplit(i: { amount: number; rate: number; category: string; payeeVatNumber: string; country: string; vatRegistered: boolean }): VatSplit {
  const amount = round2(i.amount)
  if (i.category !== 'standard' || !(i.rate > 0)) return { vat: 0, net: amount, recoverable: false, note: 'No VAT on this tax code.' }
  if (!i.vatRegistered) return { vat: 0, net: amount, recoverable: false, note: 'The company isn’t VAT registered: VAT is part of the cost.' }
  if (!isValidTaxNumber(i.country, i.payeeVatNumber)) {
    return { vat: 0, net: amount, recoverable: false, note: `No valid ${i.country === 'SA' ? 'VAT number' : 'TRN'} on the tax invoice: the full amount is the expense.` }
  }
  const vat = round2((amount * i.rate) / (100 + i.rate))
  return { vat, net: round2(amount - vat), recoverable: true, note: `VAT ${i.rate}% recovered (valid tax invoice).` }
}

export const toBase = (amount: number, rate: number): number => round2(amount * rate)

/** Base-currency split used for posting: gross and VAT converted, net is the remainder (balances exactly). */
export function baseSplit(amount: number, vat: number, rate: number): { gross: number; vat: number; net: number } {
  const gross = toBase(amount, rate)
  const v = toBase(vat, rate)
  return { gross, vat: v, net: round2(gross - v) }
}

/* ---------------- petty cash ---------------- */

export interface FundFigures {
  bookBalance: number
  pendingTotal: number
  cashExpected: number
  replenishAmount: number
  lowBalance: boolean
}
export function fundFigures(floatLimit: number, bookBalance: number, pendingTotal: number): FundFigures {
  const book = round2(bookBalance)
  const pending = round2(pendingTotal)
  const expected = round2(book - pending)
  return {
    bookBalance: book,
    pendingTotal: pending,
    cashExpected: expected,
    replenishAmount: round2(Math.max(0, floatLimit - expected)),
    lowBalance: floatLimit > 0 && expected < (floatLimit * LOW_FUND_PCT) / 100,
  }
}

/** A replenishment of `approvedTotal`: the expenses leave the book, then the bank tops the fund back to its float. */
export function replenishment(floatLimit: number, bookBalance: number, approvedTotal: number): { expensesTotal: number; topUp: number; bookAfter: number } {
  const expensesTotal = round2(approvedTotal)
  const afterExpenses = round2(bookBalance - expensesTotal)
  const topUp = round2(Math.max(0, floatLimit - afterExpenses))
  return { expensesTotal, topUp, bookAfter: round2(afterExpenses + topUp) }
}

/** Cash count: positive = cash over, negative = cash short. */
export const countDifference = (counted: number, expected: number): number => round2(counted - expected)

/* ---------------- policy checks ---------------- */

export interface PolicyRules {
  receiptRequiredAbove: number
  receiptMode: PolicyMode
  claimMaxAgeDays: number
  ageMode: PolicyMode
  limitMode: PolicyMode
}
export interface PolicyLine {
  id: string
  date: string
  categoryId: string
  baseAmount: number
  hasReceipt: boolean
}

const dayMs = 86_400_000
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs)

/**
 * Policy warnings of a claim (or petty expenses): receipt above the threshold, line older than the age limit, and
 * per-category monthly limits (the employee's other live claims of the month count via `priorSpend`, keyed
 * `<categoryId>:<yyyy-MM>`). `blocking` follows each rule's mode.
 */
export function policyWarnings(
  lines: PolicyLine[],
  today: string,
  rules: PolicyRules,
  categories: Map<string, { name: string; monthlyLimit: number | null }>,
  priorSpend: Map<string, number> = new Map(),
  currency = '',
): PolicyWarning[] {
  const out: PolicyWarning[] = []
  const money = (n: number) => `${currency ? `${currency} ` : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  for (const l of lines) {
    if (l.baseAmount > rules.receiptRequiredAbove && !l.hasReceipt) {
      out.push({ code: 'receipt_missing', lineId: l.id, blocking: rules.receiptMode === 'block', message: `A receipt is needed above ${money(rules.receiptRequiredAbove)}.` })
    }
    const age = daysBetween(l.date, today)
    if (age > rules.claimMaxAgeDays) {
      out.push({ code: 'too_old', lineId: l.id, blocking: rules.ageMode === 'block', message: `Spent ${age} days ago: claims are due within ${rules.claimMaxAgeDays} days.` })
    }
  }
  const sums = new Map<string, { total: number; lastLine: string }>()
  for (const l of lines) {
    const key = `${l.categoryId}:${l.date.slice(0, 7)}`
    const s = sums.get(key) ?? { total: 0, lastLine: l.id }
    sums.set(key, { total: round2(s.total + l.baseAmount), lastLine: l.id })
  }
  for (const [key, s] of sums) {
    const [catId, month] = key.split(':')
    const cat = categories.get(catId)
    if (!cat || cat.monthlyLimit === null) continue
    const used = round2((priorSpend.get(key) ?? 0) + s.total)
    if (used > cat.monthlyLimit) {
      out.push({
        code: 'over_monthly_limit',
        lineId: s.lastLine,
        blocking: rules.limitMode === 'block',
        message: `${cat.name}: ${money(used)} in ${month} is over the monthly limit of ${money(cat.monthlyLimit)}.`,
      })
    }
  }
  return out
}
