import { finVatReturns } from '@/shared/mocks/data/financeTax'
import { finTaxSettings } from '@/shared/mocks/data/financeTax'
import { finBudgets } from '@/shared/mocks/data/financeBudgets'
import { finForecastSettings } from '@/shared/mocks/data/financeBudgets'
import { departments } from '@/shared/mocks/data/departments'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { ensureReturns, fileVatReturn } from '@/shared/mocks/services/financeTax'
import { addForecastLine } from '@/shared/mocks/services/financeForecast'
import { createBudget, putBudgetLines } from '@/shared/mocks/services/financeBudgets'
import { fiscalYearOf } from '@/modules/finance/tax/calc'
import { ADMIN, APEX, userById, type Co } from './harness'
import type { Endpoint } from './endpoints'
import { finToday } from './financeLedgerEndpoints'

/**
 * Coverage-table entries of Accounts & finance › Tax (VAT returns, corporate tax / zakat) and planning (budgets,
 * cash-flow forecast) — handlers/financeTax.ts — spread into ENDPOINTS (endpoints.ts). Samples run as the company admin
 * (accounting full; also a budget approver) and prepare their records through the services: an ended draft VAT return
 * (filed first for the payment sample), a draft budget of a future year with one line, a fresh forecast line.
 */

const M = 'accounting'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
let n = 0

const seeded = (co: Co) => {
  runFinanceHooks(co)
  return co
}
/** The latest ended, unfiled return (or the latest ended one). */
export function endedReturn(co: Co) {
  seeded(co)
  const today = finToday(co)
  const rows = ensureReturns(co).filter((r) => r.to < today)
  return rows.find((r) => r.status === 'draft') ?? rows[0]
}
/** A filed (unpaid when possible) return. */
export function filedReturn(co: Co) {
  const r = endedReturn(co)
  if (r.status === 'draft') fileVatReturn(userById(ADMIN[co]), r.id, { filingReference: `ISO-${++n}-FILE` })
  return finVatReturns.find((x) => x.companyId === co && x.id === r.id)!
}
export const anyReturn = (co: Co) => (seeded(co), ensureReturns(co)[0])

const curYear = (co: Co) => fiscalYearOf(finToday(co), 1)
export const seedBudget = (co: Co) => finBudgets.find((b) => b.companyId === co && b.status === 'approved') ?? finBudgets.find((b) => b.companyId === co)!
export const ownDept = (co: Co) => departments.find((d) => d.companyId === co && d.active !== false)!
/** A draft budget of next year + 1 with one line (created once per seed state). */
export function draftBudget(co: Co) {
  seeded(co)
  const year = curYear(co) + 2
  const found = finBudgets.find((b) => b.companyId === co && b.fiscalYear === year)
  if (found) return found
  const admin = userById(ADMIN[co])
  const d = createBudget(admin, { fiscalYear: year })
  putBudgetLines(admin, d.id, { lines: [{ departmentId: ownDept(co).id, accountId: 'ACC-6600', annual: 1200 }] })
  return finBudgets.find((b) => b.id === d.id)!
}
const freshLine = (co: Co) => {
  seeded(co)
  return addForecastLine(userById(ADMIN[co]), { label: `Iso line ${++n}`, date: finToday(co), amount: -10 - n, recurrence: 'once' }).settings.lines.find((l) => l.label === `Iso line ${n}`)!
}

export const FINANCE_TAX_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/finance/tax/settings', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'PATCH', path: '/finance/tax/settings', kind: 'company-write', module: M, sample: (co) => ({ body: { vat_frequency: finTaxSettings.get(seeded(co)).vatFrequency } }) },
  { method: 'GET', path: '/finance/vat-returns', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => (ensureReturns(co), finVatReturns.filter((r) => r.companyId === co).length) } },
  { method: 'GET', path: '/finance/vat-returns/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: anyReturn(co).id } }) },
  { method: 'GET', path: '/finance/vat-returns/:id/boxes/:box', kind: 'company-item', module: M, notOwned: ['box'], sample: (co) => ({ params: { id: anyReturn(co).id, box: '1' } }) },
  { method: 'POST', path: '/finance/vat-returns/:id/file', kind: 'company-item', module: M, sample: (co) => ({ params: { id: endedReturn(co).id }, body: { filing_reference: `ISO-${++n}-REF` }, expect: [200, 409] }) },
  { method: 'POST', path: '/finance/vat-returns/:id/pay', kind: 'company-item', module: M, sample: (co) => ({ params: { id: filedReturn(co).id }, body: { reference: 'ISO-PAY' }, expect: [200, 409] }) },
  { method: 'GET', path: '/finance/tax/corporate-tax', kind: 'company-export', module: M, sample: (co) => (seeded(co), { expect: co === APEX ? 200 : 409 }) },
  { method: 'GET', path: '/finance/tax/zakat', kind: 'company-export', module: M, sample: (co) => (seeded(co), { expect: co === APEX ? 409 : 200 }) },
  { method: 'PUT', path: '/finance/tax/adjustments', kind: 'company-write', module: M, sample: (co) => ({ body: { kind: co === APEX ? 'corporate_tax' : 'zakat', lines: [{ label: 'Iso adjustment', amount: 100 }] } }) },
  { method: 'POST', path: '/finance/tax/provisions', kind: 'company-write', module: M, sample: (co) => ({ body: { kind: co === APEX ? 'corporate_tax' : 'zakat' }, expect: [200, 409] }) },
]

export const FINANCE_BUDGETS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/finance/budgets', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finBudgets.filter((b) => b.companyId === co).length } },
  { method: 'POST', path: '/finance/budgets', kind: 'company-write', module: M, sample: (co) => ({ body: { fiscal_year: curYear(co) + 1, name: 'Iso budget' }, expect: [200, 409] }) },
  { method: 'GET', path: '/finance/budgets/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: seedBudget(co).id } }) },
  { method: 'DELETE', path: '/finance/budgets/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: draftBudget(co).id }, expect: [200, 404] }) },
  { method: 'PUT', path: '/finance/budgets/:id/lines', kind: 'company-item', module: M, sample: (co) => ({ params: { id: draftBudget(co).id }, body: { lines: [{ department_id: ownDept(co).id, account_id: 'ACC-6600', annual: 2400, pattern: 'even' }] } }) },
  { method: 'POST', path: '/finance/budgets/:id/copy-actuals', kind: 'company-item', module: M, sample: (co) => ({ params: { id: draftBudget(co).id }, body: { from_year: curYear(co), adjust_pct: 5 } }) },
  { method: 'POST', path: '/finance/budgets/:id/approve', kind: 'company-item', module: M, sample: (co) => ({ params: { id: draftBudget(co).id }, expect: [200, 409] }) },
  { method: 'POST', path: '/finance/budgets/:id/reopen', kind: 'company-item', module: M, sample: (co) => ({ params: { id: seedBudget(co).id }, expect: [200, 409] }) },
  { method: 'GET', path: '/finance/budgets/:id/vs-actual', kind: 'company-item', module: M, sample: (co) => ({ params: { id: seedBudget(co).id } }) },
  { method: 'GET', path: '/finance/forecast', kind: 'company-export', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'PUT', path: '/finance/forecast/settings', kind: 'company-write', module: M, sample: (co) => ({ body: { inflow_adjust_pct: 0, minimum_cash: finForecastSettings.get(seeded(co)).minimumCash } }) },
  { method: 'POST', path: '/finance/forecast/lines', kind: 'company-write', module: M, sample: (co) => ({ body: { label: `Iso forecast ${++n}`, date: finToday(co), amount: 25, recurrence: 'once' } }) },
  { method: 'DELETE', path: '/finance/forecast/lines/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshLine(co).id } }) },
]
