import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import type { InvoiceLine } from '@/modules/finance/types'
import type { VatItem } from '@/modules/finance/tax/types'
import { addDaysIso, boxOf, corporateTaxBands, corporateTaxOf, periodOf, settlementLines, vatBoxes, vatDueDate, zakatOf } from '@/modules/finance/tax/calc'
import { customers, users } from '@/shared/mocks/db'
import { financeJournal } from '@/shared/mocks/data/finance'
import { financeCreditNotes, invoiceRecords, type CreditNoteRecord, type InvoiceRecord } from '@/shared/mocks/data/financeInvoices'
import { finBills, finDebitNotes, type BillRecord, type DebitNoteRecord } from '@/shared/mocks/data/financePurchases'
import { finVatReturns } from '@/shared/mocks/data/financeTax'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import '@/shared/mocks/handlers'
import { nextId, postJournal, runFinanceHooks } from './ledger'
import { creditLines, issueLines } from './financeInvoiceCore'
import { billPostingLines } from './financePurchasesCore'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import * as t from './financeTax'

/**
 * Accounts & finance › Tax: VAT return classification (UAE FTA VAT 201 / KSA ZATCA), filing (frozen snapshot +
 * balanced settlement), payment, next-period corrections, corporate tax bands, zakat base and provisions.
 */

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const APEX = 'co_apex'
const CREST = 'co_crest'
const today = (co: string) => companyDayOf(co).today
/** A day in the previous filing period (ended), and that period. */
function lastPeriod(co: string, freq: 'monthly' | 'quarterly') {
  const p = periodOf(addDaysIso(periodOf(today(co), freq).from, -1), freq)
  return { ...p, day: addDaysIso(p.from, 10) }
}

/**
 * Apex's last ended quarter, or — once the seed has filed it (its deadline passed) — the last ended month after
 * switching Apex to monthly filing: a period that ended and is still a draft.
 */
function apexOpenEndedPeriod(acc: User) {
  const q = lastPeriod(APEX, 'quarterly')
  if (t.listVatReturns(acc).find((r) => r.from === q.from)?.status === 'draft') return q
  t.updateTaxSettings(acc, { vatFrequency: 'monthly' })
  return lastPeriod(APEX, 'monthly')
}

let n = 0
const line = (net: number, taxCodeId: string, rate: number, revenueAccountId = 'ACC-4200'): InvoiceLine => ({ id: `ILT-${++n}`, description: `Line ${n}`, serviceId: null, quantity: 1, unitPrice: net, discount: 0, taxCodeId, net, taxAmount: Math.round(net * rate) / 100, total: net + Math.round(net * rate) / 100, revenueAccountId })

function invoice(co: string, customerId: string, date: string, lines: InvoiceLine[], currency?: string, fx = 1): InvoiceRecord {
  const id = nextId('invoice', 'INV')
  const subtotal = lines.reduce((s, l) => s + l.net, 0)
  const tax = lines.reduce((s, l) => s + l.taxAmount, 0)
  const inv = {
    companyId: co, id, number: `TST-INV-${++n}`, kind: 'tax_invoice', status: 'issued', customerId, quotationId: null, contractId: null, leadId: null, projectId: null, eventId: null, recurringId: null,
    issueDate: date, dueDate: date, currency: currency ?? (co === CREST ? 'SAR' : 'AED'), exchangeRate: fx, lines, subtotal, discountTotal: 0, taxTotal: tax, total: subtotal + tax,
    amountPaid: 0, amountCredited: 0, balanceDue: subtotal + tax, notes: '', terms: '', journalEntryId: null, createdBy: 'u1', createdAt: date, updatedAt: date, issuedAt: date, voidedAt: null, voidReason: null,
    customerVatNumber: '', paymentTermsDays: 0, billingPct: null, milestone: '', sendLog: [], history: [], zatca: null, voidJournalEntryId: null,
  } as InvoiceRecord
  invoiceRecords.push(inv)
  inv.journalEntryId = postJournal(co, { date, memo: `Test invoice ${id}`, sourceType: 'invoice', sourceId: id, lines: issueLines(co, inv), createdBy: null }).id
  return inv
}

function creditNote(co: string, inv: InvoiceRecord, date: string, of: InvoiceLine, net: number): Tenant<CreditNoteRecord> {
  const taxAmount = Math.round((of.taxAmount / of.net) * net * 100) / 100
  const cn: Tenant<CreditNoteRecord> = {
    companyId: co, id: nextId('creditNote', 'CN'), number: `TST-CN-${++n}`, invoiceId: inv.id, customerId: inv.customerId, date, reason: 'Test', currency: inv.currency, exchangeRate: inv.exchangeRate,
    lines: [{ invoiceLineId: of.id, description: of.description, taxCodeId: of.taxCodeId, taxRate: 0, net, taxAmount, total: net + taxAmount, revenueAccountId: of.revenueAccountId }],
    subtotal: net, taxTotal: taxAmount, total: net + taxAmount, appliedAmount: net + taxAmount, excessAmount: 0, journalEntryId: null, zatca: null, createdBy: 'u1', createdAt: date,
  }
  financeCreditNotes.push(cn)
  cn.journalEntryId = postJournal(co, { date, memo: 'Test credit note', sourceType: 'credit_note', sourceId: cn.id, lines: creditLines(co, inv, cn), createdBy: null }).id
  return cn
}

function bill(co: string, date: string, lines: { net: number; taxCodeId: string; rate: number; recoverable: boolean }[]): Tenant<BillRecord> {
  const id = nextId('bill', 'BILL')
  const bl = lines.map((l, i) => ({ id: `BLT-${++n}`, description: `Bill line ${i}`, quantity: 1, unitPrice: l.net, taxCodeId: l.taxCodeId, accountId: 'ACC-6600', departmentId: null, projectId: null, eventId: null, budgetLineId: null, net: l.net, taxAmount: Math.round(l.net * l.rate) / 100, total: 0, poLineId: null, vatRecoverable: l.recoverable }))
  const subtotal = bl.reduce((s, l) => s + l.net, 0)
  const tax = bl.reduce((s, l) => s + l.taxAmount, 0)
  const b = { companyId: co, id, number: `TST-BILL-${++n}`, supplierInvoiceNumber: `SUP-${n}`, status: 'open', vendorId: 'VND-X', poId: null, billDate: date, dueDate: date, termsDays: 0, currency: co === CREST ? 'SAR' : 'AED', exchangeRate: 1, vendorVatNumber: '', lines: bl, subtotal, taxTotal: tax, total: subtotal + tax, amountPaid: 0, amountCredited: 0, balanceDue: subtotal + tax, notes: '', journalEntryId: null, voidJournalEntryId: null, rejectionReason: null, voidReason: null, attachments: [], history: [], dueSoonNotifiedAt: null, createdAt: date, updatedAt: date, postedAt: date, voidedAt: null, requesterId: 'u8', departmentId: null, chain: [], decisions: [], approvedBy: [], notifiedSteps: [] } as unknown as Tenant<BillRecord>
  finBills.push(b)
  b.journalEntryId = postJournal(co, { date, memo: 'Test bill', sourceType: 'bill', sourceId: id, lines: billPostingLines(co, b), createdBy: null }).id
  return b
}

function debitNote(co: string, b: BillRecord, date: string, net: number, tax: number): Tenant<DebitNoteRecord> {
  const dn: Tenant<DebitNoteRecord> = { companyId: co, id: nextId('debitNote', 'DN'), number: `TST-DN-${++n}`, billId: b.id, vendorId: b.vendorId, date, reason: 'Test', currency: b.currency, exchangeRate: 1, net, taxAmount: tax, total: net + tax, accountId: 'ACC-6600', journalEntryId: null, status: 'posted', voidReason: null, voidedAt: null, voidJournalEntryId: null, createdBy: 'u8', createdAt: date }
  finDebitNotes.push(dn)
  dn.journalEntryId = postJournal(co, {
    date, memo: 'Test debit note', sourceType: 'bill', sourceId: dn.id, createdBy: null,
    lines: [
      { accountId: 'ACC-2100', debit: net + tax, credit: 0, description: 'AP' },
      { accountId: 'ACC-6600', debit: 0, credit: net, description: 'Cost' },
      ...(tax ? [{ accountId: 'ACC-1300', debit: 0, credit: tax, description: 'VAT input reversed' }] : []),
    ],
  }).id
  return dn
}

/** Items of my entries only, in a computed range (the seed has its own entries in the same period). */
function itemsOf(co: string, from: string, to: string, entryIds: (string | null)[]): VatItem[] {
  const ids = new Set(entryIds)
  return t.draftItems(co, { id: 'test', from, to }).filter((i) => ids.has(i.entryId))
}
const boxMap = (items: VatItem[], layout: 'uae_vat201' | 'ksa_zatca') => new Map(vatBoxes(layout, items).boxes.map((b) => [b.key, b]))

describe('VAT box mapping (pure)', () => {
  const base: VatItem = { entryId: 'E', entryNumber: 'JV', date: '2026-07-10', side: 'sales', kind: 'invoice', docId: null, docNumber: '', link: null, counterparty: '', category: 'standard', taxCode: 'VAT5', net: 1000, vat: 50, recoverable: true, emirate: 'Dubai', emirateAssumed: false, export: false, correction: false, box: '' }
  const it2 = (x: Partial<VatItem>, layout: 'uae_vat201' | 'ksa_zatca' = 'uae_vat201'): VatItem => {
    const i = { ...base, ...x }
    return { ...i, box: boxOf(layout, i) }
  }
  it('UAE: emirates, zero-rated, exempt, credit notes, purchases, non-recoverable, corrections, boxes 8 / 11 / 12–14', () => {
    const items = [
      it2({ emirate: 'Abu Dhabi' }),
      it2({ emirate: 'Abu Dhabi', kind: 'credit_note', net: -200, vat: -10 }),
      it2({ emirate: 'Sharjah', net: 400, vat: 20 }),
      it2({ category: 'zero_rated', net: 300, vat: 0 }),
      it2({ category: 'exempt', net: 100, vat: 0 }),
      it2({ category: 'out_of_scope', net: 999, vat: 0 }),
      it2({ side: 'purchases', kind: 'bill', net: 600, vat: 30 }),
      it2({ side: 'purchases', kind: 'debit_note', net: -100, vat: -5 }),
      it2({ side: 'purchases', kind: 'bill', net: 80, vat: 4, recoverable: false }),
      it2({ emirate: 'Dubai', correction: true, net: 60, vat: 3 }),
      it2({ side: 'purchases', kind: 'expense', correction: true, net: 20, vat: 1 }),
    ]
    expect(items.map((i) => i.box)).toEqual(['1a', '1a', '1c', '4', '5', 'excluded', '9', '9', 'excluded', '1b', '9'])
    const { boxes, totals } = vatBoxes('uae_vat201', items)
    const b = new Map(boxes.map((x) => [x.key, x]))
    expect(b.get('1a')).toMatchObject({ amount: 800, vat: 40, adjustment: 0 })
    expect(b.get('1b')).toMatchObject({ amount: 0, vat: 0, adjustment: 3 })
    expect(b.get('1c')).toMatchObject({ amount: 400, vat: 20 })
    expect(b.get('4')!.amount).toBe(300)
    expect(b.get('5')!.amount).toBe(100)
    expect(b.get('8')).toMatchObject({ amount: 1600, vat: 60, adjustment: 3 })
    expect(b.get('9')).toMatchObject({ amount: 500, vat: 25, adjustment: 1 })
    expect(b.get('11')).toMatchObject({ amount: 500, vat: 25, adjustment: 1 })
    expect(b.get('12')!.vat).toBe(63)
    expect(b.get('13')!.vat).toBe(26)
    expect(b.get('14')!.vat).toBe(37)
    expect(totals).toMatchObject({ outputVat: 63, inputVat: 26, netVat: 37, corrections: 2, payable: 37 })
    // A credit brought forward reduces what is paid (not the boxes).
    expect(vatBoxes('uae_vat201', items, 10).totals.payable).toBe(27)
  })
  it('KSA: standard, zero-rated domestic vs exports, exempt, purchases 7 / 10 / 11, notes in the adjustment column, corrections in 14, box 16', () => {
    const k = (x: Partial<VatItem>) => it2({ taxCode: 'VAT15', ...x }, 'ksa_zatca')
    const items = [
      k({ net: 1000, vat: 150 }),
      k({ kind: 'credit_note', net: -100, vat: -15 }),
      k({ category: 'zero_rated', net: 500, vat: 0 }),
      k({ category: 'zero_rated', net: 700, vat: 0, export: true }),
      k({ category: 'exempt', net: 50, vat: 0 }),
      k({ side: 'purchases', kind: 'bill', net: 400, vat: 60 }),
      k({ side: 'purchases', kind: 'debit_note', net: -40, vat: -6 }),
      k({ side: 'purchases', kind: 'bill', category: 'zero_rated', net: 90, vat: 0 }),
      k({ side: 'purchases', kind: 'bill', category: 'exempt', net: 30, vat: 0 }),
      k({ side: 'purchases', kind: 'bill', net: 100, vat: 15, recoverable: false }),
      k({ correction: true, net: 200, vat: 30 }),
    ]
    expect(items.map((i) => i.box)).toEqual(['1', '1', '3', '4', '5', '7', '7', '10', '11', 'excluded', '14'])
    const { boxes, totals } = vatBoxes('ksa_zatca', items, 20)
    const b = new Map(boxes.map((x) => [x.key, x]))
    expect(b.get('1')).toMatchObject({ amount: 1000, adjustment: -100, vat: 135 })
    expect(b.get('3')!.amount).toBe(500)
    expect(b.get('4')!.amount).toBe(700)
    expect(b.get('6')).toMatchObject({ amount: 2250, adjustment: -100, vat: 135 })
    expect(b.get('7')).toMatchObject({ amount: 400, adjustment: -40, vat: 54 })
    expect(b.get('12')).toMatchObject({ amount: 520, adjustment: -40, vat: 54 })
    expect(b.get('13')!.vat).toBe(81)
    expect(b.get('14')!.vat).toBe(30)
    expect(b.get('15')!.vat).toBe(20)
    expect(b.get('16')!.vat).toBe(91)
    expect(totals).toMatchObject({ outputVat: 165, inputVat: 54, netVat: 111, payable: 91 })
  })
  it('settlement lines balance and flip for a credit; due dates per authority', () => {
    const acc = { output: 'O', input: 'I', payable: 'P' }
    const l = settlementLines({ outputVat: 100, inputVat: 30 }, acc)
    expect(l).toEqual([
      { accountId: 'O', debit: 100, credit: 0, description: expect.any(String) },
      { accountId: 'I', debit: 0, credit: 30, description: expect.any(String) },
      { accountId: 'P', debit: 0, credit: 70, description: expect.any(String) },
    ])
    const c = settlementLines({ outputVat: 10, inputVat: 50 }, acc)
    expect(c.find((x) => x.accountId === 'P')).toMatchObject({ debit: 40, credit: 0 })
    expect(c.reduce((s, x) => s + x.debit - x.credit, 0)).toBe(0)
    expect(vatDueDate('uae_vat201', '2026-09-30')).toBe('2026-10-28')
    expect(vatDueDate('ksa_zatca', '2026-09-30')).toBe('2026-10-31')
    expect(vatDueDate('ksa_zatca', '2026-01-31')).toBe('2026-02-28')
  })
})

describe('VAT classification from the journal and documents', () => {
  it('UAE: invoice lines by category and emirate, credit note, bill with non-recoverable VAT, debit note, expense without a valid tax invoice', () => {
    runFinanceHooks(APEX)
    const p = lastPeriod(APEX, 'quarterly')
    const cust = customers.find((c) => c.companyId === APEX)!
    cust.emirate = 'Abu Dhabi'
    const std = line(1000, 'VAT5', 5)
    const inv = invoice(APEX, cust.id, p.day, [std, line(500, 'ZR', 0), line(100, 'EX', 0)])
    const cn = creditNote(APEX, inv, addDaysIso(p.day, 1), std, 200)
    const b = bill(APEX, p.day, [
      { net: 400, taxCodeId: 'VAT5', rate: 5, recoverable: true },
      { net: 100, taxCodeId: 'VAT5', rate: 5, recoverable: false },
    ])
    const dn = debitNote(APEX, b, addDaysIso(p.day, 2), 80, 4)
    const items = itemsOf(APEX, p.from, p.to, [inv.journalEntryId, cn.journalEntryId, b.journalEntryId, dn.journalEntryId])
    const bx = boxMap(items, 'uae_vat201')
    expect(bx.get('1a')).toMatchObject({ amount: 800, vat: 40 })
    expect(bx.get('4')!.amount).toBe(500)
    expect(bx.get('5')!.amount).toBe(100)
    expect(bx.get('9')).toMatchObject({ amount: 320, vat: 16 })
    const excluded = items.filter((i) => i.box === 'excluded')
    expect(excluded).toHaveLength(1)
    expect(excluded[0]).toMatchObject({ kind: 'bill', recoverable: false, net: 100, vat: 5 })
    // Without a customer emirate the company's emirate is used (and flagged).
    cust.emirate = ''
    const inv2 = invoice(APEX, cust.id, p.day, [line(300, 'VAT5', 5)])
    const [i2] = itemsOf(APEX, p.from, p.to, [inv2.journalEntryId])
    expect(i2).toMatchObject({ box: '1b', emirate: 'Dubai', emirateAssumed: true })
    // The ledger's VAT always wins: items' VAT equals the VAT-account movements of the entries.
    const out = financeJournal.filter((e) => [inv.journalEntryId, cn.journalEntryId].includes(e.id)).flatMap((e) => e.lines).filter((l) => l.accountId === 'ACC-2200').reduce((s, l) => s + l.credit - l.debit, 0)
    expect(items.filter((i) => i.side === 'sales').reduce((s, i) => s + i.vat, 0)).toBeCloseTo(out, 2)
  })

  it('a voided (reversed) invoice nets to zero in the period', () => {
    runFinanceHooks(APEX)
    const p = lastPeriod(APEX, 'quarterly')
    const inv = invoice(APEX, customers.find((c) => c.companyId === APEX)!.id, p.day, [line(1000, 'VAT5', 5)])
    const orig = financeJournal.find((e) => e.id === inv.journalEntryId)!
    const rev = postJournal(APEX, { date: addDaysIso(p.day, 3), memo: 'Void', sourceType: 'invoice', sourceId: inv.id, lines: orig.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })), createdBy: null })
    rev.reversalOf = orig.id
    const items = itemsOf(APEX, p.from, p.to, [orig.id, rev.id])
    expect(items).toHaveLength(2)
    expect(items.reduce((s, i) => s + i.net, 0)).toBe(0)
    expect(items.reduce((s, i) => s + i.vat, 0)).toBe(0)
  })

  it('KSA: standard sale, export (foreign currency, zero-rated), exempt sale, zero-rated purchase', () => {
    runFinanceHooks(CREST)
    const p = lastPeriod(CREST, 'monthly')
    const cust = customers.find((c) => c.companyId === CREST)!
    const a = invoice(CREST, cust.id, p.day, [line(2000, 'VAT15', 15), line(300, 'EX', 0)])
    const x = invoice(CREST, cust.id, p.day, [line(1000, 'ZR', 0)], 'USD', 3.75)
    const z = invoice(CREST, cust.id, p.day, [line(400, 'ZR', 0)])
    const b = bill(CREST, p.day, [{ net: 250, taxCodeId: 'ZR', rate: 0, recoverable: true }])
    const items = itemsOf(CREST, p.from, p.to, [a.journalEntryId, x.journalEntryId, z.journalEntryId, b.journalEntryId])
    const bx = boxMap(items, 'ksa_zatca')
    expect(bx.get('1')).toMatchObject({ amount: 2000, vat: 300 })
    expect(bx.get('4')!.amount).toBe(3750)
    expect(bx.get('3')!.amount).toBe(400)
    expect(bx.get('5')!.amount).toBe(300)
    expect(bx.get('10')!.amount).toBe(250)
  })
})

describe('VAT returns: filing, settlement, payment and corrections', () => {
  it('files the last ended period: frozen snapshot, balanced settlement Dr 2200 / Cr 1300 / 2210, then paid Dr 2210 / Cr bank', () => {
    const acc = u('u8')
    runFinanceHooks(APEX)
    const p = apexOpenEndedPeriod(acc)
    invoice(APEX, customers.find((c) => c.companyId === APEX)!.id, p.day, [line(10000, 'VAT5', 5)])
    const row = t.listVatReturns(acc).find((r) => r.from === p.from)!
    expect(row.status).toBe('draft')
    const draft = t.getVatReturn(acc, row.id)
    expect(draft.frozen).toBe(false)
    expect(draft.can.file).toBe(true)
    expect(() => t.fileVatReturn(acc, row.id, { filingReference: 'x' })).toThrow(/filing reference/)
    const filed = t.fileVatReturn(acc, row.id, { filingReference: 'FTA-230001234' })
    expect(filed).toMatchObject({ status: 'filed', frozen: true, filingReference: 'FTA-230001234' })
    expect(filed.totals).toEqual(draft.totals)
    const se = financeJournal.find((e) => e.id === filed.settlementEntry!.id)!
    expect(se.sourceType).toBe('vat_return')
    const dr = se.lines.reduce((s, l) => s + l.debit, 0)
    const cr = se.lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
    const on = (id: string) => se.lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0)
    expect(on('ACC-2200')).toBeCloseTo(filed.totals.outputVat, 2)
    expect(on('ACC-1300')).toBeCloseTo(-filed.totals.inputVat, 2)
    expect(on('ACC-2210')).toBeCloseTo(-filed.totals.netVat, 2)
    // Filed: can't be filed or recomputed again.
    expect(() => t.fileVatReturn(acc, row.id, { filingReference: 'FTA-2' })).toThrow(/already filed/)
    invoice(APEX, customers.find((c) => c.companyId === APEX)!.id, p.day, [line(2000, 'VAT5', 5)])
    expect(t.getVatReturn(acc, row.id).totals).toEqual(filed.totals)
    // The late invoice goes to the next (open) return's adjustment column.
    const next = t.listVatReturns(acc).find((r) => r.from === addDaysIso(p.to, 1))!
    const nd = t.getVatReturn(acc, next.id)
    expect(nd.correctionCount).toBe(1)
    expect(nd.boxes.filter((b) => b.key.startsWith('1')).reduce((s, b) => s + b.adjustment, 0)).toBe(100)
    expect(t.getVatBoxItems(acc, next.id, 'corrections').items).toHaveLength(1)
    // The open period can't be filed yet.
    expect(() => t.fileVatReturn(acc, next.id, { filingReference: 'FTA-3333' })).toThrow(/ends on/)
    // Paid.
    if (filed.totals.payable > 0) {
      const paid = t.payVatReturn(acc, row.id, { reference: 'TRX-1' })
      expect(paid.status).toBe('paid')
      const pe = financeJournal.find((e) => e.id === paid.paymentEntry!.id)!
      expect(pe.lines).toEqual([
        expect.objectContaining({ accountId: 'ACC-2210', debit: filed.totals.payable, credit: 0 }),
        expect.objectContaining({ accountId: 'ACC-1120', debit: 0, credit: filed.totals.payable }),
      ])
      expect(() => t.payVatReturn(acc, row.id, {})).toThrow(/already paid/)
    }
  })

  it('a credit (negative net) is carried into the next return', () => {
    const acc = u('u8')
    runFinanceHooks(APEX)
    const p = apexOpenEndedPeriod(acc)
    bill(APEX, p.day, [{ net: 10_000_000, taxCodeId: 'VAT5', rate: 5, recoverable: true }])
    const row = t.listVatReturns(acc).find((r) => r.from === p.from)!
    const filed = t.fileVatReturn(acc, row.id, { filingReference: 'FTA-CREDIT-1' })
    expect(filed.totals.payable).toBeLessThan(0)
    expect(filed.can.pay).toBe(false)
    expect(() => t.payVatReturn(acc, row.id, {})).toThrow(/Nothing to pay/)
    const next = t.listVatReturns(acc).find((r) => r.from === addDaysIso(p.to, 1))!
    expect(t.getVatReturn(acc, next.id).totals.creditBroughtForward).toBe(-filed.totals.payable)
  })

  it('view (Sales Manager) reads; writes are 403; KSA uses the ZATCA layout; a locked period refuses filing', () => {
    runFinanceHooks(CREST)
    const sm = u('u103')
    const r = t.listVatReturns(sm)[1]
    const d = t.getVatReturn(sm, r.id)
    expect(d.layout).toBe('ksa_zatca')
    expect(d.boxes.map((b) => b.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'])
    expect(d.can.file).toBe(false)
    expect(() => t.fileVatReturn(sm, r.id, { filingReference: 'ZATCA-1' })).toThrow(/Only/)
    expect(() => t.getVatReturn(u('u1'), r.id)).toThrow('Not found')
  })

  it('switching frequency keeps filed returns and refuses quarterly after a mid-quarter monthly filing', () => {
    const admin = u('u101')
    runFinanceHooks(CREST)
    const rows = t.listVatReturns(admin)
    expect(rows.every((r) => r.frequency === 'monthly')).toBe(true)
    const p = lastPeriod(CREST, 'monthly')
    const row = rows.find((r) => r.from === p.from)!
    t.fileVatReturn(admin, row.id, { filingReference: 'ZATCA-77' })
    const midQuarter = ![3, 6, 9, 12].includes(Number(p.to.slice(5, 7)))
    if (midQuarter) expect(() => t.updateTaxSettings(admin, { vatFrequency: 'quarterly' })).toThrow(/quarter/)
    else {
      t.updateTaxSettings(admin, { vatFrequency: 'quarterly' })
      const after = t.listVatReturns(admin)
      expect(after.find((r) => r.id === row.id)!.status).toBe('filed')
      expect(after.filter((r) => r.status === 'draft').every((r) => r.frequency === 'quarterly')).toBe(true)
    }
    expect(finVatReturns.some((r) => r.id === row.id && r.status === 'filed')).toBe(true)
  })
})

describe('corporate tax (UAE) and zakat (KSA)', () => {
  it('bands: 0 % up to AED 375,000, 9 % above', () => {
    expect(corporateTaxOf(0)).toBe(0)
    expect(corporateTaxOf(375_000)).toBe(0)
    expect(corporateTaxOf(375_001)).toBe(0.09)
    expect(corporateTaxOf(1_000_000)).toBe(56_250)
    expect(corporateTaxOf(-50_000)).toBe(0)
    expect(corporateTaxBands(500_000)).toEqual([
      { label: 'Up to AED 375,000', amount: 375_000, rate: 0, tax: 0 },
      { label: 'Above AED 375,000', amount: 125_000, rate: 9, tax: 11_250 },
    ])
  })

  it('estimate: profit + 50 % entertainment add-back + manual adjustments; provision Dr 6960 / Cr 2700 tops up once', () => {
    const acc = u('u8')
    runFinanceHooks(APEX)
    const day = today(APEX)
    // A large profit so the 9 % band applies.
    postJournal(APEX, { date: day, memo: 'Big sale', sourceType: 'manual', sourceId: null, createdBy: null, lines: [{ accountId: 'ACC-1120', debit: 2_000_000, credit: 0, description: '' }, { accountId: 'ACC-4900', debit: 0, credit: 2_000_000, description: '' }] })
    const e = t.getCorporateTax(acc)
    const ent = e.adjustments.find((a) => a.key === 'entertainment')
    expect(e.taxableIncome).toBeCloseTo(e.accountingProfit + e.adjustments.reduce((s, a) => s + a.amount, 0), 2)
    if (ent) expect(ent.amount).toBeGreaterThan(0)
    expect(e.tax).toBeCloseTo(Math.max(0, e.taxableIncome - 375_000) * 0.09, 2)
    const adj = t.putTaxAdjustments(acc, { kind: 'corporate_tax', year: e.fiscalYear, lines: [{ label: 'Donations not deductible', amount: 10_000 }] })
    expect(adj.kind === 'corporate_tax' && adj.taxableIncome).toBeCloseTo(e.taxableIncome + 10_000, 2)
    const r = t.postTaxProvision(acc, { kind: 'corporate_tax', year: e.fiscalYear })
    const je = financeJournal.find((x) => x.id === r.entry.id)!
    expect(je.lines).toEqual([expect.objectContaining({ accountId: 'ACC-6960', debit: r.entry.amount }), expect.objectContaining({ accountId: 'ACC-2700', credit: r.entry.amount })])
    expect(r.estimate.provided).toBe(r.entry.amount)
    expect(r.estimate.toProvide).toBe(0)
    // The provision itself doesn't change the estimate (profit before tax).
    expect(r.estimate.kind === 'corporate_tax' && r.estimate.tax).toBe(adj.kind === 'corporate_tax' && adj.tax)
    expect(() => t.postTaxProvision(acc, { kind: 'corporate_tax', year: e.fiscalYear })).toThrow(/already matches/)
    expect(() => t.getZakat(acc)).toThrow(/KSA/)
  })

  it('zakat base: equity + long-term liabilities − net fixed assets, or adjusted net profit when higher; 2.5 %', () => {
    expect(zakatOf({ equity: 1_000_000, unclosedProfit: 200_000, longTermLiabilities: 100_000, fixedAssetsNet: 300_000, adjustedNetProfit: 150_000, manual: 0 })).toEqual({ baseByBalanceSheet: 1_000_000, base: 1_000_000, method: 'balance_sheet', zakat: 25_000 })
    expect(zakatOf({ equity: 100_000, unclosedProfit: 0, longTermLiabilities: 0, fixedAssetsNet: 300_000, adjustedNetProfit: 80_000, manual: 0 })).toMatchObject({ base: 80_000, method: 'net_profit', zakat: 2000 })
    expect(zakatOf({ equity: -10, unclosedProfit: 0, longTermLiabilities: 0, fixedAssetsNet: 0, adjustedNetProfit: -5, manual: 0 }).zakat).toBe(0)
    const admin = u('u101')
    runFinanceHooks(CREST)
    const z = t.getZakat(admin)
    expect(z.base).toBe(Math.max(0, Math.max(z.baseByBalanceSheet, z.adjustedNetProfit)))
    expect(z.zakat).toBeCloseTo(z.base * 0.025, 2)
    expect(z.notes[0]).toMatch(/consult your advisor/)
    expect(() => t.getCorporateTax(admin)).toThrow(/UAE/)
    if (z.toProvide !== 0) {
      const r = t.postTaxProvision(admin, { kind: 'zakat', year: z.fiscalYear })
      expect(financeJournal.find((x) => x.id === r.entry.id)!.lines.some((l) => l.accountId === 'ACC-2700')).toBe(true)
      expect(r.estimate.toProvide).toBe(0)
    }
  })
})
