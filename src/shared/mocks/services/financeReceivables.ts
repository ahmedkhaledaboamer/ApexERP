import type { User } from '@/shared/types'
import type { Invoice } from '@/modules/finance/types'
import type {
  AgingAmounts,
  AgingBucket,
  AgingDetail,
  AgingInvoice,
  AgingReport,
  CreditCheck,
  CustomerCredit,
  CustomerCreditInput,
  DunningLogEntry,
  DunningPauseInput,
  Statement,
  StatementLine,
} from '@/modules/finance/collections/types'
import { AGING_BUCKETS } from '@/modules/finance/collections/types'
import { addressLinesOf, issuerFor } from '@/modules/quotations/lib/company'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso } from '@/shared/mocks/clock'
import { customers, leads } from '@/shared/mocks/db'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeCreditNotes } from '@/shared/mocks/data/financeInvoices'
import { finCollectionsMeta, finCreditNoteUses, finDunningLog, finInvoicePauses, finPayments, finPdcs, nextCollectionsSeq } from '@/shared/mocks/data/financeCollections'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf } from '@/shared/mocks/tenant'
import { companyModules, onLifecycleTick } from './billing'
import { round2 } from './ledger'
import {
  addDays,
  assertFinFull,
  bad,
  baseCurrencyOf,
  billingContact,
  companyInvoices,
  creditOf,
  creditRecord,
  customerName,
  customerOf,
  daysBetween,
  finAccessOf,
  invoiceOf,
  invoicePaused,
  isIsoDate,
  isOpenInvoice,
  logOnCustomer,
  logOnInvoice,
  notFound,
  notify,
  ownerNameOf,
  pdcHeldOn,
  rateFor,
  settingsOf,
  str,
  todayOf,
} from './financeCollectionsCore'
import { creditNoteRemaining, ensureCollectionsSeed, paymentTotals } from './financeCollections'

/**
 * Accounts & finance › Receivables (docs/API.md › Finance › Receivables): aging, customer statements, credit
 * limits + the quotation credit check, and dunning (automated payment reminders on the lifecycle tick).
 *
 * AS-OF BALANCES (aging): today = the live balance; an earlier date = the total of an invoice issued on or before it,
 * minus the allocations dated on or before it (an allocation a refund took back counts until the refund date), minus
 * the credit notes dated on or before it (invoices section, `applied_amount`). Void invoices and void payments are
 * left out (a void is an error correction). Buckets by days past due at the date: current (not yet due), 1–30, 31–60,
 * 61–90, 90+. Amounts in base currency at each invoice's rate.
 *
 * CREDIT EXPOSURE = open invoice balances (base) − unapplied customer credit (base), never below 0. Cheques held
 * (PDC) are NOT deducted: a cheque isn't money until it clears. The credit check adds the quotation's amount.
 */

/* ---------------- shared ---------------- */

const readCo = (user: User) => {
  finAccessOf(user)
  const co = tenantOf(user)
  ensureCollectionsSeed(co)
  return co
}
const asOfOf = (co: string, v: unknown) => {
  if (v === undefined || v === null || v === '') return todayOf(co)
  if (!isIsoDate(v)) return bad('as_of must be a date (yyyy-MM-dd).', 'invalid_date')
  return v
}

export function bucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd30'
  if (daysOverdue <= 60) return 'd60'
  if (daysOverdue <= 90) return 'd90'
  return 'over90'
}
const zero = (): AgingAmounts => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 })

/** Allocations of non-void payments (and the dates they count from / to). */
function allocationsOf(co: string, invoiceId: string): { amount: number; date: string; reversedOn: string | null }[] {
  return [
    ...finPayments.filter((p) => p.companyId === co && p.status === 'posted').flatMap((p) => p.allocations.filter((a) => a.invoiceId === invoiceId)),
    // Credit-note excess applied to this invoice.
    ...finCreditNoteUses.filter((u) => u.companyId === co && u.kind === 'apply' && u.invoiceId === invoiceId).map((u) => ({ amount: u.amount, date: u.date, reversedOn: null })),
  ]
}

/** Open balance of an invoice at the end of `asOf` (invoice currency). */
export function balanceAsOf(co: string, inv: Invoice & { id: string }, asOf: string): number {
  if (inv.status === 'draft' || inv.status === 'void' || !inv.issueDate || inv.issueDate > asOf) return 0
  // Up to today the live balance is the truth (it also covers credit notes); before, rebuild it from dated allocations.
  if (asOf >= todayOf(co)) return Math.max(0, inv.balanceDue)
  const paid = allocationsOf(co, inv.id)
    .filter((a) => a.date <= asOf && (!a.reversedOn || a.reversedOn > asOf))
    .reduce((s, a) => s + a.amount, 0)
  return Math.max(0, round2(inv.total - creditedAsOf(co, inv.id, asOf) - paid))
}

function agingInvoices(co: string, asOf: string, customerId?: string): (AgingInvoice & { customerId: string })[] {
  return companyInvoices(co)
    .filter((i) => !customerId || i.customerId === customerId)
    .map((inv) => {
      const balance = balanceAsOf(co, inv, asOf)
      const due = inv.dueDate ?? inv.issueDate ?? asOf
      const days = daysBetween(due, asOf)
      const held = asOf >= todayOf(co) ? pdcHeldOn(co, inv.id) : 0
      const last = finDunningLog.filter((d) => d.companyId === co && d.invoiceId === inv.id && d.outcome === 'sent').sort((a, b) => b.date.localeCompare(a.date))[0]
      return {
        customerId: inv.customerId,
        invoiceId: inv.id,
        number: inv.number,
        issueDate: inv.issueDate ?? '',
        dueDate: due,
        currency: inv.currency,
        balance,
        balanceBase: round2(balance * inv.exchangeRate),
        daysOverdue: Math.max(0, days),
        bucket: bucketOf(days),
        pdcSecured: round2(Math.min(held, balance) * inv.exchangeRate),
        dunningPaused: invoicePaused(co, inv.id) || creditOf(co, inv.customerId).dunningPaused,
        lastReminder: last?.date ?? null,
      }
    })
    .filter((r) => r.balance > 0)
}

/** Unapplied customer credit (base) at the end of `asOf`. */
function creditBase(co: string, customerId: string, asOf?: string): number {
  return round2(creditNoteExcessBase(co, customerId, asOf) +
    finPayments
      .filter((p) => p.companyId === co && p.customerId === customerId && p.status === 'posted' && (!asOf || p.date <= asOf))
      .reduce((s, p) => {
        if (!asOf || asOf >= todayOf(co)) return s + paymentTotals(p).unallocated * p.exchangeRate
        const used = p.allocations.filter((a) => a.date <= asOf && (!a.reversedOn || a.reversedOn > asOf)).reduce((x, a) => x + a.amount, 0)
        const refunded = p.refunds.filter((r) => r.date <= asOf).reduce((x, r) => x + r.amount, 0)
        return s + Math.max(0, p.amount - used - refunded) * p.exchangeRate
      }, 0),
  )
}

/* ---------------- aging ---------------- */

export function agingReport(co: string, asOf: string): AgingReport {
  const byCustomer = new Map<string, AgingInvoice[]>()
  for (const r of agingInvoices(co, asOf)) byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), r])
  // Customers with only credit appear too (negative position).
  for (const p of finPayments) if (p.companyId === co && p.status === 'posted' && !byCustomer.has(p.customerId) && creditBase(co, p.customerId, asOf) > 0) byCustomer.set(p.customerId, [])
  const rows = [...byCustomer.entries()].map(([customerId, invs]) => {
    const a = zero()
    for (const i of invs) {
      a[i.bucket] = round2(a[i.bucket] + i.balanceBase)
      a.total = round2(a.total + i.balanceBase)
    }
    return {
      ...a,
      customerId,
      customerName: customerName(co, customerId),
      ownerName: ownerNameOf(co, customerId),
      invoiceCount: invs.length,
      pdcSecured: round2(invs.reduce((s, i) => s + i.pdcSecured, 0)),
      credit: creditBase(co, customerId, asOf),
      creditHold: creditOf(co, customerId).creditHold,
    }
  })
  rows.sort((x, y) => y.total - x.total || x.customerName.localeCompare(y.customerName))
  const totals = { ...zero(), pdcSecured: 0, credit: 0 }
  for (const r of rows) {
    for (const b of AGING_BUCKETS) totals[b] = round2(totals[b] + r[b])
    totals.total = round2(totals.total + r.total)
    totals.pdcSecured = round2(totals.pdcSecured + r.pdcSecured)
    totals.credit = round2(totals.credit + r.credit)
  }
  return { asOf, baseCurrency: baseCurrencyOf(co), rows, totals }
}

export async function getAging(user: User, q: { asOf?: string | null } = {}): Promise<AgingReport> {
  const co = readCo(user)
  return delay(agingReport(co, asOfOf(co, q.asOf)))
}

export async function getAgingDetail(user: User, customerId: string, q: { asOf?: string | null } = {}): Promise<AgingDetail> {
  const co = readCo(user)
  const c = customerOf(co, customerId) ?? notFound()
  const asOf = asOfOf(co, q.asOf)
  const invoices = agingInvoices(co, asOf, c.id)
    .map(({ customerId: _c, ...r }) => r)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const totals = zero()
  for (const i of invoices) {
    totals[i.bucket] = round2(totals[i.bucket] + i.balanceBase)
    totals.total = round2(totals.total + i.balanceBase)
  }
  return delay({ asOf, baseCurrency: baseCurrencyOf(co), customerId: c.id, customerName: c.name, invoices, totals })
}

/* ---------------- statement ---------------- */

/** Credit notes of a customer (invoices section): each lowers what the customer owes by its total, on its date. */
function creditLines(co: string, customerId: string): { date: string; reference: string; invoiceNumber: string; amount: number }[] {
  return financeCreditNotes
    .filter((n) => n.companyId === co && n.customerId === customerId)
    .map((n) => ({ date: n.date, reference: n.number, invoiceNumber: invoiceOf(co, n.invoiceId)?.number ?? '', amount: round2(n.total * n.exchangeRate) }))
}
/** Credit-note amounts applied to an invoice on or before a date. */
function creditedAsOf(co: string, invoiceId: string, asOf: string): number {
  return round2(financeCreditNotes.filter((n) => n.companyId === co && n.invoiceId === invoiceId && n.date <= asOf).reduce((s, n) => s + n.appliedAmount, 0))
}
/** Credit-note excess (more credited than the invoice still owed) kept as customer credit, base currency. */
function creditNoteExcessBase(co: string, customerId: string, asOf?: string): number {
  return round2(financeCreditNotes.filter((n) => n.companyId === co && n.customerId === customerId && (!asOf || n.date <= asOf)).reduce((s, n) => s + creditNoteRemaining(co, n, asOf) * n.exchangeRate, 0))
}

export function statementOf(co: string, customerId: string, from: string, to: string): Statement {
  const c = customerOf(co, customerId) ?? notFound()
  type Raw = Omit<StatementLine, 'balance'> & { order: number }
  const raw: Raw[] = []
  for (const i of companyInvoices(co)) {
    if (i.customerId !== c.id || i.status === 'draft' || i.status === 'void' || !i.issueDate) continue
    raw.push({ date: i.issueDate, type: 'invoice', reference: i.number, description: `Invoice${i.currency !== baseCurrencyOf(co) ? ` (${i.currency} ${i.total.toFixed(2)})` : ''}${i.dueDate ? `, due ${i.dueDate}` : ''}`, debit: round2(i.total * i.exchangeRate), credit: 0, order: 0 })
  }
  for (const x of creditLines(co, c.id)) raw.push({ date: x.date, type: 'credit_note', reference: x.reference, description: `Credit note${x.invoiceNumber ? ` on ${x.invoiceNumber}` : ''}`, debit: 0, credit: x.amount, order: 1 })
  for (const p of finPayments) {
    if (p.companyId !== co || p.customerId !== c.id || p.status !== 'posted') continue
    const invs = [...new Set(p.allocations.filter((a) => a.kind === 'payment').map((a) => a.invoiceNumber))]
    raw.push({ date: p.date, type: 'payment', reference: p.number, description: `Payment${invs.length ? ` for ${invs.join(', ')}` : ' (credit)'}${p.currency !== baseCurrencyOf(co) ? ` (${p.currency} ${p.amount.toFixed(2)})` : ''}`, debit: 0, credit: round2(p.amount * p.exchangeRate), order: 2 })
    for (const r of p.refunds) raw.push({ date: r.date, type: 'refund', reference: p.number, description: 'Refund', debit: round2(r.amount * p.exchangeRate), credit: 0, order: 3 })
  }
  for (const u of finCreditNoteUses) {
    if (u.companyId !== co || u.kind !== 'refund') continue
    const n = financeCreditNotes.find((x) => x.companyId === co && x.id === u.creditNoteId)
    if (n && n.customerId === c.id) raw.push({ date: u.date, type: 'refund', reference: n.number, description: 'Refund of credit', debit: round2(u.amount * n.exchangeRate), credit: 0, order: 3 })
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference))
  let opening = 0
  for (const r of raw) if (r.date < from) opening = round2(opening + r.debit - r.credit)
  let bal = opening
  const lines: StatementLine[] = raw
    .filter((r) => r.date >= from && r.date <= to)
    .map(({ order: _o, ...r }) => {
      bal = round2(bal + r.debit - r.credit)
      return { ...r, balance: bal }
    })
  const company = companyById(co) ?? null
  const issuer = issuerFor(company)
  const pdcHeld = round2(
    finPdcs
      .filter((p) => p.companyId === co && p.customerId === c.id && p.receivedDate <= to && (p.status === 'received' || p.status === 'deposited'))
      .reduce((s, p) => s + p.amount * p.exchangeRate, 0),
  )
  return {
    customerId: c.id,
    customerName: c.name,
    customerAddress: c.address,
    company: { name: issuer.name, logoUrl: company?.branding.logoUrl ?? null, monogram: company?.branding.monogram ?? '', addressLines: company ? addressLinesOf(company.profile) : [] },
    baseCurrency: baseCurrencyOf(co),
    from,
    to,
    openingBalance: opening,
    lines,
    closingBalance: bal,
    pdcHeld,
  }
}

function range(co: string, q: { from?: unknown; to?: unknown }): { from: string; to: string } {
  const to = q.to === undefined || q.to === null || q.to === '' ? todayOf(co) : q.to
  const from = q.from === undefined || q.from === null || q.from === '' ? `${String(to).slice(0, 4)}-01-01` : q.from
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return bad('Pick a valid date range.', 'invalid_range')
  return { from, to }
}

export async function getStatement(user: User, customerId: string, q: { from?: string | null; to?: string | null } = {}): Promise<Statement> {
  const co = readCo(user)
  const r = range(co, q)
  return delay(statementOf(co, customerId, r.from, r.to))
}

/** Mock email of the statement to the customer's billing contact (logged on the customer timeline). */
export async function emailStatement(user: User, customerId: string, input: { from?: unknown; to?: unknown; email?: unknown } | null): Promise<{ sentTo: string; closingBalance: number }> {
  assertFinFull(user)
  const co = tenantOf(user)
  ensureCollectionsSeed(co)
  const c = customerOf(co, customerId) ?? notFound()
  const r = range(co, input ?? {})
  const s = statementOf(co, c.id, r.from, r.to)
  const typed = str(input?.email, 190)
  if (typed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return bad('Enter a valid email address.', 'invalid_email')
  const to = typed || billingContact(co, c.id)?.email
  if (!to) return bad('This customer has no contact email. Type one.', 'no_contact_email')
  logOnCustomer(co, c.id, 'email', `Statement of account ${r.from} – ${r.to} emailed to ${to} (closing ${s.baseCurrency} ${s.closingBalance.toFixed(2)})`, user.id)
  recordAudit(user, { action: 'update', entity: 'statement', entityId: c.id, summary: `Emailed the statement of ${c.name} (${r.from} – ${r.to}) to ${to}` })
  return delay({ sentTo: to, closingBalance: s.closingBalance })
}

/* ---------------- credit ---------------- */

export function creditView(co: string, customerId: string): CustomerCredit {
  const c = customerOf(co, customerId) ?? notFound()
  const rec = creditOf(co, c.id)
  const today = todayOf(co)
  let openAr = 0
  let overdue = 0
  let pdcHeld = 0
  for (const i of companyInvoices(co)) {
    if (i.customerId !== c.id || !isOpenInvoice(i)) continue
    const b = i.balanceDue * i.exchangeRate
    openAr += b
    if (i.dueDate && i.dueDate < today) overdue += b
  }
  for (const p of finPdcs) if (p.companyId === co && p.customerId === c.id && (p.status === 'received' || p.status === 'deposited')) pdcHeld += p.amount * p.exchangeRate
  const unapplied = creditBase(co, c.id)
  const exposure = Math.max(0, round2(openAr - unapplied))
  return {
    customerId: c.id,
    customerName: c.name,
    ownerName: ownerNameOf(co, c.id),
    baseCurrency: baseCurrencyOf(co),
    creditLimit: rec.creditLimit,
    creditHold: rec.creditHold,
    openAr: round2(openAr),
    overdue: round2(overdue),
    pdcHeld: round2(pdcHeld),
    unappliedCredit: unapplied,
    exposure,
    available: rec.creditLimit === null ? null : round2(rec.creditLimit - exposure),
    overLimit: rec.creditLimit !== null && exposure > rec.creditLimit,
    bouncedCheques: rec.bouncedCheques,
    lastBounceDate: rec.lastBounceDate,
    dunningPaused: rec.dunningPaused,
  }
}

/** Every customer of the company with its credit position (credit limits tab, payment drawer picker). */
export async function listCustomerCredit(user: User): Promise<CustomerCredit[]> {
  const co = readCo(user)
  return delay(customers.filter((c) => c.companyId === co).map((c) => creditView(co, c.id)).sort((a, b) => a.customerName.localeCompare(b.customerName)))
}

export async function getCustomerCredit(user: User, customerId: string): Promise<CustomerCredit> {
  const co = readCo(user)
  return delay(creditView(co, customerId))
}

export async function updateCustomerCredit(user: User, customerId: string, input: CustomerCreditInput | null): Promise<CustomerCredit> {
  assertFinFull(user)
  const co = tenantOf(user)
  const c = customerOf(co, customerId) ?? notFound()
  const b = input ?? {}
  const changes: string[] = []
  let limit: number | null | undefined
  if (b.creditLimit !== undefined) {
    if (b.creditLimit === null || (b.creditLimit as unknown) === '') limit = null
    else {
      const n = Number(b.creditLimit)
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return bad('Credit limit must be 0 or more (empty = no limit).', 'invalid_limit')
      limit = round2(n)
    }
  }
  if (b.creditHold !== undefined && typeof b.creditHold !== 'boolean') return bad('credit_hold is true or false.')
  if (b.dunningPaused !== undefined && typeof b.dunningPaused !== 'boolean') return bad('dunning_paused is true or false.')
  const rec = creditRecord(co, c.id)
  if (limit !== undefined && limit !== rec.creditLimit) {
    changes.push(`limit ${rec.creditLimit ?? 'none'} → ${limit ?? 'none'}`)
    rec.creditLimit = limit
  }
  if (b.creditHold !== undefined && b.creditHold !== rec.creditHold) {
    changes.push(b.creditHold ? 'on credit hold' : 'credit hold lifted')
    rec.creditHold = b.creditHold
  }
  if (b.dunningPaused !== undefined && b.dunningPaused !== rec.dunningPaused) {
    changes.push(b.dunningPaused ? 'reminders paused' : 'reminders resumed')
    rec.dunningPaused = b.dunningPaused
  }
  rec.updatedAt = nowIso()
  if (changes.length) recordAudit(user, { action: 'update', entity: 'customer_credit', entityId: c.id, summary: `${c.name}: ${changes.join(', ')}` })
  return delay(creditView(co, c.id))
}

/** The credit verdict for a customer about to be quoted `amountBase` more (base currency). */
export function creditVerdict(co: string, customerId: string | null, amountBase: number): { level: CreditCheck['level']; message: string | null; mode: CreditCheck['mode'] } {
  const mode = settingsOf(co).creditCheckMode
  if (!customerId || !customerOf(co, customerId) || !companyModules(co).includes('accounting')) return { level: 'ok', message: null, mode }
  const v = creditView(co, customerId)
  const hit = mode === 'block' ? 'blocked' : 'warning'
  if (v.creditHold) return { level: hit, message: `${v.customerName} is on credit hold. Talk to finance before quoting.`, mode }
  if (v.creditLimit !== null && v.exposure + Math.max(0, amountBase) > v.creditLimit) {
    return { level: hit, message: `${v.customerName} would go over the credit limit (${v.baseCurrency} ${v.creditLimit.toFixed(2)}; owed now ${v.exposure.toFixed(2)}).`, mode }
  }
  if (v.bouncedCheques > 0) return { level: 'warning', message: `${v.customerName} had ${v.bouncedCheques} bounced cheque${v.bouncedCheques === 1 ? '' : 's'}${v.lastBounceDate ? ` (last ${v.lastBounceDate})` : ''}.`, mode }
  return { level: 'ok', message: null, mode }
}

/** Used by services/quotations.ts on create / send: 409 credit_blocked only when the company setting says block. */
export function assertCreditAllows(co: string, customerId: string | null | undefined, amount: number, currency: string): void {
  if (!customerId) return
  const rate = currency === baseCurrencyOf(co) ? 1 : safeRate(co, currency)
  const v = creditVerdict(co, customerId, amount * rate)
  if (v.level === 'blocked') throw new CodedApiError(v.message ?? 'Credit check failed.', 409, 'credit_blocked')
}
function safeRate(co: string, currency: string): number {
  try {
    return rateFor(co, currency, todayOf(co))
  } catch {
    return 1
  }
}

/**
 * GET /finance/credit-check — for the quotation form: anyone who can see sales or accounting. The lead (or
 * customer) must be the caller's company's; amounts are only shown to accounting view / full.
 */
export async function creditCheck(user: User, q: { leadId?: string | null; customerId?: string | null; amount?: string | null; currency?: string | null }): Promise<CreditCheck> {
  const co = tenantOf(user)
  const sales = scopeOf(user.role, 'sales') !== 'hidden'
  const fin = scopeOf(user.role, 'accounting') !== 'hidden'
  if (!sales && !fin) throw new CodedApiError('Your role can’t run a credit check.', 403, 'forbidden')
  ensureCollectionsSeed(co)
  let customerId: string | null = null
  if (q.leadId) {
    const lead = leads.find((l) => l.companyId === co && l.id === q.leadId) ?? notFound()
    customerId = lead.customerId ?? null
  } else if (q.customerId) customerId = (customerOf(co, q.customerId) ?? notFound()).id
  const amount = Number(q.amount ?? 0)
  const currency = (q.currency ?? '').toUpperCase() || baseCurrencyOf(co)
  const base = Number.isFinite(amount) ? amount * (currency === baseCurrencyOf(co) ? 1 : safeRate(co, currency)) : 0
  const v = creditVerdict(co, customerId, base)
  const detail = fin && customerId ? creditView(co, customerId) : null
  return delay({
    customerId,
    level: v.level,
    mode: v.mode,
    message: v.message,
    detail: detail ? { creditLimit: detail.creditLimit, exposure: detail.exposure, available: detail.available, creditHold: detail.creditHold, baseCurrency: detail.baseCurrency } : null,
  })
}

/* ---------------- dunning ---------------- */

export function dunningView(co: string, d: (typeof finDunningLog)[number]): DunningLogEntry {
  return {
    id: d.id,
    invoiceId: d.invoiceId,
    invoiceNumber: invoiceOf(co, d.invoiceId)?.number ?? '',
    customerId: d.customerId,
    customerName: customerName(co, d.customerId),
    stepId: d.stepId,
    offsetDays: d.offsetDays,
    outcome: d.outcome,
    sentTo: d.sentTo,
    date: d.date,
    at: d.at,
  }
}

const stepLabel = (off: number) => (off < 0 ? `${-off} day${off === -1 ? '' : 's'} before the due date` : off === 0 ? 'on the due date' : `${off} day${off === 1 ? '' : 's'} overdue`)

/**
 * The dunning tick (company calendar, mock clock): for each open invoice with a balance not covered by cheques
 * held, not paused (invoice or customer), the LATEST active step whose day has come is emailed once (mock email
 * to the customer's billing contact, logged on the customer timeline and in the dunning log); earlier steps not
 * sent yet are logged as skipped, so a late start never sends a burst. Steps with notifyOwner also notify the
 * customer's owner (finance bell). Idempotent: one log row per invoice and step.
 */
export function runDunning(co: string): { sent: number; skipped: number } {
  const out = { sent: 0, skipped: 0 }
  // Starts once the company uses collections (its lazy seed has run), so other modules' requests never write reminders.
  if (!finCollectionsMeta.seeded.includes(co)) return out
  const s = settingsOf(co)
  if (!s.dunningEnabled) return out
  const steps = s.dunningSteps.filter((x) => x.active).sort((a, b) => a.offsetDays - b.offsetDays)
  if (!steps.length) return out
  const today = todayOf(co)
  for (const inv of companyInvoices(co)) {
    if (!isOpenInvoice(inv) || !inv.dueDate) continue
    if (invoicePaused(co, inv.id) || creditOf(co, inv.customerId).dunningPaused) continue
    if (inv.balanceDue - pdcHeldOn(co, inv.id) <= 0) continue
    const due = steps.filter((x) => addDays(inv.dueDate!, x.offsetDays) <= today)
    const latest = due[due.length - 1]
    if (!latest) continue
    const logged = (stepId: string) => finDunningLog.some((d) => d.companyId === co && d.invoiceId === inv.id && d.stepId === stepId)
    if (logged(latest.id)) continue
    const at = nowIso()
    for (const x of due.slice(0, -1)) {
      if (logged(x.id)) continue
      finDunningLog.push({ companyId: co, id: nextCollectionsSeq('dunning', 'DN'), invoiceId: inv.id, customerId: inv.customerId, stepId: x.id, offsetDays: x.offsetDays, outcome: 'skipped', sentTo: null, date: today, at })
      out.skipped++
    }
    const contact = billingContact(co, inv.customerId)
    finDunningLog.push({ companyId: co, id: nextCollectionsSeq('dunning', 'DN'), invoiceId: inv.id, customerId: inv.customerId, stepId: latest.id, offsetDays: latest.offsetDays, outcome: 'sent', sentTo: contact?.email ?? null, date: today, at })
    out.sent++
    logOnInvoice(inv, 'sent', `Payment reminder (${stepLabel(latest.offsetDays)}) emailed${contact ? ` to ${contact.email}` : ': no contact email'}`, null, at)
    logOnCustomer(co, inv.customerId, 'email', `Payment reminder for ${inv.number} (${stepLabel(latest.offsetDays)}): ${inv.currency} ${inv.balanceDue.toFixed(2)} due${contact ? `, emailed to ${contact.email}` : ', no contact email'}`, null, at)
    if (latest.notifyOwner) {
      const owner = customerOf(co, inv.customerId)?.ownerId
      if (owner) notify(co, [owner], `${inv.number} is ${daysBetween(inv.dueDate, today)} days overdue`, `${customerName(co, inv.customerId)} · ${inv.currency} ${inv.balanceDue.toFixed(2)} open. Please follow up.`, `/finance/receivables?customer=${encodeURIComponent(inv.customerId)}`, at)
    }
  }
  return out
}

export async function listDunningLog(user: User, f: { invoiceId?: string | null; customerId?: string | null } = {}): Promise<DunningLogEntry[]> {
  const co = readCo(user)
  return delay(
    finDunningLog
      .filter((d) => d.companyId === co && (!f.invoiceId || d.invoiceId === f.invoiceId) && (!f.customerId || d.customerId === f.customerId))
      .map((d) => dunningView(co, d))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)),
  )
}

export async function setDunningPause(user: User, input: DunningPauseInput | null): Promise<{ targetType: string; targetId: string; paused: boolean }> {
  assertFinFull(user)
  const co = tenantOf(user)
  const b = input ?? ({} as DunningPauseInput)
  if (typeof b.paused !== 'boolean') return bad('paused is true or false.')
  if (b.targetType === 'customer') {
    const c = customerOf(co, b.targetId) ?? notFound()
    const rec = creditRecord(co, c.id)
    rec.dunningPaused = b.paused
    rec.updatedAt = nowIso()
    recordAudit(user, { action: 'update', entity: 'customer_credit', entityId: c.id, summary: `${c.name}: reminders ${b.paused ? 'paused' : 'resumed'}` })
    return delay({ targetType: 'customer', targetId: c.id, paused: b.paused })
  }
  if (b.targetType !== 'invoice') return bad('target_type is invoice or customer.')
  const inv = invoiceOf(co, b.targetId) ?? notFound()
  const i = finInvoicePauses.findIndex((p) => p.companyId === co && p.invoiceId === inv.id)
  if (b.paused && i < 0) finInvoicePauses.push({ companyId: co, invoiceId: inv.id, pausedAt: nowIso(), pausedBy: user.id })
  if (!b.paused && i >= 0) finInvoicePauses.splice(i, 1)
  recordAudit(user, { action: 'update', entity: 'invoice', entityId: inv.id, summary: `${inv.number}: reminders ${b.paused ? 'paused' : 'resumed'}` })
  return delay({ targetType: 'invoice', targetId: inv.id, paused: b.paused })
}

/** Helper for the invoices section: everything collections knows about one invoice. */
export function collectionsOfInvoice(co: string, invoiceId: string) {
  return {
    payments: finPayments.filter((p) => p.companyId === co && p.allocations.some((a) => a.invoiceId === invoiceId)).map((p) => p.id),
    pdcHeld: pdcHeldOn(co, invoiceId),
    reminders: finDunningLog.filter((d) => d.companyId === co && d.invoiceId === invoiceId).map((d) => dunningView(co, d)),
    paused: invoicePaused(co, invoiceId),
  }
}

onLifecycleTick('finance.dunning', (co) => runDunning(co))
