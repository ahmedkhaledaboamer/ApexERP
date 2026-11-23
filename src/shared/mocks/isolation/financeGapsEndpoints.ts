import { finPaymentRuns, finSupplierAdvances } from '@/shared/mocks/data/financePurchases'
import * as fin from '@/shared/mocks/services/financePurchases'
import { runFinanceHooks } from '@/shared/mocks/services/ledger'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { monthRange } from '@/modules/finance/ledger/calc'
import { ADMIN, userById, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'
import { purchasesFixtures as purFx } from './financePurchasesEndpoints'

/**
 * Coverage-table entries of the finance gaps (docs/DB-ALIGNMENT.md F-P10/F-P11/F-P12/F-B5): supplier advances, the
 * payment-run bank file and its sent / confirmed status, debit-note void (handlers/financePurchases.ts) and the EOSB
 * provision (handlers/financeBanking.ts). Spread into ENDPOINTS (endpoints.ts). Samples run as the company admin
 * (accounting full); each action prepares a FRESH document through the services so the spoofing variants stay valid.
 */

const M = 'finance/gaps'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const s = (f: (co: Co) => Sample | Promise<Sample>) => f
const admin = (co: Co) => userById(ADMIN[co])

/** A fresh advance (500, base currency) to the open bill's supplier. */
const freshAdvance = (co: Co) => fin.createSupplierAdvance(admin(co), { vendorId: purFx.openBill(co).vendorId, paymentAccountId: 'ACC-1120', amount: 500 }).id
/** A fresh debit note (1.00) on an open bill. */
const freshDebitNote = (co: Co) => fin.createDebitNote(admin(co), { billId: purFx.openBill(co).id, reason: 'Isolation credit', amount: 1 }).id
/** A fresh payment run of 1.00 on an open bill, its bank file exported (so it can be marked sent). */
const freshRun = (co: Co, exported: boolean) => {
  const r = fin.createPaymentRun(admin(co), { paymentAccountId: 'ACC-1120', items: [{ billId: purFx.openBill(co).id, amount: 1 }] })
  if (exported) fin.exportPaymentRunFile(admin(co), r.id)
  return r.id
}
const lastClosed = (co: Co) => monthRange(companyDayOf(co).today, -1).month

/** Exposed for scoped.isolation.test.ts (REFS: ids in bodies). */
export const gapsFixtures = { freshAdvance }

export const FINANCE_GAPS_ENDPOINTS: Endpoint[] = [
  /* debit-note void */
  { method: 'POST', path: '/finance/debit-notes/:id/void', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: freshDebitNote(co) }, body: { reason: 'Isolation void' }, expect: [200, 409] })) },

  /* supplier advances */
  {
    method: 'GET', path: '/finance/supplier-advances', kind: 'company-list', module: M, sample: () => ({}),
    count: { of: len, expected: (co) => finSupplierAdvances.filter((a) => a.companyId === co).length },
  },
  { method: 'POST', path: '/finance/supplier-advances', kind: 'company-write', module: M, sample: s((co) => ({ body: { vendor_id: purFx.VENDOR[co], payment_account_id: 'ACC-1120', amount: 100, reference: 'ISO-ADV' } })) },
  {
    method: 'GET', path: '/finance/supplier-advances/:id', kind: 'company-item', module: M,
    sample: s((co) => {
      runFinanceHooks(co)
      const a = finSupplierAdvances.find((x) => x.companyId === co)
      return { params: { id: a ? a.id : freshAdvance(co) } }
    }),
  },
  { method: 'POST', path: '/finance/supplier-advances/:id/apply', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: freshAdvance(co) }, body: { bill_id: purFx.openBill(co).id, amount: 1 }, expect: [200, 409, 422] })) },
  { method: 'POST', path: '/finance/supplier-advances/:id/refund', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: freshAdvance(co) }, body: { amount: 10 }, expect: [200, 422] })) },

  /* payment-run bank file and status */
  {
    method: 'POST', path: '/finance/payment-runs/:id/bank-file', kind: 'company-item', module: M,
    note: 'Accounting full only; the answer IS the bank upload file (full supplier IBANs), audited (REVEAL_PATHS in harness.ts).',
    sample: s((co) => {
      runFinanceHooks(co)
      const r = finPaymentRuns.find((x) => x.companyId === co)
      return { params: { id: r ? r.id : freshRun(co, false) }, expect: [200, 409] }
    }),
  },
  { method: 'POST', path: '/finance/payment-runs/:id/sent', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: freshRun(co, true) }, body: { bank_reference: 'ISO-UPLOAD' }, expect: [200, 409] })) },
  {
    method: 'POST', path: '/finance/payment-runs/:id/confirm', kind: 'company-item', module: M,
    sample: s((co) => {
      const id = freshRun(co, true)
      fin.markPaymentRunSent(admin(co), id, null)
      return { params: { id }, expect: [200, 409] }
    }),
  },

  /* EOSB provision */
  { method: 'GET', path: '/finance/eosb-provision', kind: 'company-export', module: M, sample: () => ({}) },
  { method: 'POST', path: '/finance/eosb-provision/run', kind: 'company-write', module: M, sample: s((co) => ({ body: { month: lastClosed(co) } })) },
]

