import type { User } from '@/shared/types'
import type {
  CreditNote,
  CreditNoteInput,
  InvoiceDetail,
  InvoiceFromSourceInput,
  InvoiceInput,
  InvoiceJournal,
  InvoiceListQuery,
  InvoiceMeta,
  InvoiceRow,
  InvoiceSources,
  RecurringFrequency,
  RecurringInput,
  RecurringMode,
  RecurringSchedule,
  RecurringStatus,
  RecurringUpdate,
  SendInput,
  XmlFile,
} from '@/modules/finance/invoices/types'
import { daysBetween, isIsoDay, lineMath, periodDate, round2, toBase, totalsOf } from '@/modules/finance/invoices/calc'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { now as clockNow, nowIso } from '@/shared/mocks/clock'
import { contacts, customers, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { services } from '@/shared/mocks/data/services'
import { projects, pushNotification } from '@/shared/mocks/data/tasks'
import { events } from '@/shared/mocks/data/events'
import { financeAccounts, financeTaxCodes } from '@/shared/mocks/data/finance'
import { financeCreditNotes, financeRecurring, invoiceRecords, type CreditNoteRecord, type InvoiceRecord, type RecurringRecord } from '@/shared/mocks/data/financeInvoices'
import '@/shared/mocks/data/financeInvoicesSeed'
import { recordAudit } from '@/shared/mocks/data/audit'
import { delay } from '@/shared/mocks/server'
import { NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { companyModules, onLifecycleTick } from './billing'
import { isOverdue } from './financeInvoiceBalance'
import { nextId, runFinanceHooks } from './ledger'
import { registerJournalSource } from './financeLedger'
import {
  FINANCE_ALERT_TYPE,
  accountById,
  applyTotals,
  bad,
  buildLines,
  companyToday,
  conflict,
  creditCore,
  creditableOf,
  historyEntry,
  invoiceById,
  invoicePathOf,
  issueCore,
  journalById,
  kindFor,
  newInvoiceRecord,
  rateOrDefault,
  runRecurring,
  standardCode,
  taxCodeOf,
  ublForCreditNote,
  ublForInvoice,
  voidCore,
  zatcaXml,
  type Actor,
} from './financeInvoiceCore'
import { invoicedPctOfContract, invoicedPctOfQuotation, linesFromContract, linesFromQuotation, quotationNet } from './financeInvoiceSources'
import { invoiceSettingsFor, defaultRateFor, revenueAccountFor } from './financeInvoiceSettings'

/**
 * Accounts & finance › Invoices, credit notes, recurring invoices, ZATCA data (docs/API.md › Finance).
 * PERMISSION_MATRIX `accounting`: full (Company Admin, Management, Accountant) reads and writes; view (Sales
 * Manager) reads every invoice of the company, no writes; hidden → 403. Plan module `accounting` (the /finance
 * path gate). The company comes from the session; a foreign id answers 404 like a missing one; ids in bodies
 * (customer, quotation, contract, invoice, project, event, service) are looked up in the caller's company only.
 */

export const FINANCE_FORBIDDEN = 'Accounts & finance is for the finance team. Ask your Company Admin for access.'
export const FINANCE_WRITE_ONLY = 'Only a Company Admin, Management or an Accountant can change invoices.'

type Access = 'full' | 'view'
export function financeAccessOf(user: User): Access {
  const s = scopeOf(user.role, 'accounting')
  if (s === 'hidden') throw new ApiError(FINANCE_FORBIDDEN, 403)
  runFinanceHooks(tenantOf(user))
  return s === 'full' ? 'full' : 'view'
}
function assertWrite(user: User): void {
  if (financeAccessOf(user) !== 'full') throw new ApiError(FINANCE_WRITE_ONLY, 403)
}
const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
const actor = (u: User): Actor => ({ id: u.id, name: u.name })
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const nameOf = (co: string, id: string | null) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'System') : 'System')
const customerOf = (co: string, id: unknown) => (typeof id === 'string' ? customers.find((c) => c.companyId === co && c.id === id) : undefined)
const customerName = (co: string, id: string) => customerOf(co, id)?.name ?? 'Unknown customer'

function ownInvoice(user: User, id: string): InvoiceRecord {
  financeAccessOf(user)
  return invoiceById(tenantOf(user), id) ?? notFound()
}

/** The email the invoice is sent to: the customer's decision maker (or first contact with an email). */
function customerEmail(co: string, customerId: string): string {
  const c = customerOf(co, customerId)
  if (!c) return ''
  const list = contacts.filter((x) => x.companyId === co && (x.customerId === c.id || x.leadId === c.leadId) && x.email)
  return (list.find((x) => x.isDecisionMaker) ?? list[0])?.email ?? ''
}

/** Last VAT number used for the customer on an invoice (customers have no VAT field yet: gap F-I2). */
function lastVatOf(co: string, customerId: string): string {
  const mine = invoiceRecords.filter((i) => i.companyId === co && i.customerId === customerId && i.customerVatNumber)
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.customerVatNumber ?? ''
}

/* ---------------- views ---------------- */

function rowView(inv: InvoiceRecord, today: string): InvoiceRow {
  const overdue = isOverdue(inv, today)
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    overdue,
    daysOverdue: overdue && inv.dueDate ? daysBetween(inv.dueDate, today) : 0,
    customerId: inv.customerId,
    customerName: customerName(inv.companyId, inv.customerId),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    exchangeRate: inv.exchangeRate,
    total: inv.total,
    taxTotal: inv.taxTotal,
    amountPaid: inv.amountPaid,
    amountCredited: inv.amountCredited,
    balanceDue: inv.balanceDue,
    baseTotal: toBase(inv.total, inv.exchangeRate),
    baseBalanceDue: toBase(inv.balanceDue, inv.exchangeRate),
    quotationId: inv.quotationId,
    contractId: inv.contractId,
    recurringId: inv.recurringId,
    milestone: inv.milestone,
    createdAt: inv.createdAt,
  }
}

function journalView(co: string, id: string | null): InvoiceJournal | null {
  const e = journalById(co, id)
  if (!e) return null
  return {
    id: e.id,
    number: e.number,
    date: e.date,
    status: e.status,
    memo: e.memo,
    lines: e.lines.map((l) => {
      const a = accountById(co, l.accountId)
      return { accountId: l.accountId, accountCode: a?.code ?? '', accountName: a?.name ?? l.accountId, debit: l.debit, credit: l.credit, description: l.description }
    }),
  }
}

function detailView(user: User, inv: InvoiceRecord): InvoiceDetail {
  const co = inv.companyId
  const s = invoiceSettingsFor(co)
  const today = companyToday(co, clockNow())
  const full = financeAccessOf(user) === 'full'
  const { companyId: _c, sendLog, history, zatca, voidJournalEntryId, customerVatNumber, paymentTermsDays, billingPct, milestone, ...base } = inv // eslint-disable-line @typescript-eslint/no-unused-vars
  const cns = financeCreditNotes.filter((c) => c.companyId === co && c.invoiceId === inv.id)
  const taxes = new Map<string, { net: number; tax: number }>()
  for (const l of inv.lines) {
    const t = taxes.get(l.taxCodeId) ?? { net: 0, tax: 0 }
    taxes.set(l.taxCodeId, { net: round2(t.net + l.net), tax: round2(t.tax + l.taxAmount) })
  }
  const customer = customerOf(co, inv.customerId)
  const ksa = s.country === 'SA'
  const simplified = inv.kind === 'simplified'
  const open = inv.status === 'issued' || inv.status === 'partially_paid' || inv.status === 'paid'
  const q = inv.quotationId ? quotations.find((x) => x.companyId === co && x.id === inv.quotationId) : undefined
  const c = inv.contractId ? contracts.find((x) => x.companyId === co && x.id === inv.contractId) : undefined
  const creditable = open ? creditableOf(inv) : {}
  return {
    ...base,
    lines: inv.lines.map((l) => ({ ...l })),
    customerName: customer?.name ?? 'Unknown customer',
    customerEmail: customerEmail(co, inv.customerId),
    customerAddress: customer?.address ?? '',
    customerVatNumber,
    paymentTermsDays,
    billingPct,
    milestone,
    overdue: isOverdue(inv, today),
    title: ksa && simplified ? 'Simplified Tax Invoice' : 'Tax Invoice',
    titleAr: ksa ? (simplified ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية') : '',
    baseSubtotal: toBase(round2(inv.subtotal - inv.discountTotal), inv.exchangeRate),
    baseTaxTotal: toBase(inv.taxTotal, inv.exchangeRate),
    baseTotal: toBase(inv.total, inv.exchangeRate),
    baseCurrency: s.baseCurrency,
    taxSummary: [...taxes.entries()].map(([id, v]) => {
      const t = taxCodeOf(co, id)
      return { taxCodeId: id, name: t?.name ?? id, rate: t?.rate ?? 0, category: t?.category ?? 'standard', net: v.net, tax: v.tax }
    }),
    quotationNumber: q?.number ?? null,
    contractTitle: c?.title ?? null,
    projectName: inv.projectId ? (projects.find((p) => p.companyId === co && p.id === inv.projectId)?.name ?? null) : null,
    eventName: inv.eventId ? (events.find((e) => e.companyId === co && e.id === inv.eventId)?.name ?? null) : null,
    createdByName: nameOf(co, inv.createdBy),
    seller: {
      legalName: s.legalName,
      legalNameAr: s.legalNameAr,
      vatNumber: s.vatNumber,
      taxLabel: s.taxLabel,
      addressLines: s.addressLines,
      commercialRegistration: s.commercialRegistration,
      country: s.country,
      baseCurrency: s.baseCurrency,
    },
    zatca: zatca ? { ...zatca } : null,
    sendLog: sendLog.map((x) => ({ ...x })),
    history: history.map((x) => ({ ...x })),
    creditNotes: cns.map((x) => ({ id: x.id, number: x.number, date: x.date, total: x.total, reason: x.reason })),
    creditable,
    journal: journalView(co, inv.journalEntryId),
    voidJournal: journalView(co, voidJournalEntryId),
    can: {
      edit: full && inv.status === 'draft',
      issue: full && inv.status === 'draft',
      void: full && (inv.status === 'issued') && inv.amountPaid === 0 && inv.amountCredited === 0 && cns.length === 0,
      credit: full && open && Object.values(creditable).some((v) => v > 0),
      send: full && open,
      xml: full && !!zatca,
    },
  }
}

/* ---------------- invoices ---------------- */

export async function listInvoices(user: User, q: InvoiceListQuery): Promise<InvoiceRow[]> {
  financeAccessOf(user)
  const co = tenantOf(user)
  const today = companyToday(co, clockNow())
  const text = (q.q ?? '').trim().toLowerCase()
  const rows = invoiceRecords
    .filter((i) => i.companyId === co)
    .map((i) => rowView(i, today))
    .filter((r) => {
      if (q.status === 'overdue') {
        if (!r.overdue) return false
      } else if (q.status === 'open') {
        if (r.status !== 'issued' && r.status !== 'partially_paid') return false
      } else if (q.status && r.status !== q.status) return false
      if (q.overdue && !r.overdue) return false
      if (q.customerId && r.customerId !== q.customerId) return false
      const d = r.issueDate ?? r.createdAt.slice(0, 10)
      if (q.from && d < q.from) return false
      if (q.to && d > q.to) return false
      if (text && !`${r.number} ${r.customerName} ${r.milestone}`.toLowerCase().includes(text)) return false
      return true
    })
    .sort((a, b) => (b.issueDate ?? '9999').localeCompare(a.issueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

export async function getInvoice(user: User, id: string): Promise<InvoiceDetail> {
  return delay(detailView(user, ownInvoice(user, id)))
}

interface DraftFields {
  customerId: string
  customerVatNumber: string
  currency: string
  exchangeRate: number
  paymentTermsDays: number
  issueDate: string | null
  dueDate: string | null
  notes: string
  terms: string
  projectId: string | null
  eventId: string | null
}

/** Validates the header of a draft (customer, currency, rate, dates, terms, project / event) in the caller's company. */
function draftFields(co: string, input: Partial<InvoiceInput> | null, prev?: InvoiceRecord): DraftFields {
  const s = invoiceSettingsFor(co)
  const i = input ?? {}
  const customerId = i.customerId !== undefined ? i.customerId : prev?.customerId
  const customer = customerOf(co, customerId)
  if (!customer) bad('Customer not found.', 'customer_not_found')
  const currency = i.currency !== undefined ? str(i.currency, 3).toUpperCase() : (prev?.currency ?? s.baseCurrency)
  if (!/^[A-Z]{3}$/.test(currency)) bad('Choose a currency (ISO code).', 'invalid_currency')
  const termsRaw = i.paymentTermsDays !== undefined && i.paymentTermsDays !== null ? Number(i.paymentTermsDays) : (prev?.paymentTermsDays ?? s.paymentTermsDays)
  if (!Number.isInteger(termsRaw) || termsRaw < 0 || termsRaw > 365) bad('Payment terms are 0 to 365 days.', 'invalid_terms')
  const date = (v: unknown, fallback: string | null, label: string) => {
    if (v === undefined) return fallback
    if (v === null || v === '') return null
    if (!isIsoDay(v)) bad(`${label} must be a date (yyyy-MM-dd).`, 'invalid_date')
    return v as string
  }
  const issueDate = date(i.issueDate, prev?.issueDate ?? null, 'The issue date')
  const dueDate = date(i.dueDate, prev?.dueDate ?? null, 'The due date')
  if (issueDate && dueDate && dueDate < issueDate) bad('The due date can’t be before the issue date.', 'invalid_due_date')
  const exchangeRate = rateOrDefault(co, currency, i.exchangeRate !== undefined ? i.exchangeRate : prev && prev.currency === currency ? prev.exchangeRate : undefined, issueDate ?? companyToday(co, clockNow()))
  const projectId = i.projectId !== undefined ? (i.projectId || null) : (prev?.projectId ?? null)
  if (projectId && !projects.some((p) => p.companyId === co && p.id === projectId)) bad('Project not found.', 'project_not_found')
  const eventId = i.eventId !== undefined ? (i.eventId || null) : (prev?.eventId ?? null)
  if (eventId && !events.some((e) => e.companyId === co && e.id === eventId)) bad('Event not found.', 'event_not_found')
  const vat = i.customerVatNumber !== undefined ? str(i.customerVatNumber, 20).replace(/\s+/g, '') : (prev?.customerVatNumber ?? lastVatOf(co, customer!.id))
  if (vat && !/^[0-9A-Za-z-]{5,20}$/.test(vat)) bad('The customer VAT number looks invalid.', 'invalid_vat_number')
  if (vat && s.country === 'SA' && !/^3\d{13}3$/.test(vat)) bad('A KSA VAT number has 15 digits and starts and ends with 3.', 'invalid_vat_number')
  return {
    customerId: customer!.id,
    customerVatNumber: vat,
    currency,
    exchangeRate,
    paymentTermsDays: termsRaw,
    issueDate,
    dueDate,
    notes: i.notes !== undefined ? str(i.notes) : (prev?.notes ?? s.invoiceNotes),
    terms: i.terms !== undefined ? str(i.terms) : (prev?.terms ?? (s.invoiceTerms || `Payment due within ${termsRaw} days by bank transfer.`)),
    projectId,
    eventId,
  }
}

export async function createInvoice(user: User, input: InvoiceInput | null): Promise<InvoiceDetail> {
  assertWrite(user)
  const co = tenantOf(user)
  const f = draftFields(co, input)
  const inv = newInvoiceRecord(co, { ...f, lines: input?.lines ?? [], createdBy: actor(user), at: nowIso() })
  recordAudit(user, { action: 'create', entity: 'invoice', entityId: inv.id, summary: `Created a draft invoice for ${customerName(co, inv.customerId)}` })
  return delay(detailView(user, inv))
}

export async function updateInvoice(user: User, id: string, input: Partial<InvoiceInput> | null): Promise<InvoiceDetail> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  if (inv.status !== 'draft') conflict('Issued invoices can’t be edited. Issue a credit note or void the invoice.', 'not_draft')
  const co = inv.companyId
  const f = draftFields(co, input, inv)
  const lines = input?.lines !== undefined ? buildLines(co, inv.id, input.lines, { eventId: f.eventId }) : inv.lines
  Object.assign(inv, f, { lines, kind: kindFor(co, f.customerVatNumber), updatedAt: nowIso() })
  applyTotals(inv)
  inv.history.push(historyEntry(actor(user), 'updated', 'Draft updated', inv.updatedAt))
  recordAudit(user, { action: 'update', entity: 'invoice', entityId: inv.id, summary: `Updated the draft invoice for ${customerName(co, inv.customerId)}` })
  return delay(detailView(user, inv))
}

export async function deleteInvoice(user: User, id: string): Promise<{ ok: true }> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  if (inv.status !== 'draft') conflict('Only drafts can be deleted. Void or credit an issued invoice.', 'not_draft')
  invoiceRecords.splice(invoiceRecords.indexOf(inv), 1)
  recordAudit(user, { action: 'delete', entity: 'invoice', entityId: inv.id, summary: `Deleted the draft invoice for ${customerName(inv.companyId, inv.customerId)}` })
  return delay({ ok: true as const })
}

export async function issueInvoice(user: User, id: string): Promise<InvoiceDetail> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  if (inv.status !== 'draft') conflict('Only a draft can be issued.', 'not_draft')
  if (!customerOf(inv.companyId, inv.customerId)) bad('Customer not found.', 'customer_not_found')
  issueCore(inv, actor(user), clockNow())
  recordAudit(user, { action: 'update', entity: 'invoice', entityId: inv.id, summary: `Issued invoice ${inv.number} (${inv.total.toFixed(2)} ${inv.currency})` })
  return delay(detailView(user, inv))
}

export async function voidInvoice(user: User, id: string, body: { reason?: unknown } | null): Promise<InvoiceDetail> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  const reason = str(body?.reason, 500)
  if (reason.length < 3) bad('Give a reason for voiding the invoice.', 'reason_required')
  voidCore(inv, actor(user), reason, clockNow())
  recordAudit(user, { action: 'update', entity: 'invoice', entityId: inv.id, summary: `Voided invoice ${inv.number}: ${reason}` })
  if (inv.createdBy !== user.id && users.some((u) => u.id === inv.createdBy && u.companyId === inv.companyId && u.active)) {
    pushNotification({ userId: inv.createdBy, companyId: inv.companyId, type: FINANCE_ALERT_TYPE, title: `Invoice ${inv.number} voided`, body: `${user.name}: ${reason}`, link: invoicePathOf(inv.id), at: inv.voidedAt ?? nowIso() })
  }
  return delay(detailView(user, inv))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function sendInvoice(user: User, id: string, body: SendInput | null): Promise<InvoiceDetail> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  if (inv.status === 'draft' || inv.status === 'void') conflict('Issue the invoice before sending it.', 'not_issued')
  const to = str(body?.to, 190) || customerEmail(inv.companyId, inv.customerId)
  if (!to) bad('The customer has no contact email. Enter one.', 'email_required')
  if (!EMAIL.test(to)) bad('Enter a valid email address.', 'invalid_email')
  const at = nowIso()
  const subject = `${inv.kind === 'simplified' ? 'Simplified tax invoice' : 'Tax invoice'} ${inv.number} from ${invoiceSettingsFor(inv.companyId).legalName}`
  inv.sendLog.push({ at, byName: user.name, to, subject })
  inv.history.push(historyEntry(actor(user), 'sent', `Emailed to ${to}`, at))
  inv.updatedAt = at
  recordAudit(user, { action: 'update', entity: 'invoice', entityId: inv.id, summary: `Emailed invoice ${inv.number} to ${to}` })
  return delay(detailView(user, inv))
}

function xmlFile(number: string, xml: string): XmlFile {
  return { filename: `${number}.xml`, mimeType: 'application/xml', content: xml }
}

export async function invoiceXml(user: User, id: string): Promise<XmlFile> {
  assertWrite(user)
  const inv = ownInvoice(user, id)
  const doc = ublForInvoice(inv, true)
  if (!doc) conflict('ZATCA XML exists for issued invoices of a KSA company only.', 'zatca_not_applicable')
  inv.history.push(historyEntry(actor(user), 'xml', 'Downloaded the ZATCA UBL XML', nowIso()))
  recordAudit(user, { action: 'security', entity: 'invoice', entityId: inv.id, summary: `Downloaded the ZATCA XML of invoice ${inv.number}` })
  return delay(xmlFile(inv.number, zatcaXml(doc!)))
}

/* ---------------- meta, sources, from-source ---------------- */

export async function invoiceMeta(user: User): Promise<InvoiceMeta> {
  const access = financeAccessOf(user)
  const co = tenantOf(user)
  const s = invoiceSettingsFor(co)
  const rates: Record<string, number> = {}
  for (const c of s.currencies) {
    const r = defaultRateFor(co, c, companyToday(co, clockNow()))
    if (r) rates[c] = r
  }
  return delay({
    country: s.country,
    baseCurrency: s.baseCurrency,
    zatcaEnabled: s.country === 'SA',
    vatNumber: s.vatNumber,
    paymentTermsDays: s.paymentTermsDays,
    defaultRevenueAccountId: revenueAccountFor(co, {}),
    serviceRevenueAccountId: revenueAccountFor(co, { serviceId: 'x' }),
    currencies: s.currencies,
    rates,
    taxCodes: financeTaxCodes.filter((t) => t.companyId === co && t.active).map((t) => ({ id: t.id, name: t.name, rate: t.rate, category: t.category })),
    standardTaxCodeId: standardCode(co).id,
    revenueAccounts: financeAccounts.filter((a) => a.companyId === co && a.type === 'income' && !a.isHeader && a.active).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    customers: customers.filter((c) => c.companyId === co).map((c) => ({ id: c.id, name: c.name, vatNumber: lastVatOf(co, c.id) })).sort((a, b) => a.name.localeCompare(b.name)),
    services: services.filter((x) => x.companyId === co && x.active).map((x) => ({ id: x.id, name: x.name, price: x.price, currency: x.currency, pricingType: x.pricingType })),
    projects: projects.filter((p) => p.companyId === co).map((p) => ({ id: p.id, name: p.name, customerId: p.customerId })),
    events: events.filter((e) => e.companyId === co).map((e) => ({ id: e.id, name: e.name })),
    canWrite: access === 'full',
  })
}

export async function invoiceSources(user: User): Promise<InvoiceSources> {
  financeAccessOf(user)
  const co = tenantOf(user)
  const custOfLead = (leadId: string) => customers.find((c) => c.companyId === co && c.leadId === leadId)
  return delay({
    quotations: quotations
      .filter((q) => q.companyId === co && q.status === 'accepted')
      .map((q) => {
        const cust = (q.customerId ? customerOf(co, q.customerId) : undefined) ?? custOfLead(q.leadId)
        return { id: q.id, number: q.number, title: q.title, customerId: cust?.id ?? null, customerName: cust?.name ?? q.company, leadId: q.leadId, currency: q.currency, netTotal: quotationNet(q), invoicedPct: invoicedPctOfQuotation(co, q.id) }
      }),
    contracts: contracts
      .filter((c) => c.companyId === co && c.status !== 'cancelled')
      .map((c) => ({ id: c.id, title: c.title, customerId: c.customerId, customerName: customerName(co, c.customerId), value: c.value, billing: c.billing, status: c.status, quotationId: c.quotationId ?? null, invoicedPct: invoicedPctOfContract(co, c) })),
  })
}

function percentOf(input: InvoiceFromSourceInput | null, remaining: number, what: string): number {
  if (remaining <= 0) conflict(`This ${what} is already fully invoiced.`, 'already_invoiced')
  const raw = input?.percent
  const pct = raw === undefined || raw === null || (raw as unknown) === '' ? remaining : round2(Number(raw))
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) bad('The share to invoice is 1 to 100%.', 'invalid_percent')
  if (pct > remaining + 0.001) bad(`Only ${remaining}% of this ${what} is left to invoice.`, 'exceeds_remaining', { remaining })
  return pct
}

export async function createFromSource(user: User, input: InvoiceFromSourceInput | null): Promise<InvoiceDetail> {
  assertWrite(user)
  const co = tenantOf(user)
  const milestone = str(input?.milestone, 120)
  let quotationId = typeof input?.quotationId === 'string' ? input.quotationId : null
  let contractId = typeof input?.contractId === 'string' ? input.contractId : null
  if (!quotationId && !contractId && typeof input?.leadId === 'string') {
    // A won deal: its accepted quotation with something left, else the contract the Won flow created.
    const leadId = input.leadId
    const cust = customers.find((c) => c.companyId === co && c.leadId === leadId)
    if (!cust) bad('Won deal not found.', 'lead_not_found')
    const q = quotations.find((x) => x.companyId === co && x.leadId === leadId && x.status === 'accepted' && invoicedPctOfQuotation(co, x.id) < 100)
    const c = contracts.filter((x) => x.companyId === co && x.customerId === cust!.id && x.status !== 'cancelled').find((x) => x.billing !== 'One-off' || invoicedPctOfContract(co, x) < 100)
    if (q) quotationId = q.id
    else if (c) contractId = c.id
    else conflict('Nothing is left to invoice for this deal.', 'already_invoiced')
  }
  if (!quotationId && !contractId) bad('Choose a quotation, contract or won deal.', 'source_required')
  const s = invoiceSettingsFor(co)
  let built: ReturnType<typeof linesFromQuotation>
  let customerId: string
  let leadId: string | null = null
  if (quotationId) {
    const q = quotations.find((x) => x.companyId === co && x.id === quotationId)
    if (!q) bad('Quotation not found.', 'quotation_not_found')
    if (q!.status !== 'accepted') conflict('Only an accepted quotation can be invoiced.', 'quotation_not_accepted')
    const cust = (q!.customerId ? customerOf(co, q!.customerId) : undefined) ?? customers.find((c) => c.companyId === co && c.leadId === q!.leadId)
    if (!cust) conflict('Win the deal first: the quotation has no customer yet.', 'no_customer')
    const pct = percentOf(input, round2(100 - invoicedPctOfQuotation(co, q!.id)), 'quotation')
    built = linesFromQuotation(co, q!, pct, milestone)
    customerId = cust!.id
    leadId = q!.leadId
    contractId = contracts.find((c) => c.companyId === co && c.quotationId === q!.id)?.id ?? null
  } else {
    const c = contracts.find((x) => x.companyId === co && x.id === contractId)
    if (!c) bad('Contract not found.', 'contract_not_found')
    if (c!.status === 'cancelled') conflict('A cancelled contract can’t be invoiced.', 'contract_cancelled')
    const q = c!.quotationId ? quotations.find((x) => x.companyId === co && x.id === c!.quotationId) : undefined
    const pct = c!.billing === 'One-off' ? percentOf(input, round2(100 - invoicedPctOfContract(co, c!)), 'contract') : 100
    built = linesFromContract(co, c!, pct, milestone, q)
    customerId = c!.customerId
    quotationId = c!.quotationId ?? null
    leadId = q?.leadId ?? customerOf(co, c!.customerId)?.leadId ?? null
  }
  const inv = newInvoiceRecord(co, {
    customerId,
    customerVatNumber: lastVatOf(co, customerId),
    currency: built.currency,
    exchangeRate: rateOrDefault(co, built.currency, undefined, companyToday(co, clockNow())),
    paymentTermsDays: s.paymentTermsDays,
    issueDate: null,
    dueDate: null,
    notes: s.invoiceNotes,
    terms: s.invoiceTerms || `Payment due within ${s.paymentTermsDays} days by bank transfer.`,
    quotationId,
    contractId,
    leadId,
    billingPct: built.billingPct,
    milestone: built.milestone,
    lines: built.lines,
    createdBy: actor(user),
    at: nowIso(),
  })
  recordAudit(user, { action: 'create', entity: 'invoice', entityId: inv.id, summary: `Created a draft invoice from ${quotationId ? `quotation ${quotations.find((q) => q.id === quotationId)?.number}` : `contract ${contractId}`}${built.billingPct && built.billingPct < 100 ? ` (${built.billingPct}%)` : ''}` })
  return delay(detailView(user, inv))
}

/* ---------------- credit notes ---------------- */

function creditView(cn: Tenant<CreditNoteRecord>): CreditNote {
  const { companyId: _c, createdBy, ...rest } = cn // eslint-disable-line @typescript-eslint/no-unused-vars
  const inv = invoiceById(cn.companyId, cn.invoiceId)
  return { ...rest, lines: cn.lines.map((l) => ({ ...l })), zatca: cn.zatca ? { ...cn.zatca } : null, invoiceNumber: inv?.number ?? '', customerName: customerName(cn.companyId, cn.customerId), createdByName: nameOf(cn.companyId, createdBy) }
}

export async function listCreditNotes(user: User, q: { invoiceId?: string | null }): Promise<CreditNote[]> {
  financeAccessOf(user)
  const co = tenantOf(user)
  return delay(financeCreditNotes.filter((c) => c.companyId === co && (!q.invoiceId || c.invoiceId === q.invoiceId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(creditView))
}

function ownCreditNote(user: User, id: string): Tenant<CreditNoteRecord> {
  financeAccessOf(user)
  return financeCreditNotes.find((c) => c.companyId === tenantOf(user) && c.id === id) ?? notFound()
}

export async function getCreditNote(user: User, id: string): Promise<CreditNote> {
  return delay(creditView(ownCreditNote(user, id)))
}

export async function createCreditNote(user: User, input: CreditNoteInput | null): Promise<CreditNote> {
  assertWrite(user)
  const co = tenantOf(user)
  const inv = typeof input?.invoiceId === 'string' ? invoiceById(co, input.invoiceId) : undefined
  if (!inv) bad('Invoice not found.', 'invoice_not_found')
  const reason = str(input?.reason, 500)
  if (reason.length < 3) bad('Give a reason for the credit note.', 'reason_required')
  const today = companyToday(co, clockNow())
  const date = input?.date ? String(input.date) : today
  if (!isIsoDay(date)) bad('The date must be yyyy-MM-dd.', 'invalid_date')
  if (date > today) bad('The credit note date can’t be in the future.', 'future_date')
  if (inv!.issueDate && date < inv!.issueDate) bad('The credit note can’t be dated before the invoice.', 'invalid_date')
  const lines = Array.isArray(input?.lines) ? input!.lines.map((l) => ({ invoiceLineId: String(l?.invoiceLineId ?? ''), amount: Number(l?.amount) })) : []
  const cn = creditCore(inv!, { reason, date, full: !!input?.full, lines }, actor(user), clockNow())
  recordAudit(user, { action: 'create', entity: 'credit_note', entityId: cn.id, summary: `Issued credit note ${cn.number} on invoice ${inv!.number} (${cn.total.toFixed(2)} ${cn.currency})${cn.excessAmount > 0 ? `; ${cn.excessAmount.toFixed(2)} as customer credit` : ''}` })
  return delay(creditView(cn))
}

export async function creditNoteXml(user: User, id: string): Promise<XmlFile> {
  assertWrite(user)
  const cn = ownCreditNote(user, id)
  const inv = invoiceById(cn.companyId, cn.invoiceId)
  const doc = inv ? ublForCreditNote(cn, inv, true) : null
  if (!doc) conflict('ZATCA XML exists for credit notes of a KSA company only.', 'zatca_not_applicable')
  recordAudit(user, { action: 'security', entity: 'credit_note', entityId: cn.id, summary: `Downloaded the ZATCA XML of credit note ${cn.number}` })
  return delay(xmlFile(cn.number, zatcaXml(doc!)))
}

/* ---------------- recurring ---------------- */

const FREQS: RecurringFrequency[] = ['monthly', 'quarterly', 'yearly']
const MODES: RecurringMode[] = ['draft', 'auto_issue']
const STATUSES: RecurringStatus[] = ['active', 'paused', 'ended']

function recurringView(r: Tenant<RecurringRecord>): RecurringSchedule {
  const { companyId: _c, createdBy, periodIndex: _p, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
  const amount = totalsOf(r.template.lines.map((l) => lineMath(l.quantity, l.unitPrice, l.discount ?? 0, taxCodeOf(r.companyId, l.taxCodeId ?? '')?.rate ?? 0))).total
  return { ...structuredClone(rest), customerName: customerName(r.companyId, r.customerId), amount, createdByName: nameOf(r.companyId, createdBy) }
}

function ownRecurring(user: User, id: string): Tenant<RecurringRecord> {
  financeAccessOf(user)
  return financeRecurring.find((r) => r.companyId === tenantOf(user) && r.id === id) ?? notFound()
}

export async function listRecurring(user: User): Promise<RecurringSchedule[]> {
  financeAccessOf(user)
  const co = tenantOf(user)
  return delay(financeRecurring.filter((r) => r.companyId === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(recurringView))
}

export async function getRecurring(user: User, id: string): Promise<RecurringSchedule> {
  return delay(recurringView(ownRecurring(user, id)))
}

export async function createRecurring(user: User, input: RecurringInput | null): Promise<RecurringSchedule> {
  assertWrite(user)
  const co = tenantOf(user)
  const s = invoiceSettingsFor(co)
  const today = companyToday(co, clockNow())
  let customerId: string
  let template: RecurringRecord['template']
  let sourceInvoiceId: string | null = null
  let contractId: string | null = null
  let frequency: RecurringFrequency = 'monthly'
  if (typeof input?.sourceInvoiceId === 'string') {
    const inv = invoiceById(co, input.sourceInvoiceId)
    if (!inv) bad('Invoice not found.', 'invoice_not_found')
    if (inv!.status === 'void') conflict('A void invoice can’t be a template.', 'invoice_void')
    sourceInvoiceId = inv!.id
    contractId = inv!.contractId
    customerId = inv!.customerId
    template = {
      currency: inv!.currency,
      customerVatNumber: inv!.customerVatNumber,
      paymentTermsDays: inv!.paymentTermsDays,
      lines: inv!.lines.map((l) => ({ description: l.description, serviceId: l.serviceId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxCodeId: l.taxCodeId, revenueAccountId: l.revenueAccountId })),
      notes: inv!.notes,
      terms: inv!.terms,
      projectId: inv!.projectId,
    }
  } else if (typeof input?.contractId === 'string') {
    const c = contracts.find((x) => x.companyId === co && x.id === input.contractId)
    if (!c) bad('Contract not found.', 'contract_not_found')
    if (c!.status === 'cancelled') conflict('A cancelled contract can’t be billed.', 'contract_cancelled')
    contractId = c!.id
    customerId = c!.customerId
    frequency = c!.billing === 'Annual' ? 'yearly' : 'monthly'
    const built = linesFromContract(co, c!, 100, '', undefined)
    template = { currency: built.currency, customerVatNumber: lastVatOf(co, c!.customerId), paymentTermsDays: s.paymentTermsDays, lines: built.lines, notes: '', terms: `Payment due within ${s.paymentTermsDays} days by bank transfer.`, projectId: null }
  } else {
    bad('Choose the invoice or contract to repeat.', 'source_required')
  }
  if (input?.frequency !== undefined) {
    if (!FREQS.includes(input.frequency)) bad('Frequency is monthly, quarterly or yearly.', 'invalid_frequency')
    frequency = input.frequency
  }
  const mode = input?.mode ?? 'draft'
  if (!MODES.includes(mode)) bad('Mode is draft or auto_issue.', 'invalid_mode')
  const startDate = input?.startDate ?? today
  if (!isIsoDay(startDate)) bad('The start date must be yyyy-MM-dd.', 'invalid_date')
  const endDate = input?.endDate || null
  if (endDate && (!isIsoDay(endDate) || endDate < startDate)) bad('The end date must be on or after the start date.', 'invalid_date')
  if (financeRecurring.some((r) => r.companyId === co && r.status !== 'ended' && ((sourceInvoiceId && r.sourceInvoiceId === sourceInvoiceId) || (!sourceInvoiceId && contractId && r.contractId === contractId)))) {
    conflict('A recurring schedule already exists for this source.', 'schedule_exists')
  }
  // Build once to validate the template lines (tax codes, accounts) before saving.
  buildLines(co, 'REC-CHECK', template!.lines)
  const at = nowIso()
  const r: Tenant<RecurringRecord> = {
    companyId: co,
    id: nextRecurringId(),
    customerId: customerId!,
    sourceInvoiceId,
    contractId,
    frequency,
    startDate,
    endDate,
    nextDate: startDate,
    periodIndex: 0,
    mode,
    status: 'active',
    template: template!,
    generated: [],
    lastError: null,
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  }
  if (sourceInvoiceId && invoiceById(co, sourceInvoiceId)?.issueDate === startDate) {
    // The source invoice is the first period.
    const src = invoiceById(co, sourceInvoiceId)!
    r.generated.push({ period: startDate, invoiceId: src.id, at })
    r.periodIndex = 1
    r.nextDate = periodNext(r)
    if (!src.recurringId) src.recurringId = r.id
  }
  financeRecurring.push(r)
  recordAudit(user, { action: 'create', entity: 'recurring_invoice', entityId: r.id, summary: `Created a ${frequency} recurring invoice for ${customerName(co, r.customerId)} from ${startDate}` })
  return delay(recurringView(r))
}

const nextRecurringId = () => nextId('recurring', 'REC')
function periodNext(r: RecurringRecord): string | null {
  const next = periodDate(r.startDate, r.frequency, r.periodIndex)
  return r.endDate && next > r.endDate ? null : next
}

export async function updateRecurring(user: User, id: string, input: RecurringUpdate | null): Promise<RecurringSchedule> {
  assertWrite(user)
  const r = ownRecurring(user, id)
  if (r.status === 'ended') conflict('This schedule has ended.', 'schedule_ended')
  const i = input ?? {}
  if (i.frequency !== undefined) {
    if (!FREQS.includes(i.frequency)) bad('Frequency is monthly, quarterly or yearly.', 'invalid_frequency')
    if (i.frequency !== r.frequency) {
      // Restart the series from the next date so already generated periods stay as they are.
      r.startDate = r.nextDate ?? r.startDate
      r.periodIndex = 0
      r.frequency = i.frequency
    }
  }
  if (i.mode !== undefined) {
    if (!MODES.includes(i.mode)) bad('Mode is draft or auto_issue.', 'invalid_mode')
    r.mode = i.mode
  }
  if (i.endDate !== undefined) {
    if (i.endDate !== null && (!isIsoDay(i.endDate) || i.endDate < r.startDate)) bad('The end date must be on or after the start date.', 'invalid_date')
    r.endDate = i.endDate
  }
  if (i.nextDate !== undefined) {
    if (!isIsoDay(i.nextDate)) bad('The next date must be yyyy-MM-dd.', 'invalid_date')
    if (r.generated.some((g) => g.period >= i.nextDate!)) bad('The next date must be after the last generated period.', 'invalid_date')
    r.startDate = i.nextDate
    r.periodIndex = 0
  }
  if (i.status !== undefined) {
    if (!STATUSES.includes(i.status)) bad('Status is active, paused or ended.', 'invalid_status')
    r.status = i.status
  }
  r.nextDate = r.status === 'ended' ? null : periodNext(r)
  if (!r.nextDate) r.status = 'ended'
  r.updatedAt = nowIso()
  recordAudit(user, { action: 'update', entity: 'recurring_invoice', entityId: r.id, summary: `Updated recurring invoice ${r.id} (${r.status}, ${r.frequency}, next ${r.nextDate ?? '—'})` })
  return delay(recurringView(r))
}

/* ---------------- journal source links ---------------- */

// Credit-note entries in the journal show the credit note number and open the invoice it credits.
registerJournalSource('credit_note', (co, id) => {
  const cn = financeCreditNotes.find((c) => c.companyId === co && c.id === id)
  return cn ? { number: cn.number, link: invoicePathOf(cn.invoiceId) } : null
})

/* ---------------- lifecycle tick ---------------- */

/** Recurring invoices ride on the lazy, idempotent lifecycle tick (company timezone), only with the accounting module. */
onLifecycleTick('finance.recurring-invoices', (companyId, until) => {
  if (!companyModules(companyId).includes('accounting')) return 0
  return runRecurring(companyId, until)
})

