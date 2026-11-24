import { afterEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID } from '@/shared/mocks/data/tenancy'
import { projects, timeEntries } from '@/shared/mocks/data/tasks'
import { eventBudgetLines } from '@/shared/mocks/data/events'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { postJournal, runFinanceHooks, systemAccount } from './ledger'
import * as svc from './financeProfitability'
// Every store registered before the snapshot.
import '@/shared/mocks/handlers'

/** Profitability services on the live seed: department split, labour allocation per project, event cost rule. */

const snap = takeSnapshot(true)
afterEach(() => restoreSnapshot(snap))

const omar = () => users.find((x) => x.id === 'u1')! as User // Apex Company Admin (accounting full)
const karim = () => users.find((x) => x.id === 'u3')! as User // Apex Sales Manager (accounting view)
const today = () => companyDayOf(APEX_ID).today
const year = () => ({ from: `${today().slice(0, 4)}-01-01`, to: `${today().slice(0, 4)}-12-31` })

function post(lines: { accountId: string; debit: number; credit: number; departmentId?: string; projectId?: string; eventId?: string }[]) {
  runFinanceHooks(APEX_ID)
  postJournal(APEX_ID, { date: today(), memo: 'Profitability test', sourceType: 'manual', sourceId: null, lines: lines.map((l) => ({ description: 'test', ...l })), createdBy: 'u1' })
}

describe('department split', () => {
  it('department dimension first, then the project manager’s department, else Unassigned; totals equal the company P&L', () => {
    const { from, to } = year()
    const before = new Map(svc.departmentPnlRows(APEX_ID, from, to).rows.map((r) => [r.departmentId ?? '', r]))
    const project = projects.find((p) => p.companyId === APEX_ID && p.id === 'PRJ-101')!
    const managerDept = users.find((u) => u.id === project.managerId)!.departmentId
    const revenue = systemAccount(APEX_ID, 'service_revenue')
    post([
      { accountId: 'ACC-1120', debit: 1000, credit: 0 },
      { accountId: revenue, debit: 0, credit: 1000, projectId: project.id }, // → manager's department
      { accountId: 'ACC-6800', debit: 300, credit: 0, departmentId: 'd-sales' }, // explicit
      { accountId: 'ACC-6800', debit: 200, credit: 0 }, // no dimension → Unassigned
      { accountId: 'ACC-1120', debit: 0, credit: 500 },
    ])
    const split = svc.departmentPnlRows(APEX_ID, from, to)
    const after = new Map(split.rows.map((r) => [r.departmentId ?? '', r]))
    expect(after.get(managerDept)!.revenue - before.get(managerDept)!.revenue).toBeCloseTo(1000, 2)
    expect(after.get('d-sales')!.operatingExpenses - before.get('d-sales')!.operatingExpenses).toBeCloseTo(300, 2)
    expect(after.get('')!.operatingExpenses - (before.get('')?.operatingExpenses ?? 0)).toBeCloseTo(200, 2)
    // Rows add up to the company's income statement.
    const company = svc.incomeStatementIn(APEX_ID, from, to)
    expect(split.rows.reduce((s, r) => s + r.revenue, 0)).toBeCloseTo(company.revenue, 2)
    expect(split.rows.reduce((s, r) => s + r.totalCost, 0)).toBeCloseTo(company.expenses, 2)
  })
})

describe('project labour allocation', () => {
  it('full sees the allocation (hours × pay ÷ standard hours); view sees hours only and margins before labour', () => {
    const full = svc.projectProfitability(omar(), year())
    const view = svc.projectProfitability(karim(), year())
    const withHours = full.rows.find((r) => r.labourHours > 0)!
    expect(withHours.labourCost).toBeGreaterThan(0)
    expect(withHours.margin).toBeCloseTo(withHours.revenue - withHours.directCosts - withHours.labourCost!, 2)
    const same = view.rows.find((r) => r.projectId === withHours.projectId)!
    expect(same.labourHours).toBe(withHours.labourHours)
    expect(same.labourCost).toBeNull()
    expect(same.margin).toBeCloseTo(same.revenue - same.directCosts, 2)
    expect(view.totals.labourCost).toBeNull()
    // Hours logged on the project's tasks this year.
    const y = today().slice(0, 4)
    const hours = timeEntries.filter((t) => t.companyId === APEX_ID && t.projectId === withHours.projectId && t.entryDate.startsWith(y)).reduce((s, t) => s + t.hours, 0)
    expect(withHours.labourHours).toBeCloseTo(hours, 2)
  })
})

describe('event costs', () => {
  it('a bill linked to a budget line replaces that line’s actual; unlinked ledger costs count fully', () => {
    const rows = svc.eventProfitability(omar(), { from: '2025-06-01', to: '2028-05-31' }).rows
    for (const r of rows) {
      const lines = eventBudgetLines.filter((l) => l.companyId === APEX_ID && l.eventId === r.eventId)
      const typed = lines.reduce((s, l) => s + l.actual, 0)
      // Never more than ledger + every typed actual, never less than the ledger alone.
      expect(r.totalCost).toBeLessThanOrEqual(r.ledgerCosts + typed + 0.01)
      expect(r.totalCost).toBeGreaterThanOrEqual(r.ledgerCosts - 0.01)
      expect(r.totalCost).toBeCloseTo(r.ledgerCosts + r.budgetLineCosts, 2)
    }
    // The seeded photography bill is linked to the event's first budget line: that line is not counted twice.
    const linked = rows.find((r) => r.ledgerCosts > 0 && r.budgetLineCosts > 0)!
    const typed = eventBudgetLines.filter((l) => l.companyId === APEX_ID && l.eventId === linked.eventId).reduce((s, l) => s + l.actual, 0)
    expect(linked.totalCost).toBeLessThan(linked.ledgerCosts + typed)
  })
})
