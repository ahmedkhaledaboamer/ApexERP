import { afterEach, describe, expect, it } from 'vitest'
import { isHistoryInvoiceId } from '@/shared/mocks/data/financeHistorySeed'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeJournal } from '@/shared/mocks/data/finance'
import { financeCreditNotes, financeRecurring, invoiceRecords, type InvoiceRecord } from '@/shared/mocks/data/financeInvoices'
import { notifications } from '@/shared/mocks/data/tasks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { advanceClock, nowMs, resetClock } from '@/shared/mocks/clock'
import { addDaysIso, addMonthsIso, lineMath, round2, totalsOf, toBase } from '@/modules/finance/invoices/calc'
import { INITIAL_PIH, buildUblXml, decodeQr, decodeTlv, encodeTlv, fromBase64, invoiceHash, qrPayload, sha256, toBase64, toHex, utf8 } from '@/modules/finance/invoices/zatca'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { runLifecycle } from './billing'
import { ublForCreditNote, ublForInvoice } from './financeInvoiceCore'
import * as fin from './financeInvoices'
import '@/shared/mocks/handlers'
import { skipCollectionsSeed } from './financeCollections.fixtures'

/** Accounts & finance › Invoices: math, postings, credit notes, recurring generation, ZATCA data. */

// These tests use the invoice seed as issued (no payments): keep the collections seed out.
skipCollectionsSeed(APEX_ID)
skipCollectionsSeed(CREST_ID)
const seed = takeSnapshot(true)
afterEach(() => {
  restoreSnapshot(seed)
  resetClock()
})

const u = (id: string) => users.find((x) => x.id === id)!
const ACCOUNTANT = () => u('u8') // Apex
const CREST_ADMIN = () => u('u101')
const inv = (id: string) => invoiceRecords.find((i) => i.id === id)!
const entry = (id: string | null) => financeJournal.find((e) => e.id === id)!
const sumBy = (lines: { accountId: string; debit: number; credit: number }[], acc: string) => round2(lines.filter((l) => l.accountId === acc).reduce((s, l) => s + l.debit - l.credit, 0))
const balanced = (lines: { debit: number; credit: number }[]) => round2(lines.reduce((s, l) => s + l.debit, 0)) === round2(lines.reduce((s, l) => s + l.credit, 0))
const today = (co: string) => todayIsoIn(co === CREST_ID ? 'Asia/Riyadh' : 'Asia/Dubai', new Date(nowMs()))

describe('line, discount and tax math', () => {
  it('rounds per line and sums the totals', () => {
    expect(lineMath(3, 33.335, 0, 5)).toEqual({ gross: 100.01, discount: 0, net: 100.01, taxAmount: 5, total: 105.01 })
    expect(lineMath(1, 0.1, 0, 15).taxAmount).toBe(0.02) // 0.015 → 0.02
    expect(lineMath(2, 100, 500, 5)).toMatchObject({ discount: 200, net: 0, taxAmount: 0 }) // discount capped at the gross
    const lines = [lineMath(1, 10.05, 0.05, 5), lineMath(7, 3.33, 1, 15)]
    const t = totalsOf(lines)
    expect(t).toEqual({ subtotal: 33.36, discountTotal: 1.05, taxTotal: 0.5 + 3.35, total: round2(33.36 - 1.05 + 3.85) })
    expect(toBase(1234.57, 3.6725)).toBe(4533.96) // 4533.958325
  })

  it('validates lines on create (catalog service of the company, tax code, discount ≤ amount)', async () => {
    await expect(fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1030', lines: [{ description: 'x', quantity: 1, unitPrice: 10, discount: 11 }] })).rejects.toMatchObject({ status: 422 })
    await expect(fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1030', lines: [{ description: 'x', serviceId: 'S-901', quantity: 1, unitPrice: 10 }] })).rejects.toMatchObject({ status: 422, code: 'service_not_found' })
    await expect(fin.createInvoice(ACCOUNTANT(), { customerId: 'C-5007', lines: [{ description: 'x', quantity: 1, unitPrice: 10 }] })).rejects.toMatchObject({ status: 422, code: 'customer_not_found' })
    const d = await fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1030', lines: [{ description: 'Hours', serviceId: 'S-402', quantity: 3, unitPrice: 300, discount: 50 }, { description: 'Free text', quantity: 1, unitPrice: 99.99, taxCodeId: 'ZR' }] })
    expect(d.status).toBe('draft')
    expect(d.number).toBe('Draft')
    expect(d.journalEntryId).toBeNull()
    expect(d.lines[0]).toMatchObject({ net: 850, taxAmount: 42.5, revenueAccountId: 'ACC-4200', taxCodeId: 'VAT5' })
    expect(d.lines[1]).toMatchObject({ net: 99.99, taxAmount: 0, revenueAccountId: 'ACC-4200' }) // Finance settings default (Apex: service revenue)
    expect(d).toMatchObject({ subtotal: 999.99, discountTotal: 50, taxTotal: 42.5, total: 992.49 })
  })
})

describe('issue, void and credit-note postings', () => {
  it('issue numbers the invoice and posts Dr AR / Dr discounts / Cr revenue / Cr VAT, balanced', async () => {
    const d = await fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1030', paymentTermsDays: 14, lines: [{ description: 'Hours', serviceId: 'S-402', quantity: 3, unitPrice: 300, discount: 50 }, { description: 'Setup', quantity: 1, unitPrice: 1000 }, { description: 'Licence resale', quantity: 1, unitPrice: 200, revenueAccountId: 'ACC-4100' }] })
    const issued = await fin.issueInvoice(ACCOUNTANT(), d.id)
    expect(issued.number).toMatch(/^APX-INV-\d{4}-\d{4}$/)
    expect(issued.status).toBe('issued')
    expect(issued.issueDate).toBe(today(APEX_ID))
    expect(issued.dueDate).toBe(addDaysIso(today(APEX_ID), 14))
    expect(issued.zatca).toBeNull() // UAE
    const je = entry(issued.journalEntryId)
    expect(balanced(je.lines)).toBe(true)
    expect(sumBy(je.lines, 'ACC-1200')).toBe(issued.total)
    expect(sumBy(je.lines, 'ACC-4800')).toBe(50)
    expect(sumBy(je.lines, 'ACC-4200')).toBe(-1900)
    expect(sumBy(je.lines, 'ACC-4100')).toBe(-200)
    expect(sumBy(je.lines, 'ACC-2200')).toBe(-issued.taxTotal)
    expect(je.sourceType).toBe('invoice')
    // Frozen once issued.
    await expect(fin.updateInvoice(ACCOUNTANT(), d.id, { notes: 'x' })).rejects.toMatchObject({ status: 409, code: 'not_draft' })
    await expect(fin.issueInvoice(ACCOUNTANT(), d.id)).rejects.toMatchObject({ status: 409 })
  })

  it('a USD invoice posts in base currency (AED at the rate) and balances with a rounding line when needed', async () => {
    const usd = inv('INV-1006')
    expect(usd.currency).toBe('USD')
    expect(usd.exchangeRate).toBe(3.6725)
    const je = entry(usd.journalEntryId)
    expect(balanced(je.lines)).toBe(true)
    expect(sumBy(je.lines, 'ACC-1200')).toBe(toBase(usd.total, 3.6725))
    expect(sumBy(je.lines, 'ACC-2200')).toBe(-toBase(usd.taxTotal, 3.6725))
    // A rate that forces a rounding difference.
    const d = await fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1025', currency: 'EUR', exchangeRate: 3.98765, lines: [{ description: 'A', quantity: 1, unitPrice: 33.33 }, { description: 'B', quantity: 1, unitPrice: 66.67, discount: 0.01 }] })
    const issued = await fin.issueInvoice(ACCOUNTANT(), d.id)
    const lines = entry(issued.journalEntryId).lines
    expect(balanced(lines)).toBe(true)
    expect(sumBy(lines, 'ACC-1200')).toBe(toBase(issued.total, 3.98765))
  })

  it('void reverses the journal (reason required, audited) and notifies the creator; refused with credit notes', async () => {
    const d = await fin.createInvoice(ACCOUNTANT(), { customerId: 'C-1030', lines: [{ description: 'Setup', quantity: 1, unitPrice: 1000 }] })
    await fin.issueInvoice(ACCOUNTANT(), d.id)
    await expect(fin.voidInvoice(u('u1'), d.id, { reason: '' })).rejects.toMatchObject({ status: 422, code: 'reason_required' })
    const v = await fin.voidInvoice(u('u1'), d.id, { reason: 'Wrong customer' })
    expect(v.status).toBe('void')
    const orig = entry(v.journalEntryId)
    const rev = entry(v.voidJournal!.id)
    expect(orig.status).toBe('reversed')
    expect(rev.reversalOf).toBe(orig.id)
    for (const acc of ['ACC-1200', 'ACC-4200', 'ACC-2200']) expect(round2(sumBy(orig.lines, acc) + sumBy(rev.lines, acc))).toBe(0)
    expect(notifications.filter((n) => n.userId === 'u8' && n.type === 'finance' && n.title.includes(v.number))).toHaveLength(1)
    // An invoice with a credit note can't be voided.
    await expect(fin.voidInvoice(ACCOUNTANT(), 'INV-1008', { reason: 'Nope' })).rejects.toMatchObject({ status: 409, code: 'has_settlements' })
  })

  it('a credit note reverses revenue and VAT, reduces the balance; the excess becomes customer credit', async () => {
    const i = inv('INV-1003')
    const balance = i.balanceDue
    const line = i.lines[0]
    const cn = await fin.createCreditNote(ACCOUNTANT(), { invoiceId: i.id, reason: 'Scope reduced', lines: [{ invoiceLineId: line.id, amount: 1000 }] })
    expect(cn.number).toMatch(/^APX-CN-\d{4}-\d{4}$/)
    expect(cn).toMatchObject({ subtotal: 1000, taxTotal: 50, total: 1050, appliedAmount: 1050, excessAmount: 0 })
    expect(inv('INV-1003').balanceDue).toBe(round2(balance - 1050))
    expect(inv('INV-1003').status).toBe('partially_paid')
    const je = entry(cn.journalEntryId)
    expect(balanced(je.lines)).toBe(true)
    expect(sumBy(je.lines, 'ACC-2200')).toBe(50)
    expect(sumBy(je.lines, 'ACC-1200')).toBe(-1050)
    // Over-credit beyond the open balance: simulate a payment (Collections) of almost everything first.
    const target = inv('INV-1003')
    target.amountPaid = round2(target.balanceDue - 100)
    target.balanceDue = 100
    const rest = await fin.createCreditNote(ACCOUNTANT(), { invoiceId: target.id, reason: 'Cancelled', full: true })
    expect(rest.appliedAmount).toBe(100)
    expect(rest.excessAmount).toBe(round2(rest.total - 100))
    const lines = entry(rest.journalEntryId).lines
    expect(sumBy(lines, 'ACC-2300')).toBe(-rest.excessAmount)
    expect(balanced(lines)).toBe(true)
    expect(inv('INV-1003').balanceDue).toBe(0)
    expect(inv('INV-1003').status).toBe('paid')
    // Nothing left to credit.
    await expect(fin.createCreditNote(ACCOUNTANT(), { invoiceId: target.id, reason: 'Again', full: true })).rejects.toMatchObject({ status: 422, code: 'nothing_to_credit' })
  })
})

describe('invoicing from a quotation / contract / won deal', () => {
  it('a quotation can’t be invoiced twice beyond 100%; milestones split it and the last one takes the remainder', async () => {
    // Q-1001 is fully invoiced by INV-1001.
    await expect(fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1001' })).rejects.toMatchObject({ status: 409, code: 'already_invoiced' })
    // Q-1002: 40% issued + 30% draft → 30% left.
    await expect(fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1002', percent: 40 })).rejects.toMatchObject({ status: 422, code: 'exceeds_remaining' })
    const last = await fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1002', milestone: 'Go-live' })
    expect(last.billingPct).toBe(30)
    const all = invoiceRecords.filter((i) => i.quotationId === 'Q-1002')
    const net = round2(all.reduce((s, i) => s + i.lines.reduce((x, l) => x + l.net, 0), 0))
    expect(net).toBe(28000 + 40 * 350 + 12 * 2500) // exactly the quotation net
    await expect(fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1002' })).rejects.toMatchObject({ code: 'already_invoiced' })
    // Not accepted / other company.
    await expect(fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1008' })).rejects.toMatchObject({ status: 409, code: 'quotation_not_accepted' })
    await expect(fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-5001' })).rejects.toMatchObject({ status: 422, code: 'quotation_not_found' })
  })

  it('full quotation invoice copies the lines; a won deal resolves to its quotation or contract', async () => {
    const d = await fin.createFromSource(ACCOUNTANT(), { quotationId: 'Q-1006' })
    expect(d.lines).toHaveLength(3)
    expect(d.quotationId).toBe('Q-1006')
    expect(d.billingPct).toBe(100)
    expect(d.lines[1]).toMatchObject({ unitPrice: 30000, discount: 4500, net: 25500 })
    const won = await fin.createFromSource(ACCOUNTANT(), { leadId: 'L-1012' }) // Palm Retail: Q-1007 has 50% left
    expect(won.quotationId).toBe('Q-1007')
    expect(won.billingPct).toBe(50)
    const contract = await fin.createFromSource(CREST_ADMIN(), { contractId: 'CON-5001' })
    expect(contract.contractId).toBe('CON-5001')
    expect(contract.lines[0].unitPrice).toBe(18500)
  })
})

describe('recurring invoices (lifecycle tick, company timezone, once per period)', () => {
  it('generates once per period at the company’s midnight and notifies the accountants', async () => {
    // A Crest (Riyadh, UTC+3) schedule starting the day after tomorrow.
    const start = addDaysIso(today(CREST_ID), 2)
    const r = await fin.createRecurring(CREST_ADMIN(), { contractId: 'CON-5002', frequency: 'monthly', startDate: start, mode: 'auto_issue' })
    // Remove the seeded schedule's effect: only count invoices of this schedule.
    const mine = () => invoiceRecords.filter((i) => i.recurringId === r.id)
    const at = (iso: string) => advanceClock((Date.parse(iso) - nowMs()) / 86_400_000)
    // 23:30 Riyadh on the day before the start (20:30Z): not yet.
    at(`${addDaysIso(start, -1)}T20:30:00Z`)
    runLifecycle(CREST_ID)
    expect(mine()).toHaveLength(0)
    // 00:30 Riyadh on the start day (21:30Z of the day before in UTC): generated.
    at(`${addDaysIso(start, -1)}T21:30:00Z`)
    runLifecycle(CREST_ID)
    expect(mine()).toHaveLength(1)
    expect(mine()[0]).toMatchObject({ status: 'issued', issueDate: start })
    expect(entry(mine()[0].journalEntryId).date).toBe(start)
    runLifecycle(CREST_ID)
    runLifecycle(CREST_ID)
    expect(mine()).toHaveLength(1)
    const notes = notifications.filter((n) => n.companyId === CREST_ID && n.type === 'finance' && n.link.includes(mine()[0].id))
    const fullUsers = users.filter((x) => x.companyId === CREST_ID && x.active && ['Company Admin', 'Management', 'Accountant'].includes(x.role))
    expect(notes.map((n) => n.userId).sort()).toEqual(fullUsers.map((x) => x.id).sort())
    // Apex is untouched by Crest's tick.
    expect(notifications.some((n) => n.companyId === APEX_ID && n.link.includes(mine()[0].id))).toBe(false)
    // Two months later: exactly two more periods.
    advanceClock(62)
    runLifecycle(CREST_ID)
    runLifecycle(CREST_ID)
    const periods = financeRecurring.find((x) => x.id === r.id)!.generated.map((g) => g.period)
    expect(new Set(periods).size).toBe(periods.length)
    expect(periods.length).toBeGreaterThanOrEqual(2)
    expect(mine()).toHaveLength(periods.length)
  })

  it('a paused schedule generates nothing; draft mode leaves drafts (no journal)', async () => {
    const start = addDaysIso(today(APEX_ID), 1)
    const r = await fin.createRecurring(ACCOUNTANT(), { sourceInvoiceId: 'INV-1012', frequency: 'quarterly', startDate: start, mode: 'draft' })
    await fin.updateRecurring(ACCOUNTANT(), r.id, { status: 'paused' })
    advanceClock(3)
    runLifecycle(APEX_ID)
    expect(invoiceRecords.filter((i) => i.recurringId === r.id)).toHaveLength(0)
    await fin.updateRecurring(ACCOUNTANT(), r.id, { status: 'active' })
    runLifecycle(APEX_ID)
    const made = invoiceRecords.filter((i) => i.recurringId === r.id)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ status: 'draft', journalEntryId: null })
    expect(made[0].issueDate).toBe(start)
    expect(financeRecurring.find((x) => x.id === r.id)!.nextDate).toBe(addMonthsIso(start, 3))
  })
})

describe('ZATCA data', () => {
  it('SHA-256, base64 and the initial PIH match the published values', () => {
    expect(toHex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(toHex(sha256(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(toHex(sha256('a'.repeat(1000)))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
    expect(INITIAL_PIH).toBe('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==')
    for (const s of ['', 'f', 'fo', 'foo', 'شركة']) expect(new TextDecoder().decode(fromBase64(toBase64(utf8(s))))).toBe(s)
  })

  it('the QR is base64 TLV of tags 1–5 and decodes back (Arabic seller name in UTF-8)', () => {
    const fields = { sellerName: 'شركة كرست', vatNumber: '310123456700003', timestamp: '2026-11-21T09:30:00Z', total: '1150.00', vatTotal: '150.00' }
    const b64 = qrPayload(fields)
    const bytes = fromBase64(b64)
    expect(bytes[0]).toBe(1)
    expect(bytes[1]).toBe(utf8(fields.sellerName).length)
    expect(decodeQr(b64)).toEqual(fields)
    expect(decodeTlv(encodeTlv([[2, 'x'], [5, '0.00']]))).toEqual({ 2: 'x', 5: '0.00' })
    // A seeded Crest invoice.
    const i = inv('INV-5001')
    const q = decodeQr(i.zatca!.qr)
    expect(q).toMatchObject({ vatNumber: '310123456700003', total: i.total.toFixed(2), vatTotal: i.taxTotal.toFixed(2), timestamp: i.zatca!.timestamp })
  })

  it('Crest documents form one chain: ICV 1…n, PIH of n+1 = hash of n; each hash is SHA-256 of its XML', () => {
    const docs = [
      ...invoiceRecords.filter((i) => i.companyId === CREST_ID && i.zatca).map((i) => ({ z: i.zatca!, doc: ublForInvoice(i, false)! })),
      ...financeCreditNotes.filter((c) => c.companyId === CREST_ID && c.zatca).map((c) => ({ z: c.zatca!, doc: ublForCreditNote(c, inv(c.invoiceId), false)! })),
    ].sort((a, b) => a.z.icv - b.z.icv)
    expect(docs.length).toBeGreaterThanOrEqual(8)
    expect(docs.map((d) => d.z.icv)).toEqual(docs.map((_, i) => i + 1))
    expect(docs[0].z.pih).toBe(INITIAL_PIH)
    for (let i = 1; i < docs.length; i++) expect(docs[i].z.pih).toBe(docs[i - 1].z.invoiceHash)
    for (const d of docs) {
      expect(d.z.invoiceHash).toBe(invoiceHash(d.doc))
      expect(d.z.status).toBe('not_submitted')
      expect(d.z.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    // Apex (UAE) has no ZATCA data.
    expect(invoiceRecords.some((i) => i.companyId === APEX_ID && i.zatca)).toBe(false)
  })

  it('a newly issued Crest invoice continues the chain; standard vs simplified by the buyer VAT number', async () => {
    const lastHash = () => [...invoiceRecords.filter((i) => i.companyId === CREST_ID && i.zatca).map((i) => i.zatca!), ...financeCreditNotes.filter((c) => c.companyId === CREST_ID && c.zatca).map((c) => c.zatca!)].sort((a, b) => b.icv - a.icv)[0]
    const prev = lastHash()
    const b2c = await fin.createInvoice(CREST_ADMIN(), { customerId: 'C-5010', customerVatNumber: '', lines: [{ description: 'Delivery', quantity: 1, unitPrice: 100 }] })
    const issued = await fin.issueInvoice(CREST_ADMIN(), b2c.id)
    expect(issued.kind).toBe('simplified')
    expect(issued.title).toBe('Simplified Tax Invoice')
    expect(issued.titleAr).toBe('فاتورة ضريبية مبسطة')
    expect(issued.zatca).toMatchObject({ icv: prev.icv + 1, pih: prev.invoiceHash, typeCode: '388', subtype: '0200000' })
    await expect(fin.createInvoice(CREST_ADMIN(), { customerId: 'C-5003', customerVatNumber: '123', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).rejects.toMatchObject({ code: 'invalid_vat_number' })
    expect(inv('INV-5001').kind).toBe('tax_invoice')
    expect(inv('INV-5001').zatca!.subtype).toBe('0100000')
  })

  it('the UBL XML has the mandatory elements (invoice 388 / credit note 381)', async () => {
    const x = await fin.invoiceXml(CREST_ADMIN(), 'INV-5001')
    expect(x.filename).toBe(`${inv('INV-5001').number}.xml`)
    for (const tag of [
      '<cbc:ProfileID>reporting:1.0</cbc:ProfileID>', '<cbc:UUID>', '<cbc:IssueDate>', '<cbc:IssueTime>', '<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>',
      '<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>', '<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>', '<cbc:ID>ICV</cbc:ID>', '<cbc:ID>PIH</cbc:ID>', '<cbc:ID>QR</cbc:ID>',
      '<cac:AccountingSupplierParty>', '<cbc:CompanyID>310123456700003</cbc:CompanyID>', '<cac:AccountingCustomerParty>', '<cbc:ActualDeliveryDate>', '<cbc:PaymentMeansCode>',
      '<cac:TaxTotal>', '<cac:TaxSubtotal>', '<cbc:TaxExclusiveAmount', '<cbc:TaxInclusiveAmount', '<cbc:PayableAmount', '<cac:InvoiceLine>', '<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID>',
    ]) expect(x.content, tag).toContain(tag)
    expect(x.content).toContain(inv('INV-5001').zatca!.qr)
    const cn = financeCreditNotes.find((c) => c.companyId === CREST_ID)!
    const cx = await fin.creditNoteXml(CREST_ADMIN(), cn.id)
    expect(cx.content).toContain('>381</cbc:InvoiceTypeCode>')
    expect(cx.content).toContain(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv(cn.invoiceId).number}</cbc:ID>`)
    expect(cx.content).toContain(`<cbc:InstructionNote>${cn.reason}</cbc:InstructionNote>`)
    // Zero-rated line of the USD invoice has an exemption reason.
    expect((await fin.invoiceXml(CREST_ADMIN(), 'INV-5005')).content).toContain('<cbc:ID>Z</cbc:ID>')
    // UAE: no XML.
    await expect(fin.invoiceXml(ACCOUNTANT(), 'INV-1001')).rejects.toMatchObject({ status: 409, code: 'zatca_not_applicable' })
    expect(buildUblXml(ublForInvoice(inv('INV-5004'), false)!)).toContain('name="0200000"')
  })
})

describe('seed', () => {
  it('each company has drafts, issued, overdue, void, a credit note, a recurring schedule and a USD invoice', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const mine = invoiceRecords.filter((i) => i.companyId === co) as InvoiceRecord[]
      // The showcase rows; the year's trading invoices (financeHistorySeed) come on top.
      const showcase = mine.filter((i) => !isHistoryInvoiceId(i.id))
      expect(showcase.length).toBeGreaterThanOrEqual(10)
      expect(showcase.length).toBeLessThanOrEqual(14)
      expect(mine.length - showcase.length).toBeGreaterThan(30)
      for (const s of ['draft', 'issued', 'void', 'partially_paid']) expect(mine.some((i) => i.status === s), `${co} ${s}`).toBe(true)
      expect(mine.some((i) => i.status === 'issued' && i.dueDate! < today(co))).toBe(true)
      expect(mine.some((i) => i.currency === 'USD' && i.exchangeRate > 1)).toBe(true)
      expect(financeCreditNotes.some((c) => c.companyId === co)).toBe(true)
      expect(financeRecurring.some((r) => r.companyId === co && r.status === 'active')).toBe(true)
      expect(mine.every((i) => i.amountPaid === 0)).toBe(true)
      for (const i of mine.filter((x) => x.journalEntryId)) expect(balanced(entry(i.journalEntryId).lines)).toBe(true)
    }
    const apex = new Set(invoiceRecords.filter((i) => i.companyId === APEX_ID).map((i) => i.customerId))
    expect(invoiceRecords.filter((i) => i.companyId === CREST_ID).some((i) => apex.has(i.customerId))).toBe(false)
  })
})
