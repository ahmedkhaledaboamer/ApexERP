import type { InvoiceLine, JournalLine, TaxCode } from '@/modules/finance/types'
import type { CreditNoteLine, InvoiceHistoryEntry, InvoiceLineInput, ZatcaStamp } from '@/modules/finance/invoices/types'
import { lineMath, toBase, totalsOf, addDaysIso, periodDate, round2 } from '@/modules/finance/invoices/calc'
import { INITIAL_PIH, buildUblXml, invoiceHash, money, qrPayload, uuidFrom, type UblDocument, type UblLine, type UblParty } from '@/modules/finance/invoices/zatca'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { users, customers } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'
import { financeAccounts, financeTaxCodes, financeJournal } from '@/shared/mocks/data/finance'
import { financeCreditNotes, financeRecurring, financeZatcaChain, invoiceRecords, type CreditNoteRecord, type InvoiceRecord } from '@/shared/mocks/data/financeInvoices'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { recordSystemAudit } from '@/shared/mocks/data/audit'
import { scopeOf } from '@/shared/lib/permissions'
import { docNumber, nextId, postJournal, reverseJournal, systemAccount } from './ledger'
import { applyToInvoice } from './financeInvoiceBalance'
import { defaultRateFor, invoiceSettingsFor, revenueAccountFor } from './financeInvoiceSettings'

/**
 * Accounts & finance › Invoices — the store-level rules shared by the endpoints (services/financeInvoices.ts),
 * the seed (data/financeInvoicesSeed.ts) and the recurring tick. No permission checks here.
 *
 * POSTINGS (base currency = amount × exchangeRate, rounded; a rounding difference goes to the `rounding` account)
 *   issue        Dr AR (total)            Dr sales discounts (line discounts)
 *                Cr revenue per line account (qty × price)      Cr VAT output (VAT)
 *   void         the issue entry reversed (reverseJournal) on the company's today
 *   credit note  Dr revenue per line account (credited net)     Dr VAT output (credited VAT)
 *                Cr AR (up to the open balance)                  Cr customer advances (the excess = customer credit)
 */

export const bad = (message: string, code = 'validation_failed', extra?: Record<string, unknown>): never => {
  throw new CodedApiError(message, 422, code, extra)
}
export const conflict = (message: string, code: string, extra?: Record<string, unknown>): never => {
  throw new CodedApiError(message, 409, code, extra)
}

export interface Actor {
  id: string | null
  name: string
}
export const SYSTEM: Actor = { id: null, name: 'System' }

export const companyToday = (co: string, at: Date): string => todayIsoIn(invoiceSettingsFor(co).timezone, at)

export function historyEntry(by: Actor, action: InvoiceHistoryEntry['action'], summary: string, at: string): InvoiceHistoryEntry {
  return { at, byName: by.name, action, summary }
}

/* ---------------- lines ---------------- */

export function taxCodeOf(co: string, id: string): Tenant<TaxCode> | undefined {
  return financeTaxCodes.find((t) => t.companyId === co && t.id === id)
}

export function standardCode(co: string): Tenant<TaxCode> {
  const rate = invoiceSettingsFor(co).country === 'SA' ? 15 : 5
  return financeTaxCodes.find((t) => t.companyId === co && t.active && t.category === 'standard' && t.rate === rate) ?? financeTaxCodes.find((t) => t.companyId === co && t.active)!
}

function revenueAccountValid(co: string, id: string): boolean {
  const a = financeAccounts.find((x) => x.companyId === co && x.id === id)
  return !!a && a.active && !a.isHeader && a.type === 'income'
}

let lineSeq = 0
const lineId = (invoiceId: string) => `${invoiceId}-L${++lineSeq}-${Date.now().toString(36).slice(-4)}`

/** Validated, computed invoice lines (422 on the first invalid one). */
export function buildLines(co: string, invoiceId: string, inputs: unknown, opts: { eventId?: string | null } = {}): InvoiceLine[] {
  if (!Array.isArray(inputs) || inputs.length === 0) bad('Add at least one line.', 'no_lines')
  if ((inputs as unknown[]).length > 200) bad('An invoice has at most 200 lines.')
  return (inputs as InvoiceLineInput[]).map((raw, i) => {
    const n = i + 1
    if (!raw || typeof raw !== 'object') bad(`Line ${n} is invalid.`)
    const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : ''
    let serviceId: string | null = null
    if (raw.serviceId) {
      const s = services.find((x) => x.companyId === co && x.id === raw.serviceId)
      if (!s) bad(`Line ${n}: service not found.`, 'service_not_found')
      serviceId = s!.id
    }
    const quantity = Number(raw.quantity)
    const unitPrice = Number(raw.unitPrice)
    const discount = raw.discount === undefined || raw.discount === null ? 0 : Number(raw.discount)
    if (!description && !serviceId) bad(`Line ${n}: add a description.`)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) bad(`Line ${n}: quantity must be greater than 0.`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) bad(`Line ${n}: unit price must be 0 or more.`)
    if (!Number.isFinite(discount) || discount < 0) bad(`Line ${n}: discount must be 0 or more.`)
    if (round2(discount) > round2(quantity * unitPrice)) bad(`Line ${n}: the discount is larger than the line amount.`)
    const tax = raw.taxCodeId ? taxCodeOf(co, raw.taxCodeId) : standardCode(co)
    if (!tax || !tax.active) bad(`Line ${n}: unknown or inactive tax code.`, 'invalid_tax_code')
    const revenueAccountId = raw.revenueAccountId || revenueAccountFor(co, { serviceId, eventId: opts.eventId })
    if (!revenueAccountValid(co, revenueAccountId)) bad(`Line ${n}: choose an active income account.`, 'invalid_account')
    const m = lineMath(quantity, unitPrice, discount, tax!.rate)
    const name = description || services.find((x) => x.companyId === co && x.id === serviceId)?.name || ''
    return {
      id: typeof raw.id === 'string' && raw.id.startsWith(invoiceId) ? raw.id : lineId(invoiceId),
      description: name,
      serviceId,
      quantity,
      unitPrice: round2(unitPrice),
      discount: m.discount,
      taxCodeId: tax!.id,
      net: m.net,
      taxAmount: m.taxAmount,
      total: m.total,
      revenueAccountId,
    }
  })
}

export function applyTotals(inv: InvoiceRecord): void {
  const t = totalsOf(inv.lines.map((l) => ({ gross: round2(l.quantity * l.unitPrice), discount: l.discount, net: l.net, taxAmount: l.taxAmount, total: l.total })))
  inv.subtotal = t.subtotal
  inv.discountTotal = t.discountTotal
  inv.taxTotal = t.taxTotal
  inv.total = t.total
  inv.balanceDue = round2(t.total - inv.amountPaid - inv.amountCredited)
}

/** KSA: B2B (buyer VAT number) → standard tax invoice; otherwise simplified. UAE: always a tax invoice. */
export const kindFor = (co: string, customerVatNumber: string): InvoiceRecord['kind'] =>
  invoiceSettingsFor(co).country === 'SA' && !customerVatNumber.trim() ? 'simplified' : 'tax_invoice'

export function rateOrDefault(co: string, currency: string, rate: unknown, date?: string | null): number {
  const base = invoiceSettingsFor(co).baseCurrency
  if (currency === base) return 1
  if (rate !== undefined && rate !== null && rate !== '') {
    const n = Number(rate)
    if (!Number.isFinite(n) || n <= 0 || n > 100_000) bad('The exchange rate must be greater than 0.', 'invalid_rate')
    return Math.round(n * 1_000_000) / 1_000_000
  }
  const d = defaultRateFor(co, currency, date)
  if (!d) bad(`Enter the exchange rate from ${currency} to ${base}.`, 'rate_required')
  return d!
}

/* ---------------- journal ---------------- */

function balanceWithRounding(co: string, lines: JournalLine[], description: string): JournalLine[] {
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  const diff = round2(dr - cr)
  if (diff === 0) return lines
  const acc = systemAccount(co, 'rounding')
  return [...lines, diff > 0 ? { accountId: acc, debit: 0, credit: diff, description } : { accountId: acc, debit: -diff, credit: 0, description }]
}

/** The issue entry's lines (base currency). */
export function issueLines(co: string, inv: InvoiceRecord): JournalLine[] {
  const r = inv.exchangeRate
  const dims = { customerId: inv.customerId, projectId: inv.projectId, eventId: inv.eventId }
  const byAccount = new Map<string, number>()
  for (const l of inv.lines) byAccount.set(l.revenueAccountId, round2((byAccount.get(l.revenueAccountId) ?? 0) + l.quantity * l.unitPrice))
  const lines: JournalLine[] = [{ accountId: systemAccount(co, 'accounts_receivable'), debit: toBase(inv.total, r), credit: 0, description: 'Accounts receivable', ...dims }]
  if (inv.discountTotal > 0) lines.push({ accountId: systemAccount(co, 'sales_discounts'), debit: toBase(inv.discountTotal, r), credit: 0, description: 'Discounts', ...dims })
  for (const [acc, gross] of byAccount) lines.push({ accountId: acc, debit: 0, credit: toBase(round2(gross), r), description: 'Revenue', ...dims })
  if (inv.taxTotal > 0) lines.push({ accountId: systemAccount(co, 'vat_output'), debit: 0, credit: toBase(inv.taxTotal, r), description: 'VAT output', ...dims, taxCode: inv.lines.find((l) => l.taxAmount > 0)?.taxCodeId ?? null })
  return balanceWithRounding(co, lines, 'Currency rounding')
}

export function creditLines(co: string, inv: InvoiceRecord, cn: Pick<CreditNoteRecord, 'lines' | 'taxTotal' | 'appliedAmount' | 'excessAmount' | 'exchangeRate'>): JournalLine[] {
  const r = cn.exchangeRate
  const dims = { customerId: inv.customerId, projectId: inv.projectId, eventId: inv.eventId }
  const byAccount = new Map<string, number>()
  for (const l of cn.lines) byAccount.set(l.revenueAccountId, round2((byAccount.get(l.revenueAccountId) ?? 0) + l.net))
  const lines: JournalLine[] = []
  for (const [acc, net] of byAccount) lines.push({ accountId: acc, debit: toBase(net, r), credit: 0, description: 'Revenue credited', ...dims })
  if (cn.taxTotal > 0) lines.push({ accountId: systemAccount(co, 'vat_output'), debit: toBase(cn.taxTotal, r), credit: 0, description: 'VAT output credited', ...dims })
  if (cn.appliedAmount > 0) lines.push({ accountId: systemAccount(co, 'accounts_receivable'), debit: 0, credit: toBase(cn.appliedAmount, r), description: 'Accounts receivable', ...dims })
  if (cn.excessAmount > 0) lines.push({ accountId: systemAccount(co, 'customer_advances'), debit: 0, credit: toBase(cn.excessAmount, r), description: 'Customer credit', ...dims })
  return balanceWithRounding(co, lines, 'Currency rounding')
}

/* ---------------- ZATCA ---------------- */

const isKsa = (co: string) => invoiceSettingsFor(co).country === 'SA'

function sellerParty(co: string): UblParty {
  const s = invoiceSettingsFor(co)
  return { name: s.legalName, vatNumber: s.vatNumber, crn: s.commercialRegistration || undefined, ...s.address }
}

function buyerParty(co: string, customerId: string, vatNumber: string): UblParty {
  const c = customers.find((x) => x.companyId === co && x.id === customerId)
  const s = invoiceSettingsFor(co)
  return {
    name: c?.name ?? 'Customer',
    vatNumber,
    street: c?.address || '-',
    buildingNumber: '0000',
    district: '-',
    city: s.address.city || '-',
    postalZone: '00000',
    region: '-',
    country: s.country,
  }
}

const TAX_CAT: Record<TaxCode['category'], UblLine['taxCategory']> = { standard: 'S', zero_rated: 'Z', exempt: 'E', out_of_scope: 'O' }

function ublOf(co: string, d: {
  number: string
  stamp: Pick<ZatcaStamp, 'uuid' | 'icv' | 'pih' | 'typeCode' | 'subtype' | 'timestamp'>
  currency: string
  exchangeRate: number
  customerId: string
  customerVatNumber: string
  date: string
  lines: UblLine[]
  allowance: number
  taxTotal: number
  total: number
  billingReference?: string
  reason?: string
}): UblDocument {
  const s = invoiceSettingsFor(co)
  const lineExtension = round2(d.lines.reduce((x, l) => x + l.net, 0))
  return {
    number: d.number,
    uuid: d.stamp.uuid,
    issueDate: d.date,
    issueTime: d.stamp.timestamp.slice(11, 19),
    typeCode: d.stamp.typeCode,
    subtype: d.stamp.subtype,
    currency: d.currency,
    taxCurrency: s.baseCurrency,
    taxTotalInTaxCurrency: toBase(d.taxTotal, d.exchangeRate),
    icv: d.stamp.icv,
    pih: d.stamp.pih,
    seller: sellerParty(co),
    buyer: d.stamp.subtype === '0100000' || d.customerVatNumber ? buyerParty(co, d.customerId, d.customerVatNumber) : null,
    deliveryDate: d.date,
    billingReference: d.billingReference,
    reason: d.reason,
    paymentMeansCode: '30',
    lines: d.lines,
    lineExtension,
    allowanceTotal: 0,
    taxExclusive: lineExtension,
    taxTotal: d.taxTotal,
    taxInclusive: d.total,
    payable: d.total,
  }
}

function invoiceUblLines(co: string, lines: InvoiceLine[]): UblLine[] {
  return lines.map((l, i) => {
    const t = taxCodeOf(co, l.taxCodeId)
    return { id: String(i + 1), name: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, net: l.net, taxAmount: l.taxAmount, taxCategory: TAX_CAT[t?.category ?? 'standard'], taxPercent: t?.rate ?? 0 }
  })
}

function creditUblLines(co: string, lines: CreditNoteLine[]): UblLine[] {
  return lines.map((l, i) => {
    const t = taxCodeOf(co, l.taxCodeId)
    return { id: String(i + 1), name: l.description, quantity: 1, unitPrice: l.net, discount: 0, net: l.net, taxAmount: l.taxAmount, taxCategory: TAX_CAT[t?.category ?? 'standard'], taxPercent: l.taxRate }
  })
}

/** The UBL document of an issued invoice / credit note (with or without the QR). */
export function ublForInvoice(inv: InvoiceRecord, withQr: boolean): UblDocument | null {
  if (!inv.zatca) return null
  const doc = ublOf(inv.companyId, {
    number: inv.number, stamp: inv.zatca, currency: inv.currency, exchangeRate: inv.exchangeRate, customerId: inv.customerId, customerVatNumber: inv.customerVatNumber,
    date: inv.issueDate!, lines: invoiceUblLines(inv.companyId, inv.lines), allowance: inv.discountTotal, taxTotal: inv.taxTotal, total: inv.total,
  })
  return withQr ? { ...doc, qr: inv.zatca.qr } : doc
}

export function ublForCreditNote(cn: Tenant<CreditNoteRecord>, inv: InvoiceRecord, withQr: boolean): UblDocument | null {
  if (!cn.zatca) return null
  const doc = ublOf(cn.companyId, {
    number: cn.number, stamp: cn.zatca, currency: cn.currency, exchangeRate: cn.exchangeRate, customerId: cn.customerId, customerVatNumber: inv.customerVatNumber,
    date: cn.date, lines: creditUblLines(cn.companyId, cn.lines), allowance: 0, taxTotal: cn.taxTotal, total: cn.total, billingReference: inv.number, reason: cn.reason,
  })
  return withQr ? { ...doc, qr: cn.zatca.qr } : doc
}

/** Next link of the company's chain: ICV + 1, PIH = the previous hash (the spec's seed for the first). */
function stampFor(co: string, seed: string, build: (s: Omit<ZatcaStamp, 'invoiceHash' | 'qr' | 'status'>) => UblDocument, typeCode: '388' | '381', subtype: ZatcaStamp['subtype'], at: string, total: number, vat: number): ZatcaStamp {
  const chain = financeZatcaChain[co] ?? { icv: 0, lastHash: INITIAL_PIH }
  const base = { uuid: uuidFrom(`${co}:${seed}`), icv: chain.icv + 1, pih: chain.lastHash, typeCode, subtype, timestamp: at.replace(/\.\d{3}Z$/, 'Z') }
  const hash = invoiceHash(build(base))
  const s = invoiceSettingsFor(co)
  const qr = qrPayload({ sellerName: s.legalName, vatNumber: s.vatNumber, timestamp: base.timestamp, total: money(total), vatTotal: money(vat) })
  financeZatcaChain[co] = { icv: base.icv, lastHash: hash }
  return { ...base, invoiceHash: hash, qr, status: 'not_submitted' }
}

export const zatcaXml = (doc: UblDocument): string => buildUblXml(doc)

/* ---------------- issue / void / credit ---------------- */

/**
 * Issues a draft: number (frozen), kind, dates, the journal entry (base currency) and, for KSA, the ZATCA
 * stamp. The entry is posted BEFORE the number is taken, so a refused post (e.g. 423 period_locked) consumes nothing.
 */
export function issueCore(inv: InvoiceRecord, by: Actor, at: Date): InvoiceRecord {
  if (inv.status !== 'draft') conflict('Only a draft can be issued.', 'not_draft')
  const co = inv.companyId
  if (inv.lines.length === 0) bad('Add at least one line before issuing.', 'no_lines')
  applyTotals(inv)
  if (inv.total <= 0) bad('The invoice total must be greater than 0.', 'zero_total')
  const s = invoiceSettingsFor(co)
  const today = companyToday(co, at)
  const issueDate = inv.issueDate ?? today
  if (issueDate > today) bad('The issue date can’t be in the future.', 'future_date')
  const dueDate = inv.dueDate ?? addDaysIso(issueDate, inv.paymentTermsDays)
  if (dueDate < issueDate) bad('The due date can’t be before the issue date.', 'invalid_due_date')
  inv.issueDate = issueDate
  inv.kind = kindFor(co, inv.customerVatNumber)
  const customer = customers.find((c) => c.companyId === co && c.id === inv.customerId)
  const entry = postJournal(co, { date: issueDate, memo: `Invoice to ${customer?.name ?? inv.customerId}`, sourceType: 'invoice', sourceId: inv.id, lines: issueLines(co, inv), createdBy: by.id })
  const iso = at.toISOString()
  inv.number = docNumber(co, s.prefix, 'INV', issueDate.slice(0, 4))
  entry.memo = `Invoice ${inv.number} · ${customer?.name ?? inv.customerId}`
  inv.dueDate = dueDate
  inv.status = 'issued'
  inv.journalEntryId = entry.id
  inv.issuedAt = iso
  inv.amountPaid = 0
  inv.amountCredited = 0
  inv.balanceDue = inv.total
  inv.updatedAt = iso
  if (isKsa(co)) {
    const subtype = inv.kind === 'simplified' ? '0200000' : '0100000'
    inv.zatca = stampFor(co, inv.id, (st) => ublOf(co, {
      number: inv.number, stamp: st, currency: inv.currency, exchangeRate: inv.exchangeRate, customerId: inv.customerId, customerVatNumber: inv.customerVatNumber,
      date: issueDate, lines: invoiceUblLines(co, inv.lines), allowance: inv.discountTotal, taxTotal: inv.taxTotal, total: inv.total,
    }), '388', subtype, iso, inv.total, inv.taxTotal)
  }
  inv.history.push(historyEntry(by, 'issued', `Issued ${inv.number} (journal ${entry.number})`, iso))
  return inv
}

export function voidCore(inv: InvoiceRecord, by: Actor, reason: string, at: Date): InvoiceRecord {
  if (inv.status === 'draft') conflict('A draft isn’t posted: delete it instead.', 'is_draft')
  if (inv.status === 'void') conflict('This invoice is already void.', 'already_void')
  if (inv.amountPaid > 0 || inv.amountCredited > 0 || financeCreditNotes.some((c) => c.companyId === inv.companyId && c.invoiceId === inv.id)) {
    conflict('An invoice with payments or credit notes can’t be voided. Issue a credit note instead.', 'has_settlements')
  }
  const iso = at.toISOString()
  const today = companyToday(inv.companyId, at)
  if (inv.journalEntryId) {
    const rev = reverseJournal(inv.companyId, inv.journalEntryId, today, `Void of invoice ${inv.number}: ${reason}`, by.id)
    inv.voidJournalEntryId = rev.id
  }
  inv.status = 'void'
  inv.balanceDue = 0
  inv.voidedAt = iso
  inv.voidReason = reason
  inv.updatedAt = iso
  inv.history.push(historyEntry(by, 'voided', `Voided: ${reason}`, iso))
  return inv
}

/** Net still creditable per line (line net − credited net on earlier credit notes). */
export function creditableOf(inv: InvoiceRecord): Record<string, number> {
  const used = new Map<string, number>()
  for (const cn of financeCreditNotes) {
    if (cn.companyId !== inv.companyId || cn.invoiceId !== inv.id) continue
    for (const l of cn.lines) used.set(l.invoiceLineId, round2((used.get(l.invoiceLineId) ?? 0) + l.net))
  }
  return Object.fromEntries(inv.lines.map((l) => [l.id, round2(Math.max(0, l.net - (used.get(l.id) ?? 0)))]))
}

export function creditCore(inv: InvoiceRecord, input: { reason: string; date: string; full: boolean; lines: { invoiceLineId: string; amount: number }[] }, by: Actor, at: Date): Tenant<CreditNoteRecord> {
  const co = inv.companyId
  if (inv.status === 'draft' || inv.status === 'void') conflict('Credit notes are for issued invoices.', 'not_issued')
  const creditable = creditableOf(inv)
  const wanted = input.full
    ? inv.lines.map((l) => ({ invoiceLineId: l.id, amount: creditable[l.id] })).filter((x) => x.amount > 0)
    : input.lines
  if (wanted.length === 0) bad('Choose what to credit.', 'nothing_to_credit')
  const lines: CreditNoteLine[] = wanted.map((w) => {
    const l = inv.lines.find((x) => x.id === w.invoiceLineId)
    if (!l) bad('Line not found on this invoice.', 'invalid_line')
    const amount = round2(Number(w.amount))
    if (!Number.isFinite(amount) || amount <= 0) bad('Credit amounts must be greater than 0.')
    if (amount > creditable[l!.id]) bad(`At most ${money(creditable[l!.id])} ${inv.currency} of “${l!.description}” can still be credited.`, 'exceeds_line')
    const t = taxCodeOf(co, l!.taxCodeId)
    // Full remaining amount of a line: credit its exact remaining VAT so a full credit nets to zero.
    const taxAmount = amount === l!.net ? l!.taxAmount : round2((amount * (t?.rate ?? 0)) / 100)
    return { invoiceLineId: l!.id, description: l!.description, taxCodeId: l!.taxCodeId, taxRate: t?.rate ?? 0, net: amount, taxAmount, total: round2(amount + taxAmount), revenueAccountId: l!.revenueAccountId }
  })
  const subtotal = round2(lines.reduce((s, l) => s + l.net, 0))
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0))
  const total = round2(subtotal + taxTotal)
  const appliedAmount = round2(Math.min(total, Math.max(inv.balanceDue, 0)))
  const excessAmount = round2(total - appliedAmount)
  const id = nextId('creditNote', 'CN')
  const iso = at.toISOString()
  const draft = { lines, taxTotal, appliedAmount, excessAmount, exchangeRate: inv.exchangeRate }
  const entry = postJournal(co, { date: input.date, memo: `Credit note for invoice ${inv.number}: ${input.reason}`, sourceType: 'credit_note', sourceId: id, lines: creditLines(co, inv, draft), createdBy: by.id })
  const s = invoiceSettingsFor(co)
  const cn: Tenant<CreditNoteRecord> = {
    companyId: co,
    id,
    number: docNumber(co, s.prefix, 'CN', input.date.slice(0, 4)),
    invoiceId: inv.id,
    customerId: inv.customerId,
    date: input.date,
    reason: input.reason,
    currency: inv.currency,
    exchangeRate: inv.exchangeRate,
    lines,
    subtotal,
    taxTotal,
    total,
    appliedAmount,
    excessAmount,
    journalEntryId: entry.id,
    zatca: null,
    createdBy: by.id ?? 'system',
    createdAt: iso,
  }
  entry.memo = `Credit note ${cn.number} for invoice ${inv.number}: ${input.reason}`
  if (isKsa(co)) {
    cn.zatca = stampFor(co, cn.id, (st) => ublOf(co, {
      number: cn.number, stamp: st, currency: cn.currency, exchangeRate: cn.exchangeRate, customerId: cn.customerId, customerVatNumber: inv.customerVatNumber,
      date: cn.date, lines: creditUblLines(co, lines), allowance: 0, taxTotal, total, billingReference: inv.number, reason: cn.reason,
    }), '381', inv.kind === 'simplified' ? '0200000' : '0100000', iso, total, taxTotal)
  }
  financeCreditNotes.push(cn)
  if (appliedAmount > 0) applyToInvoice(inv, { credited: appliedAmount }, iso)
  inv.history.push(historyEntry(by, 'credited', `Credit note ${cn.number}: ${money(total)} ${inv.currency}${excessAmount > 0 ? ` (${money(excessAmount)} as customer credit)` : ''}`, iso))
  return cn
}

/* ---------------- new invoice rows ---------------- */

export function newInvoiceRecord(co: string, fields: {
  id?: string
  customerId: string
  customerVatNumber: string
  currency: string
  exchangeRate: number
  paymentTermsDays: number
  issueDate: string | null
  dueDate: string | null
  notes: string
  terms: string
  quotationId?: string | null
  contractId?: string | null
  leadId?: string | null
  projectId?: string | null
  eventId?: string | null
  recurringId?: string | null
  billingPct?: number | null
  milestone?: string
  lines: InvoiceLineInput[] | InvoiceLine[]
  createdBy: Actor
  at: string
}): InvoiceRecord {
  const id = fields.id ?? nextId('invoice', 'INV')
  const inv: InvoiceRecord = {
    companyId: co,
    id,
    number: 'Draft',
    kind: kindFor(co, fields.customerVatNumber),
    status: 'draft',
    customerId: fields.customerId,
    quotationId: fields.quotationId ?? null,
    contractId: fields.contractId ?? null,
    leadId: fields.leadId ?? null,
    projectId: fields.projectId ?? null,
    eventId: fields.eventId ?? null,
    recurringId: fields.recurringId ?? null,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    currency: fields.currency,
    exchangeRate: fields.exchangeRate,
    lines: [],
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    total: 0,
    amountPaid: 0,
    amountCredited: 0,
    balanceDue: 0,
    notes: fields.notes,
    terms: fields.terms,
    journalEntryId: null,
    createdBy: fields.createdBy.id ?? 'system',
    createdAt: fields.at,
    updatedAt: fields.at,
    issuedAt: null,
    voidedAt: null,
    voidReason: null,
    customerVatNumber: fields.customerVatNumber,
    paymentTermsDays: fields.paymentTermsDays,
    billingPct: fields.billingPct ?? null,
    milestone: fields.milestone ?? '',
    sendLog: [],
    history: [],
    zatca: null,
    voidJournalEntryId: null,
  }
  inv.lines = buildLines(co, id, fields.lines, { eventId: inv.eventId })
  applyTotals(inv)
  inv.history.push(historyEntry(fields.createdBy, fields.recurringId ? 'generated' : 'created', fields.recurringId ? `Generated by recurring schedule ${fields.recurringId}` : 'Draft created', fields.at))
  invoiceRecords.push(inv)
  return inv
}

/* ---------------- recurring ---------------- */

export const FINANCE_ALERT_TYPE = 'finance'
export const invoicePathOf = (id: string) => `/finance/invoices/${encodeURIComponent(id)}`

/** Active users of the company with accounting FULL (Company Admin, Management, Accountant). */
export function accountingUsers(co: string) {
  return users.filter((u) => u.companyId === co && u.active && scopeOf(u.role, 'accounting') === 'full')
}

/**
 * Generates every period due up to the company's today at `until` (company timezone), once per period:
 * a period is generated only when nextDate ≤ today, and nextDate then moves on, so re-running is a no-op.
 * auto_issue issues the invoice (a refused post leaves it a draft and records `lastError`).
 * The accountants get one stored "finance" notification per generated invoice.
 */
export function runRecurring(co: string, until: number): number {
  const at = new Date(until)
  const today = companyToday(co, at)
  let made = 0
  for (const r of financeRecurring) {
    if (r.companyId !== co || r.status !== 'active') continue
    for (let guard = 0; guard < 60 && r.nextDate && r.nextDate <= today; guard++) {
      const period = r.nextDate
      if (r.endDate && period > r.endDate) {
        r.status = 'ended'
        r.nextDate = null
        break
      }
      if (!r.generated.some((g) => g.period === period)) {
        const iso = at.toISOString()
        try {
          const inv = newInvoiceRecord(co, {
            customerId: r.customerId,
            customerVatNumber: r.template.customerVatNumber,
            currency: r.template.currency,
            exchangeRate: rateOrDefault(co, r.template.currency, undefined, period),
            paymentTermsDays: r.template.paymentTermsDays,
            issueDate: period,
            dueDate: null,
            notes: r.template.notes,
            terms: r.template.terms,
            contractId: r.contractId,
            projectId: r.template.projectId,
            recurringId: r.id,
            lines: r.template.lines,
            createdBy: SYSTEM,
            at: iso,
          })
          r.lastError = null
          if (r.mode === 'auto_issue') {
            try {
              issueCore(inv, SYSTEM, at)
            } catch (e) {
              r.lastError = `Generated ${period} as a draft: ${(e as Error).message}`
            }
          }
          r.generated.push({ period, invoiceId: inv.id, at: iso })
          made++
          const customer = customers.find((c) => c.companyId === co && c.id === r.customerId)
          const what = inv.status === 'draft' ? 'Draft invoice' : `Invoice ${inv.number}`
          for (const u of accountingUsers(co)) {
            pushNotification({ userId: u.id, companyId: co, type: FINANCE_ALERT_TYPE, title: `Recurring invoice generated`, body: `${what} for ${customer?.name ?? r.customerId} · period ${period}`, link: invoicePathOf(inv.id), at: iso })
          }
          recordSystemAudit(co, { action: 'create', entity: 'invoice', entityId: inv.id, summary: `Recurring schedule ${r.id} generated ${what.toLowerCase()} for period ${period}`, at: iso })
        } catch (e) {
          r.lastError = `Period ${period}: ${(e as Error).message}`
          break
        }
      }
      r.periodIndex += 1
      const next = periodDate(r.startDate, r.frequency, r.periodIndex)
      r.nextDate = r.endDate && next > r.endDate ? null : next
      if (!r.nextDate) r.status = 'ended'
      r.updatedAt = at.toISOString()
    }
  }
  return made
}

/** Journal entry lookup for views. */
export const journalById = (co: string, id: string | null) => (id ? financeJournal.find((e) => e.companyId === co && e.id === id) : undefined)
export const accountById = (co: string, id: string) => financeAccounts.find((a) => a.companyId === co && a.id === id)
export const invoiceById = (co: string, id: string) => invoiceRecords.find((i) => i.companyId === co && i.id === id)
