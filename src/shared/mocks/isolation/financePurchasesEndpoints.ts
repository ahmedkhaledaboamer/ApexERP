import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { events } from '@/shared/mocks/data/events'
import { finBillPayments, finBills, finDebitNotes, finPaymentRuns, finPurchaseOrders, finSupplierProfiles } from '@/shared/mocks/data/financePurchases'
import * as fin from '@/shared/mocks/services/financePurchases'
import { ADMIN, userById, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Purchases & payables (handlers/financePurchases.ts), spread into
 * ENDPOINTS (endpoints.ts). Samples run as the company admin (accounting full) unless `as` names the approver (the
 * department head of the requester, or the accountant / management step). Every action sample prepares a FRESH
 * document through the services, so re-running it for the spoofing variants stays valid.
 */

const M = 'finance/purchases'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
let n = 0
const uniq = () => `${Date.now().toString(36)}${++n}`

/** Who plays which part per company. */
const EMPLOYEE: Record<Co, string> = { co_apex: 'u11', co_crest: 'u107' } // requester (delivery / operations)
const HEAD: Record<Co, string> = { co_apex: 'u10', co_crest: 'u106' } // their department head
const ACCOUNTANT: Record<Co, string> = { co_apex: 'u8', co_crest: 'u102' } // accountant step (Crest: Management stands in)
const VENDOR: Record<Co, string> = { co_apex: 'VND-1002', co_crest: 'VND-5002' }

const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T => {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Purchases isolation table: no ${what} in ${co}`)
  return row
}
const lines = () => [{ description: 'Isolation line', quantity: 2, unit_price: 150 }]
const svcLines = () => [{ description: 'Isolation line', quantity: 2, unitPrice: 150 }]

/** Fresh documents (through the services). */
const draftPo = (co: Co) => fin.createPurchaseOrder(userById(EMPLOYEE[co]), { vendorId: VENDOR[co], lines: svcLines() }).id
const pendingPo = (co: Co) => {
  const id = draftPo(co)
  fin.submitPurchaseOrder(userById(EMPLOYEE[co]), id)
  return id
}
const approvedPo = (co: Co) => {
  const id = pendingPo(co)
  fin.approvePurchaseOrder(userById(HEAD[co]), id)
  return id
}
const draftBill = (co: Co) => fin.createBill(userById(ADMIN[co]), { vendorId: VENDOR[co], supplierInvoiceNumber: `ISO-${uniq()}`, lines: svcLines() }).id
const pendingBill = (co: Co) => {
  const id = draftBill(co)
  fin.submitBill(userById(ADMIN[co]), id)
  return id
}
const postedBill = (co: Co) => {
  const id = pendingBill(co)
  fin.approveBill(userById(ACCOUNTANT[co]), id)
  return id
}
const poBill = (co: Co) => {
  const po = approvedPo(co)
  return fin.createBill(userById(ADMIN[co]), { poId: po, supplierInvoiceNumber: `ISO-PO-${uniq()}` }).id
}
const freshPayment = (co: Co) => fin.createBillPayment(userById(ADMIN[co]), { vendorId: VENDOR[co], paymentAccountId: 'ACC-1120', allocations: [{ billId: postedBill(co), amount: 10 }] }).id
const freshAttachment = (co: Co) => {
  const b = own(finBills, co, 'open bill', (x) => x.status === 'open')
  const d = fin.addBillAttachment(userById(ADMIN[co]), b.id, { name: `iso-${uniq()}.png`, mimeType: 'image/png', dataUrl: TINY_PNG })
  return { bill: b.id, att: d.attachments[d.attachments.length - 1].id }
}
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** A seeded vendor with a finance profile and an IBAN. */
const supplier = (co: Co) => own(finSupplierProfiles, co, 'supplier profile with IBAN', (p) => !!p.iban).vendorId
const openBill = (co: Co) => own(finBills, co, 'open base-currency bill', (b) => (b.status === 'open' || b.status === 'partially_paid') && b.balanceDue > 10 && b.exchangeRate === 1)
const event = (co: Co) => own(events, co, 'event').id

const s = (f: (co: Co) => Sample | Promise<Sample>) => f

/** Exposed for scoped.isolation.test.ts (REFS: ids in bodies). */
export const purchasesFixtures = { supplier, openBill, draftPo, draftBill, approvedPo, VENDOR, EMPLOYEE, HEAD, ACCOUNTANT }

export const FINANCE_PURCHASES_ENDPOINTS: Endpoint[] = [
  /* suppliers */
  { method: 'GET', path: '/finance/suppliers', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => eventVendors.filter((v) => v.companyId === co).length } },
  { method: 'POST', path: '/finance/suppliers', kind: 'company-write', module: M, sample: s(() => ({ body: { name: `Isolation supplier ${uniq()}`, vat_number: '100999000000003', payment_terms_days: 30 } })) },
  { method: 'GET', path: '/finance/suppliers/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: supplier(co) } })) },
  { method: 'PATCH', path: '/finance/suppliers/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: supplier(co) }, body: { notes: 'Checked by isolation' } })) },
  {
    method: 'POST', path: '/finance/suppliers/:id/reveal-iban', kind: 'company-item', module: M,
    note: 'Accounting full only; the full IBAN (audited). Everywhere else it is served masked “•••• 1234”.',
    sample: s((co) => ({ params: { id: supplier(co) } })),
  },
  { method: 'GET', path: '/finance/suppliers/:id/statement', kind: 'company-export', module: M, sample: s((co) => ({ params: { id: supplier(co) } })) },
  { method: 'GET', path: '/finance/purchases/meta', kind: 'company-list', module: M, sample: () => ({}) },

  /* purchase orders */
  { method: 'GET', path: '/finance/purchase-orders', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finPurchaseOrders.filter((p) => p.companyId === co).length } },
  { method: 'POST', path: '/finance/purchase-orders', kind: 'company-write', module: M, sample: s((co) => ({ body: { vendor_id: VENDOR[co], lines: lines() } })) },
  { method: 'GET', path: '/finance/purchase-orders/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(finPurchaseOrders, co, 'PO').id } })) },
  { method: 'PATCH', path: '/finance/purchase-orders/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftPo(co) }, body: { notes: 'Checked by isolation' } })) },
  { method: 'DELETE', path: '/finance/purchase-orders/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftPo(co) }, expect: [200, 404] })) },
  { method: 'POST', path: '/finance/purchase-orders/:id/submit', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftPo(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/purchase-orders/:id/approve', kind: 'company-item', module: M, note: 'As the requester’s department head (step 1).', sample: s((co) => ({ params: { id: pendingPo(co) }, as: HEAD[co], expect: [200, 409] })) },
  { method: 'POST', path: '/finance/purchase-orders/:id/reject', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: pendingPo(co) }, as: HEAD[co], body: { reason: 'Isolation reject' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/purchase-orders/:id/cancel', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftPo(co) }, body: { reason: 'Isolation cancel' }, expect: [200, 409] })) },
  {
    method: 'POST', path: '/finance/purchase-orders/:id/receive', kind: 'company-item', module: M,
    sample: s((co) => {
      const id = approvedPo(co)
      const po = finPurchaseOrders.find((p) => p.id === id)!
      return { params: { id }, body: { lines: [{ line_id: po.lines[0].id, quantity: 1 }] }, expect: [200, 422] }
    }),
  },
  { method: 'POST', path: '/finance/purchase-orders/:id/close', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: approvedPo(co) }, expect: [200, 409] })) },

  /* bills */
  { method: 'GET', path: '/finance/bills', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finBills.filter((b) => b.companyId === co).length } },
  { method: 'POST', path: '/finance/bills', kind: 'company-write', module: M, sample: s((co) => ({ body: { vendor_id: VENDOR[co], supplier_invoice_number: `ISO-${uniq()}`, lines: lines() } })) },
  { method: 'GET', path: '/finance/bills/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: openBill(co).id } })) },
  { method: 'PATCH', path: '/finance/bills/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftBill(co) }, body: { notes: 'Checked by isolation' } })) },
  { method: 'DELETE', path: '/finance/bills/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftBill(co) }, expect: [200, 404] })) },
  { method: 'POST', path: '/finance/bills/:id/submit', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draftBill(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/bills/:id/post', kind: 'company-item', module: M, note: 'Direct posting of a bill matched to an approved PO.', sample: s((co) => ({ params: { id: poBill(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/bills/:id/approve', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: pendingBill(co) }, as: ACCOUNTANT[co], expect: [200, 409] })) },
  { method: 'POST', path: '/finance/bills/:id/reject', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: pendingBill(co) }, as: ACCOUNTANT[co], body: { reason: 'Isolation reject' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/bills/:id/void', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: postedBill(co) }, body: { reason: 'Isolation void' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/bills/:id/attachments', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: openBill(co).id }, body: { name: 'iso.png', mime_type: 'image/png', data_url: TINY_PNG }, expect: [200, 409] })) },
  {
    method: 'DELETE', path: '/finance/bills/:id/attachments/:attachmentId', kind: 'company-item', module: M,
    sample: s((co) => {
      const a = freshAttachment(co)
      return { params: { id: a.bill, attachmentId: a.att }, expect: [200, 404] }
    }),
  },

  /* debit notes */
  { method: 'GET', path: '/finance/debit-notes', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finDebitNotes.filter((d) => d.companyId === co).length } },
  { method: 'POST', path: '/finance/debit-notes', kind: 'company-write', module: M, sample: s((co) => ({ body: { bill_id: openBill(co).id, reason: 'Isolation credit', amount: 1 }, expect: [200, 409, 422] })) },

  /* bill payments and runs */
  { method: 'GET', path: '/finance/bill-payments', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finBillPayments.filter((p) => p.companyId === co).length } },
  {
    method: 'POST', path: '/finance/bill-payments', kind: 'company-write', module: M,
    sample: s((co) => {
      const b = openBill(co)
      return { body: { vendor_id: b.vendorId, payment_account_id: 'ACC-1120', allocations: [{ bill_id: b.id, amount: 1 }] }, expect: [200, 409, 422] }
    }),
  },
  { method: 'POST', path: '/finance/bill-payments/run', kind: 'company-write', module: M, sample: s((co) => ({ body: { payment_account_id: 'ACC-1120', items: [{ bill_id: openBill(co).id, amount: 1 }] }, expect: [200, 409, 422] })) },
  { method: 'GET', path: '/finance/payment-runs', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => finPaymentRuns.filter((r) => r.companyId === co).length } },
  { method: 'GET', path: '/finance/bill-payments/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(finBillPayments, co, 'bill payment').id } })) },
  { method: 'POST', path: '/finance/bill-payments/:id/void', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: freshPayment(co) }, body: { reason: 'Isolation void' }, expect: [200, 409] })) },

  /* payables */
  { method: 'GET', path: '/finance/payables/aging', kind: 'company-export', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/payables/due', kind: 'company-export', module: M, sample: () => ({ query: { days: '30' } }) },
  { method: 'GET', path: '/finance/payables/overview', kind: 'company-export', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/event-costs', kind: 'company-export', module: M, sample: s((co) => ({ query: { event_id: event(co) } })) },

  /* approval rules */
  { method: 'GET', path: '/finance/approval-rules', kind: 'company-list', module: M, sample: () => ({}) },
  {
    method: 'PUT', path: '/finance/approval-rules', kind: 'company-write', module: M,
    sample: s(() => ({ body: { doc_type: 'purchase_order', rules: [{ min_amount: 0, approver: 'department_head' }, { min_amount: 10000, approver: 'Accountant' }, { min_amount: 50000, approver: 'Management' }] } })),
  },
]
