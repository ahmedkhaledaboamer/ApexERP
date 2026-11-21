import type { User } from '@/shared/types'
import type { AgingBucket, CashForecast, ForecastItem, ForecastLine, ForecastLineInput, ForecastSettings, ForecastSettingsInput } from '@/modules/finance/planning/types'
import { AGING_BUCKETS, AGING_LABEL } from '@/modules/finance/planning/types'
import {
  addDays,
  addMonths,
  agingBucketOf,
  bucketize,
  dayInMonth,
  expected,
  expectedInvoiceDate,
  lowestOf,
  monthRanges,
  r2,
  weekRanges,
} from '@/modules/finance/planning/calc'
import { isIsoDate } from '@/modules/finance/ledger/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { financeTaxCodes } from '@/shared/mocks/data/finance'
import { financeRecurring, invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { finCustomerCredit, finPdcs } from '@/shared/mocks/data/financeCollections'
import { finBills } from '@/shared/mocks/data/financePurchases'
import { finExpenseCategories, finExpenses } from '@/shared/mocks/data/financeExpenses'
import { finForecastSettings, type ForecastSettingsRecord } from '@/shared/mocks/data/financeBudgets'
import { hrPayrollRuns, hrPaySettings } from '@/shared/mocks/data/hrPayroll'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { CodedApiError, NOT_FOUND, tenantOf } from '@/shared/mocks/tenant'
import { nextId } from './ledger'
import { balancesByAccount, financeAccessOf, FINANCE_MANAGE_ONLY } from './financeLedger'
import { baseCurrencyOf, rateFor } from './financeRates'
import { cashAccountsOf, vatOutflows } from './financeTax'

/**
 * Accounts & finance › Cash-flow forecast (docs/API.md › Finance › Cash-flow forecast): 13 weeks and 6 months from the
 * company's today (its timezone). WHO: `accounting` full and view read; full changes the assumptions and manual lines.
 *
 * Opening cash = ledger balances of the cash and bank accounts today. Inflows: open invoices (balance due in base
 * currency, minus amounts held as undeposited post-dated cheques) by expected date × the collection probability of
 * their aging bucket; PDCs held (received / deposited) at maturity, 100 % (the bounced-cheque probability when the
 * customer has bounced one); active recurring invoices (each occurrence + its payment terms, "not yet due"
 * probability). Outflows: open bills by due date; payroll (the last run's net + employee and employer social
 * insurance) on each pay day; recurring expenses (3 full months' average by category, spread weekly); VAT returns
 * (filed unpaid, and the estimate of unfiled periods) on their due date. Then manual lines and the scenario % on all
 * inflows / outflows. Anything already past due is expected from today.
 */

const bad = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never => {
  throw new CodedApiError(message, 422, code, details)
}

function viewer(user: User): string {
  financeAccessOf(user)
  return tenantOf(user)
}
function writer(user: User): string {
  if (financeAccessOf(user) !== 'full') throw new CodedApiError(FINANCE_MANAGE_ONLY, 403, 'forbidden')
  return tenantOf(user)
}

const todayOf = (co: string) => companyDayOf(co).today

function settingsView(s: ForecastSettingsRecord): ForecastSettings {
  return {
    probabilities: AGING_BUCKETS.map((bucket) => ({ bucket, pct: s.probabilities[bucket] })),
    bouncedPdcPct: s.bouncedPdcPct,
    inflowAdjustPct: s.inflowAdjustPct,
    outflowAdjustPct: s.outflowAdjustPct,
    minimumCash: s.minimumCash,
    lines: [...s.lines].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** The forecast's raw items (signed gross, probability) before scenario %; exported for tests. */
export function forecastItems(co: string, today: string, horizonEnd: string): ForecastItem[] {
  const s = finForecastSettings.get(co)
  const items: ForecastItem[] = []
  const add = (i: Omit<ForecastItem, 'amount'>) => {
    const date = i.date < today ? today : i.date
    if (date > horizonEnd || i.gross === 0) return
    items.push({ ...i, date, amount: 0 })
  }
  const customerName = (id: string) => customers.find((c) => c.companyId === co && c.id === id)?.name ?? 'Customer'
  const bounced = (customerId: string) => (finCustomerCredit.find((c) => c.companyId === co && c.customerId === customerId)?.bouncedCheques ?? 0) > 0

  // PDCs held: they pay their invoices at maturity, so those amounts are not expected again from the invoice.
  const held = finPdcs.filter((p) => p.companyId === co && (p.status === 'received' || p.status === 'deposited'))
  const heldByInvoice = new Map<string, number>()
  for (const p of held) for (const a of p.allocations) heldByInvoice.set(a.invoiceId, r2((heldByInvoice.get(a.invoiceId) ?? 0) + a.amount * (p.exchangeRate || 1)))
  for (const p of held) {
    const pct = bounced(p.customerId) ? s.bouncedPdcPct : 100
    add({ id: `pdc:${p.id}`, date: p.dueDate, category: 'pdc', label: `Cheque ${p.chequeNo} · ${customerName(p.customerId)}`, ref: p.chequeNo, link: `/finance/payments?tab=pdc&pdc=${encodeURIComponent(p.id)}`, gross: r2(p.amount * (p.exchangeRate || 1)), probability: pct })
  }

  for (const inv of invoiceRecords) {
    if (inv.companyId !== co || (inv.status !== 'issued' && inv.status !== 'partially_paid') || inv.balanceDue <= 0 || !inv.dueDate) continue
    const base = r2(inv.balanceDue * (inv.exchangeRate || 1) - (heldByInvoice.get(inv.id) ?? 0))
    if (base <= 0) continue
    const bucket: AgingBucket = agingBucketOf(inv.dueDate, today)
    add({ id: `inv:${inv.id}`, date: expectedInvoiceDate(inv.dueDate, today), category: 'receivables', label: `${inv.number} · ${customerName(inv.customerId)} (${AGING_LABEL[bucket].toLowerCase()})`, ref: inv.number, link: `/finance/invoices/${encodeURIComponent(inv.id)}`, gross: base, probability: s.probabilities[bucket] })
  }

  const rateOf = (code: string | null | undefined) => financeTaxCodes.find((t) => t.companyId === co && t.id === code)?.rate ?? 0
  for (const r of financeRecurring) {
    if (r.companyId !== co || r.status !== 'active' || !r.nextDate) continue
    const net = r.template.lines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0), 0)
    const vat = r.template.lines.reduce((t, l) => t + ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)) * (rateOf(l.taxCodeId) / 100), 0)
    const fx = r.template.currency === baseCurrencyOf(co) ? 1 : (rateFor(co, r.template.currency, today) ?? 1)
    const amount = r2((net + vat) * fx)
    const step = r.frequency === 'monthly' ? 1 : r.frequency === 'quarterly' ? 3 : 12
    for (let k = 0, d = r.nextDate; k < 24 && d <= horizonEnd; k++) {
      if (r.endDate && d > r.endDate) break
      add({ id: `rec:${r.id}:${d}`, date: addDays(d, r.template.paymentTermsDays || 0), category: 'recurring', label: `Recurring invoice · ${customerName(r.customerId)} (${d})`, ref: null, link: '/finance/invoices?tab=recurring', gross: amount, probability: s.probabilities.current })
      d = dayInMonth(addMonths(d.slice(0, 7), step), Number(r.startDate.slice(8, 10)))
    }
  }

  for (const b of finBills) {
    if (b.companyId !== co || (b.status !== 'open' && b.status !== 'partially_paid') || b.balanceDue <= 0) continue
    add({ id: `bill:${b.id}`, date: b.dueDate, category: 'bills', label: `${b.number} · supplier ${b.supplierInvoiceNumber}`, ref: b.number, link: `/finance/bills/${encodeURIComponent(b.id)}`, gross: -r2(b.balanceDue * (b.exchangeRate || 1)), probability: 100 })
  }

  // Payroll: the last calculated run repeats on each pay day.
  const runs = hrPayrollRuns.filter((r) => r.companyId === co && r.lines.length).sort((a, b) => b.month.localeCompare(a.month))
  const last = runs[0]
  if (last) {
    const net = r2(last.lines.reduce((t, l) => t + l.net, 0))
    const si = r2(last.lines.reduce((t, l) => t + l.employeeSocialInsurance + l.employerSocialInsurance, 0))
    const payDay = hrPaySettings.find((p) => p.companyId === co)?.payDay ?? 28
    const paid = new Set(hrPayrollRuns.filter((r) => r.companyId === co && r.status === 'paid').map((r) => r.month))
    for (let k = 0; k < 8; k++) {
      const ym = addMonths(today.slice(0, 7), k)
      const date = dayInMonth(ym, payDay)
      if (date < today || paid.has(ym) || date > horizonEnd) continue
      add({ id: `pay:${ym}`, date, category: 'payroll', label: `Payroll ${ym}: net salaries (as ${last.month})`, ref: last.id, link: '/hr/salary', gross: -net, probability: 100 })
      if (si) add({ id: `si:${ym}`, date, category: 'payroll', label: `Social insurance ${ym} (employee + employer, as ${last.month})`, ref: last.id, link: '/hr/salary', gross: -si, probability: 100 })
    }
  }

  // Recurring expenses: the last 3 full months' average per category, spread over the weeks.
  const firstMonth = addMonths(today.slice(0, 7), -3)
  const thisMonth = today.slice(0, 7)
  const byCat = new Map<string, number>()
  for (const e of finExpenses) {
    if (e.companyId !== co || e.status !== 'approved') continue
    const ym = e.date.slice(0, 7)
    if (ym < firstMonth || ym >= thisMonth) continue
    byCat.set(e.categoryId, r2((byCat.get(e.categoryId) ?? 0) + e.amount * (e.exchangeRate || 1)))
  }
  for (const [cat, total] of byCat) {
    const weekly = r2(((total / 3) * 12) / 52)
    const name = finExpenseCategories.find((c) => c.companyId === co && c.id === cat)?.name ?? 'Expenses'
    for (let w = 0, d = today; d <= horizonEnd; w++, d = addDays(today, w * 7)) add({ id: `exp:${cat}:${w}`, date: d, category: 'expenses', label: `${name} (3-month average)`, ref: null, link: '/finance/expenses', gross: -weekly, probability: 100 })
  }

  for (const v of vatOutflows(co)) add({ id: `vat:${v.returnId}`, date: v.dueDate, category: 'vat', label: `VAT ${v.label}${v.estimate ? ' (estimate)' : ''}`, ref: v.returnId, link: `/finance/tax?return=${encodeURIComponent(v.returnId)}`, gross: -v.amount, probability: 100 })

  for (const l of s.lines) {
    const step = l.recurrence
    for (let k = 0, d = l.date; k < 60 && d <= horizonEnd; k++) {
      if (d >= today) add({ id: `man:${l.id}:${k}`, date: d, category: 'manual', label: l.label, ref: l.id, link: null, gross: l.amount, probability: 100 })
      if (step === 'once') break
      d = step === 'weekly' ? addDays(l.date, (k + 1) * 7) : dayInMonth(addMonths(l.date.slice(0, 7), k + 1), Number(l.date.slice(8, 10)))
    }
  }

  // Probability, then the scenario % (manual lines are taken as entered).
  for (const i of items) i.amount = i.category === 'manual' ? i.gross : expected(i.gross, i.probability, i.gross > 0 ? s.inflowAdjustPct : s.outflowAdjustPct)
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

function build(user: User, co: string): CashForecast {
  const today = todayOf(co)
  const weeks = weekRanges(today)
  const months = monthRanges(today)
  const horizonEnd = months[months.length - 1].to > weeks[weeks.length - 1].to ? months[months.length - 1].to : weeks[weeks.length - 1].to
  const balances = balancesByAccount(co, today)
  const cash = cashAccountsOf(co).map((a) => ({ accountId: a.id, code: a.code, name: a.name, balance: balances.get(a.id) ?? 0 }))
  const opening = r2(cash.reduce((s, c) => s + c.balance, 0))
  const items = forecastItems(co, today, horizonEnd)
  const wk = bucketize(opening, items, weeks)
  const mo = bucketize(opening, items, months)
  const lo = lowestOf(wk)
  const s = finForecastSettings.get(co)
  return {
    currency: baseCurrencyOf(co),
    today,
    openingCash: opening,
    cashAccounts: cash,
    weeks: wk,
    months: mo,
    lowestWeek: { key: lo.key, label: `${lo.label} (${lo.from} – ${lo.to})`, closing: lo.closing, belowMinimum: lo.closing < s.minimumCash, negative: lo.closing < 0 },
    items,
    settings: settingsView(s),
    assumptions: [
      `Open invoices: balance due × collection probability by aging bucket (${AGING_BUCKETS.map((b) => `${AGING_LABEL[b].toLowerCase()} ${s.probabilities[b]} %`).join(', ')}); overdue ones expected 1–4 weeks from today by bucket.`,
      `Post-dated cheques at maturity: 100 % (${s.bouncedPdcPct} % when the customer has bounced a cheque); amounts held as cheques are not counted again on the invoice.`,
      'Payroll: the last run’s net salaries plus employee and employer social insurance, on the pay day of each month.',
      'Recurring expenses: the average of the last 3 full months of approved company expenses by category, spread weekly.',
      'VAT: filed unpaid returns and the estimate of unfiled periods on their due dates.',
      `Scenario: inflows ${s.inflowAdjustPct >= 0 ? '+' : ''}${s.inflowAdjustPct} %, outflows ${s.outflowAdjustPct >= 0 ? '+' : ''}${s.outflowAdjustPct} %; manual lines as entered.`,
    ],
    canEdit: scopeOf(user.role, 'accounting') === 'full',
  }
}

/** GET /finance/forecast */
export function getCashForecast(user: User): CashForecast {
  const co = viewer(user)
  return build(user, co)
}

const pctIn = (v: unknown, field: string, min: number, max: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return bad(`${field} must be between ${min} and ${max}.`, 'validation_failed', { field })
  return r2(n)
}

/** PUT /finance/forecast/settings */
export function putForecastSettings(user: User, input: ForecastSettingsInput | null): CashForecast {
  const co = writer(user)
  const s = finForecastSettings.get(co)
  const next = { ...s, probabilities: { ...s.probabilities } }
  if (input?.probabilities !== undefined) {
    if (!Array.isArray(input.probabilities)) bad('Send the probabilities as a list of { bucket, pct }.', 'validation_failed', { field: 'probabilities' })
    for (const p of input.probabilities) {
      if (!AGING_BUCKETS.includes(p?.bucket)) bad('Unknown aging bucket.', 'validation_failed', { field: 'probabilities' })
      next.probabilities[p.bucket] = pctIn(p.pct, 'probabilities', 0, 100)
    }
  }
  if (input?.bouncedPdcPct !== undefined) next.bouncedPdcPct = pctIn(input.bouncedPdcPct, 'bounced_pdc_pct', 0, 100)
  if (input?.inflowAdjustPct !== undefined) next.inflowAdjustPct = pctIn(input.inflowAdjustPct, 'inflow_adjust_pct', -100, 100)
  if (input?.outflowAdjustPct !== undefined) next.outflowAdjustPct = pctIn(input.outflowAdjustPct, 'outflow_adjust_pct', -100, 100)
  if (input?.minimumCash !== undefined) next.minimumCash = pctIn(input.minimumCash, 'minimum_cash', 0, 1e12)
  next.updatedAt = nowIso()
  next.updatedBy = user.id
  finForecastSettings.set(co, next)
  recordAudit(user, { action: 'update', entity: 'cash_forecast', entityId: 'settings', summary: 'Updated the cash-flow forecast assumptions' })
  return build(user, co)
}

/** POST /finance/forecast/lines — a manual scenario line (+ inflow, − outflow). */
export function addForecastLine(user: User, input: Partial<ForecastLineInput> | null): CashForecast {
  const co = writer(user)
  const label = typeof input?.label === 'string' ? input.label.trim() : ''
  if (!label || label.length > 120) bad('Enter a label (up to 120 characters).', 'validation_failed', { field: 'label' })
  if (!isIsoDate(input?.date)) bad('Enter the date as yyyy-MM-dd.', 'validation_failed', { field: 'date' })
  const today = todayOf(co)
  if (input!.date! < today || input!.date! > addDays(today, 400)) bad('The date must be between today and about a year from now.', 'validation_failed', { field: 'date' })
  const amount = pctIn(input?.amount, 'amount', -1e12, 1e12)
  if (amount === 0) bad('The amount can’t be 0 (positive = cash in, negative = cash out).', 'validation_failed', { field: 'amount' })
  const recurrence = input?.recurrence ?? 'once'
  if (!['once', 'weekly', 'monthly'].includes(recurrence)) bad('Repeat once, weekly or monthly.', 'validation_failed', { field: 'recurrence' })
  const s = finForecastSettings.get(co)
  if (s.lines.length >= 100) bad('Up to 100 manual lines.', 'too_many_lines')
  const line: ForecastLine = { id: nextId('forecastLine', 'FCL'), label, date: input!.date!, amount, recurrence: recurrence as ForecastLine['recurrence'] }
  s.lines.push(line)
  s.updatedAt = nowIso()
  s.updatedBy = user.id
  return build(user, co)
}

/** DELETE /finance/forecast/lines/:id */
export function deleteForecastLine(user: User, id: string): CashForecast {
  const co = writer(user)
  const s = finForecastSettings.get(co)
  const i = s.lines.findIndex((l) => l.id === id)
  if (i < 0) throw new ApiError(NOT_FOUND, 404)
  s.lines.splice(i, 1)
  s.updatedAt = nowIso()
  s.updatedBy = user.id
  return build(user, co)
}
