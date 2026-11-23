import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeJournal } from '@/shared/mocks/data/finance'
import { finBills, finDebitNotes, finPaymentRuns, finSupplierAdvances, finSupplierProfiles } from '@/shared/mocks/data/financePurchases'
import { finEosbPeriods, finEosbUses } from '@/shared/mocks/data/financeEosb'
import { finBankAccounts } from '@/shared/mocks/data/financeBanking'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrFinalSettlements } from '@/shared/mocks/data/hrPayroll'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { addDaysIso, round2, toBase } from '@/modules/finance/invoices/calc'
import { monthRange } from '@/modules/finance/ledger/calc'
import { PAYMENT_FILE_TEMPLATE_DEF, bankCodeOf, buildPaymentFile, columnsFor } from '@/modules/finance/purchases/bankFile'
import { gratuity } from '@/modules/hr/payroll/calc'
import { eventActualCost } from '@/shared/mocks/selectors/events'
import { runFinanceHooks } from './ledger'
import * as fin from './financePurchases'
import { apAgingOf, billBalanceAsOf, statementOf, todayOf, unappliedAdvancesBase } from './financePurchasesCore'
import { accrueEosbThrough, eosbTarget, getEosbProvision, provisionOf, runEosbProvision } from './financeEosb'
import { settlementLines, syncPayrollPostings } from './financePayrollGl'
import { budgetOf } from './eventBudget'
import { getTrialBalance } from './financeLedger'
import '@/shared/mocks/handlers'

/**
 * The finance gaps (docs/DB-ALIGNMENT.md F-P10 / F-P11 / F-P12 / F-P14 / F-B5): supplier advances, the payment-run
 * bank file, debit-note void, the monthly EOSB provision and the event budget's billed column.
 */

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const balanceOf = (co: string, account: string) => round2(financeJournal.filter((e) => e.companyId === co).flatMap((e) => e.lines).filter((l) => l.accountId === account).reduce((s, l) => s + l.debit - l.credit, 0))
const entry = (id: string) => financeJournal.find((e) => e.id === id)!
const line = (id: string, account: string) => entry(id).lines.find((l) => l.accountId === account)
const openBaseBill = (co: string) => finBills.find((b) => b.companyId === co && (b.status === 'open' || b.status === 'partially_paid') && b.balanceDue > 100 && b.exchangeRate === 1)!

describe('supplier advances', () => {
  it('pay → Dr 1420 / Cr bank; apply → Dr AP / Cr 1420 through the bill balance; refund → Dr bank / Cr 1420', () => {
    const admin = u('u1')
    runFinanceHooks(APEX_ID)
    const bill = openBaseBill(APEX_ID)
    const before1420 = balanceOf(APEX_ID, 'ACC-1420')
    const bank0 = balanceOf(APEX_ID, 'ACC-1120')
    const adv = fin.createSupplierAdvance(admin, { vendorId: bill.vendorId, paymentAccountId: 'ACC-1120', amount: 1000, reference: 'TEST-ADV' })
    expect(adv.number).toMatch(/-ADV-\d{4}-\d{4}$/)
    expect(line(adv.journal!.id, 'ACC-1420')!.debit).toBe(1000)
    expect(line(adv.journal!.id, 'ACC-1120')!.credit).toBe(1000)
    expect(balanceOf(APEX_ID, 'ACC-1420')).toBe(round2(before1420 + 1000))
    expect(balanceOf(APEX_ID, 'ACC-1120')).toBe(round2(bank0 - 1000))
    const advBase0 = unappliedAdvancesBase(APEX_ID, bill.vendorId)

    // Apply 300 to the bill: the bill's balance moves through applyToBill.
    const due0 = bill.balanceDue
    const paid0 = bill.amountPaid
    const applied = fin.applySupplierAdvance(admin, adv.id, { billId: bill.id, amount: 300 })
    expect(applied.applied).toBe(300)
    expect(applied.remaining).toBe(700)
    expect(bill.balanceDue).toBe(round2(due0 - 300))
    expect(bill.amountPaid).toBe(round2(paid0 + 300))
    expect(bill.status).toBe('partially_paid')
    const app = applied.applications[0]
    expect(line(app.journalEntryId, 'ACC-2100')!.debit).toBe(300)
    expect(line(app.journalEntryId, 'ACC-1420')!.credit).toBe(300)
    expect(unappliedAdvancesBase(APEX_ID, bill.vendorId)).toBe(round2(advBase0 - 300))
    expect(billBalanceAsOf(APEX_ID, bill, todayOf(APEX_ID))).toBe(bill.balanceDue)

    // More than the remaining advance / the bill's balance → 422.
    expect(() => fin.applySupplierAdvance(admin, adv.id, { billId: bill.id, amount: 701 })).toThrow(/unapplied|due/)

    // Refund 200 back to the bank.
    const refunded = fin.refundSupplierAdvance(admin, adv.id, { amount: 200 })
    expect(refunded.remaining).toBe(500)
    expect(line(refunded.refunds[0].journalEntryId, 'ACC-1120')!.debit).toBe(200)
    expect(balanceOf(APEX_ID, 'ACC-1420')).toBe(round2(before1420 + 500))
    expect(() => fin.refundSupplierAdvance(admin, adv.id, { amount: 600 })).toThrow(/unapplied/)

    // A bill with an applied advance can't be voided (its settlements must go first).
    expect(() => fin.voidBill(admin, bill.id, { reason: 'Test void' })).toThrow(/advances|payments/)
    expect(getTrialBalance(admin).balanced).toBe(true)
  })

  it('aging and the statement include advances; the PO advance % is used by the bill posted from it', () => {
    const admin = u('u1')
    runFinanceHooks(APEX_ID)
    const today = todayOf(APEX_ID)
    // Seeded: a 30 % advance on PO-1005 (VND-1002), unapplied.
    const seeded = finSupplierAdvances.find((a) => a.companyId === APEX_ID && a.poId === 'PO-1005')!
    expect(seeded).toBeTruthy()
    const aging = apAgingOf(APEX_ID, today)
    const row = aging.rows.find((r) => r.vendorId === 'VND-1002')!
    expect(row.advances).toBe(unappliedAdvancesBase(APEX_ID, 'VND-1002'))
    expect(row.net).toBe(round2(row.total - row.advances))
    expect(aging.totals.advances).toBe(round2(aging.rows.reduce((s, r) => s + r.advances, 0)))
    const st = statementOf(APEX_ID, 'VND-1002', addDaysIso(today, -365), today)
    expect(st.lines.some((l) => l.type === 'advance' && l.reference === seeded.number)).toBe(true)

    // A bill from PO-1005 picks up its advance automatically when posted.
    const po = fin.getPurchaseOrder(admin, 'PO-1005')
    expect(po.advancePct).toBe(30)
    expect(po.advanceDue).toBe(round2(po.total * 0.3))
    const b = fin.createBill(admin, { poId: 'PO-1005', supplierInvoiceNumber: 'ADV-TEST-1' })
    fin.postBill(admin, b.id)
    const after = fin.getBill(admin, b.id)
    expect(after.advances.reduce((s, x) => s + x.amount, 0)).toBe(seeded.amount)
    expect(after.balanceDue).toBe(round2(after.total - seeded.amount))
    expect(finSupplierAdvances.find((a) => a.id === seeded.id)!.applications.length).toBe(1)
  })

  it('accounting full only: view roles read, others are refused', () => {
    runFinanceHooks(APEX_ID)
    expect(fin.listSupplierAdvances(u('u3')).length).toBeGreaterThan(0) // Sales Manager: view
    expect(() => fin.createSupplierAdvance(u('u3'), { vendorId: 'VND-1002', paymentAccountId: 'ACC-1120', amount: 1 })).toThrow(/Only/)
    expect(() => fin.listSupplierAdvances(u('u5'))).toThrow() // Sales Agent: hidden
    expect(() => fin.createSupplierAdvance(u('u11'), { vendorId: 'VND-1002', paymentAccountId: 'ACC-1120', amount: 1 })).toThrow()
  })
})

describe('payment-run bank file', () => {
  it('builds the template columns, a header and a TOTAL trailer with the control total', () => {
    const rows = [
      { beneficiaryName: 'Emirates Print House', iban: 'AE070331234567890123456', bankName: 'Mashreq', swiftBic: 'BOMLAEAD', amount: 1200.5, currency: 'AED', valueDate: '2026-11-20', reference: 'PV-1 PRUN-1' },
      { beneficiaryName: 'Comma, Quote "Co"', iban: 'AE460030012055609300201', bankName: 'ADCB', swiftBic: '', amount: 99.5, currency: 'AED', valueDate: '2026-11-20', reference: 'PV-2 PRUN-1' },
    ]
    const cols = columnsFor('ae_adcb_bulk', null)
    expect(cols).toEqual(PAYMENT_FILE_TEMPLATE_DEF.ae_adcb_bulk.columns)
    const f = buildPaymentFile('ae_adcb_bulk', cols, rows, { debitAccount: 'AE000', purposeCode: 'SUP' })
    const lines = f.content.trim().split('\r\n')
    expect(lines[0]).toBe('Beneficiary name,Beneficiary IBAN,Amount,Currency,Value date,Payment reference,Purpose code')
    expect(lines[1]).toBe('Emirates Print House,AE070331234567890123456,1200.50,AED,2026-11-20,PV-1 PRUN-1,SUP')
    expect(lines[2].startsWith('"Comma, Quote ""Co""",')).toBe(true)
    expect(lines[3]).toBe('TOTAL,2,1300.00')
    expect(f.total).toBe(1300)
    // Configured columns (subset / order) and the KSA bank code from the IBAN.
    expect(columnsFor('sa_alrajhi_bulk', ['amount', 'iban', 'bogus'])).toEqual(['amount', 'iban'])
    expect(bankCodeOf('SA0380000000608010167519')).toBe('80')
    const swift = buildPaymentFile('swift_mt103', columnsFor('swift_mt103', null), [rows[0]], { debitAccount: 'AE330330000019400772188', purposeCode: 'SUP' })
    expect(swift.content.split('\r\n')[0]).toContain('32A Amount')
    expect(swift.content).toContain('BOMLAEAD')
    expect(swift.content).toContain(',SHA')
  })

  it('exports the run (full IBANs only in the POST answer, audited), then sent → confirmed; accounting full only', () => {
    const admin = u('u1')
    runFinanceHooks(APEX_ID)
    const run = finPaymentRuns.find((r) => r.companyId === APEX_ID)!
    const f = fin.exportPaymentRunFile(admin, run.id)
    expect(f.files.length).toBeGreaterThan(0)
    const local = f.files.find((x) => x.kind === 'local')!
    expect(local.template).toBe('ae_enbd_bulk')
    const ibans = finSupplierProfiles.filter((p) => p.companyId === APEX_ID && p.iban).map((p) => p.iban)
    expect(ibans.some((i) => local.content.includes(i))).toBe(true)
    const bodyLines = local.content.trim().split('\r\n')
    expect(bodyLines[bodyLines.length - 1]).toBe(`TOTAL,${local.count},${local.total.toFixed(2)}`)
    // The company's own debit account (ENBD template) is in the file too, and nowhere in a GET.
    const main = finBankAccounts.find((b) => b.companyId === APEX_ID && b.ledgerAccountId === 'ACC-1120')!
    expect(local.content).toContain(main.iban)
    const listed = JSON.stringify(fin.listPaymentRuns(admin))
    for (const i of [...ibans, main.iban]) expect(listed.includes(i)).toBe(false)

    expect(() => fin.exportPaymentRunFile(u('u3'), run.id)).toThrow(/Only/) // Sales Manager: view
    expect(() => fin.confirmPaymentRun(admin, run.id, null)).toThrow(/sent/)
    expect(fin.markPaymentRunSent(admin, run.id, { bankReference: 'ENBD-UP-1' }).bankStatus).toBe('sent')
    const c = fin.confirmPaymentRun(admin, run.id, null)
    expect(c.bankStatus).toBe('confirmed')
    expect(c.bankReference).toBe('ENBD-UP-1')
    expect(c.exportCount).toBe(1)
  })

  it('a fresh run can’t be marked sent before its file is exported', () => {
    const admin = u('u101')
    runFinanceHooks(CREST_ID)
    const bill = openBaseBill(CREST_ID)
    const r = fin.createPaymentRun(admin, { paymentAccountId: 'ACC-1120', items: [{ billId: bill.id, amount: 1 }] })
    expect(r.bankStatus).toBe('created')
    expect(() => fin.markPaymentRunSent(admin, r.id, null)).toThrow(/Export/)
    const f = fin.exportPaymentRunFile(admin, r.id)
    expect(f.files[0].template).toBe('sa_alrajhi_bulk')
    expect(f.files[0].content.split('\r\n')[0]).toContain('Bank code')
  })
})

describe('debit-note void', () => {
  it('reverses the entry and gives the bill its balance back through the bill-balance helper', () => {
    const admin = u('u1')
    runFinanceHooks(APEX_ID)
    const bill = openBaseBill(APEX_ID)
    const due0 = bill.balanceDue
    const dn = fin.createDebitNote(admin, { billId: bill.id, reason: 'Test credit', amount: 50 })
    expect(bill.balanceDue).toBe(round2(due0 - 50))
    const v = fin.voidDebitNote(admin, dn.id, { reason: 'Entered by mistake' })
    expect(v.status).toBe('void')
    expect(bill.balanceDue).toBe(due0)
    expect(bill.amountCredited).toBe(round2(bill.total - bill.amountPaid - due0))
    const rec = finDebitNotes.find((d) => d.id === dn.id)!
    expect(entry(rec.journalEntryId!).status).toBe('reversed')
    expect(entry(rec.voidJournalEntryId!).reversalOf).toBe(rec.journalEntryId)
    expect(() => fin.voidDebitNote(admin, dn.id, { reason: 'Again please' })).toThrow(/already/)
    expect(() => fin.voidDebitNote(u('u3'), dn.id, { reason: 'View role' })).toThrow()
    expect(statementOf(APEX_ID, bill.vendorId, '2000-01-01', todayOf(APEX_ID)).lines.some((l) => l.reference === dn.number)).toBe(false)
  })
})

describe('EOSB provision', () => {
  for (const [co, admin] of [[APEX_ID, 'u1'], [CREST_ID, 'u101']] as const) {
    it(`${co}: monthly accrual from the gratuity calculator, idempotent; 2500 = closing provision`, () => {
      runFinanceHooks(co)
      const today = todayOf(co)
      const last = monthRange(today, -1).month
      const months = finEosbPeriods.filter((p) => p.companyId === co && p.kind === 'month').map((p) => p.month)
      // Every month of the year up to the last closed one, once.
      expect(months).toEqual(Array.from({ length: Number(last.slice(5, 7)) }, (_, i) => `${last.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`))
      expect(finEosbPeriods.some((p) => p.companyId === co && p.kind === 'opening')).toBe(true)
      const n = financeJournal.length
      expect(accrueEosbThrough(co, last)).toEqual([])
      expect(runEosbProvision(u(admin), { month: last }).alreadyPosted).toBe(true)
      expect(financeJournal.length).toBe(n)
      const r = getEosbProvision(u(admin), {})
      expect(r.ledgerBalance).toBe(r.totals.closing)
      expect(round2(r.totals.opening + r.totals.charge - r.totals.used)).toBe(r.totals.closing)
      expect(r.totals.charge).toBeGreaterThan(0)
      expect(-balanceOf(co, 'ACC-2500')).toBe(r.totals.closing)
      // Each employee's provision equals the calculator at the last month end.
      const end = monthRange(`${last}-01`).to
      for (const row of r.rows!) expect(provisionOf(co, row.employeeId), row.employeeName).toBe(eosbTarget(co, row.employeeId, end))
      // Monthly entries: Dr 6120 per department / Cr 2500, source payroll.
      const p = finEosbPeriods.find((x) => x.companyId === co && x.month === last && x.kind === 'month')!
      const e = entry(p.entryId!)
      expect(e.sourceType).toBe('payroll')
      expect(e.lines.filter((l) => l.accountId === 'ACC-6120').every((l) => l.departmentId !== undefined)).toBe(true)
    })
  }

  it('the target is the UAE / KSA gratuity of the current contract (UAE: nothing before one year)', () => {
    runFinanceHooks(APEX_ID)
    const e = hrEmployees.find((x) => x.companyId === APEX_ID && x.hireDate && x.employmentType !== 'contractor' && x.status !== 'terminated')!
    const oneDay = addDaysIso(e.hireDate, 10)
    expect(eosbTarget(APEX_ID, e.id, oneDay)).toBe(0)
    const later = addDaysIso(e.hireDate, 800)
    expect(eosbTarget(APEX_ID, e.id, later)).toBeGreaterThan(0)
    expect(gratuity({ country: 'SA', reason: 'termination', basic: 10000, housing: 2500, startDate: '2020-01-01', endDate: '2024-12-31' }).amount).toBeGreaterThan(0)
  })

  it('a paid final settlement uses the provision (Dr 2500) and expenses only the difference (6120); no accrual after', () => {
    runFinanceHooks(APEX_ID)
    const today = todayOf(APEX_ID)
    const e = hrEmployees.find((x) => x.companyId === APEX_ID && provisionOf(APEX_ID, x.id) > 1000)!
    const provision = provisionOf(APEX_ID, e.id)
    const g = provision + 1234.56
    hrFinalSettlements.push({
      companyId: APEX_ID, id: 'PFS-TEST-1', employeeId: e.id, exitDate: today, reason: 'termination', currency: 'AED', basicSalary: 10000, housingAllowance: 0,
      gratuity: { amount: g } as never, unpaidSalaryFrom: null, unpaidSalaryDays: 0, unpaidSalary: 0, leaveDays: 0, leaveEncashment: 0, loanBalance: 0, adjustments: [], total: g,
      status: 'paid', notes: '', createdAt: `${today}T08:00:00.000Z`, createdBy: 'u9', paidAt: `${today}T09:00:00.000Z`, paidBy: 'u9',
    } as never)
    syncPayrollPostings(APEX_ID)
    const se = financeJournal.find((x) => x.companyId === APEX_ID && x.sourceId === 'PFS-TEST-1')!
    expect(se.lines.find((l) => l.accountId === 'ACC-2500')!.debit).toBe(provision)
    expect(se.lines.find((l) => l.accountId === 'ACC-6120')!.debit).toBe(1234.56)
    expect(finEosbUses.find((x) => x.settlementId === 'PFS-TEST-1')!.amount).toBe(provision)
    expect(provisionOf(APEX_ID, e.id)).toBe(0)
    // Pure lines: provision larger than the gratuity → the excess is released (Cr 6120).
    const lines = settlementLines({ gratuity: { amount: 800 } as never, unpaidSalary: 0, leaveEncashment: 0, loanBalance: 0, adjustments: [], total: 800 }, 'ACC-1120', 'X', 1000)
    expect(lines.find((l) => l.accountId === 'ACC-2500')!.debit).toBe(1000)
    expect(lines.find((l) => l.accountId === 'ACC-6120')!.credit).toBe(200)
    expect(round2(lines.reduce((s, l) => s + l.debit - l.credit, 0))).toBe(0)
  })

  it('the per-employee rows are for accounting full only (Sales Manager: totals)', () => {
    runFinanceHooks(APEX_ID)
    const view = getEosbProvision(u('u3'), {})
    expect(view.rows).toBeNull()
    expect(view.canRun).toBe(false)
    expect(view.totals.closing).toBeGreaterThan(0)
    expect(() => runEosbProvision(u('u3'), {})).toThrow(/Only/)
    expect(() => getEosbProvision(u('u5'), {})).toThrow()
  })
})

describe('event budget: billed column without double counting', () => {
  it('shows what bills charged to a line; the event cost is Σ max(actual, billed)', () => {
    runFinanceHooks(APEX_ID)
    // The seeded BILL-1005 is linked to the first budget line of the seeded event.
    const linked = finBills.find((b) => b.id === 'BILL-1005')!
    const l0 = linked.lines.find((l) => l.budgetLineId)!
    const ev = events.find((e) => e.id === l0.eventId)!
    const viewer = u('u1')
    const b = budgetOf(ev as never, viewer)
    const line = b.lines.find((x) => x.id === l0.budgetLineId)!
    expect(line.billed).toBe(toBase(l0.net + (l0.vatRecoverable ? 0 : l0.taxAmount), linked.exchangeRate))
    expect(line.bills!.map((x) => x.id)).toContain('BILL-1005')
    const lines = eventBudgetLines.filter((x) => x.companyId === APEX_ID && x.eventId === ev.id)
    const expected = round2(lines.reduce((s, x) => s + Math.max(x.actual, b.lines.find((y) => y.id === x.id)!.billed ?? 0), 0))
    expect(b.costTotal).toBe(expected)
    expect(eventActualCost(ev)).toBe(expected)
    // Raising the typed actual above the billed amount: only the actual counts (no double counting).
    const rec = lines.find((x) => x.id === l0.budgetLineId)!
    rec.actual = round2(line.billed! + 500)
    expect(eventActualCost(ev)).toBe(round2(expected - Math.max(line.actual, line.billed!) + rec.actual))
    // A Sales Agent sees the amounts (events permission) but no bill links.
    expect(budgetOf(ev as never, u('u5')).lines.find((x) => x.id === l0.budgetLineId)!.bills).toEqual([])
  })
})
