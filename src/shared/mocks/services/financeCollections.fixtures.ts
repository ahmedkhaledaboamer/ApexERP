import type { Invoice } from '@/modules/finance/types'
import { customers } from '@/shared/mocks/db'
import { financeInvoices } from '@/shared/mocks/data/finance'
import { finCollectionsMeta } from '@/shared/mocks/data/financeCollections'
import { financeCreditNotes, type CreditNoteRecord } from '@/shared/mocks/data/financeInvoices'
import type { Tenant } from '@/shared/mocks/tenant'
import { nowIso } from '@/shared/mocks/clock'
import { nextId, postJournal, round2, systemAccount } from './ledger'

/**
 * Test fixtures of Accounts & finance › Collections (unit, isolation and role tests): a minimal ISSUED invoice
 * pushed into `financeInvoices` with its AR posting (Dr AR / Cr service revenue + VAT, base currency), so the
 * collections tests never depend on the invoices section's seed. Not used by the app.
 */

let n = 0
export function fixtureInvoice(
  co: string,
  opts: { customerId?: string; total?: number; currency?: string; exchangeRate?: number; issueDate: string; dueDate: string; vatPct?: number },
): Tenant<Invoice> {
  const customerId = opts.customerId ?? customers.find((c) => c.companyId === co)!.id
  const total = round2(opts.total ?? 1050)
  const vatPct = opts.vatPct ?? 5
  const net = round2(total / (1 + vatPct / 100))
  const tax = round2(total - net)
  const rate = opts.exchangeRate ?? 1
  const id = nextId('invoice', 'INV')
  const je = postJournal(co, {
    date: opts.issueDate,
    memo: `Fixture invoice ${id}`,
    sourceType: 'invoice',
    sourceId: id,
    createdBy: null,
    lines: [
      { accountId: systemAccount(co, 'accounts_receivable'), debit: round2(total * rate), credit: 0, description: 'AR', customerId },
      { accountId: systemAccount(co, 'service_revenue'), debit: 0, credit: round2(net * rate), description: 'Revenue' },
      ...(tax > 0 ? [{ accountId: systemAccount(co, 'vat_output'), debit: 0, credit: round2(total * rate) - round2(net * rate), description: 'VAT' }] : []),
    ],
  })
  const at = nowIso()
  const inv = {
    companyId: co,
    id,
    number: `FIX-INV-${opts.issueDate.slice(0, 4)}-${String(++n).padStart(4, '0')}`,
    kind: 'tax_invoice',
    status: 'issued',
    customerId,
    quotationId: null,
    contractId: null,
    leadId: null,
    projectId: null,
    eventId: null,
    recurringId: null,
    issueDate: opts.issueDate,
    dueDate: opts.dueDate,
    currency: opts.currency ?? (co === 'co_crest' ? 'SAR' : 'AED'),
    exchangeRate: rate,
    lines: [],
    subtotal: net,
    discountTotal: 0,
    taxTotal: tax,
    total,
    amountPaid: 0,
    amountCredited: 0,
    balanceDue: total,
    notes: '',
    terms: '',
    journalEntryId: je.id,
    createdBy: 'u1',
    createdAt: at,
    updatedAt: at,
    issuedAt: at,
    voidedAt: null,
    voidReason: null,
    // Fields of the invoices section's row (so its screens can read a fixture too).
    customerVatNumber: '',
    paymentTermsDays: 30,
    billingPct: null,
    milestone: '',
    sendLog: [],
    history: [],
    zatca: null,
    voidJournalEntryId: null,
  } as Tenant<Invoice>
  financeInvoices.push(inv)
  return inv
}

/** Marks a company's collections seed as done, so a test starts from its own fixtures only. */
export function skipCollectionsSeed(co: string): void {
  if (!finCollectionsMeta.seeded.includes(co)) finCollectionsMeta.seeded.push(co)
}

/** A credit note of the invoice's customer with `excess` kept as customer credit (as the invoices section stores it). */
export function fixtureCreditNote(co: string, inv: Tenant<Invoice>, excess: number, date: string): Tenant<CreditNoteRecord> {
  const n: Tenant<CreditNoteRecord> = {
    companyId: co,
    id: nextId('creditNote', 'CN'),
    number: `FIX-CN-${date.slice(0, 4)}-${String(++n2).padStart(4, '0')}`,
    invoiceId: inv.id,
    customerId: inv.customerId,
    date,
    reason: 'Fixture',
    currency: inv.currency,
    exchangeRate: inv.exchangeRate,
    lines: [],
    subtotal: excess,
    taxTotal: 0,
    total: excess,
    appliedAmount: 0,
    excessAmount: excess,
    journalEntryId: null,
    zatca: null,
    createdBy: 'u1',
    createdAt: nowIso(),
  }
  financeCreditNotes.push(n)
  return n
}
let n2 = 0
