import { customers } from '@/shared/mocks/db'
import { financeInvoices } from '@/shared/mocks/data/finance'
import { finPaymentLinks, finPayments, finPdcs } from '@/shared/mocks/data/financeCollections'
import { addDays, availableOn, todayOf } from '@/shared/mocks/services/financeCollectionsCore'
import { createLinkFor, depositPdcFor, ensureCollectionsSeed, paymentTotals, receivePdcFor, recordPaymentFor } from '@/shared/mocks/services/financeCollections'
import { fixtureCreditNote, fixtureInvoice } from '@/shared/mocks/services/financeCollections.fixtures'
import { ADMIN, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Collections (handlers/financeCollections.ts), spread into ENDPOINTS
 * (endpoints.ts). Both seeded companies have the `accounting` module. Samples run as the company admin (accounting
 * full) and prepare their own records through the services (a fresh payment / cheque / link per call, so re-running
 * a sample for the spoofing variants stays valid). The public pay page is `public` (token only, docs/API.md).
 */

const M = 'finance/collections'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
let n = 0

/** An open invoice of the company with something left to pay (an issued fixture when the seed has none). */
function openInvoice(co: Co) {
  ensureCollectionsSeed(co)
  const found = financeInvoices.find((i) => i.companyId === co && availableOn(co, i) > 1)
  if (found) return found
  const today = todayOf(co)
  return fixtureInvoice(co, { issueDate: addDays(today, -40), dueDate: addDays(today, -10), currency: co === 'co_crest' ? 'SAR' : 'AED', vatPct: co === 'co_crest' ? 15 : 5 })
}
/** A fresh small payment left as customer credit, for that invoice's customer and currency. */
function creditPayment(co: Co) {
  const inv = openInvoice(co)
  return recordPaymentFor(co, ADMIN[co], { customerId: inv.customerId, date: todayOf(co), method: 'bank_transfer', amount: 1, currency: inv.currency, exchangeRate: inv.exchangeRate, allocationMode: 'none', reference: 'Isolation' })
}
/** A fresh held cheque dated today (no invoices: an advance cheque). */
function heldCheque(co: Co) {
  const inv = openInvoice(co)
  const today = todayOf(co)
  return receivePdcFor(co, ADMIN[co], { customerId: inv.customerId, chequeNo: `ISO${co.slice(3, 5)}${++n}`, bankName: 'Isolation Bank', receivedDate: today, dueDate: today, amount: 5, currency: inv.currency, exchangeRate: inv.exchangeRate })
}
function depositedCheque(co: Co) {
  const p = heldCheque(co)
  depositPdcFor(co, p, {})
  return p
}
const customerId = (co: Co) => openInvoice(co).customerId
const anyPayment = (co: Co) => {
  ensureCollectionsSeed(co)
  return finPayments.find((p) => p.companyId === co) ?? creditPayment(co)
}
const anyPdc = (co: Co) => {
  ensureCollectionsSeed(co)
  return finPdcs.find((p) => p.companyId === co) ?? heldCheque(co)
}
/** A fresh credit note with 2 of excess credit for an open invoice's customer. */
const creditNote = (co: Co) => fixtureCreditNote(co, openInvoice(co), 2, todayOf(co))
const freshLink = (co: Co) => createLinkFor(co, ADMIN[co], { invoiceId: openInvoice(co).id })
const seeded = (co: Co) => {
  ensureCollectionsSeed(co)
  return co
}

export const FINANCE_COLLECTIONS_ENDPOINTS: Endpoint[] = [
  /* ---- payments ---- */
  { method: 'GET', path: '/finance/payments', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finPayments.filter((p) => p.companyId === co).length } },
  {
    method: 'POST', path: '/finance/payments', kind: 'company-write', module: M,
    sample: (co) => {
      const inv = openInvoice(co)
      return { body: { customer_id: inv.customerId, date: todayOf(co), method: 'cash', amount: 1, currency: inv.currency, exchange_rate: inv.exchangeRate, allocation_mode: 'manual', allocations: [{ invoice_id: inv.id, amount: 1 }] } }
    },
  },
  { method: 'GET', path: '/finance/deposit-accounts', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/payments/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: anyPayment(co).id } }) },
  { method: 'GET', path: '/finance/payments/:id/receipt', kind: 'company-item', module: M, sample: (co) => ({ params: { id: anyPayment(co).id } }) },
  { method: 'POST', path: '/finance/payments/:id/apply-credit', kind: 'company-item', module: M, sample: (co) => ({ params: { id: creditPayment(co).id }, body: {}, expect: [200, 409] }) },
  { method: 'POST', path: '/finance/payments/:id/refund', kind: 'company-item', module: M, sample: (co) => ({ params: { id: creditPayment(co).id }, body: { amount: 1, date: todayOf(co) } }) },
  { method: 'POST', path: '/finance/payments/:id/void', kind: 'company-item', module: M, sample: (co) => ({ params: { id: creditPayment(co).id }, body: { reason: 'Isolation' } }) },

  { method: 'POST', path: '/finance/credit-note-credits/:id/apply', kind: 'company-item', module: M, sample: (co) => ({ params: { id: creditNote(co).id }, body: {}, expect: [200, 409] }) },
  { method: 'POST', path: '/finance/credit-note-credits/:id/refund', kind: 'company-item', module: M, sample: (co) => ({ params: { id: creditNote(co).id }, body: { amount: 1 } }) },

  /* ---- post-dated cheques ---- */
  { method: 'GET', path: '/finance/pdcs', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finPdcs.filter((p) => p.companyId === co).length } },
  {
    method: 'POST', path: '/finance/pdcs', kind: 'company-write', module: M,
    sample: (co) => {
      const inv = openInvoice(co)
      return { body: { customer_id: inv.customerId, cheque_no: `ISOW${++n}`, bank_name: 'Isolation Bank', received_date: todayOf(co), due_date: addDays(todayOf(co), 10), amount: 1, currency: inv.currency, exchange_rate: inv.exchangeRate, allocations: [{ invoice_id: inv.id, amount: 1 }] } }
    },
  },
  { method: 'GET', path: '/finance/pdcs/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: anyPdc(co).id } }) },
  { method: 'POST', path: '/finance/pdcs/:id/deposit', kind: 'company-item', module: M, sample: (co) => ({ params: { id: heldCheque(co).id }, body: {} }) },
  { method: 'POST', path: '/finance/pdcs/:id/clear', kind: 'company-item', module: M, sample: (co) => ({ params: { id: depositedCheque(co).id }, body: {} }) },
  { method: 'POST', path: '/finance/pdcs/:id/bounce', kind: 'company-item', module: M, sample: (co) => ({ params: { id: heldCheque(co).id }, body: { reason: 'Isolation', bounce_fee: 0 } }) },

  /* ---- payment links ---- */
  { method: 'GET', path: '/finance/payment-links', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}), count: { of: len, expected: (co) => finPaymentLinks.filter((l) => l.companyId === co).length } },
  { method: 'POST', path: '/finance/payment-links', kind: 'company-write', module: M, sample: (co) => ({ body: { invoice_id: openInvoice(co).id, expires_in_days: 7 } }) },
  { method: 'POST', path: '/finance/payment-links/:id/void', kind: 'company-item', module: M, sample: (co) => ({ params: { id: freshLink(co).id } }) },

  /* ---- receivables ---- */
  { method: 'GET', path: '/finance/receivables/aging', kind: 'company-export', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'GET', path: '/finance/receivables/aging/:id', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) } }) },
  { method: 'GET', path: '/finance/customers', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => customers.filter((c) => c.companyId === co).length } },
  { method: 'GET', path: '/finance/customers/:id/credit', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) } }) },
  { method: 'PATCH', path: '/finance/customers/:id/credit', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) }, body: { credit_limit: 250000, credit_hold: false } }) },
  { method: 'GET', path: '/finance/customers/:id/open-items', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) } }) },
  { method: 'GET', path: '/finance/customers/:id/statement', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) }, query: { from: addDays(todayOf(co), -365), to: todayOf(co) } }) },
  { method: 'POST', path: '/finance/customers/:id/statement/email', kind: 'company-item', module: M, sample: (co) => ({ params: { id: customerId(co) }, body: { email: 'accounts@example.com' } }) },
  { method: 'GET', path: '/finance/credit-check', kind: 'company-search', module: M, sample: (co) => ({ query: { customer_id: customerId(co), amount: '1000' } }) },

  /* ---- dunning & settings ---- */
  { method: 'GET', path: '/finance/collections/settings', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PATCH', path: '/finance/collections/settings', kind: 'company-write', module: M, sample: () => ({ body: { gateway_fee_pct: 1.5, credit_check_mode: 'warn' } }) },
  { method: 'GET', path: '/finance/dunning/log', kind: 'company-list', module: M, sample: (co) => (seeded(co), {}) },
  { method: 'POST', path: '/finance/dunning/pause', kind: 'company-write', module: M, sample: (co) => ({ body: { target_type: 'invoice', target_id: openInvoice(co).id, paused: true } }) },

  /* ---- public pay page ---- */
  {
    method: 'GET', path: '/public/pay/:token', kind: 'public', module: M,
    reason: 'Public payment page of a payment link (no sign-in by design): the link is found by its unguessable token and answers only that invoice’s number, amount due, currency and the company’s name / logo; an unknown token, a company without accounting or a deleted / suspended workspace answer the same 404.',
  },
  {
    method: 'POST', path: '/public/pay/:token', kind: 'public', module: M,
    reason: 'Public payment (simulated gateway, test mode): pays only the invoice behind the token, in that link’s company; the card is validated and dropped (brand + last 4 kept), rate-limited per client and link.',
  },
]

/** Helpers for the targeted tests (scoped.isolation, role tests). */
export const collectionsFixtures = { openInvoice, creditPayment, heldCheque, freshLink, customerId, paymentTotals }
