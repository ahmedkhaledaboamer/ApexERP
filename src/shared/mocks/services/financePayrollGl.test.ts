import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { financeJournal } from '@/shared/mocks/data/finance'
import { finPayrollPostings } from '@/shared/mocks/data/financeBanking'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import '@/shared/mocks/handlers'
import * as hr from './hrPayroll'
import * as gl from './financePayrollGl'
import { getTrialBalance } from './financeLedger'

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User
const r2 = (n: number) => Math.round(n * 100) / 100
const sum = (co: string, entryId: string, account: string, side: 'debit' | 'credit', desc?: RegExp) =>
  r2(financeJournal.find((e) => e.companyId === co && e.id === entryId)!.lines.filter((l) => l.accountId === account && (!desc || desc.test(l.description))).reduce((s, l) => s + l[side], 0))

describe('payroll → ledger', () => {
  for (const [co, admin] of [['co_apex', 'u1'], ['co_crest', 'u101']] as const) {
    it(`${co}: every seeded paid run has a balanced accrual equal to the run totals and a payment equal to the bank file total`, () => {
      gl.listPayrollPostings(u(admin)) // first finance access: posts the seeded runs
      const paid = hrPayrollRuns.filter((r) => r.companyId === co && r.status === 'paid')
      expect(paid.length).toBe(3)
      for (const r of paid) {
        const p = gl.getPayrollPosting(u(admin), r.id)
        expect(p.status, r.month).toBe('paid')
        const e = financeJournal.find((x) => x.id === p.accrualEntryId)!
        const dr = r2(e.lines.reduce((s, l) => s + l.debit, 0))
        expect(dr).toBe(r2(e.lines.reduce((s, l) => s + l.credit, 0)))
        expect(e.sourceType).toBe('payroll')
        expect(e.date).toBe(r.periodEnd)
        const gross = r2(r.lines.reduce((s, l) => s + l.gross, 0))
        const net = r2(r.lines.filter((l) => l.net > 0).reduce((s, l) => s + l.net, 0))
        const si = r2(r.lines.reduce((s, l) => s + l.employeeSocialInsurance + l.employerSocialInsurance, 0))
        const erSi = r2(r.lines.reduce((s, l) => s + l.employerSocialInsurance, 0))
        const earnings = r2(['ACC-6100', 'ACC-6110'].reduce((s, a) => s + sum(co, e.id, a, 'debit'), 0) + sum(co, e.id, 'ACC-2400', 'debit', /Commission/))
        const reimb = r2(r.lines.reduce((s, l) => s + l.items.filter((i) => (i.type as string) === 'reimbursement').reduce((t, i) => t + i.amount, 0), 0))
        expect(sum(co, e.id, 'ACC-2450', 'debit'), `${r.month} reimbursements`).toBe(reimb)
        expect(earnings, `${r.month} gross`).toBe(gross)
        expect(sum(co, e.id, 'ACC-2400', 'credit', /Net pay/), `${r.month} net`).toBe(net)
        expect(sum(co, e.id, 'ACC-2410', 'credit'), `${r.month} SI`).toBe(si)
        expect(sum(co, e.id, 'ACC-6130', 'debit')).toBe(erSi)
        expect(e.lines.every((l) => l.departmentId !== undefined)).toBe(true)
        const pay = financeJournal.find((x) => x.id === p.paymentEntryId)!
        const bankTotal = r2(r.lines.filter((l) => l.net > 0 && l.payMethod !== 'cash').reduce((s, l) => s + l.net, 0))
        expect(sum(co, pay.id, 'ACC-1120', 'credit', /WPS/)).toBe(bankTotal)
        expect(sum(co, pay.id, 'ACC-2400', 'debit')).toBe(net)
      }
      expect(getTrialBalance(u(admin)).balanced).toBe(true)
      // Idempotent: another access posts nothing new.
      const n = financeJournal.length
      gl.syncPayrollPostings(co)
      expect(financeJournal.length).toBe(n)
    })
  }

  it('approving a run posts the accrual; reopening reverses it; approving again posts a new one', async () => {
    gl.listPayrollPostings(u('u1'))
    const run = hrPayrollRuns.find((r) => r.companyId === 'co_apex' && r.status === 'draft')!
    await hr.calculateRun(u('u9'), run.id)
    await hr.acknowledgeWarnings(u('u9'), run.id, { all: true })
    await hr.approveRun(u('u2'), run.id)
    const p1 = gl.getPayrollPosting(u('u1'), run.id)
    expect(p1.status, p1.note ?? '').toBe('accrued')
    expect(p1.accrualEntryId).toBeTruthy()
    await hr.reopenRun(u('u2'), run.id)
    const orig = financeJournal.find((e) => e.id === p1.accrualEntryId)!
    expect(orig.status).toBe('reversed')
    const p2 = gl.getPayrollPosting(u('u1'), run.id)
    expect(p2.status).toBe('reversed')
    expect(p2.accrualEntryId).toBeNull()
    await hr.calculateRun(u('u9'), run.id)
    await hr.acknowledgeWarnings(u('u9'), run.id, { all: true })
    await hr.approveRun(u('u2'), run.id)
    const p3 = gl.getPayrollPosting(u('u1'), run.id)
    expect(p3.accrualEntryId).not.toBe(p1.accrualEntryId)
    await hr.payRun(u('u9'), run.id)
    expect(gl.getPayrollPosting(u('u1'), run.id).paymentEntryNumber).toMatch(/^JV-/)
  })

  it('a loan posts Dr 1410 / Cr bank, a cancelled one is reversed; a paid settlement posts EOSB to 6120', async () => {
    gl.listPayrollPostings(u('u1'))
    const month = hrPayrollRuns.filter((r) => r.companyId === 'co_apex').map((r) => r.month).sort().slice(-1)[0]
    const loan = await hr.createLoan(u('u9'), { employeeId: 'EMP-u15', principal: 3000, installmentAmount: 500, startMonth: `${Number(month.slice(0, 4)) + 1}-01`, kind: 'advance' })
    const rec = finPayrollPostings.find((p) => p.sourceId === loan.id)!
    expect(sum('co_apex', rec.entryId!, 'ACC-1410', 'debit')).toBe(3000)
    await hr.updateLoan(u('u9'), loan.id, { status: 'cancelled' })
    expect(financeJournal.find((e) => e.id === rec.entryId)!.status).toBe('reversed')
    const lines = gl.settlementLines({ gratuity: { amount: 10000 } as never, unpaidSalary: 2000, leaveEncashment: 1500, loanBalance: 500, adjustments: [{ label: 'Fine', amount: -100 }], total: 12900 }, 'ACC-1120', 'X')
    const dr = r2(lines.reduce((s, l) => s + l.debit, 0))
    expect(dr).toBe(r2(lines.reduce((s, l) => s + l.credit, 0)))
    expect(lines.find((l) => l.accountId === 'ACC-6120')!.debit).toBe(10000)
    expect(lines.find((l) => l.accountId === 'ACC-1120')!.credit).toBe(12900)
  })
})
