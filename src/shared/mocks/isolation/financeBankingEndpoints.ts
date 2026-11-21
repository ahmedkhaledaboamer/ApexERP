import { financeAccounts } from '@/shared/mocks/data/finance'
import { finBankAccounts, finBankMatches, finBankReconciliations, finBankRules, finBankTransfers } from '@/shared/mocks/data/financeBanking'
import { finCommissionPlans, finCommissionStatements } from '@/shared/mocks/data/financeCommissions'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { postJournal, runFinanceHooks } from '@/shared/mocks/services/ledger'
import { createTransferFor, matchFor, storeStatement } from '@/shared/mocks/services/financeBanking'
import { generateFor } from '@/shared/mocks/services/financeCommissions'
import { addDays, todayOf } from '@/shared/mocks/services/financeCollectionsCore'
import { lineIdOf } from '@/modules/finance/banking/calc'
import { users } from '@/shared/mocks/db'
import { ADMIN, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Banking, Payroll posting (handlers/financeBanking.ts) and Sales
 * commissions (handlers/financeCommissions.ts), spread into ENDPOINTS (endpoints.ts). Samples run as the company admin
 * (accounting full; Company Admin also stands in for both commission approval steps) and prepare fresh records through
 * the services (a new statement line / journal line / transfer / rule per call), so the spoofing re-runs stay valid.
 */

const M = 'accounting'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
let n = 0

const seeded = (co: Co) => {
  runFinanceHooks(co)
  return co
}
/** The main bank account (ledger 1120) and a second, non-cash one of the company. */
export function mainBank(co: Co) {
  seeded(co)
  return finBankAccounts.find((b) => b.companyId === co && b.ledgerAccountId === 'ACC-1120')!
}
export function otherBank(co: Co) {
  seeded(co)
  return finBankAccounts.find((b) => b.companyId === co && b.ledgerAccountId !== 'ACC-1120' && b.kind !== 'cash' && b.currency === mainBank(co).currency)!
}
/** A fresh unmatched journal line on the second bank account and a statement line of the same amount. */
export function freshPair(co: Co) {
  const b = otherBank(co)
  const amount = 3 + (++n % 90) / 100
  const date = todayOf(co)
  const e = postJournal(co, { date, memo: `Isolation deposit ${n}`, sourceType: 'manual', sourceId: null, createdBy: ADMIN[co], lines: [{ accountId: b.ledgerAccountId, debit: amount, credit: 0, description: 'Isolation' }, { accountId: 'ACC-4900', debit: 0, credit: amount, description: 'Isolation' }] })
  const s = storeStatement(co, ADMIN[co], b.id, `iso-${n}.csv`, [{ date, description: `Isolation ${n}`, reference: `ISO${n}`, amount, balance: null }])
  return { bank: b, statement: s, statementLineId: s.lines[0].id, journalLineId: lineIdOf(e.id, 0) }
}
const freshMatch = (co: Co) => {
  const p = freshPair(co)
  return matchFor(co, ADMIN[co], p.bank, { statementLineIds: [p.statementLineId], journalLineIds: [p.journalLineId] })
}
const freshTransfer = (co: Co) => createTransferFor(co, ADMIN[co], { fromBankAccountId: mainBank(co).id, toBankAccountId: otherBank(co).id, amountFrom: 1, date: todayOf(co) })
const csv = (co: Co) => `Date,Description,Amount\n${todayOf(co)},Isolation import ${++n},-${(1 + n / 100).toFixed(2)}\n`
const recon = (co: Co) => {
  seeded(co)
  return finBankReconciliations.find((r) => r.companyId === co)!
}
const freshRule = (co: Co) => {
  seeded(co)
  finBankRules.push({ companyId: co, id: `BR-ISO${co.slice(3, 5)}${++n}`, name: 'Iso rule', contains: `iso${n}`, direction: 'any', accountId: 'ACC-6800', bankAccountId: null, active: true, createdAt: new Date().toISOString(), createdBy: ADMIN[co] })
  return finBankRules[finBankRules.length - 1]
}
const run = (co: Co) => hrPayrollRuns.find((r) => r.companyId === co && r.status !== 'paid') ?? hrPayrollRuns.find((r) => r.companyId === co)!
const plan = (co: Co) => {
  seeded(co)
  return finCommissionPlans.find((p) => p.companyId === co)!
}
/** A pending commission statement (a fresh, empty one for a rep without a pending statement this month when needed). */
const pendingStatement = (co: Co) => {
  seeded(co)
  const found = finCommissionStatements.find((s) => s.companyId === co && s.status === 'pending_manager')
  if (found) return found
  const rep = users.find((u) => u.companyId === co && u.role === 'Sales Agent')!
  return generateFor(co, ADMIN[co], rep, todayOf(co).slice(0, 7), { includeEmpty: true })!
}
const anyStatement = (co: Co) => {
  seeded(co)
  return finCommissionStatements.find((s) => s.companyId === co) ?? pendingStatement(co)
}

export const FINANCE_BANKING_ENDPOINTS: Endpoint[] = [
  /* ---- bank accounts ---- */
  { method: 'GET', path: '/finance/bank-accounts', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finBankAccounts.filter((b) => b.companyId === co && b.active).length } },
  { method: 'GET', path: '/finance/bank-accounts/ledger-options', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'POST', path: '/finance/bank-accounts', kind: 'company-write', module: M, sample: (co) => ({ body: { name: `Isolation bank ${++n}`, bank_name: 'Iso Bank', kind: 'current', opening_balance: 10, opening_date: todayOf(co) } }) },
  { method: 'GET', path: '/finance/bank-accounts/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: mainBank(co).id } }) },
  { method: 'PATCH', path: '/finance/bank-accounts/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: otherBank(co).id }, body: { notes: 'Checked' } }) },
  { method: 'POST', path: '/finance/bank-accounts/:id/reveal', kind: 'company-item', module: M, sample: (co) => ({ params: { id: mainBank(co).id } }) },

  /* ---- statements ---- */
  { method: 'GET', path: '/finance/bank-accounts/:id/statements', kind: 'company-item', module: M, sample: (co) => ({ params: { id: mainBank(co).id } }) },
  { method: 'POST', path: '/finance/bank-accounts/:id/statements/preview', kind: 'company-item', module: M, sample: (co) => ({ params: { id: otherBank(co).id }, body: { csv: csv(co) } }) },
  { method: 'POST', path: '/finance/bank-accounts/:id/statements', kind: 'company-item', module: M, sample: (co) => ({ params: { id: otherBank(co).id }, body: { csv: csv(co), file_name: 'iso.csv' } }) },
  { method: 'GET', path: '/finance/bank-statements/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshPair(co).statement.id } }) },
  { method: 'DELETE', path: '/finance/bank-statements/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshPair(co).statement.id } }) },

  /* ---- reconciliation ---- */
  { method: 'GET', path: '/finance/bank-accounts/:id/reconcile', kind: 'company-item', module: M, sample: (co) => ({ params: { id: mainBank(co).id } }) },
  {
    method: 'POST', path: '/finance/bank-accounts/:id/matches', kind: 'company-item', module: M,
    sample: (co) => {
      const p = freshPair(co)
      return { params: { id: p.bank.id }, body: { statement_line_ids: [p.statementLineId], journal_line_ids: [p.journalLineId] }, expect: [200, 409] }
    },
  },
  { method: 'POST', path: '/finance/bank-accounts/:id/auto-match', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshPair(co).bank.id } }) },
  { method: 'DELETE', path: '/finance/bank-matches/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshMatch(co).id } }) },
  { method: 'POST', path: '/finance/bank-statement-lines/:id/create-entry', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshPair(co).statementLineId }, body: { account_id: 'ACC-4900' } }) },
  { method: 'POST', path: '/finance/bank-accounts/:id/reconciliations', kind: 'company-item', module: M, sample: (co) => ({ params: { id: otherBank(co).id }, body: { statement_date: addDays(todayOf(co), 1) }, expect: [200, 409, 422] }) },
  { method: 'GET', path: '/finance/bank-reconciliations', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finBankReconciliations.filter((r) => r.companyId === co).length } },
  { method: 'GET', path: '/finance/bank-reconciliations/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: recon(co).id } }) },
  { method: 'POST', path: '/finance/bank-reconciliations/:id/undo', kind: 'company-item', module: M, sample: (co) => ({ params: { id: recon(co).id }, expect: [200, 409] }) },

  /* ---- rules ---- */
  { method: 'GET', path: '/finance/bank-rules', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finBankRules.filter((r) => r.companyId === co).length } },
  { method: 'POST', path: '/finance/bank-rules', kind: 'company-write', module: M, sample: () => ({ body: { contains: `iso-rule-${++n}`, direction: 'out', account_id: 'ACC-6800' } }) },
  { method: 'PATCH', path: '/finance/bank-rules/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshRule(co).id }, body: { active: false } }) },
  { method: 'DELETE', path: '/finance/bank-rules/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshRule(co).id } }) },

  /* ---- transfers ---- */
  { method: 'GET', path: '/finance/bank-transfers', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finBankTransfers.filter((t) => t.companyId === co).length } },
  { method: 'POST', path: '/finance/bank-transfers', kind: 'company-write', module: M, sample: (co) => ({ body: { from_bank_account_id: mainBank(co).id, to_bank_account_id: otherBank(co).id, amount_from: 2, date: todayOf(co) } }) },
  { method: 'POST', path: '/finance/bank-transfers/:id/void', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshTransfer(co).id } }) },

  /* ---- payroll posting ---- */
  { method: 'GET', path: '/finance/payroll-postings', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => hrPayrollRuns.filter((r) => r.companyId === co).length } },
  { method: 'GET', path: '/finance/payroll-postings/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: run(co).id } }) },
  { method: 'PUT', path: '/finance/payroll-postings/:id/paid-from', kind: 'company-item', module: M, sample: (co) => ({ params: { id: run(co).id }, body: { account_id: 'ACC-1120' }, expect: [200, 409] }) },
]

export const FINANCE_COMMISSIONS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/finance/commission-plans', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finCommissionPlans.filter((p) => p.companyId === co).length } },
  { method: 'POST', path: '/finance/commission-plans', kind: 'company-write', module: M, sample: () => ({ body: { name: `Isolation plan ${++n}`, basis: 'won_deals', rate: 1, roles: ['Sales Agent'], effective_from: '2099-01' } }) },
  { method: 'PATCH', path: '/finance/commission-plans/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: plan(co).id }, body: { cap_per_month: 9999 } }) },
  { method: 'GET', path: '/finance/commissions/mine', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'GET', path: '/finance/commission-statements', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finCommissionStatements.filter((s) => s.companyId === co).length } },
  { method: 'POST', path: '/finance/commission-statements/generate', kind: 'company-write', module: M, sample: (co) => ({ body: { month: todayOf(co).slice(0, 7) } }) },
  { method: 'GET', path: '/finance/commission-statements/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: anyStatement(co).id } }) },
  { method: 'POST', path: '/finance/commission-statements/:id/approve', kind: 'company-item', module: M, sample: (co) => ({ params: { id: pendingStatement(co).id }, expect: [200, 403, 409] }) },
  { method: 'POST', path: '/finance/commission-statements/:id/reject', kind: 'company-item', module: M, sample: (co) => ({ params: { id: pendingStatement(co).id }, body: { reason: 'Isolation' }, expect: [200, 403, 409] }) },
]

/** For the REFS of scoped.isolation.test.ts and the role tests. */
export const bankingFixtures = { mainBank, otherBank, freshPair, freshTransfer, plan, pendingStatement, run, ledgerOf: (co: Co) => financeAccounts.find((a) => a.companyId === co && a.id === otherBank(co).ledgerAccountId)!, matchCount: (co: Co) => finBankMatches.filter((m) => m.companyId === co).length }
