import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { financeInvoices, financeJournal } from '@/shared/mocks/data/finance'
import { financeCreditNotes } from '@/shared/mocks/data/financeInvoices'
import { notifications } from '@/shared/mocks/data/tasks'
import { finDunningLog, finPayments, finPdcs } from '@/shared/mocks/data/financeCollections'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { quotations } from '@/shared/mocks/data/quotations'
import { customers, leads } from '@/shared/mocks/db'
import { createQuotation } from './quotations'
import { fixtureCreditNote, fixtureInvoice, skipCollectionsSeed } from './financeCollections.fixtures'
import {
  applyCreditFor,
  applyCreditNoteFor,
  creditNoteRemaining,
  refundCreditNote,
  bouncePdcFor,
  clearPdcFor,
  createLinkFor,
  depositPdcFor,
  ensureCollectionsSeed,
  getPublicPayment,
  payPublic,
  paymentTotals,
  receivePdcFor,
  recordPaymentFor,
  refundPayment,
  voidPaymentFor,
  DECLINED_TEST_CARD,
} from './financeCollections'
import { agingReport, balanceAsOf, bucketOf, creditVerdict, creditView, runDunning, statementOf, updateCustomerCredit } from './financeReceivables'
import { settingsRecord } from './financeCollectionsCore'
import '@/shared/mocks/handlers'

/** Accounts & finance › Collections: allocation, credit, refunds, voids, FX, PDC, aging, statements, dunning, credit, payment links. */

const snap = takeSnapshot(true)
// 08:00 UTC = 12:00 Dubai / 11:00 Riyadh on 2026-11-21.
const NOON = new Date('2026-11-21T08:00:00.000Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOON)
  restoreSnapshot(snap)
  // Each test starts from its own invoice fixtures (not the invoices section's seed).
  financeInvoices.splice(0)
  financeCreditNotes.splice(0)
  skipCollectionsSeed(APEX_ID)
  skipCollectionsSeed(CREST_ID)
})
afterEach(() => vi.useRealTimers())
afterAll(() => restoreSnapshot(snap))

const ACC = 'u8' // Apex accountant
const user = (id: string) => users.find((u) => u.id === id) as User
const firstCustomer = (co: string, i = 0) => customers.filter((c) => c.companyId === co)[i].id
const CUST = firstCustomer(APEX_ID)
const custOf = (co: string) => firstCustomer(co)
const je = (id: string) => financeJournal.find((e) => e.id === id)!
const lineSum = (jeId: string, acc: string, side: 'debit' | 'credit') => je(jeId).lines.filter((l) => l.accountId === acc).reduce((s, l) => s + l[side], 0)
const inv = (opts: Partial<Parameters<typeof fixtureInvoice>[1]> & { issueDate: string; dueDate: string }, co = APEX_ID) => fixtureInvoice(co, { customerId: custOf(co), ...opts })
const pay = (amount: number, extra: Record<string, unknown> = {}, co = APEX_ID) => recordPaymentFor(co, ACC, { customerId: custOf(co), date: '2026-11-21', method: 'bank_transfer', amount, ...extra } as never)

describe('fixtures', () => {
  it('uses real customers', () => {
    expect(users.some((u) => u.id === ACC && u.role === 'Accountant')).toBe(true)
    expect(leads.length).toBeGreaterThan(0)
  })
})

describe('allocation', () => {
  it('auto-allocates oldest due first, partially, and pays the invoices', () => {
    const late = inv({ total: 1000, issueDate: '2026-09-01', dueDate: '2026-10-01' })
    const mid = inv({ total: 500, issueDate: '2026-10-01', dueDate: '2026-11-01' })
    const p = pay(1200, { allocationMode: 'auto' })
    const mine = p.allocations.filter((a) => [late.id, mid.id].includes(a.invoiceId))
    expect(mine.map((a) => [a.invoiceId, a.amount])).toEqual([
      [late.id, 1000],
      [mid.id, 200],
    ])
    expect(late.status).toBe('paid')
    expect(mid.status).toBe('partially_paid')
    expect(mid.balanceDue).toBe(300)
    expect(lineSum(p.journalEntryIds[0], 'ACC-1200', 'credit')).toBeGreaterThanOrEqual(1200)
  })

  it('an overpayment becomes customer credit, applied to a later invoice', () => {
    const a = inv({ total: 400, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const p = pay(1000, { allocationMode: 'manual', allocations: [{ invoiceId: a.id, amount: 400 }] })
    expect(paymentTotals(p).unallocated).toBe(600)
    expect(lineSum(p.journalEntryIds[0], 'ACC-2300', 'credit')).toBe(600)
    const b = inv({ total: 250, issueDate: '2026-11-10', dueDate: '2026-12-10' })
    applyCreditFor(APEX_ID, ACC, p, { allocations: [{ invoiceId: b.id, amount: 250 }] })
    expect(b.status).toBe('paid')
    expect(paymentTotals(p).unallocated).toBe(350)
    const credit = p.journalEntryIds[1]
    expect(lineSum(credit, 'ACC-2300', 'debit')).toBe(250)
    expect(lineSum(credit, 'ACC-1200', 'credit')).toBe(250)
  })

  it('refuses over-allocation, another customer’s invoice and a future date', () => {
    const a = inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    expect(() => pay(500, { allocationMode: 'manual', allocations: [{ invoiceId: a.id, amount: 150 }] })).toThrow(/at most/)
    const other = fixtureInvoice(APEX_ID, { customerId: firstCustomer(APEX_ID, 1), total: 100, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    expect(() => pay(100, { allocationMode: 'manual', allocations: [{ invoiceId: other.id, amount: 100 }] })).toThrow(/this customer/)
    expect(() => pay(100, { date: '2026-11-22' })).toThrow(/future/)
  })

  it('bank charges: the bank gets the net, the charges are an expense', () => {
    const a = inv({ total: 1000, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const p = pay(1000, { bankCharges: 15, allocations: [{ invoiceId: a.id, amount: 1000 }] })
    expect(a.status).toBe('paid')
    expect(lineSum(p.journalEntryIds[0], 'ACC-1120', 'debit')).toBe(985)
    expect(lineSum(p.journalEntryIds[0], 'ACC-6800', 'debit')).toBe(15)
  })
})

describe('reversal', () => {
  it('void reverses every entry and restores the invoices', () => {
    const a = inv({ total: 600, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const b = inv({ total: 300, issueDate: '2026-11-02', dueDate: '2026-12-02' })
    const p = pay(700, { allocations: [{ invoiceId: a.id, amount: 600 }] })
    applyCreditFor(APEX_ID, ACC, p, {})
    expect(b.balanceDue).toBe(200)
    voidPaymentFor(APEX_ID, ACC, p, 'Wrong customer')
    expect(p.status).toBe('void')
    expect([a.balanceDue, a.status, b.balanceDue, b.status]).toEqual([600, 'issued', 300, 'issued'])
    for (const id of p.journalEntryIds) expect(je(id).status).toBe('reversed')
    expect(() => voidPaymentFor(APEX_ID, ACC, p, 'again')).toThrow(/already void/)
  })

  it('refund takes credit first, then re-opens the newest invoice', async () => {
    const a = inv({ total: 500, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const p = pay(600, { allocations: [{ invoiceId: a.id, amount: 500 }] })
    const out = await refundPayment(user(ACC), p.id, { amount: 250, date: '2026-11-21' })
    expect(out.refunded).toBe(250)
    expect(out.unallocated).toBe(0)
    expect(a.balanceDue).toBe(150)
    expect(a.status).toBe('partially_paid')
    const refundJe = p.journalEntryIds[1]
    expect(lineSum(refundJe, 'ACC-2300', 'debit')).toBe(100)
    expect(lineSum(refundJe, 'ACC-1200', 'debit')).toBe(150)
    expect(lineSum(refundJe, 'ACC-1120', 'credit')).toBe(250)
    // As of the day before the refund the invoice was fully paid.
    expect(balanceAsOf(APEX_ID, a, '2026-11-21')).toBe(150)
  })
})

describe('FX', () => {
  it('a USD invoice settled at a higher rate books an exchange gain', () => {
    const a = inv({ total: 100, currency: 'USD', exchangeRate: 3.6, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    const p = pay(100, { currency: 'USD', exchangeRate: 3.7, allocations: [{ invoiceId: a.id, amount: 100 }] })
    const id = p.journalEntryIds[0]
    expect(lineSum(id, 'ACC-1120', 'debit')).toBe(370)
    expect(lineSum(id, 'ACC-1200', 'credit')).toBe(360)
    expect(lineSum(id, 'ACC-6900', 'credit')).toBe(10)
    expect(a.status).toBe('paid')
  })

  it('a lower rate books a loss, and a payment in another currency can’t settle the invoice', () => {
    const a = inv({ total: 200, currency: 'USD', exchangeRate: 3.7, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    const p = pay(200, { currency: 'USD', exchangeRate: 3.65, allocations: [{ invoiceId: a.id, amount: 200 }] })
    expect(lineSum(p.journalEntryIds[0], 'ACC-6900', 'debit')).toBe(10)
    const b = inv({ total: 200, currency: 'USD', exchangeRate: 3.7, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    expect(() => pay(200, { allocations: [{ invoiceId: b.id, amount: 200 }] })).toThrow(/USD/)
  })
})

describe('post-dated cheques', () => {
  const cheque = (invoiceId: string, amount: number, dueDate: string, chequeNo = '000123') =>
    receivePdcFor(APEX_ID, ACC, { customerId: CUST, chequeNo, bankName: 'ENBD', receivedDate: '2026-11-15', dueDate, amount, allocations: [{ invoiceId, amount }] })

  it('received → secured, not paid; deposited on its date; cleared → receipt and paid', () => {
    const a = inv({ total: 800, issueDate: '2026-10-01', dueDate: '2026-11-01' })
    const p = cheque(a.id, 800, '2026-11-20')
    expect(a.status).toBe('issued')
    expect(a.balanceDue).toBe(800)
    expect(lineSum(p.journalEntryIds[0], 'ACC-1210', 'debit')).toBe(800)
    // A payment can't take money the cheque already secures.
    expect(() => pay(100, { allocations: [{ invoiceId: a.id, amount: 100 }] })).toThrow(/at most 0/)
    depositPdcFor(APEX_ID, p, { date: '2026-11-21' })
    expect(p.status).toBe('deposited')
    const receipt = clearPdcFor(APEX_ID, ACC, p, { date: '2026-11-21' })
    expect(p.status).toBe('cleared')
    expect(a.status).toBe('paid')
    expect(receipt.source).toBe('pdc')
    expect(lineSum(p.journalEntryIds[1], 'ACC-1120', 'debit')).toBe(800)
    expect(lineSum(p.journalEntryIds[1], 'ACC-1210', 'credit')).toBe(800)
    expect(() => voidPaymentFor(APEX_ID, ACC, receipt, 'x')).toThrow(/refund/)
  })

  it('can’t be deposited before its date', () => {
    const a = inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const p = cheque(a.id, 100, '2026-12-15')
    expect(() => depositPdcFor(APEX_ID, p, {})).toThrow(/before then/)
  })

  it('bounce reverses the receipt entry, keeps the invoice open, charges the fee, flags and notifies', () => {
    const a = inv({ total: 300, issueDate: '2026-10-01', dueDate: '2026-11-01' })
    const p = cheque(a.id, 300, '2026-11-18', '777')
    depositPdcFor(APEX_ID, p, { date: '2026-11-19' })
    const before = notifications.length
    bouncePdcFor(APEX_ID, ACC, p, { date: '2026-11-21', reason: 'Insufficient funds', bounceFee: 50 })
    expect(p.status).toBe('bounced')
    expect(je(p.journalEntryIds[0]).status).toBe('reversed')
    expect(lineSum(p.journalEntryIds[2], 'ACC-6800', 'debit')).toBe(50)
    expect(a.status).toBe('issued')
    expect(a.balanceDue).toBe(300)
    expect(creditView(APEX_ID, CUST).bouncedCheques).toBe(1)
    const fresh = notifications.slice(0, notifications.length - before)
    expect(fresh.some((n) => n.userId === ACC && n.type === 'finance' && n.title.includes('777'))).toBe(true)
    // The customer's owner too.
    expect(fresh.some((n) => n.title.includes('777') && n.userId !== ACC)).toBe(true)
    // The money is available to a payment again.
    expect(pay(300, { allocations: [{ invoiceId: a.id, amount: 300 }] }).allocations).toHaveLength(1)
  })
})

describe('aging', () => {
  it('puts balances in buckets by days past due at the date, in base currency', () => {
    inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-30' }) // current
    inv({ total: 200, issueDate: '2026-10-01', dueDate: '2026-11-11' }) // 10 days → 1–30
    inv({ total: 300, issueDate: '2026-08-01', dueDate: '2026-09-15' }) // 67 days → 61–90
    inv({ total: 10, currency: 'USD', exchangeRate: 3.6725, issueDate: '2026-05-01', dueDate: '2026-06-01' }) // 173 → 90+
    const row = agingReport(APEX_ID, '2026-11-21').rows.find((r) => r.customerId === CUST)!
    expect([row.current, row.d30, row.d60, row.d90, row.over90]).toEqual([100, 200, 0, 300, 36.73])
    expect(row.total).toBe(636.73)
    expect([bucketOf(0), bucketOf(1), bucketOf(30), bucketOf(31), bucketOf(60), bucketOf(61), bucketOf(90), bucketOf(91)]).toEqual(['current', 'd30', 'd30', 'd60', 'd60', 'd90', 'd90', 'over90'])
  })

  it('as of an earlier date, later payments don’t count', () => {
    const a = inv({ total: 500, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    pay(500, { allocations: [{ invoiceId: a.id, amount: 500 }] })
    expect(balanceAsOf(APEX_ID, a, '2026-11-20')).toBe(500)
    expect(balanceAsOf(APEX_ID, a, '2026-11-21')).toBe(0)
    expect(balanceAsOf(APEX_ID, a, '2026-09-30')).toBe(0) // not issued yet
  })

  it('today is the company’s: just after midnight in Dubai, Riyadh is still on the day before', () => {
    // 20:30 UTC on the 20th = 00:30 Dubai on the 21st, 23:30 Riyadh on the 20th.
    vi.setSystemTime(new Date('2026-11-20T20:30:00.000Z'))
    inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-20' })
    inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-20' }, CREST_ID)
    const apex = agingReport(APEX_ID, '2026-11-21')
    expect(apex.asOf).toBe('2026-11-21')
    expect(apex.rows.find((r) => r.customerId === CUST)!.d30).toBe(100)
    const crestToday = agingReport(CREST_ID, '2026-11-20')
    expect(crestToday.rows.find((r) => r.customerId === custOf(CREST_ID))!.current).toBe(100)
  })
})

describe('statement', () => {
  it('opening balance, running balance and closing balance', () => {
    const a = inv({ total: 1000, issueDate: '2026-10-05', dueDate: '2026-11-04' })
    const b = inv({ total: 400, issueDate: '2026-11-03', dueDate: '2026-12-03' })
    const p = recordPaymentFor(APEX_ID, ACC, { customerId: CUST, date: '2026-11-10', method: 'cash', amount: 1100, allocations: [{ invoiceId: a.id, amount: 1000 }, { invoiceId: b.id, amount: 100 }] })
    const s = statementOf(APEX_ID, CUST, '2026-11-01', '2026-11-21')
    const mine = s.lines.filter((l) => [b.number, p.number].includes(l.reference))
    expect(mine.map((l) => [l.type, l.debit, l.credit])).toEqual([
      ['invoice', 400, 0],
      ['payment', 0, 1100],
    ])
    // Every line's balance = previous + debit − credit, starting at the opening balance.
    let bal = s.openingBalance
    for (const l of s.lines) {
      bal = Math.round((bal + l.debit - l.credit) * 100) / 100
      expect(l.balance).toBe(bal)
    }
    expect(s.closingBalance).toBe(bal)
    // The invoice of 5 Oct sits in the opening balance.
    const before = statementOf(APEX_ID, CUST, '2026-10-01', '2026-10-31')
    expect(s.openingBalance).toBe(before.closingBalance)
  })
})

describe('dunning', () => {
  it('sends each step once; a late start sends only the latest step and skips the earlier ones', () => {
    const a = inv({ total: 100, issueDate: '2026-10-01', dueDate: '2026-11-14' }) // 7 days late today
    const before = notifications.length
    const first = runDunning(APEX_ID)
    const mine = () => finDunningLog.filter((d) => d.invoiceId === a.id)
    expect(mine().map((d) => [d.offsetDays, d.outcome])).toEqual([
      [-3, 'skipped'],
      [0, 'skipped'],
      [7, 'sent'],
    ])
    expect(first.sent).toBeGreaterThanOrEqual(1)
    runDunning(APEX_ID)
    expect(mine()).toHaveLength(3)
    // +30: the owner is notified (once).
    vi.setSystemTime(new Date('2026-12-15T08:00:00.000Z'))
    runDunning(APEX_ID)
    runDunning(APEX_ID)
    expect(mine().filter((d) => d.outcome === 'sent').map((d) => d.offsetDays)).toEqual([7, 30])
    const owner = notifications.slice(0, notifications.length - before).filter((n) => n.type === 'finance' && n.title.startsWith(a.number))
    expect(owner).toHaveLength(1)
  })

  it('a paused invoice or customer gets nothing; reminders off sends nothing', () => {
    const a = inv({ total: 100, issueDate: '2026-10-01', dueDate: '2026-11-21' })
    settingsRecord(APEX_ID).dunningEnabled = false
    runDunning(APEX_ID)
    expect(finDunningLog.some((d) => d.invoiceId === a.id)).toBe(false)
    settingsRecord(APEX_ID).dunningEnabled = true
    return updateCustomerCredit(user(ACC), CUST, { dunningPaused: true }).then(() => {
      runDunning(APEX_ID)
      expect(finDunningLog.some((d) => d.invoiceId === a.id)).toBe(false)
    })
  })
})

describe('credit limits', () => {
  it('exposure = open AR − unapplied credit; PDCs don’t reduce it', async () => {
    const a = inv({ total: 1000, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    const base = creditView(APEX_ID, CUST)
    pay(300, { allocationMode: 'none' })
    receivePdcFor(APEX_ID, ACC, { customerId: CUST, chequeNo: 'X1', bankName: 'ADCB', receivedDate: '2026-11-20', dueDate: '2026-12-20', amount: 200, allocations: [{ invoiceId: a.id, amount: 200 }] })
    const v = creditView(APEX_ID, CUST)
    expect(v.unappliedCredit - base.unappliedCredit).toBe(300)
    expect(v.pdcHeld - base.pdcHeld).toBe(200)
    expect(v.exposure).toBe(Math.max(0, Math.round((v.openAr - v.unappliedCredit) * 100) / 100))
    await updateCustomerCredit(user(ACC), CUST, { creditLimit: v.exposure + 100 })
    expect(creditVerdict(APEX_ID, CUST, 50).level).toBe('ok')
    expect(creditVerdict(APEX_ID, CUST, 150).level).toBe('warning')
    settingsRecord(APEX_ID).creditCheckMode = 'block'
    expect(creditVerdict(APEX_ID, CUST, 150).level).toBe('blocked')
    await updateCustomerCredit(user(ACC), CUST, { creditLimit: null, creditHold: true })
    expect(creditVerdict(APEX_ID, CUST, 0).level).toBe('blocked')
  })

  it('a quotation is blocked only when the company says block', async () => {
    const lead = leads.find((l) => l.companyId === APEX_ID && l.customerId === CUST)
    if (!lead) return
    await updateCustomerCredit(user(ACC), CUST, { creditHold: true })
    const admin = user('u1')
    const input = { leadId: lead.id, title: 'Credit test', validUntil: '2026-12-31', items: [{ description: 'Work', quantity: 1, unitPrice: 100, discountPct: 0, unit: 'project' }], notes: '', terms: '' }
    const n = quotations.length
    await createQuotation(admin, input as never)
    expect(quotations.length).toBe(n + 1)
    settingsRecord(APEX_ID).creditCheckMode = 'block'
    await expect(createQuotation(admin, input as never)).rejects.toMatchObject({ status: 409, code: 'credit_blocked' })
  })
})

describe('payment links', () => {
  it('a paid link records a gateway payment and pays the invoice; used, declined and foreign tokens', async () => {
    const a = inv({ total: 250, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const l = createLinkFor(APEX_ID, ACC, { invoiceId: a.id })
    const view = await getPublicPayment(l.token)
    expect(view).toMatchObject({ state: 'payable', amountDue: 250, currency: 'AED', invoiceNumber: a.number, testMode: true })
    expect(Object.keys(view).sort()).toEqual(['amountDue', 'companyName', 'currency', 'invoiceNumber', 'logoUrl', 'message', 'monogram', 'state', 'testMode'])
    await expect(payPublic(l.token, { cardholderName: 'A B', cardNumber: DECLINED_TEST_CARD, expiry: '12/30', cvc: '123' })).rejects.toMatchObject({ status: 402 })
    await expect(payPublic(l.token, { cardholderName: 'A B', cardNumber: '4242424242424241', expiry: '12/30', cvc: '123' })).rejects.toMatchObject({ status: 422 })
    const r = await payPublic(l.token, { cardholderName: 'A B', cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' })
    expect(r.paid).toBe(true)
    expect(a.status).toBe('paid')
    const p = finPayments.find((x) => x.paymentLinkId === l.id)!
    expect(p.depositAccountId).toBe('ACC-1140')
    expect(p.cardHint).toBe('Visa •••• 4242')
    expect(JSON.stringify(finPayments)).not.toContain('4242424242424242')
    expect((await getPublicPayment(l.token)).state).toBe('paid')
    await expect(payPublic(l.token, { cardholderName: 'A B', cardNumber: '4242424242424242', expiry: '12/30', cvc: '123' })).rejects.toMatchObject({ status: 409 })
    await expect(getPublicPayment('nope'.repeat(8))).rejects.toMatchObject({ status: 404 })
  })

  it('expires after its last day', async () => {
    const a = inv({ total: 250, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const l = createLinkFor(APEX_ID, ACC, { invoiceId: a.id, expiresInDays: 1 })
    vi.setSystemTime(new Date('2026-11-23T08:00:00.000Z'))
    expect((await getPublicPayment(l.token)).state).toBe('expired')
  })
})

describe('lazy seed', () => {
  it('seeds from the company’s issued invoices once, through the services', () => {
    restoreSnapshot(snap)
    const before = finPayments.filter((p) => p.companyId === APEX_ID).length
    ensureCollectionsSeed(APEX_ID)
    const after = finPayments.filter((p) => p.companyId === APEX_ID)
    expect(after.length).toBeGreaterThan(before)
    expect(after.some((p) => p.source === 'payment_link')).toBe(true)
    expect(finPdcs.some((p) => p.companyId === APEX_ID && p.status === 'bounced')).toBe(true)
    expect(finPdcs.some((p) => p.companyId === APEX_ID && p.status === 'received')).toBe(true)
    expect(after.some((p) => paymentTotals(p).unallocated > 0)).toBe(true)
    const n = finPayments.length
    ensureCollectionsSeed(APEX_ID)
    expect(finPayments.length).toBe(n)
    expect(finPayments.some((p) => p.companyId === CREST_ID)).toBe(false)
    // Crest's ledger is locked through 2025: its seed posts after the lock date.
    ensureCollectionsSeed(CREST_ID)
    const crest = finPayments.filter((p) => p.companyId === CREST_ID)
    expect(crest.length).toBeGreaterThan(2)
    expect(crest.every((p) => p.date >= '2026-01-01')).toBe(true)
  })
})

describe('credit-note excess is customer credit', () => {
  it('counts as unapplied credit, applies to another invoice and can be refunded', async () => {
    const a = inv({ total: 300, issueDate: '2026-10-01', dueDate: '2026-10-31' })
    const b = inv({ total: 100, issueDate: '2026-11-01', dueDate: '2026-11-30' })
    const before = creditView(APEX_ID, CUST).unappliedCredit
    const n = fixtureCreditNote(APEX_ID, a, 150, '2026-11-15')
    expect(creditView(APEX_ID, CUST).unappliedCredit - before).toBe(150)
    applyCreditNoteFor(APEX_ID, ACC, n, { allocations: [{ invoiceId: b.id, amount: 100 }] })
    expect(b.status).toBe('paid')
    expect(creditNoteRemaining(APEX_ID, n)).toBe(50)
    const r = await refundCreditNote(user(ACC), n.id, { amount: 50, date: '2026-11-21' })
    expect(r.remaining).toBe(0)
    await expect(refundCreditNote(user(ACC), n.id, { amount: 1, date: '2026-11-21' })).rejects.toMatchObject({ status: 422 })
    expect(statementOf(APEX_ID, CUST, '2026-11-01', '2026-11-21').lines.some((l) => l.type === 'refund' && l.reference === n.number)).toBe(true)
  })
})
