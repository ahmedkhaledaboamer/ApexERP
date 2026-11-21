import { afterEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeJournal } from '@/shared/mocks/data/finance'
import { notifications } from '@/shared/mocks/data/tasks'
import { finBills, finPurchaseOrders, finSupplierProfiles } from '@/shared/mocks/data/financePurchases'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { advanceClock, resetClock } from '@/shared/mocks/clock'
import { addDaysIso, round2, toBase } from '@/modules/finance/invoices/calc'
import { apBucketOf, isValidIban, matchLine, maskIban, purchaseLine, purchaseTotals } from '@/modules/finance/purchases/calc'
import { approvalChain } from './financeApprovals'
import { billPostingLines, todayOf, apAgingOf, statementOf, billBalanceAsOf } from './financePurchasesCore'
import { ibanFor } from '@/shared/mocks/data/financePurchasesSeed'
import * as fin from './financePurchases'
import '@/shared/mocks/handlers'

/** Accounts & finance › Purchases & payables: math, postings, approvals, receipts / matching, balances, aging, statement. */

const seed = takeSnapshot(true)
afterEach(() => {
  restoreSnapshot(seed)
  resetClock()
})

const u = (id: string) => users.find((x) => x.id === id)! as User
const entry = (id: string | null) => financeJournal.find((e) => e.id === id)!
const balanced = (lines: { debit: number; credit: number }[]) => round2(lines.reduce((s, l) => s + l.debit, 0)) === round2(lines.reduce((s, l) => s + l.credit, 0))
const sumBy = (lines: { accountId: string; debit: number; credit: number }[], acc: string) => round2(lines.filter((l) => l.accountId === acc).reduce((s, l) => s + l.debit - l.credit, 0))
const bill = (id: string) => finBills.find((b) => b.id === id)!

describe('line and VAT math', () => {
  it('rounds VAT per line and sums', () => {
    expect(purchaseLine(3, 33.335, 5)).toEqual({ net: 100.01, taxAmount: 5, total: 105.01 })
    expect(purchaseLine(1, 0.1, 15).taxAmount).toBe(0.02)
    expect(purchaseTotals([purchaseLine(2, 100, 5), purchaseLine(1, 50, 0)])).toEqual({ subtotal: 250, taxTotal: 10, total: 260 })
  })
  it('IBAN check digits and masking', () => {
    expect(isValidIban(ibanFor('AE', '0260001015123456789'))).toBe(true)
    expect(isValidIban('AE070331234567890123456')).toBe(true)
    expect(isValidIban('AE080331234567890123456')).toBe(false)
    expect(maskIban('SA0380000000608010167519')).toBe('•••• 7519')
  })
  it('VAT input only for a supplier with a VAT number on a standard line; otherwise VAT is cost', () => {
    const b = fin.createBill(u('u8'), { vendorId: 'VND-1003', supplierInvoiceNumber: 'T-NOVAT', lines: [{ description: 'x', quantity: 1, unitPrice: 1000, taxCodeId: 'VAT5' }] })
    expect(b.lines[0].vatRecoverable).toBe(false)
    const lines = billPostingLines(APEX_ID, bill(b.id))
    expect(sumBy(lines, 'ACC-1300')).toBe(0)
    expect(sumBy(lines, b.lines[0].accountId)).toBe(1050)
    const c = fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'T-VAT', lines: [{ description: 'x', quantity: 1, unitPrice: 1000, taxCodeId: 'VAT5' }, { description: 'y', quantity: 1, unitPrice: 200, taxCodeId: 'ZR' }] })
    expect(c.recoverableTax).toBe(50)
    const l2 = billPostingLines(APEX_ID, bill(c.id))
    expect(sumBy(l2, 'ACC-1300')).toBe(50)
    expect(sumBy(l2, 'ACC-2100')).toBe(-1250)
    expect(balanced(l2)).toBe(true)
  })
})

describe('postings in base currency', () => {
  it('a USD bill posts AP and cost at its rate, balanced; payment at another rate books the FX difference', () => {
    const b = fin.createBill(u('u8'), { vendorId: 'VND-1005', supplierInvoiceNumber: 'T-USD', currency: 'USD', exchangeRate: 3.6725, lines: [{ description: 'Licence', quantity: 3, unitPrice: 333.33, taxCodeId: 'ZR' }] })
    // 999.99 USD × 3.6725 — no approval needed? bill chain starts at 0 → submit then approve by another user.
    fin.submitBill(u('u8'), b.id)
    const posted = fin.approveBill(u('u2'), b.id)
    expect(posted.status).toBe('open')
    const je = entry(posted.journal!.id)
    expect(balanced(je.lines)).toBe(true)
    expect(sumBy(je.lines, 'ACC-2100')).toBe(-toBase(999.99, 3.6725))
    const pay = fin.createBillPayment(u('u8'), { vendorId: 'VND-1005', paymentAccountId: 'ACC-1120', exchangeRate: 3.7, bankCharges: 25, allocations: [{ billId: b.id, amount: 999.99 }] })
    const pe = entry(pay.journal!.id)
    expect(balanced(pe.lines)).toBe(true)
    expect(sumBy(pe.lines, 'ACC-2100')).toBe(toBase(999.99, 3.6725))
    expect(sumBy(pe.lines, 'ACC-1120')).toBe(-round2(toBase(999.99, 3.7) + 25))
    expect(pay.fxDifference).toBe(round2(toBase(999.99, 3.6725) - toBase(999.99, 3.7)))
    expect(sumBy(pe.lines, 'ACC-6900')).toBe(-pay.fxDifference)
    expect(sumBy(pe.lines, 'ACC-6800')).toBe(25)
    expect(fin.getBill(u('u8'), b.id).status).toBe('paid')
  })
  it('every seeded posting is balanced and never on or before Crest’s lock date', () => {
    for (const b of finBills.filter((x) => x.journalEntryId)) {
      const e = entry(b.journalEntryId)
      expect(balanced(e.lines), b.id).toBe(true)
      if (b.companyId === CREST_ID) expect(e.date > '2025-12-31').toBe(true)
    }
  })
  it('a locked period answers 423 and posts nothing', () => {
    const b = fin.createBill(u('u101'), { vendorId: 'VND-5002', supplierInvoiceNumber: 'T-LOCK', billDate: '2025-06-01', lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] })
    const before = financeJournal.length
    fin.submitBill(u('u101'), b.id)
    expect(() => fin.approveBill(u('u102'), b.id)).toThrow(expect.objectContaining({ status: 423 }))
    expect(financeJournal.length).toBe(before)
    expect(fin.getBill(u('u101'), b.id).status).toBe('pending_approval')
  })
})

describe('approval chains per band, maker–checker', () => {
  it('PO bands: dept head < 10k; + accountant from 10k; + management from 50k', () => {
    expect(approvalChain(APEX_ID, 'purchase_order', 9_999).map((s) => s.approver)).toEqual(['department_head'])
    expect(approvalChain(APEX_ID, 'purchase_order', 12_000).map((s) => s.approver)).toEqual(['department_head', 'Accountant'])
    expect(approvalChain(APEX_ID, 'bill', 60_000).map((s) => s.approver)).toEqual(['Accountant', 'Management'])
  })
  it('employee request → own department only; head approves step 1, accountant step 2; requester can’t approve', () => {
    const emp = u('u11')
    expect(() => fin.createPurchaseOrder(emp, { vendorId: 'VND-1002', departmentId: 'd-sales', lines: [{ description: 'x', quantity: 1, unitPrice: 10 }] })).toThrow(expect.objectContaining({ status: 403, code: 'own_department_only' }))
    const po = fin.createPurchaseOrder(emp, { vendorId: 'VND-1002', lines: [{ description: 'Banners', quantity: 10, unitPrice: 1200 }] })
    expect(po.departmentId).toBe('d-delivery')
    const sub = fin.submitPurchaseOrder(emp, po.id)
    expect(sub.status).toBe('pending_approval')
    expect(sub.approvals.map((a) => a.approver)).toEqual(['department_head', 'Accountant'])
    expect(notifications.some((n) => n.userId === 'u10' && n.type === 'finance' && n.link?.includes(po.id))).toBe(true)
    expect(() => fin.approvePurchaseOrder(u('u8'), po.id)).toThrow(expect.objectContaining({ code: 'not_your_step' }))
    const s1 = fin.approvePurchaseOrder(u('u10'), po.id)
    expect(s1.status).toBe('pending_approval')
    expect(() => fin.approvePurchaseOrder(u('u10'), po.id)).toThrow(expect.objectContaining({ code: 'already_approved_step' }))
    const s2 = fin.approvePurchaseOrder(u('u8'), po.id)
    expect(s2.status).toBe('approved')
    expect(notifications.filter((n) => n.userId === 'u11' && n.title === 'Purchase order approved' && n.link?.includes(po.id)).length).toBe(1)
  })
  it('maker–checker on bills; a rejection needs a reason and tells the requester', () => {
    const b = fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'T-MC', lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] })
    fin.submitBill(u('u8'), b.id)
    expect(() => fin.approveBill(u('u8'), b.id)).toThrow(expect.objectContaining({ code: 'own_request' }))
    expect(() => fin.rejectBill(u('u2'), b.id, { reason: '' })).toThrow(expect.objectContaining({ code: 'reason_required' }))
    const r = fin.rejectBill(u('u2'), b.id, { reason: 'Wrong amount' })
    expect(r.status).toBe('rejected')
    expect(notifications.some((n) => n.userId === 'u8' && n.title === 'Bill rejected')).toBe(true)
  })
  it('editing the rules changes the chain (audited editors only)', () => {
    expect(() => fin.saveApprovalRules(u('u2'), { docType: 'bill', rules: [] })).toThrow(expect.objectContaining({ status: 403 }))
    const v = fin.saveApprovalRules(u('u8'), { docType: 'bill', rules: [{ minAmount: 1000, approver: 'Management' }] })
    expect(v.rules.filter((r) => r.docType === 'bill')).toEqual([{ docType: 'bill', minAmount: 1000, approver: 'Management' }])
    expect(approvalChain(APEX_ID, 'bill', 500)).toEqual([])
    // An empty chain posts on submit.
    const b = fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'T-EMPTY', lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] })
    expect(fin.submitBill(u('u8'), b.id).status).toBe('open')
    expect(() => fin.saveApprovalRules(u('u8'), { docType: 'bill', rules: [{ minAmount: 0, approver: 'Accountant' }, { minAmount: 5, approver: 'Accountant' }] })).toThrow(expect.objectContaining({ code: 'duplicate_approver' }))
  })
})

describe('PO receipt and match tolerance', () => {
  it('matchLine: price tolerance, ordered (2-way) and received (3-way) quantities', () => {
    expect(matchLine({ lineId: 'a', description: 'x', quantity: 1, unitPrice: 102 }, { quantity: 1, unitPrice: 100, receivedQty: 1, billedElsewhere: 0 }, true, 2)).toEqual([])
    expect(matchLine({ lineId: 'a', description: 'x', quantity: 1, unitPrice: 102.5 }, { quantity: 1, unitPrice: 100, receivedQty: 1, billedElsewhere: 0 }, true, 2)[0].kind).toBe('price')
    expect(matchLine({ lineId: 'a', description: 'x', quantity: 3, unitPrice: 100 }, { quantity: 5, unitPrice: 100, receivedQty: 2, billedElsewhere: 0 }, true, 2)[0].kind).toBe('not_received')
    expect(matchLine({ lineId: 'a', description: 'x', quantity: 3, unitPrice: 100 }, { quantity: 5, unitPrice: 100, receivedQty: 0, billedElsewhere: 3 }, false, 2)[0].kind).toBe('quantity')
  })
  it('receipt → bill from PO prefilled with the received quantity, posts directly, PO closes when all billed', () => {
    const emp = u('u14')
    const po = fin.createPurchaseOrder(emp, { vendorId: 'VND-1005', lines: [{ description: 'Shoot', quantity: 4, unitPrice: 500 }] })
    fin.submitPurchaseOrder(emp, po.id)
    fin.approvePurchaseOrder(u('u10'), po.id)
    expect(() => fin.receivePurchaseOrder(emp, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 5 }] })).toThrow(expect.objectContaining({ code: 'over_received' }))
    const r = fin.receivePurchaseOrder(emp, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 2 }] })
    expect(r.status).toBe('partially_received')
    const b = fin.createBill(u('u8'), { poId: po.id, supplierInvoiceNumber: 'T-PO' })
    expect(b.lines[0].quantity).toBe(2)
    expect(b.match).toMatchObject({ kind: 'three_way', ok: true })
    expect(b.can.post).toBe(true)
    // Raising the price beyond the tolerance needs approval.
    const e = fin.updateBill(u('u8'), b.id, { lines: [{ ...b.lines[0], unitPrice: 520 }] })
    expect(e.match.ok).toBe(false)
    expect(() => fin.postBill(u('u8'), b.id)).toThrow(expect.objectContaining({ code: 'approval_required' }))
    fin.updateBill(u('u8'), b.id, { lines: [{ ...b.lines[0], unitPrice: 500 }] })
    expect(fin.postBill(u('u8'), b.id).status).toBe('open')
    fin.receivePurchaseOrder(emp, po.id, { lines: [{ lineId: po.lines[0].id, quantity: 2 }] })
    const b2 = fin.createBill(u('u8'), { poId: po.id, supplierInvoiceNumber: 'T-PO-2' })
    fin.postBill(u('u8'), b2.id)
    expect(fin.getPurchaseOrder(u('u8'), po.id).status).toBe('closed')
    expect(() => fin.createBill(u('u8'), { poId: po.id, supplierInvoiceNumber: 'T-PO-3' })).toThrow(expect.objectContaining({ status: 409 }))
  })
  it('supplier invoice numbers are unique per supplier', () => {
    expect(() => fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'EPH-26-0412', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] })).toThrow(expect.objectContaining({ code: 'duplicate_supplier_invoice' }))
    expect(fin.createBill(u('u8'), { vendorId: 'VND-1001', supplierInvoiceNumber: 'EPH-26-0412', lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).status).toBe('draft')
  })
})

describe('bill balance through payments, debit notes and voids', () => {
  it('partial payment, debit note, void payment, then void bill', () => {
    const b = fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'T-BAL', lines: [{ description: 'x', quantity: 1, unitPrice: 1000 }] })
    fin.submitBill(u('u8'), b.id)
    fin.approveBill(u('u2'), b.id)
    expect(bill(b.id)).toMatchObject({ total: 1050, balanceDue: 1050, status: 'open' })
    const p = fin.createBillPayment(u('u8'), { vendorId: 'VND-1002', paymentAccountId: 'ACC-1120', allocations: [{ billId: b.id, amount: 400 }] })
    expect(bill(b.id)).toMatchObject({ amountPaid: 400, balanceDue: 650, status: 'partially_paid' })
    expect(() => fin.createDebitNote(u('u8'), { billId: b.id, reason: 'Too much', amount: 700 })).toThrow(expect.objectContaining({ code: 'exceeds_balance' }))
    const dn = fin.createDebitNote(u('u8'), { billId: b.id, reason: 'Short delivery', amount: 210 })
    expect(dn).toMatchObject({ net: 200, taxAmount: 10, total: 210 })
    expect(bill(b.id)).toMatchObject({ amountCredited: 210, balanceDue: 440 })
    expect(() => fin.voidBill(u('u8'), b.id, { reason: 'Mistake' })).toThrow(expect.objectContaining({ code: 'has_settlements' }))
    fin.voidBillPayment(u('u8'), p.id, { reason: 'Bounced transfer' })
    expect(bill(b.id)).toMatchObject({ amountPaid: 0, balanceDue: 840, status: 'partially_paid' })
    const c = fin.createBill(u('u8'), { vendorId: 'VND-1002', supplierInvoiceNumber: 'T-VOID', lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] })
    fin.submitBill(u('u8'), c.id)
    fin.approveBill(u('u2'), c.id)
    const v = fin.voidBill(u('u8'), c.id, { reason: 'Entered twice' })
    expect(v.status).toBe('void')
    expect(entry(v.journal!.id).status).toBe('reversed')
  })
  it('a payment run pays several suppliers, one voucher each', () => {
    const open = finBills.filter((b) => b.companyId === APEX_ID && (b.status === 'open' || b.status === 'partially_paid') && b.currency === 'AED')
    const two = [open[0], open.find((b) => b.vendorId !== open[0].vendorId)!]
    const run = fin.createPaymentRun(u('u8'), { paymentAccountId: 'ACC-1120', items: two.map((b) => ({ billId: b.id, amount: b.balanceDue })) })
    expect(run.payments).toHaveLength(2)
    for (const b of two) expect(bill(b.id).status).toBe('paid')
  })
})

describe('AP aging and statement', () => {
  it('buckets by days past due', () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(apBucketOf)).toEqual(['current', 'd30', 'd30', 'd60', 'd60', 'd90', 'd90', 'over90'])
  })
  it('aging uses the company’s today (timezone) and sums live balances; as-of rebuilds from dated payments', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const a = apAgingOf(co, todayOf(co))
      const open = finBills.filter((b) => b.companyId === co && (b.status === 'open' || b.status === 'partially_paid'))
      expect(a.totals.total).toBe(round2(open.reduce((s, b) => s + toBase(b.balanceDue, b.exchangeRate), 0)))
      expect(a.totals.over90).toBeGreaterThan(0)
      expect(a.totals.current).toBeGreaterThan(0)
    }
    // Before the seeded payment run, the partially paid bill had its full balance.
    const partial = finBills.find((b) => b.id === 'BILL-1004')!
    expect(billBalanceAsOf(APEX_ID, partial, addDaysIso(todayOf(APEX_ID), -5))).toBe(partial.total)
    const now = apAgingOf(APEX_ID, todayOf(APEX_ID))
    advanceClock(40)
    const later = apAgingOf(APEX_ID, todayOf(APEX_ID))
    expect(later.totals.total).toBe(now.totals.total)
    expect(later.totals.current).toBeLessThan(now.totals.current)
  })
  it('statement: opening + bills − payments − debit notes = closing', () => {
    const today = todayOf(APEX_ID)
    const s = statementOf(APEX_ID, 'VND-1002', addDaysIso(today, -365), today)
    const net = round2(s.lines.reduce((x, l) => x + l.credit - l.debit, 0))
    expect(round2(s.openingBalance + net)).toBe(s.closingBalance)
    const open = finBills.filter((b) => b.companyId === APEX_ID && b.vendorId === 'VND-1002' && b.status !== 'void').reduce((x, b) => x + toBase(b.balanceDue, b.exchangeRate), 0)
    expect(s.closingBalance).toBe(round2(open))
  })
})

describe('suppliers: IBAN stored in full, served masked, revealed audited', () => {
  it('masks in the detail and list; reveal for accounting full only', () => {
    const d = fin.getSupplier(u('u8'), 'VND-1001')
    const full = finSupplierProfiles.find((p) => p.vendorId === 'VND-1001')!.iban
    expect(JSON.stringify(d)).not.toContain(full)
    expect(d.ibanMasked).toBe(maskIban(full))
    expect(fin.revealSupplierIban(u('u8'), 'VND-1001').iban).toBe(full)
    expect(() => fin.revealSupplierIban(u('u3'), 'VND-1001')).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => fin.updateSupplier(u('u8'), 'VND-1001', { iban: 'AE000000' })).toThrow(expect.objectContaining({ code: 'invalid_iban' }))
  })
  it('creates a supplier in the vendor directory with category other', () => {
    const s = fin.createSupplier(u('u8'), { name: 'Finance Created Supplier LLC', vatNumber: '100999888700003', paymentTermsDays: 45 })
    expect(s).toMatchObject({ category: 'other', paymentTermsDays: 45, vatNumber: '100999888700003' })
    expect(() => fin.createSupplier(u('u8'), { name: 'Finance Created Supplier LLC' })).toThrow(expect.objectContaining({ code: 'vendor_exists' }))
  })
})

describe('seed', () => {
  it('POs in every status, ~11 bills per company', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const st = new Set(finPurchaseOrders.filter((p) => p.companyId === co).map((p) => p.status))
      for (const s of ['draft', 'pending_approval', 'rejected', 'approved', 'partially_received', 'received', 'closed', 'cancelled']) expect(st, `${co} ${s}`).toContain(s)
      const bills = finBills.filter((b) => b.companyId === co)
      expect(bills.length).toBeGreaterThanOrEqual(10)
      for (const s of ['open', 'partially_paid', 'paid', 'draft', 'pending_approval', 'void']) expect(bills.map((b) => b.status), `${co} ${s}`).toContain(s)
      expect(bills.some((b) => b.currency === 'USD')).toBe(true)
      expect(bills.some((b) => b.amountCredited > 0)).toBe(true)
    }
  })
})
