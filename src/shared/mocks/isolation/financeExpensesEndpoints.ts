import { finExpenseCategories, finExpenseClaims, finExpenses, finPettyFunds } from '@/shared/mocks/data/financeExpenses'
import { ADMIN, api, userToken, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'
import { finToday } from './financeLedgerEndpoints'

/**
 * Coverage-table entries of Accounts & finance › Expenses, expense categories / policy, employee expense claims and
 * petty cash (handlers/financeExpenses.ts), spread into ENDPOINTS (endpoints.ts). Samples run as the company admin
 * (accounting full) unless `as` says otherwise; writes prepare their own data through the API:
 *   expense approve / reject: recorded by Management (u2 / u102), acted on by the admin (maker–checker);
 *   claim approve / reject: a Sales Agent's claim (u5 / u104), acted on by their department head (u3 / u103).
 */

const M = 'finance/expenses'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T => {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Expenses isolation table: no ${what} in ${co}`)
  return row
}

export const MGMT: Record<Co, string> = { co_apex: 'u2', co_crest: 'u102' }
export const AGENT: Record<Co, string> = { co_apex: 'u5', co_crest: 'u104' }
export const HEAD: Record<Co, string> = { co_apex: 'u3', co_crest: 'u103' }

async function ok(co: Co, userId: string, method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(userToken(userId), method, path, { body })
  if (r.status !== 200) throw new Error(`Expenses isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body
}

export const expCategory = (co: Co) => own(finExpenseCategories, co, 'active expense category', (c) => c.active).id
export const expenseBody = (co: Co, extra: Record<string, unknown> = {}) => ({
  date: finToday(co),
  payee_name: `Iso payee ${uniq()}`,
  category_id: expCategory(co),
  amount: 50,
  payment_method: 'card',
  paid_from_account_id: 'ACC-1120',
  ...extra,
})
export const claimBody = (co: Co, extra: Record<string, unknown> = {}) => ({
  title: 'Isolation claim',
  lines: [{ date: finToday(co), category_id: expCategory(co), description: 'Isolation taxi', merchant: 'Taxi', amount: 40, ...extra }],
})

const newPending = async (co: Co): Promise<string> => (await ok(co, MGMT[co], 'POST', '/finance/expenses', expenseBody(co))).id
const newDraftClaim = async (co: Co): Promise<string> => (await ok(co, ADMIN[co], 'POST', '/finance/expense-claims', claimBody(co))).id
const newAgentClaim = async (co: Co): Promise<string> => {
  const id = (await ok(co, AGENT[co], 'POST', '/finance/expense-claims', claimBody(co))).id
  await ok(co, AGENT[co], 'POST', `/finance/expense-claims/${id}/submit`)
  return id
}
const fund = (co: Co) => own(finPettyFunds, co, 'active petty fund', (f) => f.active).id

const s = (f: (co: Co) => Sample | Promise<Sample>) => f

export const FINANCE_EXPENSES_ENDPOINTS: Endpoint[] = [
  /* categories & policy */
  { method: 'GET', path: '/finance/expense-categories', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finExpenseCategories.filter((c) => c.companyId === co && c.active).length } },
  { method: 'POST', path: '/finance/expense-categories', kind: 'company-write', module: M, sample: s(() => ({ body: { name: `Iso category ${uniq()}`, account_id: 'ACC-6550', monthly_limit: 100 } })) },
  { method: 'PATCH', path: '/finance/expense-categories/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: expCategory(co) }, body: { description: 'Checked by isolation' } })) },
  { method: 'GET', path: '/finance/expense-policy', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PATCH', path: '/finance/expense-policy', kind: 'company-write', module: M, sample: () => ({ body: { claim_max_age_days: 60, age_mode: 'warn' } }) },

  /* company expenses */
  { method: 'GET', path: '/finance/expenses', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finExpenses.filter((e) => e.companyId === co).length } },
  { method: 'POST', path: '/finance/expenses', kind: 'company-write', module: M, sample: s((co) => ({ body: expenseBody(co) })) },
  { method: 'GET', path: '/finance/expenses/meta', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/finance/expenses/check-duplicate', kind: 'company-search', module: M, sample: s((co) => { const e = own(finExpenses, co, 'expense'); return { body: { payee_name: e.payeeName, amount: e.amount, date: e.date } } }) },
  { method: 'GET', path: '/finance/expenses/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(finExpenses, co, 'expense').id } })) },
  { method: 'PATCH', path: '/finance/expenses/:id', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newPending(co) }, body: { notes: 'Checked by isolation' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/expenses/:id/approve', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newPending(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/expenses/:id/reject', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newPending(co) }, body: { reason: 'Isolation reject' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/expenses/:id/void', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newPending(co) }, body: { reason: 'Isolation void' }, expect: [200, 409] })) },

  /* employee expense claims */
  { method: 'GET', path: '/finance/expense-claims', kind: 'company-list', module: M, sample: () => ({ query: { view: 'all' } }), count: { of: len, expected: (co) => finExpenseClaims.filter((c) => c.companyId === co).length } },
  { method: 'POST', path: '/finance/expense-claims', kind: 'company-write', module: M, sample: s((co) => ({ body: claimBody(co) })) },
  { method: 'GET', path: '/finance/expense-claims/meta', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/expense-claims/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(finExpenseClaims, co, 'claim', (c) => c.status !== 'draft').id } })) },
  { method: 'PATCH', path: '/finance/expense-claims/:id', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newDraftClaim(co) }, body: { title: 'Checked by isolation' }, expect: [200, 409] })) },
  { method: 'DELETE', path: '/finance/expense-claims/:id', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newDraftClaim(co) }, expect: [200, 404] })) },
  { method: 'POST', path: '/finance/expense-claims/:id/submit', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newDraftClaim(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/expense-claims/:id/approve', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newAgentClaim(co) }, as: HEAD[co], expect: [200, 409] })) },
  { method: 'POST', path: '/finance/expense-claims/:id/reject', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newAgentClaim(co) }, as: HEAD[co], body: { reason: 'Isolation reject' }, expect: [200, 409] })) },
  {
    method: 'POST', path: '/finance/expense-claims/:id/reimburse', kind: 'company-item', module: M,
    note: 'Seeded approved claim: the first run pays it (200), later runs answer 409 not_approved.',
    sample: s((co) => ({ params: { id: own(finExpenseClaims, co, 'approved or reimbursed claim', (c) => c.status === 'approved' || (c.status === 'reimbursed' && c.reimbursement?.method === 'payment')).id }, body: { method: 'payment', account_id: 'ACC-1120' }, expect: [200, 409] })),
  },

  /* petty cash */
  { method: 'GET', path: '/finance/petty-cash/meta', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/petty-cash/funds', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finPettyFunds.filter((f) => f.companyId === co).length } },
  { method: 'POST', path: '/finance/petty-cash/funds', kind: 'company-write', module: M, sample: s((co) => ({ body: { name: `Iso fund ${uniq()}`, custodian_employee_id: co === 'co_apex' ? 'EMP-u4' : 'EMP-u104', float_limit: 200 } })) },
  { method: 'GET', path: '/finance/petty-cash/funds/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: fund(co) } })) },
  { method: 'PATCH', path: '/finance/petty-cash/funds/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: fund(co) }, body: { float_limit: own(finPettyFunds, co, 'fund', (f) => f.id === fund(co)).floatLimit } })) },
  { method: 'POST', path: '/finance/petty-cash/funds/:id/top-up', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: fund(co) }, body: { amount: 1, from_account_id: 'ACC-1120' } })) },
  { method: 'POST', path: '/finance/petty-cash/funds/:id/expenses', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: fund(co) }, body: { category_id: expCategory(co), payee_name: 'Iso shop', amount: 1, description: 'Isolation' } })) },
  { method: 'POST', path: '/finance/petty-cash/funds/:id/replenish', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: fund(co) }, body: { from_account_id: 'ACC-1120' } })) },
  {
    method: 'POST', path: '/finance/petty-cash/funds/:id/count', kind: 'company-item', module: M,
    note: 'Counts the expected cash (no difference, nothing posted).',
    sample: s(async (co) => {
      const f = await ok(co, ADMIN[co], 'GET', `/finance/petty-cash/funds/${fund(co)}`)
      return { params: { id: fund(co) }, body: { counted: f.cash_expected } }
    }),
  },
]
