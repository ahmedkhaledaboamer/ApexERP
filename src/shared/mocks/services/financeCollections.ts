import type { User } from '@/shared/types'
import type { Invoice } from '@/modules/finance/types'
import type {
  AllocationInput,
  ApplyCreditInput,
  CreditNoteCredit,
  CollectionsSettings,
  CollectionsSettingsInput,
  CustomerOpenItems,
  DepositAccount,
  Payment,
  PaymentInput,
  PaymentLink,
  PaymentLinkInput,
  PaymentLinkStatus,
  PaymentMethod,
  Pdc,
  PdcActionInput,
  PdcInput,
  PublicPayInput,
  PublicPayment,
  PublicPayResult,
  ReceiptView,
  RefundInput,
} from '@/modules/finance/collections/types'
import { MANUAL_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/modules/finance/collections/types'
import { addressLinesOf, issuerFor } from '@/modules/quotations/lib/company'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeInvoices } from '@/shared/mocks/data/finance'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { registerJournalSource } from './financeLedger'
import { financeCreditNotes, type CreditNoteRecord } from '@/shared/mocks/data/financeInvoices'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import {
  finCollectionsMeta,
  finCreditNoteUses,
  finCollectionsSettings,
  finPayHits,
  finPaymentLinks,
  finPayments,
  finPdcs,
  nextCollectionsSeq,
  type AllocationRecord,
  type PaymentLinkRecord,
  type PaymentRecord,
  type PdcRecord,
} from '@/shared/mocks/data/financeCollections'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { companyModules, isReadOnly, onLifecycleTick } from './billing'
import { applyToInvoice } from './financeInvoiceBalance'
import { historyInvoicesOf, isHistoryInvoiceId } from '@/shared/mocks/data/financeHistorySeed'
import { docNumber, nextId, onFinanceAccess, reverseJournal, round2, systemAccount } from './ledger'
import { hitRateLimit } from './rateLimit'
import {
  accountName,
  accountantIds,
  addDays,
  assertFinFull,
  availableOn,
  bad,
  bankChargesAccount,
  baseCurrencyOf,
  conflict,
  cr,
  creditRecord,
  customerName,
  customerOf,
  depositAccount,
  depositAccounts,
  dr,
  finAccessOf,
  invoiceOf,
  isIsoDate,
  isOpenInvoice,
  logOnCustomer,
  logOnInvoice,
  money,
  notFound,
  notify,
  openInvoicesOf,
  pdcHeldOn,
  postWithFx,
  prefixOf,
  rateInput,
  settingsRecord,
  settingsView,
  str,
  todayOf,
  userName,
  type Ln,
} from './financeCollectionsCore'

/**
 * Accounts & finance › Collections: payments received, customer credit, refunds, voids, receipts, post-dated
 * cheques, payment links (simulated gateway) and the collections settings. docs/API.md › Finance › Payments / PDC /
 * Payment links. Aging, statements, credit limits and dunning: services/financeReceivables.ts.
 *
 * Every write posts through the ledger (postJournal / reverseJournal; a lock date answers 423 before anything
 * changes) and moves invoice balances only through `applyToInvoice`. The company comes from the session; a foreign
 * id answers 404 like a missing one; ids inside bodies must be the caller's own (customer, invoices, accounts).
 *
 * POSTINGS (journal lines in base currency; r = the payment's rate, ri = each invoice's own rate)
 *   payment       Dr deposit (amount − charges)·r · Dr bank charges charges·r · Cr AR Σ alloc·ri · Cr customer advances credit·r · ± FX
 *   apply credit  Dr customer advances x·r · Cr AR x·ri · ± FX
 *   refund        Dr customer advances (from credit)·r · Dr AR (taken back off invoices)·ri · Cr refund account amount·r · ± FX
 *   void          every entry of the payment reversed; allocations undone on the invoices
 *   PDC received  Dr PDC receivable amount·r · Cr AR Σ alloc·ri · Cr customer advances rest·r · ± FX   (invoice stays OPEN, "secured")
 *   PDC cleared   Dr bank amount·r · Cr PDC receivable amount·r → a receipt (source pdc) is recorded and THEN the invoices are paid
 *   PDC bounced   the received entry reversed (+ optional bank fee: Dr bank charges · Cr bank); the customer is flagged
 */

/* ---------------- views ---------------- */

const activeAlloc = (p: PaymentRecord) => p.allocations.filter((a) => !a.reversedOn)
export function paymentTotals(p: PaymentRecord): { allocated: number; refunded: number; unallocated: number } {
  const allocated = round2(activeAlloc(p).reduce((s, a) => s + a.amount, 0))
  const refunded = round2(p.refunds.reduce((s, r) => s + r.amount, 0))
  return { allocated, refunded, unallocated: p.status === 'void' ? 0 : round2(p.amount - allocated - refunded) }
}

export function paymentView(p: Tenant<PaymentRecord>): Payment {
  const co = p.companyId
  const t = paymentTotals(p)
  return {
    id: p.id,
    number: p.number,
    customerId: p.customerId,
    customerName: customerName(co, p.customerId),
    date: p.date,
    method: p.method,
    amount: p.amount,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    bankCharges: p.bankCharges,
    depositAccountId: p.depositAccountId,
    depositAccountName: accountName(co, p.depositAccountId),
    reference: p.reference,
    notes: p.notes,
    allocations: p.allocations.map((a) => ({ id: a.id, invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber, amount: a.amount, date: a.date, kind: a.kind, reversedOn: a.reversedOn })),
    allocated: t.allocated,
    refunded: t.refunded,
    unallocated: t.unallocated,
    amountBase: round2(p.amount * p.exchangeRate),
    status: p.status,
    source: p.source,
    pdcId: p.pdcId,
    paymentLinkId: p.paymentLinkId,
    cardHint: p.cardHint,
    refunds: p.refunds.map((r) => ({ id: r.id, date: r.date, amount: r.amount, accountId: r.accountId, reference: r.reference, journalEntryId: r.journalEntryId, createdByName: userName(co, r.createdBy) })),
    journalEntryIds: [...p.journalEntryIds],
    createdBy: p.createdBy,
    createdByName: userName(co, p.createdBy),
    createdAt: p.createdAt,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
  }
}

export function pdcView(p: Tenant<PdcRecord>): Pdc {
  const co = p.companyId
  const today = todayOf(co)
  const pay = p.paymentId ? finPayments.find((x) => x.companyId === co && x.id === p.paymentId) : undefined
  return {
    id: p.id,
    chequeNo: p.chequeNo,
    bankName: p.bankName,
    customerId: p.customerId,
    customerName: customerName(co, p.customerId),
    receivedDate: p.receivedDate,
    dueDate: p.dueDate,
    amount: p.amount,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    allocations: p.allocations.map((a) => ({ ...a })),
    status: p.status,
    depositAccountId: p.depositAccountId,
    depositedDate: p.depositedDate,
    clearedDate: p.clearedDate,
    bouncedDate: p.bouncedDate,
    bounceReason: p.bounceReason,
    bounceFee: p.bounceFee,
    paymentId: p.paymentId,
    paymentNumber: pay?.number ?? null,
    notes: p.notes,
    journalEntryIds: [...p.journalEntryIds],
    maturingSoon: p.status === 'received' && p.dueDate >= today && p.dueDate <= addDays(today, 7),
    depositDue: p.status === 'received' && p.dueDate <= today,
    createdByName: userName(co, p.createdBy),
    createdAt: p.createdAt,
  }
}

export function linkStatus(l: Tenant<PaymentLinkRecord>): PaymentLinkStatus {
  if (l.status !== 'active') return l.status
  return todayOf(l.companyId) > l.expiresAt ? 'expired' : 'active'
}
export function linkView(l: Tenant<PaymentLinkRecord>): PaymentLink {
  const co = l.companyId
  const inv = invoiceOf(co, l.invoiceId)
  return {
    id: l.id,
    invoiceId: l.invoiceId,
    invoiceNumber: inv?.number ?? '',
    customerId: inv?.customerId ?? '',
    customerName: inv ? customerName(co, inv.customerId) : '',
    amount: l.amount,
    currency: l.currency,
    url: `/pay/${l.token}`,
    expiresAt: l.expiresAt,
    status: linkStatus(l),
    paidAt: l.paidAt,
    paymentId: l.paymentId,
    createdByName: userName(co, l.createdBy),
    createdAt: l.createdAt,
  }
}

/* ---------------- lookups (caller's company) ---------------- */

const findPayment = (co: string, id: string) => finPayments.find((p) => p.companyId === co && p.id === id) ?? notFound()
const findPdc = (co: string, id: string) => finPdcs.find((p) => p.companyId === co && p.id === id) ?? notFound()
const findLink = (co: string, id: string) => finPaymentLinks.find((p) => p.companyId === co && p.id === id) ?? notFound()

function readCtx(user: User): string {
  finAccessOf(user)
  const co = tenantOf(user)
  ensureCollectionsSeed(co)
  return co
}
function writeCtx(user: User): string {
  assertFinFull(user)
  const co = tenantOf(user)
  ensureCollectionsSeed(co)
  return co
}

/* ---------------- allocation ---------------- */

export interface PlannedAllocation {
  invoice: Tenant<Invoice>
  amount: number
}

/**
 * The allocations of `amount` to a customer's open invoices in `currency`: 'auto' = oldest due first until the
 * money runs out; 'manual' = the given lines (each ≤ what the invoice can still take, sum ≤ amount); 'none' = [].
 */
export function planAllocations(co: string, customerId: string, currency: string, amount: number, mode: 'auto' | 'manual' | 'none', lines: AllocationInput[] | undefined): PlannedAllocation[] {
  if (mode === 'none') return []
  if (mode === 'auto') {
    let left = amount
    const out: PlannedAllocation[] = []
    for (const inv of openInvoicesOf(co, customerId, currency)) {
      if (left <= 0) break
      const take = round2(Math.min(left, availableOn(co, inv)))
      if (take <= 0) continue
      out.push({ invoice: inv, amount: take })
      left = round2(left - take)
    }
    return out
  }
  if (!Array.isArray(lines) || !lines.length) return bad('Allocate the payment to at least one invoice, or leave it as customer credit.', 'allocations_required')
  const seen = new Set<string>()
  const out: PlannedAllocation[] = []
  for (const l of lines) {
    const inv = invoiceOf(co, l?.invoiceId)
    if (!inv || inv.customerId !== customerId) return bad('Allocate only to this customer’s invoices.', 'invalid_invoice')
    if (seen.has(inv.id)) return bad(`${inv.number} is allocated twice.`, 'duplicate_invoice')
    seen.add(inv.id)
    if (inv.currency !== currency) return bad(`${inv.number} is in ${inv.currency}; a ${currency} payment can only settle ${currency} invoices.`, 'currency_mismatch')
    const amt = money(l.amount, `Amount for ${inv.number}`)
    const avail = availableOn(co, inv)
    if (amt > avail) return bad(`${inv.number} can take at most ${avail.toFixed(2)} ${inv.currency}.`, 'over_allocated', { invoiceId: inv.id, available: avail })
    out.push({ invoice: inv, amount: amt })
  }
  const sum = round2(out.reduce((s, a) => s + a.amount, 0))
  if (sum > amount) return bad('The allocations add up to more than the payment.', 'over_allocated', { allocated: sum, amount })
  return out
}

const allocRecord = (inv: Invoice & { id: string }, amount: number, date: string, kind: 'payment' | 'credit', journalEntryId: string | null): AllocationRecord => ({
  id: nextCollectionsSeq('alloc', 'AL'),
  invoiceId: inv.id,
  invoiceNumber: inv.number,
  amount,
  date,
  kind,
  journalEntryId,
  reversedOn: null,
})

const DEFAULT_DEPOSIT: Record<PaymentMethod, Parameters<typeof systemAccount>[1]> = {
  bank_transfer: 'bank_default',
  card: 'bank_default',
  cash: 'cash',
  cheque: 'undeposited_funds',
  payment_link: 'payment_gateway_clearing',
}

/* ---------------- payments ---------------- */

interface RecordOpts {
  source: 'manual' | 'payment_link'
  paymentLinkId?: string | null
  cardHint?: string | null
}

/**
 * Records a payment (validation → one journal entry → invoices paid → stored). Shared by POST /finance/payments,
 * the public pay page and the seed. Nothing changes when the posting fails (lock date 423).
 */
export function recordPaymentFor(co: string, actorId: string | null, input: PaymentInput | null, opts: RecordOpts = { source: 'manual' }): Tenant<PaymentRecord> {
  const b = input ?? ({} as PaymentInput)
  const customer = customerOf(co, b.customerId)
  if (!customer) return bad('Pick the customer who paid.', 'invalid_customer')
  if (!isIsoDate(b.date)) return bad('Enter the payment date.', 'invalid_date')
  if (b.date > todayOf(co)) return bad('A payment can’t be dated in the future. Record a post-dated cheque instead.', 'future_date')
  const methods = opts.source === 'payment_link' ? PAYMENT_METHODS : MANUAL_METHODS
  if (!methods.includes(b.method)) return bad('Pick how the customer paid.', 'invalid_method')
  const amount = money(b.amount, 'Amount')
  const currency = str(b.currency, 3).toUpperCase() || baseCurrencyOf(co)
  if (!/^[A-Z]{3}$/.test(currency)) return bad('Currency must be a 3-letter code.', 'invalid_currency')
  const rate = rateInput(co, b.exchangeRate, currency, b.date)
  const charges = b.bankCharges === undefined || b.bankCharges === null || (b.bankCharges as unknown) === '' ? 0 : money(b.bankCharges, 'Bank charges', { allowZero: true })
  if (charges >= amount) return bad('Bank charges must be less than the amount.', 'invalid_charges')
  const deposit = depositAccount(co, b.depositAccountId, systemAccount(co, DEFAULT_DEPOSIT[b.method]))
  const mode = b.allocationMode ?? (b.allocations?.length ? 'manual' : 'auto')
  if (!['auto', 'manual', 'none'].includes(mode)) return bad('Allocation mode is auto, manual or none.', 'invalid_mode')
  const plan = planAllocations(co, customer.id, currency, amount, mode, b.allocations)
  const allocated = round2(plan.reduce((s, a) => s + a.amount, 0))
  const credit = round2(amount - allocated)
  const id = nextId('payment', 'PAY')
  const ar = systemAccount(co, 'accounts_receivable')
  const lines: Ln[] = [
    dr(deposit, (amount - charges) * rate, `Received from ${customer.name}`, customer.id),
    ...(charges > 0 ? [dr(bankChargesAccount(co), charges * rate, 'Bank charges deducted', customer.id)] : []),
    ...plan.map((a) => cr(ar, a.amount * a.invoice.exchangeRate, `Payment for ${a.invoice.number}`, customer.id)),
    ...(credit > 0 ? [cr(systemAccount(co, 'customer_advances'), credit * rate, 'Customer credit (unallocated)', customer.id)] : []),
  ]
  const je = postWithFx(co, { date: b.date, memo: `Payment ${id} from ${customer.name}`, sourceType: 'payment', sourceId: id, createdBy: actorId, lines })
  const at = nowIso()
  const number = docNumber(co, prefixOf(co), 'RCT', b.date.slice(0, 4))
  for (const a of plan) {
    applyToInvoice(a.invoice, { paid: a.amount }, at)
    logOnInvoice(a.invoice, 'updated', `Payment ${number} applied: ${currency} ${a.amount.toFixed(2)}`, userName(co, actorId), at)
  }
  const rec: Tenant<PaymentRecord> = {
    companyId: co,
    id,
    number,
    customerId: customer.id,
    date: b.date,
    method: b.method,
    amount,
    currency,
    exchangeRate: rate,
    bankCharges: charges,
    depositAccountId: deposit,
    reference: str(b.reference, 120),
    notes: str(b.notes, 2000),
    allocations: plan.map((a) => allocRecord(a.invoice, a.amount, b.date, 'payment', null)),
    refunds: [],
    status: 'posted',
    source: opts.source,
    pdcId: null,
    paymentLinkId: opts.paymentLinkId ?? null,
    cardHint: opts.cardHint ?? null,
    journalEntryIds: [je.id],
    createdBy: actorId,
    createdAt: at,
    voidedAt: null,
    voidReason: null,
  }
  finPayments.push(rec)
  return rec
}

export async function listPayments(user: User, f: { customerId?: string | null; invoiceId?: string | null; method?: string | null; status?: string | null; from?: string | null; to?: string | null; q?: string | null } = {}): Promise<Payment[]> {
  const co = readCtx(user)
  const q = (f.q ?? '').trim().toLowerCase()
  const rows = finPayments
    .filter((p) => p.companyId === co)
    .filter((p) => !f.customerId || p.customerId === f.customerId)
    .filter((p) => !f.invoiceId || p.allocations.some((a) => a.invoiceId === f.invoiceId))
    .filter((p) => !f.method || p.method === f.method)
    .filter((p) => !f.status || p.status === f.status)
    .filter((p) => !f.from || p.date >= f.from)
    .filter((p) => !f.to || p.date <= f.to)
    .map(paymentView)
    .filter((p) => !q || [p.number, p.customerName, p.reference, ...p.allocations.map((a) => a.invoiceNumber)].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
  return delay(rows)
}

export async function getPayment(user: User, id: string): Promise<Payment> {
  const co = readCtx(user)
  return delay(paymentView(findPayment(co, id)))
}

export async function createPayment(user: User, input: PaymentInput | null): Promise<Payment> {
  const co = writeCtx(user)
  const p = recordPaymentFor(co, user.id, input)
  recordAudit(user, { action: 'create', entity: 'payment', entityId: p.id, summary: `Recorded payment ${p.number}: ${p.currency} ${p.amount.toFixed(2)} from ${customerName(co, p.customerId)}` })
  logOnCustomer(co, p.customerId, 'system', `Payment ${p.number} received: ${p.currency} ${p.amount.toFixed(2)} (${PAYMENT_METHOD_LABEL[p.method]})`, user.id)
  return delay(paymentView(p))
}

/** Applies a payment's unallocated credit to open invoices (same currency): one entry per application. */
export function applyCreditFor(co: string, actorId: string | null, p: Tenant<PaymentRecord>, input: ApplyCreditInput | null): Tenant<PaymentRecord> {
  if (p.status !== 'posted') return conflict('This payment is void.', 'payment_void')
  const credit = paymentTotals(p).unallocated
  if (credit <= 0) return conflict(`${p.number} has no credit left to apply.`, 'no_credit')
  const date = input?.date === undefined || input?.date === null ? todayOf(co) : input.date
  if (!isIsoDate(date) || date > todayOf(co)) return bad('Enter a date up to today.', 'invalid_date')
  const plan = planAllocations(co, p.customerId, p.currency, credit, input?.allocations?.length ? 'manual' : 'auto', input?.allocations)
  if (!plan.length) return conflict(`${customerName(co, p.customerId)} has no open ${p.currency} invoices to apply the credit to.`, 'nothing_to_apply')
  const ar = systemAccount(co, 'accounts_receivable')
  const adv = systemAccount(co, 'customer_advances')
  const sum = round2(plan.reduce((s, a) => s + a.amount, 0))
  const je = postWithFx(co, {
    date,
    memo: `Credit from ${p.number} applied`,
    sourceType: 'payment',
    sourceId: p.id,
    createdBy: actorId,
    lines: [dr(adv, sum * p.exchangeRate, `Credit from ${p.number}`, p.customerId), ...plan.map((a) => cr(ar, a.amount * a.invoice.exchangeRate, `Credit applied to ${a.invoice.number}`, p.customerId))],
  })
  const at = nowIso()
  for (const a of plan) {
    applyToInvoice(a.invoice, { paid: a.amount }, at)
    logOnInvoice(a.invoice, 'updated', `Credit from ${p.number} applied: ${p.currency} ${a.amount.toFixed(2)}`, userName(co, actorId), at)
    p.allocations.push(allocRecord(a.invoice, a.amount, date, 'credit', je.id))
  }
  p.journalEntryIds.push(je.id)
  return p
}

export async function applyCredit(user: User, id: string, input: ApplyCreditInput | null): Promise<Payment> {
  const co = writeCtx(user)
  const p = findPayment(co, id)
  const before = paymentTotals(p).allocated
  applyCreditFor(co, user.id, p, input)
  recordAudit(user, { action: 'update', entity: 'payment', entityId: p.id, summary: `Applied ${p.currency} ${(paymentTotals(p).allocated - before).toFixed(2)} of credit from ${p.number}` })
  return delay(paymentView(p))
}

/**
 * Refund: takes the money from the payment's credit first, then back off its invoices (newest allocation first;
 * those invoices re-open). Posted at the payment's rate; the receivable side at each invoice's rate (± FX).
 */
export async function refundPayment(user: User, id: string, input: RefundInput | null): Promise<Payment> {
  const co = writeCtx(user)
  const p = findPayment(co, id)
  if (p.status !== 'posted') return conflict('This payment is void.', 'payment_void')
  const b = input ?? ({} as RefundInput)
  const amount = money(b.amount, 'Refund amount')
  const date = b.date ?? todayOf(co)
  if (!isIsoDate(date) || date > todayOf(co) || date < p.date) return bad('Enter a refund date between the payment date and today.', 'invalid_date')
  const t = paymentTotals(p)
  const refundable = round2(t.unallocated + t.allocated)
  if (amount > refundable) return bad(`At most ${refundable.toFixed(2)} ${p.currency} can be refunded.`, 'over_refund', { refundable })
  const account = depositAccount(co, b.accountId, p.depositAccountId)
  const fromCredit = round2(Math.min(amount, t.unallocated))
  let rest = round2(amount - fromCredit)
  const take: { a: AllocationRecord; amount: number; inv: Tenant<Invoice> | undefined }[] = []
  for (const a of [...activeAlloc(p)].sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id))) {
    if (rest <= 0) break
    const x = round2(Math.min(rest, a.amount))
    take.push({ a, amount: x, inv: invoiceOf(co, a.invoiceId) })
    rest = round2(rest - x)
  }
  const ar = systemAccount(co, 'accounts_receivable')
  const refundId = nextCollectionsSeq('refund', 'RF')
  const je = postWithFx(co, {
    date,
    memo: `Refund of ${p.number}`,
    sourceType: 'payment_refund',
    sourceId: p.id,
    createdBy: user.id,
    lines: [
      ...(fromCredit > 0 ? [dr(systemAccount(co, 'customer_advances'), fromCredit * p.exchangeRate, 'Customer credit refunded', p.customerId)] : []),
      ...take.map((x) => dr(ar, x.amount * (x.inv?.exchangeRate ?? p.exchangeRate), `Refund re-opens ${x.a.invoiceNumber}`, p.customerId)),
      cr(account, amount * p.exchangeRate, `Refund to ${customerName(co, p.customerId)}`, p.customerId),
    ],
  })
  const at = nowIso()
  const deallocated: { allocationId: string; amount: number }[] = []
  for (const x of take) {
    if (x.inv) {
      applyToInvoice(x.inv, { paid: -x.amount }, at)
      logOnInvoice(x.inv, 'updated', `Refund on ${p.number}: ${p.currency} ${x.amount.toFixed(2)} back to the customer`, user.name, at)
    }
    if (x.amount < x.a.amount) {
      // Split: the kept part stays active, the refunded part is closed on the refund date.
      const part: AllocationRecord = { ...x.a, id: nextCollectionsSeq('alloc', 'AL'), amount: x.amount, reversedOn: date }
      x.a.amount = round2(x.a.amount - x.amount)
      p.allocations.push(part)
      deallocated.push({ allocationId: part.id, amount: x.amount })
    } else {
      x.a.reversedOn = date
      deallocated.push({ allocationId: x.a.id, amount: x.amount })
    }
  }
  p.refunds.push({ id: refundId, date, amount, accountId: account, reference: str(b.reference, 120), journalEntryId: je.id, deallocated, createdBy: user.id })
  p.journalEntryIds.push(je.id)
  recordAudit(user, { action: 'update', entity: 'payment', entityId: p.id, summary: `Refunded ${p.currency} ${amount.toFixed(2)} of ${p.number}` })
  logOnCustomer(co, p.customerId, 'system', `Refund of ${p.currency} ${amount.toFixed(2)} on ${p.number}`, user.id)
  return delay(paymentView(p))
}

/** Void: reverses every entry of the payment and undoes its allocations. A cleared cheque's receipt can't be voided. */
export function voidPaymentFor(co: string, actorId: string | null, p: Tenant<PaymentRecord>, reason: string): Tenant<PaymentRecord> {
  if (p.status === 'void') return conflict('This payment is already void.', 'payment_void')
  if (p.source === 'pdc') return conflict('This receipt comes from a cleared cheque. Record a refund instead.', 'pdc_receipt')
  const date = todayOf(co)
  for (const jeId of p.journalEntryIds) reverseJournal(co, jeId, date, `Void of ${p.number}${reason ? `: ${reason}` : ''}`, actorId)
  const at = nowIso()
  for (const a of activeAlloc(p)) {
    const inv = invoiceOf(co, a.invoiceId)
    if (inv) {
      applyToInvoice(inv, { paid: -a.amount }, at)
      logOnInvoice(inv, 'updated', `Payment ${p.number} voided: ${p.currency} ${a.amount.toFixed(2)} open again`, userName(co, actorId), at)
    }
  }
  p.status = 'void'
  p.voidedAt = at
  p.voidReason = reason || null
  return p
}

export async function voidPayment(user: User, id: string, input: { reason?: unknown } | null): Promise<Payment> {
  const co = writeCtx(user)
  const p = findPayment(co, id)
  const reason = str(input?.reason, 300)
  if (!reason) return bad('Say why the payment is voided.', 'reason_required')
  // Reversals post on today's date: check the lock before touching anything (reverseJournal throws per entry).
  voidPaymentFor(co, user.id, p, reason)
  recordAudit(user, { action: 'delete', entity: 'payment', entityId: p.id, summary: `Voided payment ${p.number} (${reason})` })
  logOnCustomer(co, p.customerId, 'system', `Payment ${p.number} voided: ${reason}`, user.id)
  return delay(paymentView(p))
}

export async function getReceipt(user: User, id: string): Promise<ReceiptView> {
  const co = readCtx(user)
  const p = findPayment(co, id)
  const company = companyById(co) ?? null
  const issuer = issuerFor(company)
  const c = customerOf(co, p.customerId)
  return delay({
    payment: paymentView(p),
    company: {
      name: issuer.name,
      legalName: issuer.legalName,
      logoUrl: company?.branding.logoUrl ?? null,
      monogram: company?.branding.monogram ?? '',
      addressLines: company ? addressLinesOf(company.profile) : [],
      taxLabel: issuer.taxLabel,
      taxNumber: issuer.taxNumber,
      email: issuer.email,
      phone: issuer.phone,
    },
    customer: { id: p.customerId, name: c?.name ?? '', address: c?.address ?? '' },
    amountText: `${p.currency} ${p.amount.toFixed(2)}`,
  })
}

/* ---------------- credit-note excess (customer credit from the invoices section) ---------------- */

/** What is left of a credit note's excess (posted to customer_advances by the invoices section). */
export function creditNoteRemaining(co: string, n: Pick<CreditNoteRecord, 'id' | 'excessAmount'>, asOf?: string): number {
  const used = finCreditNoteUses.filter((u) => u.companyId === co && u.creditNoteId === n.id && (!asOf || u.date <= asOf)).reduce((s, u) => s + u.amount, 0)
  return Math.max(0, round2(n.excessAmount - used))
}
const findCreditNote = (co: string, id: string) => financeCreditNotes.find((n) => n.companyId === co && n.id === id) ?? notFound()
function creditNoteView(co: string, n: Tenant<CreditNoteRecord>): CreditNoteCredit {
  return { creditNoteId: n.id, number: n.number, customerId: n.customerId, currency: n.currency, excess: n.excessAmount, remaining: creditNoteRemaining(co, n) }
}

/** Applies a credit note's excess to the customer's open invoices (same currency): Dr customer advances · Cr AR ± FX. */
export function applyCreditNoteFor(co: string, actorId: string | null, n: Tenant<CreditNoteRecord>, input: ApplyCreditInput | null): void {
  const left = creditNoteRemaining(co, n)
  if (left <= 0) return conflict(`${n.number} has no credit left to apply.`, 'no_credit')
  const date = input?.date === undefined || input?.date === null ? todayOf(co) : input.date
  if (!isIsoDate(date) || date > todayOf(co) || date < n.date) return bad('Enter a date between the credit note and today.', 'invalid_date')
  const plan = planAllocations(co, n.customerId, n.currency, left, input?.allocations?.length ? 'manual' : 'auto', input?.allocations)
  if (!plan.length) return conflict(`${customerName(co, n.customerId)} has no open ${n.currency} invoices to apply the credit to.`, 'nothing_to_apply')
  const sum = round2(plan.reduce((s, a) => s + a.amount, 0))
  const je = postWithFx(co, {
    date,
    memo: `Credit from ${n.number} applied`,
    sourceType: 'credit_note',
    sourceId: n.id,
    createdBy: actorId,
    lines: [
      dr(systemAccount(co, 'customer_advances'), sum * n.exchangeRate, `Credit from ${n.number}`, n.customerId),
      ...plan.map((a) => cr(systemAccount(co, 'accounts_receivable'), a.amount * a.invoice.exchangeRate, `Credit applied to ${a.invoice.number}`, n.customerId)),
    ],
  })
  const at = nowIso()
  for (const a of plan) {
    applyToInvoice(a.invoice, { paid: a.amount }, at)
    logOnInvoice(a.invoice, 'updated', `Credit from ${n.number} applied: ${n.currency} ${a.amount.toFixed(2)}`, userName(co, actorId), at)
    finCreditNoteUses.push({ companyId: co, id: nextCollectionsSeq('alloc', 'CU'), creditNoteId: n.id, kind: 'apply', invoiceId: a.invoice.id, invoiceNumber: a.invoice.number, amount: a.amount, date, accountId: null, journalEntryId: je.id, createdBy: actorId, createdAt: at })
  }
}

export async function applyCreditNote(user: User, id: string, input: ApplyCreditInput | null): Promise<CreditNoteCredit> {
  const co = writeCtx(user)
  const n = findCreditNote(co, id)
  const before = creditNoteRemaining(co, n)
  applyCreditNoteFor(co, user.id, n, input)
  recordAudit(user, { action: 'update', entity: 'credit_note', entityId: n.id, summary: `Applied ${n.currency} ${(before - creditNoteRemaining(co, n)).toFixed(2)} of credit from ${n.number}` })
  return delay(creditNoteView(co, n))
}

/** Refunds (part of) a credit note's excess: Dr customer advances · Cr the refund account, at the credit note's rate. */
export async function refundCreditNote(user: User, id: string, input: RefundInput | null): Promise<CreditNoteCredit> {
  const co = writeCtx(user)
  const n = findCreditNote(co, id)
  const b = input ?? ({} as RefundInput)
  const amount = money(b.amount, 'Refund amount')
  const date = b.date ?? todayOf(co)
  if (!isIsoDate(date) || date > todayOf(co) || date < n.date) return bad('Enter a refund date between the credit note and today.', 'invalid_date')
  const left = creditNoteRemaining(co, n)
  if (amount > left) return bad(`At most ${left.toFixed(2)} ${n.currency} can be refunded.`, 'over_refund', { refundable: left })
  const account = depositAccount(co, b.accountId, systemAccount(co, 'bank_default'))
  const je = postWithFx(co, {
    date,
    memo: `Refund of credit ${n.number}`,
    sourceType: 'payment_refund',
    sourceId: n.id,
    createdBy: user.id,
    lines: [dr(systemAccount(co, 'customer_advances'), amount * n.exchangeRate, `Credit ${n.number} refunded`, n.customerId), cr(account, amount * n.exchangeRate, `Refund to ${customerName(co, n.customerId)}`, n.customerId)],
  })
  finCreditNoteUses.push({ companyId: co, id: nextCollectionsSeq('refund', 'CR'), creditNoteId: n.id, kind: 'refund', invoiceId: null, invoiceNumber: null, amount, date, accountId: account, journalEntryId: je.id, createdBy: user.id, createdAt: nowIso() })
  recordAudit(user, { action: 'update', entity: 'credit_note', entityId: n.id, summary: `Refunded ${n.currency} ${amount.toFixed(2)} of credit ${n.number}` })
  logOnCustomer(co, n.customerId, 'system', `Refund of ${n.currency} ${amount.toFixed(2)} from credit note ${n.number}`, user.id)
  return delay(creditNoteView(co, n))
}

/* ---------------- customer pickers ---------------- */

export function openItemsOf(co: string, customerId: string): CustomerOpenItems {
  const c = customerOf(co, customerId) ?? notFound()
  const today = todayOf(co)
  return {
    customerId: c.id,
    customerName: c.name,
    invoices: openInvoicesOf(co, c.id).map((i) => {
      const held = pdcHeldOn(co, i.id)
      return {
        id: i.id,
        number: i.number,
        issueDate: i.issueDate ?? '',
        dueDate: i.dueDate ?? '',
        currency: i.currency,
        exchangeRate: i.exchangeRate,
        total: i.total,
        balanceDue: i.balanceDue,
        pdcHeld: held,
        available: Math.max(0, round2(i.balanceDue - held)),
        overdue: !!i.dueDate && i.dueDate < today,
      }
    }),
    credits: finPayments
      .filter((p) => p.companyId === co && p.customerId === c.id && p.status === 'posted')
      .map((p): CustomerOpenItems['credits'][number] => ({ kind: 'payment', sourceId: p.id, number: p.number, date: p.date, currency: p.currency, unallocated: paymentTotals(p).unallocated }))
      .concat(
        financeCreditNotes
          .filter((n) => n.companyId === co && n.customerId === c.id)
          .map((n): CustomerOpenItems['credits'][number] => ({ kind: 'credit_note', sourceId: n.id, number: n.number, date: n.date, currency: n.currency, unallocated: creditNoteRemaining(co, n) })),
      )
      .filter((x) => x.unallocated > 0),
  }
}

export async function getOpenItems(user: User, customerId: string): Promise<CustomerOpenItems> {
  const co = readCtx(user)
  return delay(openItemsOf(co, customerId))
}

export async function listDepositAccounts(user: User): Promise<DepositAccount[]> {
  const co = readCtx(user)
  return delay(depositAccounts(co))
}

/* ---------------- post-dated cheques ---------------- */

export async function listPdcs(user: User, f: { status?: string | null; customerId?: string | null } = {}): Promise<Pdc[]> {
  const co = readCtx(user)
  const rows = finPdcs
    .filter((p) => p.companyId === co && (!f.status || p.status === f.status) && (!f.customerId || p.customerId === f.customerId))
    .map(pdcView)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.chequeNo.localeCompare(b.chequeNo))
  return delay(rows)
}

export async function getPdc(user: User, id: string): Promise<Pdc> {
  const co = readCtx(user)
  return delay(pdcView(findPdc(co, id)))
}

export function receivePdcFor(co: string, actorId: string | null, input: PdcInput | null): Tenant<PdcRecord> {
  const b = input ?? ({} as PdcInput)
  const customer = customerOf(co, b.customerId)
  if (!customer) return bad('Pick the customer who gave the cheque.', 'invalid_customer')
  const chequeNo = str(b.chequeNo, 40)
  if (!chequeNo) return bad('Enter the cheque number.', 'cheque_no_required')
  const bankName = str(b.bankName, 120)
  if (!bankName) return bad('Enter the bank the cheque is drawn on.', 'bank_required')
  if (finPdcs.some((p) => p.companyId === co && p.customerId === customer.id && p.chequeNo === chequeNo && p.bankName.toLowerCase() === bankName.toLowerCase() && p.status !== 'bounced')) {
    return conflict(`Cheque ${chequeNo} of ${bankName} is already registered.`, 'duplicate_cheque')
  }
  if (!isIsoDate(b.receivedDate) || b.receivedDate > todayOf(co)) return bad('Enter the date the cheque was received (up to today).', 'invalid_date')
  if (!isIsoDate(b.dueDate) || b.dueDate < b.receivedDate) return bad('The cheque date must be on or after the date received.', 'invalid_due_date')
  const amount = money(b.amount, 'Amount')
  const currency = str(b.currency, 3).toUpperCase() || baseCurrencyOf(co)
  if (!/^[A-Z]{3}$/.test(currency)) return bad('Currency must be a 3-letter code.', 'invalid_currency')
  const rate = rateInput(co, b.exchangeRate, currency, b.receivedDate)
  const plan = b.allocations?.length ? planAllocations(co, customer.id, currency, amount, 'manual', b.allocations) : []
  const allocated = round2(plan.reduce((s, a) => s + a.amount, 0))
  const id = nextId('pdc', 'PDC')
  const ar = systemAccount(co, 'accounts_receivable')
  const je = postWithFx(co, {
    date: b.receivedDate,
    memo: `Post-dated cheque ${chequeNo} (${bankName}) from ${customer.name}`,
    sourceType: 'pdc',
    sourceId: id,
    createdBy: actorId,
    lines: [
      dr(systemAccount(co, 'pdc_receivable'), amount * rate, `Cheque ${chequeNo} due ${b.dueDate}`, customer.id),
      ...plan.map((a) => cr(ar, a.amount * a.invoice.exchangeRate, `Secured by cheque ${chequeNo}: ${a.invoice.number}`, customer.id)),
      ...(amount - allocated > 0 ? [cr(systemAccount(co, 'customer_advances'), (amount - allocated) * rate, `Cheque ${chequeNo} (advance)`, customer.id)] : []),
    ],
  })
  const rec: Tenant<PdcRecord> = {
    companyId: co,
    id,
    chequeNo,
    bankName,
    customerId: customer.id,
    receivedDate: b.receivedDate,
    dueDate: b.dueDate,
    amount,
    currency,
    exchangeRate: rate,
    allocations: plan.map((a) => ({ invoiceId: a.invoice.id, invoiceNumber: a.invoice.number, amount: a.amount })),
    status: 'received',
    depositAccountId: null,
    depositedDate: null,
    clearedDate: null,
    bouncedDate: null,
    bounceReason: null,
    bounceFee: 0,
    paymentId: null,
    notes: str(b.notes, 2000),
    journalEntryIds: [je.id],
    dueNotifiedAt: null,
    createdBy: actorId,
    createdAt: nowIso(),
  }
  finPdcs.push(rec)
  return rec
}

export async function createPdc(user: User, input: PdcInput | null): Promise<Pdc> {
  const co = writeCtx(user)
  const p = receivePdcFor(co, user.id, input)
  recordAudit(user, { action: 'create', entity: 'pdc', entityId: p.id, summary: `Received post-dated cheque ${p.chequeNo} (${p.currency} ${p.amount.toFixed(2)}, due ${p.dueDate}) from ${customerName(co, p.customerId)}` })
  logOnCustomer(co, p.customerId, 'system', `Post-dated cheque ${p.chequeNo} received (${p.currency} ${p.amount.toFixed(2)}, due ${p.dueDate})`, user.id)
  return delay(pdcView(p))
}

function actionDate(co: string, v: unknown, min: string, what: string): string {
  const d = v === undefined || v === null || v === '' ? todayOf(co) : v
  if (!isIsoDate(d) || d > todayOf(co) || d < min) return bad(`Enter the ${what} date (from ${min} up to today).`, 'invalid_date')
  return d
}

export function depositPdcFor(co: string, p: Tenant<PdcRecord>, input: PdcActionInput | null): void {
  if (p.status !== 'received') return conflict(`Cheque ${p.chequeNo} is ${p.status}, not held.`, 'invalid_status', { status: p.status })
  const date = actionDate(co, input?.date, p.receivedDate, 'deposit')
  if (date < p.dueDate) return conflict(`Cheque ${p.chequeNo} is dated ${p.dueDate}; it can’t be deposited before then.`, 'not_due', { dueDate: p.dueDate })
  p.depositAccountId = depositAccount(co, input?.depositAccountId, systemAccount(co, 'bank_default'))
  p.depositedDate = date
  p.status = 'deposited'
}

export async function depositPdc(user: User, id: string, input: PdcActionInput | null): Promise<Pdc> {
  const co = writeCtx(user)
  const p = findPdc(co, id)
  depositPdcFor(co, p, input)
  recordAudit(user, { action: 'update', entity: 'pdc', entityId: p.id, summary: `Deposited cheque ${p.chequeNo}` })
  return delay(pdcView(p))
}

/** Cleared: the money is in the bank. Posts Dr bank / Cr PDC receivable, records the receipt and pays the invoices. */
export function clearPdcFor(co: string, actorId: string | null, p: Tenant<PdcRecord>, input: PdcActionInput | null): Tenant<PaymentRecord> {
  if (p.status !== 'deposited') return conflict(`Cheque ${p.chequeNo} must be deposited before it clears.`, 'invalid_status', { status: p.status })
  const date = actionDate(co, input?.date, p.depositedDate ?? p.receivedDate, 'clearing')
  const bank = p.depositAccountId ?? systemAccount(co, 'bank_default')
  const ar = systemAccount(co, 'accounts_receivable')
  const adv = systemAccount(co, 'customer_advances')
  // What each invoice can still take now (a credit note or void since the cheque came in): the rest becomes credit.
  const now = p.allocations.map((a) => {
    const inv = invoiceOf(co, a.invoiceId)
    const take = inv && isOpenInvoice(inv) ? round2(Math.min(a.amount, inv.balanceDue)) : 0
    return { a, inv, take, excess: round2(a.amount - take) }
  })
  const paymentId = nextId('payment', 'PAY')
  const je = postWithFx(co, {
    date,
    memo: `Cheque ${p.chequeNo} cleared (${p.bankName})`,
    sourceType: 'pdc',
    sourceId: p.id,
    createdBy: actorId,
    lines: [
      dr(bank, p.amount * p.exchangeRate, `Cheque ${p.chequeNo} cleared`, p.customerId),
      cr(systemAccount(co, 'pdc_receivable'), p.amount * p.exchangeRate, `Cheque ${p.chequeNo} cleared`, p.customerId),
      // Re-class what an invoice can no longer take from receivables to customer credit.
      ...now.filter((x) => x.excess > 0).flatMap((x) => [dr(ar, x.excess * (x.inv?.exchangeRate ?? p.exchangeRate), `Cheque ${p.chequeNo}: ${x.a.invoiceNumber} no longer open`, p.customerId), cr(adv, x.excess * p.exchangeRate, 'To customer credit', p.customerId)]),
    ],
  })
  const at = nowIso()
  const number = docNumber(co, prefixOf(co), 'RCT', date.slice(0, 4))
  for (const x of now) {
    if (!x.inv || x.take <= 0) continue
    applyToInvoice(x.inv, { paid: x.take }, at)
    logOnInvoice(x.inv, 'updated', `Cheque ${p.chequeNo} cleared: receipt ${number}, ${p.currency} ${x.take.toFixed(2)}`, userName(co, actorId), at)
  }
  const pay: Tenant<PaymentRecord> = {
    companyId: co,
    id: paymentId,
    number,
    customerId: p.customerId,
    date,
    method: 'cheque',
    amount: p.amount,
    currency: p.currency,
    exchangeRate: p.exchangeRate,
    bankCharges: 0,
    depositAccountId: bank,
    reference: `Cheque ${p.chequeNo} · ${p.bankName}`,
    notes: p.notes,
    allocations: now.filter((x) => x.inv && x.take > 0).map((x) => allocRecord(x.inv!, x.take, date, 'payment', null)),
    refunds: [],
    status: 'posted',
    source: 'pdc',
    pdcId: p.id,
    paymentLinkId: null,
    cardHint: null,
    journalEntryIds: [p.journalEntryIds[0], je.id],
    createdBy: actorId,
    createdAt: at,
    voidedAt: null,
    voidReason: null,
  }
  finPayments.push(pay)
  p.status = 'cleared'
  p.clearedDate = date
  p.paymentId = pay.id
  p.journalEntryIds.push(je.id)
  return pay
}

export async function clearPdc(user: User, id: string, input: PdcActionInput | null): Promise<Pdc> {
  const co = writeCtx(user)
  const p = findPdc(co, id)
  const pay = clearPdcFor(co, user.id, p, input)
  recordAudit(user, { action: 'update', entity: 'pdc', entityId: p.id, summary: `Cheque ${p.chequeNo} cleared: receipt ${pay.number}` })
  logOnCustomer(co, p.customerId, 'system', `Cheque ${p.chequeNo} cleared: receipt ${pay.number}`, user.id)
  return delay(pdcView(p))
}

/** Bounced: reverse the received entry (invoices were never paid, so they simply stay open); flag and notify. */
export function bouncePdcFor(co: string, actorId: string | null, p: Tenant<PdcRecord>, input: PdcActionInput | null): void {
  if (p.status !== 'received' && p.status !== 'deposited') return conflict(`Cheque ${p.chequeNo} is ${p.status}; only a held or deposited cheque can bounce.`, 'invalid_status', { status: p.status })
  const date = actionDate(co, input?.date, p.receivedDate, 'bounce')
  const reason = str(input?.reason, 300) || 'Returned unpaid'
  const fee = input?.bounceFee === undefined || input?.bounceFee === null || (input.bounceFee as unknown) === '' ? 0 : money(input.bounceFee, 'Bounce fee', { allowZero: true })
  const bank = p.depositAccountId ?? systemAccount(co, 'bank_default')
  const rev = reverseJournal(co, p.journalEntryIds[0], date, `Cheque ${p.chequeNo} bounced: ${reason}`, actorId)
  p.journalEntryIds.push(rev.id)
  if (fee > 0) {
    const feeJe = postWithFx(co, {
      date,
      memo: `Returned cheque fee: ${p.chequeNo}`,
      sourceType: 'pdc',
      sourceId: p.id,
      createdBy: actorId,
      lines: [dr(bankChargesAccount(co), fee * (baseCurrencyOf(co) === p.currency ? 1 : p.exchangeRate), 'Returned cheque fee', p.customerId), cr(bank, fee * (baseCurrencyOf(co) === p.currency ? 1 : p.exchangeRate), 'Returned cheque fee', p.customerId)],
    })
    p.journalEntryIds.push(feeJe.id)
  }
  p.status = 'bounced'
  p.bouncedDate = date
  p.bounceReason = reason
  p.bounceFee = fee
  const c = creditRecord(co, p.customerId)
  c.bouncedCheques += 1
  c.lastBounceDate = date
  c.updatedAt = nowIso()
  const owner = customerOf(co, p.customerId)?.ownerId
  const name = customerName(co, p.customerId)
  notify(co, [...accountantIds(co), ...(owner ? [owner] : [])], `Cheque ${p.chequeNo} bounced`, `${name} · ${p.currency} ${p.amount.toFixed(2)} · ${reason}. The invoices are open again.`, `/finance/payments?tab=pdc&pdc=${encodeURIComponent(p.id)}`)
  logOnCustomer(co, p.customerId, 'system', `Cheque ${p.chequeNo} bounced (${reason})`, actorId)
}

export async function bouncePdc(user: User, id: string, input: PdcActionInput | null): Promise<Pdc> {
  const co = writeCtx(user)
  const p = findPdc(co, id)
  bouncePdcFor(co, user.id, p, input)
  recordAudit(user, { action: 'update', entity: 'pdc', entityId: p.id, summary: `Cheque ${p.chequeNo} bounced (${p.bounceReason})${p.bounceFee ? `, fee ${p.bounceFee.toFixed(2)}` : ''}` })
  return delay(pdcView(p))
}

/* ---------------- payment links ---------------- */

const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
/** Letters only: an unguessable key that never looks like a card number. */
function newToken(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}

export function createLinkFor(co: string, actorId: string | null, input: PaymentLinkInput | null): Tenant<PaymentLinkRecord> {
  const inv = invoiceOf(co, input?.invoiceId)
  if (!inv) return bad('Pick an invoice.', 'invalid_invoice')
  const amount = availableOn(co, inv)
  if (amount <= 0) return conflict(`${inv.number} has nothing left to pay online.`, 'nothing_due')
  const days = input?.expiresInDays === undefined || input?.expiresInDays === null ? settingsRecordOrDefault(co).defaultExpiryDays : Number(input.expiresInDays)
  if (!Number.isInteger(days) || days < 1 || days > 90) return bad('A link expires after 1 to 90 days.', 'invalid_expiry')
  // One live link per invoice: an earlier active one is voided.
  for (const l of finPaymentLinks) if (l.companyId === co && l.invoiceId === inv.id && l.status === 'active') l.status = 'void'
  const rec: Tenant<PaymentLinkRecord> = {
    companyId: co,
    id: nextId('paymentLink', 'PL'),
    token: newToken(),
    invoiceId: inv.id,
    amount,
    currency: inv.currency,
    expiresAt: addDays(todayOf(co), days),
    status: 'active',
    paidAt: null,
    paymentId: null,
    createdBy: actorId,
    createdAt: nowIso(),
  }
  finPaymentLinks.push(rec)
  return rec
}
const settingsRecordOrDefault = (co: string) => finCollectionsSettings.find((s) => s.companyId === co) ?? { defaultExpiryDays: 14, gatewayFeePct: 0 }

export async function listPaymentLinks(user: User, f: { invoiceId?: string | null; status?: string | null } = {}): Promise<PaymentLink[]> {
  const co = readCtx(user)
  const rows = finPaymentLinks
    .filter((l) => l.companyId === co && (!f.invoiceId || l.invoiceId === f.invoiceId))
    .map(linkView)
    .filter((l) => !f.status || l.status === f.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

export async function createPaymentLink(user: User, input: PaymentLinkInput | null): Promise<PaymentLink> {
  const co = writeCtx(user)
  const l = createLinkFor(co, user.id, input)
  const inv = invoiceOf(co, l.invoiceId)!
  recordAudit(user, { action: 'create', entity: 'payment_link', entityId: l.id, summary: `Created a payment link for ${inv.number} (${l.currency} ${l.amount.toFixed(2)}, expires ${l.expiresAt})` })
  return delay(linkView(l))
}

export async function voidPaymentLink(user: User, id: string): Promise<PaymentLink> {
  const co = writeCtx(user)
  const l = findLink(co, id)
  if (l.status !== 'active') return conflict(`This link is ${linkStatus(l)}.`, 'invalid_status')
  l.status = 'void'
  recordAudit(user, { action: 'delete', entity: 'payment_link', entityId: l.id, summary: `Voided payment link ${l.id}` })
  return delay(linkView(l))
}

/* ---------------- public pay page (no auth) ---------------- */

const LINK_INVALID = 'This payment link isn’t valid.'
/** The link behind a token; unknown token, a company without accounting or a deleted / suspended workspace → the same 404. */
function linkByToken(token: string): Tenant<PaymentLinkRecord> {
  const l = token && token.length >= 16 ? finPaymentLinks.find((x) => x.token === token) : undefined
  const sub = l ? subscriptionOf(l.companyId) : undefined
  if (!l || !sub || sub.status === 'deleted' || companyById(l.companyId)?.status === 'suspended' || !companyModules(l.companyId).includes('accounting')) {
    throw new CodedApiError(LINK_INVALID, 404, 'payment_link_not_found')
  }
  return l
}

function publicState(l: Tenant<PaymentLinkRecord>): { state: PublicPayment['state']; message: string | null; inv: Tenant<Invoice> | undefined; due: number } {
  const inv = invoiceOf(l.companyId, l.invoiceId)
  const sub = subscriptionOf(l.companyId)
  if (l.status === 'paid') return { state: 'paid', message: 'This invoice has been paid. Thank you.', inv, due: 0 }
  if (!inv || inv.status === 'void' || l.status === 'void' || (sub && isReadOnly(sub.status))) return { state: 'unavailable', message: 'This payment link is no longer valid. Contact the company for a new one.', inv, due: 0 }
  if (linkStatus(l) === 'expired') return { state: 'expired', message: 'This payment link has expired. Ask the company for a new one.', inv, due: 0 }
  const due = Math.min(l.amount, availableOn(l.companyId, inv))
  if (due <= 0) return { state: 'paid', message: 'This invoice has already been paid.', inv, due: 0 }
  return { state: 'payable', message: null, inv, due: round2(due) }
}

export async function getPublicPayment(token: string): Promise<PublicPayment> {
  const l = linkByToken(token)
  const s = publicState(l)
  const c = companyById(l.companyId)
  return delay({
    state: s.state,
    message: s.message,
    invoiceNumber: s.inv?.number ?? '',
    amountDue: s.due,
    currency: l.currency,
    companyName: c?.branding.displayName || c?.name || '',
    logoUrl: c?.branding.logoUrl ?? null,
    monogram: c?.branding.monogram ?? '',
    testMode: true,
  })
}

function luhnOk(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}
const brandOf = (d: string) => (d.startsWith('4') ? 'Visa' : /^5[1-5]/.test(d) || /^2[2-7]/.test(d) ? 'Mastercard' : /^3[47]/.test(d) ? 'Amex' : d.startsWith('6') ? 'Mada' : 'Card')
/** Test mode: this card number is always declined (like a gateway's sandbox). */
export const DECLINED_TEST_CARD = '4000000000000002'

/**
 * POST /public/pay/:token — simulated gateway (test mode). The card is validated (Luhn, expiry, CVC) and then
 * dropped: nothing but the brand and last 4 digits is kept. Success records a payment-link payment to the gateway
 * clearing account (optional fee as bank charges) and marks the link paid. Rate-limited per client and link.
 * SEAM(gateway): a real integration (Telr / Tap / PayTabs / Stripe) replaces this with a hosted checkout + webhook.
 */
export async function payPublic(token: string, input: PublicPayInput | null, clientKey = 'anonymous'): Promise<PublicPayResult> {
  await delay(null)
  const l = linkByToken(token)
  hitRateLimit(finPayHits, [`pay:${l.id}:${clientKey || 'anonymous'}`, `pay:${l.id}`], { limit: 10, windowMs: 10 * 60_000, what: 'payment' })
  const s = publicState(l)
  if (s.state !== 'payable' || !s.inv) throw new CodedApiError(s.message ?? LINK_INVALID, 409, `link_${s.state}`)
  const b = input ?? ({} as PublicPayInput)
  const digits = String(b.cardNumber ?? '').replace(/[\s-]/g, '')
  if (!str(b.cardholderName, 120)) throw new CodedApiError('Enter the name on the card.', 422, 'invalid_card')
  if (!/^\d{12,19}$/.test(digits) || !luhnOk(digits)) throw new CodedApiError('Check the card number.', 422, 'invalid_card')
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(b.expiry ?? ''))
  const nowD = new Date(nowMs())
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || 2000 + Number(m[2]) < nowD.getUTCFullYear() || (2000 + Number(m[2]) === nowD.getUTCFullYear() && Number(m[1]) < nowD.getUTCMonth() + 1)) {
    throw new CodedApiError('Check the expiry date (MM/YY).', 422, 'invalid_card')
  }
  if (!/^\d{3,4}$/.test(String(b.cvc ?? ''))) throw new CodedApiError('Check the security code.', 422, 'invalid_card')
  if (digits === DECLINED_TEST_CARD) throw new CodedApiError('The card was declined. Try another card.', 402, 'card_declined')
  const co = l.companyId
  const inv = s.inv
  const fee = round2((s.due * (settingsRecordOrDefault(co).gatewayFeePct ?? 0)) / 100)
  const pay = recordPaymentFor(
    co,
    null,
    { customerId: inv.customerId, date: todayOf(co), method: 'payment_link', amount: s.due, currency: l.currency, exchangeRate: inv.exchangeRate, bankCharges: fee, depositAccountId: systemAccount(co, 'payment_gateway_clearing'), reference: `Online payment ${l.id}`, allocationMode: 'manual', allocations: [{ invoiceId: inv.id, amount: s.due }] },
    { source: 'payment_link', paymentLinkId: l.id, cardHint: `${brandOf(digits)} •••• ${digits.slice(-4)}` },
  )
  l.status = 'paid'
  l.paidAt = nowIso()
  l.paymentId = pay.id
  const owner = customerOf(co, inv.customerId)?.ownerId
  notify(co, [...accountantIds(co), ...(owner ? [owner] : [])], `Paid online: ${inv.number}`, `${customerName(co, inv.customerId)} · ${pay.currency} ${pay.amount.toFixed(2)} · receipt ${pay.number}`, `/finance/payments?payment=${encodeURIComponent(pay.id)}`)
  logOnCustomer(co, inv.customerId, 'system', `Paid ${inv.number} online (${pay.currency} ${pay.amount.toFixed(2)}, receipt ${pay.number})`, null)
  return { paid: true, message: 'Payment received. Thank you!', receiptNumber: pay.number, amount: pay.amount, currency: pay.currency }
}

/* ---------------- settings ---------------- */

export async function getCollectionsSettings(user: User): Promise<CollectionsSettings> {
  const co = readCtx(user)
  return delay(settingsView(co, finAccessOf(user) === 'full'))
}

export async function updateCollectionsSettings(user: User, input: CollectionsSettingsInput | null): Promise<CollectionsSettings> {
  const co = writeCtx(user)
  const b = input ?? {}
  const s = settingsRecord(co)
  const changes: string[] = []
  if (b.dunningEnabled !== undefined) {
    if (typeof b.dunningEnabled !== 'boolean') return bad('dunning_enabled is true or false.')
    s.dunningEnabled = b.dunningEnabled
    changes.push(`reminders ${b.dunningEnabled ? 'on' : 'off'}`)
  }
  if (b.dunningSteps !== undefined) {
    if (!Array.isArray(b.dunningSteps) || b.dunningSteps.length > 8) return bad('Up to 8 reminder steps.', 'invalid_steps')
    const offsets = new Set<number>()
    const steps = b.dunningSteps.map((x, i) => {
      const off = Number(x?.offsetDays)
      if (!Number.isInteger(off) || off < -30 || off > 365) return bad('A reminder is 30 days before to 365 days after the due date.', 'invalid_steps')
      if (offsets.has(off)) return bad('Two reminders on the same day.', 'invalid_steps')
      offsets.add(off)
      const id = typeof x.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(x.id) ? x.id : `step-${off < 0 ? 'm' : ''}${Math.abs(off)}-${i}`
      return { id, offsetDays: off, active: x.active !== false, notifyOwner: x.notifyOwner === true }
    })
    s.dunningSteps = steps.sort((a, c) => a.offsetDays - c.offsetDays)
    changes.push('reminder schedule')
  }
  if (b.creditCheckMode !== undefined) {
    if (b.creditCheckMode !== 'warn' && b.creditCheckMode !== 'block') return bad('Credit check is warn or block.', 'invalid_mode')
    s.creditCheckMode = b.creditCheckMode
    changes.push(`credit check ${b.creditCheckMode}`)
  }
  if (b.gatewayFeePct !== undefined) {
    const n = Number(b.gatewayFeePct)
    if (!Number.isFinite(n) || n < 0 || n > 10) return bad('Gateway fee is 0 to 10%.', 'invalid_fee')
    s.gatewayFeePct = round2(n)
    changes.push('gateway fee')
  }
  if (b.defaultExpiryDays !== undefined) {
    const n = Number(b.defaultExpiryDays)
    if (!Number.isInteger(n) || n < 1 || n > 90) return bad('Link expiry is 1 to 90 days.', 'invalid_expiry')
    s.defaultExpiryDays = n
    changes.push('link expiry')
  }
  s.updatedAt = nowIso()
  s.updatedBy = user.id
  recordAudit(user, { action: 'update', entity: 'collections_settings', entityId: co, summary: `Updated collections settings${changes.length ? `: ${changes.join(', ')}` : ''}` })
  return delay(settingsView(co, true))
}

/* ---------------- lazy seed ---------------- */

/**
 * Seeds the company's collections once, from its issued invoices (owned by the invoices section), sorted by
 * number: #1 paid in full by transfer · #2 half paid in cash · #3 secured by a PDC not yet due · #4 a PDC that
 * bounced · #5 overpaid (→ customer credit) · #6 paid through a payment link · #7 paid by card with bank charges ·
 * the rest stay open (some overdue). Everything goes through the services above (postings, applyToInvoice).
 * Without issued invoices nothing is seeded and the next call tries again.
 */
export function ensureCollectionsSeed(co: string): void {
  if (finCollectionsMeta.seeded.includes(co)) return
  if (!financeInvoicesOf(co).length) return
  finCollectionsMeta.seeded.push(co)
  const actor = accountantIds(co)[0] ?? null
  const today = todayOf(co)
  // Never on or before the ledger's lock date (Crest's seed locks 2025).
  const lock = financeSettings.get(co).lockDate
  // The year's trading invoices (data/financeHistorySeed.ts) are paid by transfer each customer's usual number of
  // days after issue; the recent ones are still open (receivables, a few overdue). They are not the examples below.
  for (const h of historyInvoicesOf(co, today)) {
    const inv = financeInvoices.find((i) => i.companyId === co && i.id === h.id)
    if (!inv || inv.status !== 'issued' || inv.amountPaid !== 0 || !inv.issueDate) continue
    const date = addDays(inv.issueDate, h.paidAfter)
    if (date >= today || (lock && date <= lock)) continue
    try {
      recordPaymentFor(co, actor, { customerId: inv.customerId, date, method: 'bank_transfer', amount: inv.balanceDue, currency: inv.currency, exchangeRate: inv.exchangeRate, allocationMode: 'manual', allocations: [{ invoiceId: inv.id, amount: inv.balanceDue }], reference: h.reference })
    } catch {
      /* a lock date or a chart change: leave it open */
    }
  }
  const issued = financeInvoicesOf(co)
  const at = (inv: Invoice, days: number) => {
    let d = addDays(inv.issueDate ?? today, days)
    if (lock && d <= lock) d = addDays(lock, 1)
    return d > today ? today : d
  }
  const tryIt = (f: () => void) => {
    try {
      f()
    } catch {
      /* a lock date or a chart change: skip that example */
    }
  }
  const pay = (inv: Tenant<Invoice>, amount: number, method: PaymentMethod, days: number, extra: Partial<PaymentInput> = {}, opts?: RecordOpts) =>
    recordPaymentFor(co, actor, { customerId: inv.customerId, date: at(inv, days), method, amount, currency: inv.currency, exchangeRate: inv.exchangeRate, allocationMode: 'manual', allocations: [{ invoiceId: inv.id, amount: Math.min(amount, inv.balanceDue) }], reference: `Seed ${method}`, ...extra }, opts)
  const [a, b, c, d, e, f, g] = issued
  if (a) tryIt(() => pay(a, a.balanceDue, 'bank_transfer', 12, { reference: 'TT 88231' }))
  if (b) tryIt(() => pay(b, round2(b.balanceDue / 2), 'cash', 9))
  if (c) tryIt(() => receivePdcFor(co, actor, { customerId: c.customerId, chequeNo: '100245', bankName: 'Emirates NBD', receivedDate: at(c, 3), dueDate: addDays(today, 5), amount: c.balanceDue, currency: c.currency, exchangeRate: c.exchangeRate, allocations: [{ invoiceId: c.id, amount: c.balanceDue }] }))
  if (d)
    tryIt(() => {
      const p = receivePdcFor(co, actor, { customerId: d.customerId, chequeNo: '200871', bankName: 'Mashreq', receivedDate: at(d, 2), dueDate: at(d, 6), amount: d.balanceDue, currency: d.currency, exchangeRate: d.exchangeRate, allocations: [{ invoiceId: d.id, amount: d.balanceDue }] })
      depositPdcFor(co, p, { date: p.dueDate })
      bouncePdcFor(co, actor, p, { date: p.dueDate, reason: 'Insufficient funds', bounceFee: 50 })
    })
  if (e) tryIt(() => pay(e, round2(e.balanceDue + 500), 'bank_transfer', 15, { allocations: [{ invoiceId: e.id, amount: e.balanceDue }], reference: 'TT 90412' }))
  if (f)
    tryIt(() => {
      const l = createLinkFor(co, actor, { invoiceId: f.id, expiresInDays: 14 })
      const p = pay(f, l.amount, 'payment_link', 4, { depositAccountId: systemAccount(co, 'payment_gateway_clearing'), reference: `Online payment ${l.id}` }, { source: 'payment_link', paymentLinkId: l.id, cardHint: 'Visa •••• 4242' })
      l.status = 'paid'
      l.paidAt = nowIso()
      l.paymentId = p.id
    })
  if (g) tryIt(() => pay(g, g.balanceDue, 'card', 7, { bankCharges: round2(g.balanceDue * 0.02) }))
  // A credit limit on the first customer with open invoices, so the credit check has something to show.
  const open = financeInvoicesOf(co).find((i) => i.balanceDue > 0)
  if (open) {
    const cr0 = creditRecord(co, open.customerId)
    // Above the customer's whole open balance (its trading invoices included), so the check shows the headroom.
    const exposure = financeInvoices.filter((i) => i.companyId === co && i.customerId === open.customerId && i.balanceDue > 0 && (i.status === 'issued' || i.status === 'partially_paid')).reduce((s, i) => s + i.balanceDue * i.exchangeRate, 0)
    cr0.creditLimit = round2(Math.max(1000, exposure * 1.25, open.balanceDue * open.exchangeRate * 1.5))
  }
}
/** Issued invoices untouched by payments yet (the seed's candidates), by number. */
function financeInvoicesOf(co: string): Tenant<Invoice>[] {
  return financeInvoices
    .filter((i) => i.companyId === co && i.status === 'issued' && i.amountPaid === 0 && i.amountCredited === 0 && i.balanceDue > 0 && !isHistoryInvoiceId(i.id))
    .sort((x, y) => x.number.localeCompare(y.number))
}

/* ---------------- PDC due reminders (lifecycle tick) ---------------- */

/** "Deposit today": once per held cheque, on its date (company calendar), to the accountants. */
export function runPdcReminders(co: string): number {
  const today = todayOf(co)
  let n = 0
  for (const p of finPdcs) {
    if (p.companyId !== co || p.status !== 'received' || p.dueNotifiedAt || p.dueDate > today) continue
    p.dueNotifiedAt = nowIso()
    notify(co, accountantIds(co), `Deposit cheque ${p.chequeNo}`, `${customerName(co, p.customerId)} · ${p.currency} ${p.amount.toFixed(2)} · dated ${p.dueDate}`, `/finance/payments?tab=pdc&pdc=${encodeURIComponent(p.id)}`)
    n++
  }
  return n
}

onLifecycleTick('finance.pdc-reminders', (co) => runPdcReminders(co))

/* ---------------- how collections documents show in the journal ---------------- */

const paymentSource = (co: string, id: string) => {
  const p = finPayments.find((x) => x.companyId === co && x.id === id)
  if (p) return { number: p.number, link: `/finance/payments?payment=${encodeURIComponent(p.id)}` }
  const n = financeCreditNotes.find((x) => x.companyId === co && x.id === id)
  return n ? { number: n.number, link: `/finance/receivables?customer=${encodeURIComponent(n.customerId)}` } : null
}
registerJournalSource('payment', paymentSource)
// Overview, invoices and journal see the seeded payments too, whichever finance page opens first.
onFinanceAccess('collections-seed', ensureCollectionsSeed)
registerJournalSource('payment_refund', paymentSource)
registerJournalSource('pdc', (co, id) => {
  const p = finPdcs.find((x) => x.companyId === co && x.id === id)
  return p ? { number: `Cheque ${p.chequeNo}`, link: `/finance/payments?tab=pdc&pdc=${encodeURIComponent(p.id)}` } : null
})
