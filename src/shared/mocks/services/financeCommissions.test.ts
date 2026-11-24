import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { customers, users } from '@/shared/mocks/db'
import { financeInvoices, financeJournal } from '@/shared/mocks/data/finance'
import { finCommissionPlans, finCommissionStatements } from '@/shared/mocks/data/financeCommissions'
import { hrPayAdjustments } from '@/shared/mocks/data/hrPayroll'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { clawbackOf, eligibleNet, rateForAchievement, statementTotals } from '@/modules/finance/commissions/calc'
import '@/shared/mocks/handlers'
import * as c from './financeCommissions'
import { recordPaymentFor } from './financeCollections'
import { fixtureInvoice } from './financeCollections.fixtures'
import { addDays, todayOf } from './financeCollectionsCore'

const snap = takeSnapshot(true)
beforeEach(() => restoreSnapshot(snap))
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User

describe('commission math', () => {
  it('tiers by target achievement, cap and clawback', () => {
    const tiers = [{ minAchievement: 80, rate: 4 }, { minAchievement: 100, rate: 5 }]
    expect(rateForAchievement(3, tiers, 50)).toBe(3)
    expect(rateForAchievement(3, tiers, 80)).toBe(4)
    expect(rateForAchievement(3, tiers, 130)).toBe(5)
    expect(statementTotals([{ kind: 'invoice', baseAmount: 100000, commission: 0 }, { kind: 'clawback', baseAmount: 0, commission: 120 }], 5, 4000)).toEqual({ baseTotal: 100000, gross: 4000, capped: true, clawback: 120, total: 3880 })
    expect(statementTotals([{ kind: 'invoice', baseAmount: 1000, commission: 0 }], 3, null).total).toBe(30)
    expect(eligibleNet({ status: 'paid', total: 1050, amountCredited: 525, net: 1000 })).toBe(500)
    expect(eligibleNet({ status: 'partially_paid', total: 1050, amountCredited: 0, net: 1000 })).toBe(0)
    expect(clawbackOf(30, 3, 500, 0)).toBe(15)
    expect(clawbackOf(30, 3, 500, 15)).toBe(0)
    expect(clawbackOf(30, 3, 1000, 0)).toBe(0)
  })
})

/** A paid invoice of a customer owned by `rep`, paid today (collected this month). */
function paidInvoice(rep: string, total = 10500) {
  const co = 'co_apex'
  const cust = customers.find((x) => x.companyId === co && x.ownerId === rep) ?? customers.find((x) => x.companyId === co)!
  cust.ownerId = rep
  const today = todayOf(co)
  const inv = fixtureInvoice(co, { customerId: cust.id, total, issueDate: addDays(today, -20), dueDate: addDays(today, 10), vatPct: 5 })
  recordPaymentFor(co, 'u8', { customerId: cust.id, date: today, method: 'bank_transfer', amount: total, currency: 'AED', exchangeRate: 1, allocationMode: 'manual', allocations: [{ invoiceId: inv.id, amount: total }] })
  return financeInvoices.find((i) => i.id === inv.id)!
}

describe('statements', () => {
  it('collected basis: generate → Sales Manager → Accountant (maker–checker) → Dr 6150 / Cr 2400 and one payroll adjustment', () => {
    c.listPlans(u('u8'))
    const month = todayOf('co_apex').slice(0, 7)
    const inv = paidInvoice('u4')
    expect(inv.status).toBe('paid')
    const gen = c.generateStatements(u('u8'), { month })
    const s = gen.find((x) => x.userId === 'u4')!
    const line = s.lines.find((l) => l.refId === inv.id)!
    expect(line.baseAmount).toBe(10000)
    expect(s.status).toBe('pending_manager')
    // The rep can't approve, the accountant can't take step 1, the sales manager can.
    expect(() => c.approveStatement(u('u4'), s.id)).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => c.approveStatement(u('u8'), s.id)).toThrow(expect.objectContaining({ status: 403 }))
    expect(c.approveStatement(u('u3'), s.id).status).toBe('pending_accountant')
    expect(() => c.approveStatement(u('u3'), s.id)).toThrow(expect.objectContaining({ status: 403 }))
    const done = c.approveStatement(u('u8'), s.id)
    expect(done.status).toBe('approved')
    const e = financeJournal.find((x) => x.id === done.journalEntryId)!
    expect(e.lines.find((l) => l.accountId === 'ACC-6150')!.debit).toBe(done.total)
    expect(e.lines.find((l) => l.accountId === 'ACC-2400')!.credit).toBe(done.total)
    const adj = hrPayAdjustments.filter((a) => a.sourceRef === `commission:${s.id}`)
    expect(adj).toHaveLength(1)
    expect(adj[0]).toMatchObject({ kind: 'commission', amount: done.total, employeeId: 'EMP-u4' })
    // Idempotent: approving again is a 409 and still one adjustment / one entry.
    expect(() => c.approveStatement(u('u8'), s.id)).toThrow(expect.objectContaining({ status: 409 }))
    expect(hrPayAdjustments.filter((a) => a.sourceRef === `commission:${s.id}`)).toHaveLength(1)
    // The invoice is not commissioned twice.
    const again = c.generateStatements(u('u8'), { month })
    expect(again.find((x) => x.id === s.id)!.lines.filter((l) => l.refId === inv.id)).toHaveLength(1)
  })

  it('a paid invoice credited after the commission was paid is clawed back next month', () => {
    c.listPlans(u('u8'))
    const month = todayOf('co_apex').slice(0, 7)
    const inv = paidInvoice('u5', 21000)
    const s = c.generateStatements(u('u8'), { month }).find((x) => x.userId === 'u5')!
    c.approveStatement(u('u3'), s.id)
    const approved = c.approveStatement(u('u8'), s.id)
    const commissioned = approved.lines.find((l) => l.refId === inv.id)!
    inv.amountCredited = 10500 // half credited
    const next = `${Number(month.slice(0, 4)) + (month.endsWith('12') ? 1 : 0)}-${month.endsWith('12') ? '01' : String(Number(month.slice(5)) + 1).padStart(2, '0')}`
    const plan = finCommissionPlans.find((p) => p.companyId === 'co_apex')!
    const calc = c.calculate('co_apex', u('u5'), next, plan, approved.achievement)
    const claw = calc.lines.find((l) => l.kind === 'clawback' && l.refId === inv.id)!
    const paidShare = approved.capped ? approved.gross / ((approved.baseTotal * approved.rate) / 100) : 1
    expect(claw.commission).toBeCloseTo(commissioned.commission * paidShare / 2, 1)
    expect(calc.total).toBeLessThan(0.01 + calc.gross)
  })

  it('a rep sees only their own statements; a Sales Manager sees the team; plans are not for reps', () => {
    c.listPlans(u('u8'))
    const mine = c.myCommissions(u('u4'))
    expect(mine.plan?.basis).toBe('collected_revenue')
    expect(mine.statements.every((s) => s.userId === 'u4')).toBe(true)
    expect(c.listStatements(u('u4')).every((s) => s.userId === 'u4')).toBe(true)
    const others = finCommissionStatements.filter((s) => s.companyId === 'co_apex' && s.userId !== 'u4')
    expect(others.length).toBeGreaterThan(0)
    expect(() => c.getStatement(u('u4'), others[0].id)).toThrow(expect.objectContaining({ status: 404 }))
    expect(c.listStatements(u('u3')).length).toBeGreaterThanOrEqual(others.length)
    expect(() => c.listPlans(u('u4'))).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => c.createPlan(u('u3'), { name: 'X', rate: 1, roles: ['Sales Agent'] })).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('seed: last month has one approved statement (posted, pushed to payroll) and a pending one per company', () => {
    for (const admin of ['u1', 'u101']) {
      const rows = c.listStatements(u(admin))
      expect(rows.some((s) => s.status === 'approved'), admin).toBe(true)
      expect(rows.some((s) => s.status === 'pending_manager'), admin).toBe(true)
    }
  })
})
