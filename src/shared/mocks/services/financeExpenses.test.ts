import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeJournal } from '@/shared/mocks/data/finance'
import { hrPayAdjustments, hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { expenseStorageBytes, finExpenseClaims, finExpenseCategories, finExpenses, finPettyExpenses, finPettyFunds } from '@/shared/mocks/data/financeExpenses'
import '@/shared/mocks/data/financeExpensesSeed'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { usedOf } from './billing'
import { countDifference, fundFigures, isValidTaxNumber, policyWarnings, replenishment, vatSplit } from '@/modules/finance/expenses/calc'
import { approveExpense, createExpense, voidExpense } from './financeExpenses'
import { approveClaim, claimForPayrollAdjustment, createClaim, getClaim, reimburseClaim, submitClaim, syncPayrollClaims } from './financeExpensesClaims'
import { countFund, getFund, recordPettyExpense, replenishFund } from './financeExpensesPetty'

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const cat = (co: string, code: string) => finExpenseCategories.find((c) => c.companyId === co && c.accountId === `ACC-${code}`)!.id
const entry = (id: string | null) => financeJournal.find((e) => e.id === id)!
const balanced = (id: string | null) => {
  const e = entry(id)
  const dr = e.lines.reduce((s, l) => s + l.debit, 0)
  const cr = e.lines.reduce((s, l) => s + l.credit, 0)
  return Math.round(dr * 100) === Math.round(cr * 100)
}
const img = { name: 'r.png', size_bytes: 2048, sizeBytes: 2048, mimeType: 'image/png', url: null }
const today = new Date().toISOString().slice(0, 10)

describe('VAT recoverability', () => {
  it('needs a standard code, a VAT-registered company and a valid TRN / VAT number', () => {
    expect(isValidTaxNumber('AE', '100234567800003')).toBe(true)
    expect(isValidTaxNumber('AE', '200234567800003')).toBe(false)
    expect(isValidTaxNumber('SA', '310987654300003')).toBe(true)
    expect(isValidTaxNumber('SA', '310987654300001')).toBe(false)
    const base = { amount: 105, rate: 5, category: 'standard', country: 'AE', vatRegistered: true }
    expect(vatSplit({ ...base, payeeVatNumber: '100234567800003' })).toMatchObject({ vat: 5, net: 100, recoverable: true })
    expect(vatSplit({ ...base, payeeVatNumber: '' })).toMatchObject({ vat: 0, net: 105, recoverable: false })
    expect(vatSplit({ ...base, payeeVatNumber: '100234567800003', vatRegistered: false }).recoverable).toBe(false)
    expect(vatSplit({ ...base, payeeVatNumber: '100234567800003', category: 'exempt' }).vat).toBe(0)
    expect(vatSplit({ amount: 115, rate: 15, category: 'standard', country: 'SA', vatRegistered: true, payeeVatNumber: '310987654300003' })).toMatchObject({ vat: 15, net: 100 })
  })
})

describe('company expenses', () => {
  it('posts Dr expense + Dr VAT input / Cr bank in base currency after the chain; maker–checker', async () => {
    const e = await createExpense(u('u8'), { date: today, vendorId: 'VND-1001', categoryId: cat(APEX_ID, '6450'), amount: 1050, paymentMethod: 'bank_transfer', paidFromAccountId: 'ACC-1120', receipt: img })
    expect(e.status).toBe('pending')
    expect(e.vatAmount).toBe(50)
    expect(e.steps.map((s) => s.approver)).toEqual(['Accountant'])
    await expect(approveExpense(u('u8'), e.id)).rejects.toMatchObject({ status: 403 })
    const ok = await approveExpense(u('u2'), e.id)
    expect(ok.status).toBe('approved')
    const je = entry(ok.journal!.id)
    expect(balanced(je.id)).toBe(true)
    expect(je.lines.find((l) => l.accountId === 'ACC-1300')!.debit).toBe(50)
    expect(je.lines.find((l) => l.accountId === 'ACC-6450')!.debit).toBe(1000)
    expect(je.lines.find((l) => l.accountId === 'ACC-1120')!.credit).toBe(1050)
    const v = await voidExpense(u('u8'), e.id, { reason: 'Test' })
    expect(v.status).toBe('void')
    expect(entry(v.voidJournal!.id).reversalOf).toBe(je.id)
  })

  it('a USD expense converts at the rate; without a TRN the full amount is the expense; big ones need Management too', async () => {
    const e = await createExpense(u('u8'), { date: today, payeeName: 'Some US SaaS', categoryId: cat(APEX_ID, '6600'), amount: 99.99, currency: 'USD', paymentMethod: 'card', paidFromAccountId: 'ACC-1120', receipt: img })
    expect(e.exchangeRate).toBe(3.6725)
    expect(e.vatAmount).toBe(0)
    const ok = await approveExpense(u('u2'), e.id)
    expect(balanced(ok.journal!.id)).toBe(true)
    expect(entry(ok.journal!.id).lines.find((l) => l.accountId === 'ACC-1120')!.credit).toBe(367.21)
    const big = await createExpense(u('u8'), { date: today, payeeName: 'Venue', categoryId: cat(APEX_ID, '6450'), amount: 25_000, paymentMethod: 'bank_transfer', paidFromAccountId: 'ACC-1120', receipt: img })
    expect(big.steps.map((s) => s.approver)).toEqual(['Accountant', 'Management'])
    const one = await approveExpense(u('u2'), big.id)
    expect(one.status).toBe('pending')
    await expect(approveExpense(u('u2'), big.id)).rejects.toMatchObject({ status: 403 })
    expect((await approveExpense(u('u1'), big.id)).status).toBe('approved')
  })

  it('requires a receipt above the threshold and flags duplicates', async () => {
    const input = { date: today, payeeName: 'Dup Co', categoryId: cat(APEX_ID, '6550'), amount: 500, paymentMethod: 'card' as const, paidFromAccountId: 'ACC-1120' }
    await expect(createExpense(u('u8'), input)).rejects.toMatchObject({ code: 'receipt_required' })
    await createExpense(u('u8'), { ...input, receipt: img })
    const second = await createExpense(u('u8'), { ...input, receipt: img })
    expect(second.duplicateOf).toHaveLength(1)
  })
})

describe('policy checks', () => {
  it('receipt, age and monthly limit warnings follow their modes', () => {
    const rules = { receiptRequiredAbove: 100, receiptMode: 'block' as const, claimMaxAgeDays: 60, ageMode: 'warn' as const, limitMode: 'block' as const }
    const cats = new Map([['C1', { name: 'Meals', monthlyLimit: 500 }]])
    const w = policyWarnings([{ id: 'a', date: '2026-01-01', categoryId: 'C1', baseAmount: 300, hasReceipt: false }, { id: 'b', date: '2026-01-02', categoryId: 'C1', baseAmount: 50, hasReceipt: false }], '2026-04-01', rules, cats, new Map([['C1:2026-01', 200]]))
    expect(w.map((x) => [x.code, x.blocking])).toEqual([['receipt_missing', true], ['too_old', false], ['too_old', false], ['over_monthly_limit', true]])
  })
})

describe('employee expense claims', () => {
  it('a Sales Agent claims; head → accountant approve (maker–checker); payroll adjustment; reimbursed when the run is paid', async () => {
    const agent = u('u5')
    const c = await createClaim(agent, { title: 'Test', lines: [{ date: today, categoryId: cat(APEX_ID, '6560'), description: 'Client lunch', merchant: 'Cafe', merchantVatNumber: '100234567800003', amount: 210, receipt: img }] })
    expect(c.status).toBe('draft')
    const s = await submitClaim(agent, c.id)
    expect(s.steps.map((x) => x.approver)).toEqual(['department_head', 'Accountant'])
    await expect(approveClaim(u('u8'), c.id)).rejects.toMatchObject({ status: 403 })
    expect((await approveClaim(u('u3'), c.id)).steps[0].status).toBe('approved')
    const done = await approveClaim(u('u8'), c.id)
    expect(done.status).toBe('approved')
    const je = entry(done.journal!.id)
    expect(balanced(je.id)).toBe(true)
    expect(je.lines.find((l) => l.accountId === 'ACC-2450')!.credit).toBe(210)
    expect(je.lines.find((l) => l.accountId === 'ACC-1300')!.debit).toBe(10)
    const inPay = await reimburseClaim(u('u8'), c.id, { method: 'payroll' })
    expect(inPay.status).toBe('in_payroll')
    const adj = hrPayAdjustments.find((a) => a.id === inPay.reimbursement!.payrollAdjustmentId)!
    expect(adj.kind).toBe('reimbursement')
    expect(claimForPayrollAdjustment(APEX_ID, adj.id)).toMatchObject({ claimId: c.id, amount: 210, liabilityAccountId: 'ACC-2450' })
    const run = hrPayrollRuns.find((r) => r.companyId === APEX_ID && r.status === 'paid')!
    adj.paidRunIds.push(run.id)
    syncPayrollClaims(APEX_ID)
    expect((await getClaim(agent, c.id)).status).toBe('reimbursed')
  })

  it('employees see only their own claims; a claim can be paid now (Dr 2450 / Cr bank)', async () => {
    const theirs = finExpenseClaims.find((x) => x.companyId === APEX_ID && x.requesterId !== 'u5' && x.status === 'approved')!
    await expect(getClaim(u('u5'), theirs.id)).rejects.toMatchObject({ status: 404 })
    const paid = await reimburseClaim(u('u8'), theirs.id, { method: 'payment', accountId: 'ACC-1120' })
    expect(paid.status).toBe('reimbursed')
    expect(balanced(paid.reimbursement!.journal!.id)).toBe(true)
  })
})

describe('petty cash', () => {
  it('replenishment math and over / short', () => {
    expect(fundFigures(3000, 3000, 2321)).toMatchObject({ cashExpected: 679, replenishAmount: 2321, lowBalance: false })
    expect(fundFigures(3000, 3000, 2500).lowBalance).toBe(true)
    expect(replenishment(3000, 3000, 2000)).toEqual({ expensesTotal: 2000, topUp: 2000, bookAfter: 3000 })
    expect(replenishment(3000, 2985, 100)).toEqual({ expensesTotal: 100, topUp: 115, bookAfter: 3000 })
    expect(countDifference(985, 1000)).toBe(-15)
  })

  it('custodian records; accountant replenishes to the float; a count difference posts to 6950', async () => {
    const f = finPettyFunds.find((x) => x.companyId === APEX_ID && x.name === 'Events team float')!
    const custodian = u('u12')
    await recordPettyExpense(custodian, f.id, { date: today, categoryId: cat(APEX_ID, '6550'), payeeName: 'Shop', amount: 50, description: 'Tape' })
    await expect(replenishFund(custodian, f.id, { fromAccountId: 'ACC-1120' })).rejects.toMatchObject({ status: 403 })
    const after = await replenishFund(u('u8'), f.id, { fromAccountId: 'ACC-1120' })
    expect(after.pendingTotal).toBe(0)
    expect(after.bookBalance).toBe(1500)
    expect(balanced(after.movements[0].journal!.id)).toBe(true)
    const counted = await countFund(u('u8'), f.id, { counted: 1490, reason: 'Missing receipt' })
    expect(counted.movements[0].difference).toBe(-10)
    expect(entry(counted.movements[0].journal!.id).lines.find((l) => l.accountId === 'ACC-6950')!.debit).toBe(10)
    await expect(getFund(u('u5'), f.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('seed and storage', () => {
  it('each company has claims in every state, ~15 expenses and two funds', () => {
    for (const co of [APEX_ID, CREST_ID]) {
      const states = new Set(finExpenseClaims.filter((c) => c.companyId === co).map((c) => c.status))
      expect([...states].sort()).toEqual(['approved', 'draft', 'in_payroll', 'pending', 'reimbursed', 'rejected'])
      const pending = finExpenseClaims.filter((c) => c.companyId === co && c.status === 'pending').map((c) => c.approval.approvals.length).sort()
      expect(pending).toEqual([0, 1])
      expect(finExpenses.filter((e) => e.companyId === co).length).toBe(15)
      const st = new Set(finExpenses.filter((e) => e.companyId === co).map((e) => e.status))
      for (const x of ['approved', 'pending', 'void']) expect(st.has(x as never), x).toBe(true)
      expect(finExpenses.some((e) => e.companyId === co && e.status === 'approved' && e.currency === 'USD')).toBe(true)
      expect(finExpenses.some((e) => e.companyId === co && e.vatRecoverable) && finExpenses.some((e) => e.companyId === co && !e.vatRecoverable)).toBe(true)
      expect(finPettyFunds.filter((f) => f.companyId === co)).toHaveLength(2)
      expect(finPettyExpenses.some((p) => p.companyId === co && p.status === 'approved')).toBe(true)
      for (const e of financeJournal.filter((j) => j.companyId === co && j.sourceType === 'expense')) expect(balanced(e.id)).toBe(true)
    }
  })

  it('receipts count toward the plan storage', async () => {
    const before = expenseStorageBytes(APEX_ID)
    const usedBefore = usedOf(APEX_ID, 'storageMb')
    await createExpense(u('u8'), { date: today, payeeName: 'Big receipt', categoryId: cat(APEX_ID, '6550'), amount: 10, paymentMethod: 'card', paidFromAccountId: 'ACC-1120', receipt: { ...img, sizeBytes: 3 * 1024 * 1024 } })
    expect(expenseStorageBytes(APEX_ID) - before).toBe(3 * 1024 * 1024)
    expect(usedOf(APEX_ID, 'storageMb')).toBeCloseTo(usedBefore + 3, 1)
  })
})
