import { describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { monthRange } from '@/modules/finance/ledger/calc'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { runFinanceHooks } from './ledger'
import { paymentAccountsOf } from './financeApprovals'
import { listVatReturns } from './financeTax'
import { eventProfitability, incomeStatementIn, projectProfitability } from './financeProfitability'
import '@/shared/mocks/handlers'

/**
 * The seeded demo books read like a real company's (both tenants, after every lazy finance seed has run): the year is
 * profitable, payroll is a plausible share of revenue, there is cost of sales, past VAT returns are filed, projects are
 * billed within budget, the bank never goes overdrawn at a month end and most events pay back.
 */

const FULL: Record<string, string> = { [APEX_ID]: 'u1', [CREST_ID]: 'u101' }
/** Projects allowed to bill above 105 % of their budget (an intended over-run, with a note in the seed). None today. */
const OVERRUN_WHITELIST = new Set<string>()

describe('seeded demo books are realistic', () => {
  for (const co of [APEX_ID, CREST_ID]) {
    describe(co, () => {
      const setup = () => {
        runFinanceHooks(co)
        const user = users.find((u) => u.id === FULL[co])! as User
        const today = companyDayOf(co).today
        return { user, today, from: `${today.slice(0, 4)}-01-01` }
      }

      it('year to date: net profit > 0, payroll 35–70 % of revenue, gross margin 50–90 %', () => {
        const { today, from } = setup()
        const pnl = incomeStatementIn(co, from, today)
        const codes = new Set(['6100', '6110', '6130'])
        const payrollIds = new Set(financeAccounts.filter((a) => a.companyId === co && codes.has(a.code)).map((a) => a.id))
        const payroll = financeJournal
          .filter((e) => e.companyId === co && e.date >= from && e.date <= today && e.sourceType !== 'year_end_close')
          .flatMap((e) => e.lines)
          .filter((l) => payrollIds.has(l.accountId))
          .reduce((s, l) => s + l.debit - l.credit, 0)
        expect(pnl.revenue).toBeGreaterThan(0)
        expect(pnl.profit).toBeGreaterThan(0)
        expect(payroll / pnl.revenue).toBeGreaterThanOrEqual(0.35)
        expect(payroll / pnl.revenue).toBeLessThanOrEqual(0.7)
        const gross = (pnl.revenue - pnl.costOfSales) / pnl.revenue
        expect(gross).toBeGreaterThanOrEqual(0.5)
        expect(gross).toBeLessThanOrEqual(0.9)
      })

      it('every VAT period that ended before last month’s end is filed', () => {
        const { user, today } = setup()
        const lastMonthEnd = monthRange(today, -1).to
        const late = listVatReturns(user).filter((r) => r.to < lastMonthEnd && r.status === 'draft')
        expect(late.map((r) => r.label)).toEqual([])
        expect(listVatReturns(user).some((r) => r.status !== 'draft' && !!r.filingReference && !!r.filedDate && r.filedDate <= r.dueDate)).toBe(true)
      })

      it('projects are billed within 105 % of their budget', () => {
        const { user, today, from } = setup()
        for (const r of projectProfitability(user, { from, to: today }).rows) {
          if (r.budgetBilledPct === null || OVERRUN_WHITELIST.has(r.projectId)) continue
          expect(r.budgetBilledPct, r.projectId).toBeLessThanOrEqual(105)
        }
      })

      it('no bank or cash account is negative at any month end of the year', () => {
        const { today, from } = setup()
        const ids = new Set(paymentAccountsOf(co).map((a) => a.id))
        const lines = financeJournal.filter((e) => e.companyId === co).flatMap((e) => e.lines.map((l) => ({ date: e.date, l })))
        for (let i = 0; ; i++) {
          const r = monthRange(from, i)
          if (r.from > today) break
          const end = r.to < today ? r.to : today
          for (const id of ids) {
            const bal = lines.filter((x) => x.l.accountId === id && x.date <= end).reduce((s, x) => s + x.l.debit - x.l.credit, 0)
            expect(Math.round(bal * 100), `${id} at ${end}`).toBeGreaterThanOrEqual(0)
          }
        }
      })

      it('events with costs pay back for at least half of them', () => {
        const { user, today } = setup()
        const y = today.slice(0, 4)
        const withCosts = eventProfitability(user, { from: `${y}-01-01`, to: `${y}-12-31` }).rows.filter((r) => r.totalCost > 0)
        expect(withCosts.length).toBeGreaterThan(0)
        expect(withCosts.filter((r) => (r.roiPct ?? -100) > 0).length * 2).toBeGreaterThanOrEqual(withCosts.length)
      })
    })
  }
})
