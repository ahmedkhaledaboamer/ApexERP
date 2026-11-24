import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { finYearEndCloses } from '@/shared/mocks/data/financeStatements'
import { addDays } from '@/modules/finance/statements/calc'
import { ADMIN, api, userToken, type Co } from './harness'
import { finToday } from './financeLedgerEndpoints'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Financial statements and year-end close (handlers/financeStatements.ts),
 * spread into ENDPOINTS (endpoints.ts). Samples run as the company admin (closes and re-opens included). A closable
 * year: the fiscal year is set to start in the company's current month, so the previous one ended last month
 * (`closableYear`).
 */

const M = 'accounting'

/** Makes the year that ended last month closable for `co` (fiscal year starting this month); returns its last day. */
export function closableYear(co: Co): string {
  const today = finToday(co)
  financeSettings.get(co).fiscalYearStartMonth = Number(today.slice(5, 7))
  return addDays(`${today.slice(0, 7)}-01`, -1)
}

/** A closed year of `co` (closed through the API when none): its close id. */
async function closedYear(co: Co): Promise<string> {
  const found = finYearEndCloses.find((c) => c.companyId === co && c.status === 'closed')
  if (found) return found.id
  const end = closableYear(co)
  const r = await api(userToken(ADMIN[co]), 'POST', '/finance/year-end/close', { body: { fiscal_year_end: end } })
  if (r.status !== 200) throw new Error(`Statements isolation table: close for ${co} answered ${r.status}: ${r.text}`)
  return r.body.close.id as string
}

export const FINANCE_STATEMENTS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/finance/statements/meta', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/statements/profit-and-loss', kind: 'company-export', module: M, sample: () => ({ query: { period: 'ytd', compare: 'previous_period,last_year' } }) },
  { method: 'GET', path: '/finance/statements/balance-sheet', kind: 'company-export', module: M, sample: (co) => ({ query: { as_of: finToday(co), compare_to: '2026-06-30' } }) },
  { method: 'GET', path: '/finance/statements/cash-flow', kind: 'company-export', module: M, sample: () => ({ query: { period: 'ytd' } }) },
  { method: 'GET', path: '/finance/statements/general-ledger', kind: 'company-export', module: M, sample: (co) => ({ query: { from: '2026-01-01', to: finToday(co) } }) },
  { method: 'GET', path: '/finance/statements/trial-balance', kind: 'company-export', module: M, sample: (co) => ({ query: { as_of: finToday(co), compare_to: '2026-06-30' } }) },
  { method: 'GET', path: '/finance/year-end', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/year-end/preview', kind: 'company-export', module: M, sample: (co) => ({ query: { fiscal_year_end: closableYear(co) } }) },
  { method: 'POST', path: '/finance/year-end/close', kind: 'company-write', module: M, sample: (co) => ({ body: { fiscal_year_end: closableYear(co), note: 'Isolation close' }, expect: [200, 409] }) },
  {
    method: 'POST', path: '/finance/year-end/closes/:id/reopen', kind: 'company-item', module: M,
    sample: async (co) => ({ params: { id: await closedYear(co) }, body: { reason: 'Isolation re-open' }, expect: [200, 409] }),
  },
]
