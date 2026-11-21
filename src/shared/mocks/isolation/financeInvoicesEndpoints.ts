import { invoiceRecords, financeCreditNotes, financeRecurring } from '@/shared/mocks/data/financeInvoices'
import { ADMIN, api, userToken, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of Accounts & finance › Invoices, credit notes, recurring invoices and ZATCA
 * (handlers/financeInvoices.ts), spread into ENDPOINTS (endpoints.ts). Samples run as the company admin
 * (accounting full); writes prepare their own data through the API. Crest (KSA) has ZATCA XML; Apex (UAE)
 * answers 409 zatca_not_applicable for it.
 */

const M = 'finance/invoices'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T => {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Invoices isolation table: no ${what} in ${co}`)
  return row
}

const CUSTOMER: Record<Co, string> = { co_apex: 'C-1030', co_crest: 'C-5010' }
const MONTHLY_CONTRACT: Record<Co, string> = { co_apex: 'CON-1004', co_crest: 'CON-5001' }
const ANNUAL_CONTRACT: Record<Co, string> = { co_apex: 'CON-1010', co_crest: 'CON-5002' }

async function ok(co: Co, method: string, path: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(userToken(ADMIN[co]), method, path, { body })
  if (r.status !== 200) throw new Error(`Invoices isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body
}

const draftBody = (co: Co) => ({ customer_id: CUSTOMER[co], lines: [{ description: 'Isolation line', quantity: 2, unit_price: 150, discount: 10 }], notes: 'Iso' })
const newDraft = async (co: Co): Promise<string> => (await ok(co, 'POST', '/finance/invoices', draftBody(co))).id
const newIssued = async (co: Co): Promise<string> => {
  const id = await newDraft(co)
  await ok(co, 'POST', `/finance/invoices/${id}/issue`)
  return id
}
const draft = (co: Co) => own(invoiceRecords, co, 'draft invoice', (i) => i.status === 'draft').id
const issued = (co: Co) => own(invoiceRecords, co, 'issued invoice', (i) => i.status === 'issued' || i.status === 'partially_paid').id
const creditable = (co: Co) => own(invoiceRecords, co, 'issued invoice with balance', (i) => i.status === 'issued' && i.balanceDue > 10)
const xmlExpect = (co: Co) => (co === 'co_crest' ? 200 : 409)

const s = (f: (co: Co) => Sample | Promise<Sample>) => f

export const FINANCE_INVOICES_ENDPOINTS: Endpoint[] = [
  /* invoices */
  { method: 'GET', path: '/finance/invoices', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => invoiceRecords.filter((i) => i.companyId === co).length } },
  { method: 'POST', path: '/finance/invoices', kind: 'company-write', module: M, sample: s((co) => ({ body: draftBody(co) })) },
  { method: 'GET', path: '/finance/invoices/meta', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/finance/invoices/sources', kind: 'company-list', module: M, sample: () => ({}) },
  // A monthly contract bills one period per invoice (never "already invoiced"), so re-runs stay 200.
  { method: 'POST', path: '/finance/invoices/from-source', kind: 'company-write', module: M, sample: s((co) => ({ body: { contract_id: MONTHLY_CONTRACT[co] } })) },
  { method: 'GET', path: '/finance/invoices/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: issued(co) } })) },
  { method: 'PATCH', path: '/finance/invoices/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: draft(co) }, body: { notes: 'Checked by isolation' } })) },
  { method: 'DELETE', path: '/finance/invoices/:id', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newDraft(co) }, expect: [200, 404] })) },
  { method: 'POST', path: '/finance/invoices/:id/issue', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newDraft(co) }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/invoices/:id/void', kind: 'company-item', module: M, sample: s(async (co) => ({ params: { id: await newIssued(co) }, body: { reason: 'Isolation void' }, expect: [200, 409] })) },
  { method: 'POST', path: '/finance/invoices/:id/send', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: issued(co) }, body: { to: 'iso-invoice@example.org' } })) },
  {
    method: 'POST', path: '/finance/invoices/:id/zatca-xml', kind: 'company-item', module: M,
    note: 'KSA only (Crest 200 with the UBL file, audited); a UAE invoice answers 409 zatca_not_applicable.',
    sample: s((co) => ({ params: { id: issued(co) }, expect: xmlExpect(co) })),
  },

  /* credit notes */
  { method: 'GET', path: '/finance/credit-notes', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => financeCreditNotes.filter((c) => c.companyId === co).length } },
  {
    method: 'POST', path: '/finance/credit-notes', kind: 'company-write', module: M,
    sample: s((co) => {
      const inv = creditable(co)
      return { body: { invoice_id: inv.id, reason: 'Isolation credit', lines: [{ invoice_line_id: inv.lines[0].id, amount: 1 }] }, expect: [200, 422] }
    }),
  },
  { method: 'GET', path: '/finance/credit-notes/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(financeCreditNotes, co, 'credit note').id } })) },
  { method: 'POST', path: '/finance/credit-notes/:id/zatca-xml', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(financeCreditNotes, co, 'credit note').id }, expect: xmlExpect(co) })) },

  /* recurring invoices */
  { method: 'GET', path: '/finance/recurring-invoices', kind: 'company-list', module: M, sample: () => ({}), count: { of: len, expected: (co) => financeRecurring.filter((r) => r.companyId === co).length } },
  { method: 'POST', path: '/finance/recurring-invoices', kind: 'company-write', module: M, sample: s((co) => ({ body: { contract_id: ANNUAL_CONTRACT[co], frequency: 'yearly', start_date: '2099-01-01', mode: 'draft' }, expect: [200, 409] })) },
  { method: 'GET', path: '/finance/recurring-invoices/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(financeRecurring, co, 'recurring schedule').id } })) },
  { method: 'PATCH', path: '/finance/recurring-invoices/:id', kind: 'company-item', module: M, sample: s((co) => ({ params: { id: own(financeRecurring, co, 'recurring schedule', (r) => r.status !== 'ended').id }, body: { mode: 'draft' } })) },
]
