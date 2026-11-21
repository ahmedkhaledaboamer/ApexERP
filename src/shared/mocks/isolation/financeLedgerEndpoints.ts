import type { Account, AccountType } from '@/modules/finance/types'
import { financeAccounts, financeJournal } from '@/shared/mocks/data/finance'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { companyById } from '@/shared/mocks/data/tenancy'
import { todayIsoIn } from '@/shared/lib/companyDay'
import type { Tenant } from '@/shared/mocks/tenant'
import { ADMIN, api, userToken, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › ledger core and setup (handlers/financeLedger.ts), spread into
 * ENDPOINTS (endpoints.ts). Both seeded companies have the `accounting` module. Samples run as the company admin
 * (accounting full; the lock date is Company Admin / Accountant). Seeded chart accounts share their ids across companies
 * by design (`ACC-<code>`, company-scoped rows), so item samples use a company-unique account (`ACC-N…`) created for the
 * company (`ownAccount`).
 */

const M = 'accounting'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
export const finToday = (co: Co) => todayIsoIn(companyById(co)!.regional.timezone)

const CODES: Record<AccountType, [string, string]> = {
  asset: ['1990', '1980'],
  liability: ['2990', '2980'],
  equity: ['3990', '3980'],
  income: ['4990', '4980'],
  expense: ['6990', '6980'],
}
const PARENT: Record<AccountType, string> = { asset: 'ACC-1000', liability: 'ACC-2000', equity: 'ACC-3000', income: 'ACC-4000', expense: 'ACC-6000' }

/**
 * A company-unique account (id `ACC-N<n>`, never shared with the other company) of a type, created in the store when
 * missing: postable, or a header. Used by item samples and by the foreign-id REFS of scoped.isolation.test.ts.
 */
export function ownAccount(co: Co, type: AccountType = 'expense', header = false): Tenant<Account> {
  const code = CODES[type][header ? 1 : 0]
  const found = financeAccounts.find((a) => a.companyId === co && a.code === code)
  if (found) return found
  const n = 90000 + financeAccounts.length + (co === 'co_apex' ? 0 : 50000)
  const at = new Date().toISOString()
  const acc: Tenant<Account> = {
    companyId: co,
    id: `ACC-N${n}`,
    code,
    name: `Isolation ${type}${header ? ' header' : ''} ${co}`,
    type,
    subtype: header ? 'header' : type === 'expense' ? 'operating_expense' : type === 'income' ? 'operating_income' : type === 'asset' ? 'current_asset' : type === 'liability' ? 'current_liability' : 'equity',
    parentId: PARENT[type],
    systemRole: null,
    isHeader: header,
    active: true,
    currency: null,
    description: '',
    createdAt: at,
    updatedAt: at,
  }
  financeAccounts.push(acc)
  return acc
}

async function ok(co: Co, method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(userToken(ADMIN[co]), method, path, { body })
  if (r.status !== 200) throw new Error(`Finance isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body
}

const manualBody = (co: Co, memo = 'Isolation entry') => ({
  date: finToday(co),
  memo,
  lines: [
    { account_id: 'ACC-6800', debit: 12.5, credit: 0, description: 'Bank fee' },
    { account_id: 'ACC-1120', debit: 0, credit: 12.5, description: 'Bank' },
  ],
})
const entryOf = (co: Co) => {
  const e = financeJournal.find((x) => x.companyId === co)
  if (!e) throw new Error(`Finance isolation table: no journal entry in ${co}`)
  return e
}

export const FINANCE_LEDGER_ENDPOINTS: Endpoint[] = [
  /* settings, lock date, exchange rates */
  { method: 'GET', path: '/finance/settings', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PATCH', path: '/finance/settings', kind: 'company-write', module: M, sample: () => ({ body: { payment_terms_days: 21, invoice_notes: 'Isolation notes' } }) },
  { method: 'PUT', path: '/finance/settings/lock-date', kind: 'company-write', module: M, sample: () => ({ body: { lock_date: '2025-12-31', reason: 'Year end' } }) },
  { method: 'GET', path: '/finance/exchange-rates/lookup', kind: 'company-search', module: M, sample: () => ({ query: { currency: 'USD', date: '2026-06-01' } }) },
  { method: 'POST', path: '/finance/exchange-rates', kind: 'company-write', module: M, sample: () => ({ body: { currency: 'GBP', rate: 4.61, effective_date: '2026-10-01' }, expect: [200, 409] }) },
  {
    method: 'DELETE', path: '/finance/exchange-rates/:id', kind: 'company-item', module: M,
    sample: (co) => ({ params: { id: financeSettings.get(co).exchangeRates[0].id }, expect: [200, 404] }),
  },

  /* chart of accounts */
  // Finance hooks first: the banking seed adds ledger accounts for new bank accounts.
  { method: 'GET', path: '/finance/accounts', kind: 'company-list', module: M, sample: (co) => (runFinanceHooks(co), {}), count: { of: len, expected: (co) => financeAccounts.filter((a) => a.companyId === co).length } },
  { method: 'POST', path: '/finance/accounts/import-template', kind: 'company-write', module: M, sample: () => ({ expect: [200, 409] }) },
  { method: 'POST', path: '/finance/accounts', kind: 'company-write', module: M, sample: () => ({ body: { code: '6970', name: 'Isolation expense', type: 'expense', parent_id: 'ACC-6000' }, expect: [200, 409] }) },
  { method: 'PATCH', path: '/finance/accounts/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: ownAccount(co).id }, body: { description: 'Checked' } }) },
  { method: 'DELETE', path: '/finance/accounts/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: ownAccount(co).id }, expect: [200, 404] }) },
  { method: 'GET', path: '/finance/accounts/:id/ledger', kind: 'company-item', module: M, sample: (co) => ({ params: { id: ownAccount(co).id } }) },

  /* journal */
  // The first finance access seeds collections (payments post to the journal): run it before counting.
  { method: 'GET', path: '/finance/journal', kind: 'company-list', module: M, sample: (co) => (runFinanceHooks(co), {}), count: { of: len, expected: (co) => financeJournal.filter((e) => e.companyId === co).length } },
  { method: 'GET', path: '/finance/journal/dimensions', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/finance/journal', kind: 'company-write', module: M, sample: (co) => ({ body: manualBody(co) }) },
  { method: 'GET', path: '/finance/journal/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: entryOf(co).id } }) },
  {
    method: 'POST', path: '/finance/journal/:id/reverse', kind: 'company-item', module: M,
    sample: async (co) => ({ params: { id: (await ok(co, 'POST', '/finance/journal', manualBody(co, 'To reverse'))).id }, body: { date: finToday(co) }, expect: [200, 409] }),
  },
  {
    method: 'POST', path: '/finance/opening-balances', kind: 'company-write', module: M,
    sample: (co) => ({ body: { date: finToday(co), lines: [{ account_id: 'ACC-1520', debit: 1000, credit: 0 }] } }),
  },

  /* reports, overview */
  { method: 'GET', path: '/finance/reports/trial-balance', kind: 'company-export', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/overview', kind: 'company-export', module: M, sample: () => ({}) },
]
