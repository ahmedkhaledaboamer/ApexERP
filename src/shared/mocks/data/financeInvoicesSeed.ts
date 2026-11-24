import type { InvoiceLineInput } from '@/modules/finance/invoices/types'
import { addDaysIso, addMonthsIso } from '@/modules/finance/invoices/calc'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { financeSeq } from '@/shared/mocks/data/finance'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { users } from '@/shared/mocks/db'
import { financeRecurring, invoiceRecords } from './financeInvoices'
import { creditCore, issueCore, newInvoiceRecord, voidCore, type Actor } from '@/shared/mocks/services/financeInvoiceCore'
import { linesFromContract, linesFromQuotation } from '@/shared/mocks/services/financeInvoiceSources'
import { invoiceSettingsFor } from '@/shared/mocks/services/financeInvoiceSettings'
import { historyInvoicesOf } from './financeHistorySeed'

/**
 * Seed of Accounts & finance › Invoices, per company (different customers and data), relative to today so
 * statuses stay meaningful: drafts, issued not yet due, overdue (open, for the Collections section to
 * receive payments against — no payments are recorded here), one void, one credit note, one recurring
 * schedule, one USD invoice with an exchange rate. Everything goes through the same core as the API
 * (postJournal, ZATCA chain in issue order for Crest).
 *
 * Ids: Apex INV-1001…, Crest INV-5001… (the shared counter then continues after the highest).
 * Synthetic data only; customer VAT numbers are made up.
 */

interface SeedInvoice {
  id: string
  customerId: string
  vat?: string
  /** Days before today it was created / issued (null = draft). */
  issuedAgo: number | null
  terms?: number
  currency?: string
  rate?: number
  quotation?: { id: string; pct: number; milestone?: string }
  contract?: { id: string; pct: number; milestone?: string }
  lines?: InvoiceLineInput[]
  notes?: string
  void?: { daysAfter: number; reason: string }
  credit?: { daysAfter: number; reason: string; amount: number }
  recurring?: string
  /** The delivery project it bills (journal lines carry project_id: Accounts & finance › Profitability). */
  project?: string
  /** The event it is attributed to (deal sourced at an exhibition, sponsorship of an organised event). */
  event?: string
}

const NOTES = 'Thank you for your business.'

const APEX: SeedInvoice[] = [
  { id: 'INV-1001', customerId: 'C-1021', issuedAgo: 75, project: 'PRJ-104', quotation: { id: 'Q-1001', pct: 100 } },
  { id: 'INV-1002', customerId: 'C-1017', issuedAgo: 50, project: 'PRJ-103', quotation: { id: 'Q-1002', pct: 40, milestone: 'Milestone 1 (kick-off, 40%)' } },
  { id: 'INV-1003', customerId: 'C-1030', issuedAgo: 20, project: 'PRJ-106', quotation: { id: 'Q-1003', pct: 100 } },
  { id: 'INV-1004', customerId: 'C-1004', issuedAgo: 25, terms: 15, contract: { id: 'CON-1002', pct: 100 }, recurring: 'REC-1001' },
  { id: 'INV-1005', customerId: 'C-1012', issuedAgo: 10, project: 'PRJ-102', quotation: { id: 'Q-1007', pct: 50, milestone: 'Milestone 1 (design sign-off, 50%)' } },
  {
    id: 'INV-1006', customerId: 'C-1025', issuedAgo: 15, currency: 'USD', rate: 3.6725,
    lines: [
      { description: 'Data strategy workshop (2 days)', quantity: 2, unitPrice: 2400, discount: 0, taxCodeId: 'VAT5' },
      { description: 'Executive BI dashboards — licence setup', serviceId: 'S-401', quantity: 1, unitPrice: 3900, discount: 390, taxCodeId: 'VAT5' },
    ],
  },
  {
    id: 'INV-1007', customerId: 'C-1004', issuedAgo: 35,
    lines: [{ description: 'Website & booking app — change request', serviceId: 'S-601', quantity: 1, unitPrice: 6000, discount: 0, taxCodeId: 'VAT5' }],
    void: { daysAfter: 2, reason: 'Issued twice by mistake (duplicate of the change-request invoice)' },
  },
  {
    id: 'INV-1008', customerId: 'C-1012', issuedAgo: 25, project: 'PRJ-102',
    lines: [
      { description: 'Dashboard support & new reports', serviceId: 'S-402', quantity: 24, unitPrice: 300, discount: 0, taxCodeId: 'VAT5' },
      { description: 'System integration (POS)', serviceId: 'S-501', quantity: 10, unitPrice: 350, discount: 100, taxCodeId: 'VAT5' },
    ],
    credit: { daysAfter: 5, reason: '4 support hours not delivered', amount: 1200 },
  },
  { id: 'INV-1009', customerId: 'C-1025', issuedAgo: 5, project: 'PRJ-105', contract: { id: 'CON-1009', pct: 30, milestone: 'Milestone 1 (discovery, 30%)' } },
  {
    id: 'INV-1010', customerId: 'C-1030', issuedAgo: null,
    lines: [{ description: 'Dashboard support & new reports', serviceId: 'S-402', quantity: 12, unitPrice: 300, discount: 0, taxCodeId: 'VAT5' }],
  },
  { id: 'INV-1011', customerId: 'C-1017', issuedAgo: null, quotation: { id: 'Q-1002', pct: 30, milestone: 'Milestone 2 (UAT, 30%)' } },
  {
    // Separate data-migration work, billed outside the CRM automation project's budget.
    id: 'INV-1012', customerId: 'C-1021', issuedAgo: 60,
    lines: [{ description: 'CRM data migration & clean-up', serviceId: 'S-202', quantity: 1, unitPrice: 12000, discount: 600, taxCodeId: 'VAT5' }],
  },
]

const VAT_EGD = '300123456700003'
const VAT_JPT = '310987654300003'
const VAT_RGS = '302468135700003'

const CREST: SeedInvoice[] = [
  { id: 'INV-5001', customerId: 'C-5007', vat: VAT_JPT, issuedAgo: 70, quotation: { id: 'Q-5001', pct: 100 } },
  { id: 'INV-5002', customerId: 'C-5007', vat: VAT_JPT, issuedAgo: 28, terms: 15, contract: { id: 'CON-5001', pct: 100 }, recurring: 'REC-5001' },
  { id: 'INV-5003', customerId: 'C-5018', vat: VAT_RGS, issuedAgo: 30, contract: { id: 'CON-5002', pct: 100, milestone: 'First half-year (50%)' } },
  {
    id: 'INV-5004', customerId: 'C-5010', issuedAgo: 12,
    lines: [{ description: 'Customs clearance — 3 shipments', serviceId: 'S-903', quantity: 3, unitPrice: 2200, discount: 0, taxCodeId: 'VAT15' }],
  },
  {
    id: 'INV-5005', customerId: 'C-5003', vat: VAT_EGD, issuedAgo: 8, project: 'PRJ-107', currency: 'USD', rate: 3.75,
    lines: [
      { description: 'Supply chain assessment — rig spares', serviceId: 'S-905', quantity: 1, unitPrice: 9300, discount: 300, taxCodeId: 'VAT15' },
      { description: 'Export freight to Bahrain (zero-rated)', quantity: 2, unitPrice: 1850, discount: 0, taxCodeId: 'ZR' },
    ],
  },
  {
    id: 'INV-5006', customerId: 'C-5003', vat: VAT_EGD, issuedAgo: 40,
    lines: [{ description: 'Fleet tracking — annual devices', serviceId: 'S-904', quantity: 4, unitPrice: 4500, discount: 0, taxCodeId: 'VAT15' }],
    void: { daysAfter: 1, reason: 'Wrong customer branch; re-issued to the Dammam entity' },
  },
  {
    id: 'INV-5007', customerId: 'C-5018', vat: VAT_RGS, issuedAgo: 20,
    lines: [
      { description: 'Freight forwarding — Jeddah to Riyadh DC', serviceId: 'S-901', quantity: 4, unitPrice: 8500, discount: 0, taxCodeId: 'VAT15' },
      { description: 'Customs clearance', serviceId: 'S-903', quantity: 4, unitPrice: 2200, discount: 200, taxCodeId: 'VAT15' },
    ],
    credit: { daysAfter: 4, reason: 'One container cancelled before loading', amount: 8500 },
  },
  {
    id: 'INV-5008', customerId: 'C-5010', issuedAgo: 55,
    lines: [{ description: 'Cold-chain freight — Tabuk to Riyadh', serviceId: 'S-901', quantity: 2, unitPrice: 8500, discount: 500, taxCodeId: 'VAT15' }],
  },
  {
    id: 'INV-5009', customerId: 'C-5003', vat: VAT_EGD, issuedAgo: null,
    lines: [{ description: 'Supply chain assessment — phase 2', serviceId: 'S-905', quantity: 1, unitPrice: 35000, discount: 0, taxCodeId: 'VAT15' }],
  },
  {
    id: 'INV-5010', customerId: 'C-5018', vat: VAT_RGS, issuedAgo: null,
    lines: [{ description: 'Contract warehousing — overflow pallets (November)', serviceId: 'S-902', quantity: 1, unitPrice: 6400, discount: 0, taxCodeId: 'VAT15' }],
  },
  {
    id: 'INV-5011', customerId: 'C-5007', vat: VAT_JPT, issuedAgo: 3,
    lines: [{ description: 'Customs clearance — urgent release', serviceId: 'S-903', quantity: 2, unitPrice: 2200, discount: 0, taxCodeId: 'VAT15' }],
  },
]

const CREATOR: Record<string, string> = { [APEX_ID]: 'u8', [CREST_ID]: 'u102' }

function actorOf(id: string): Actor {
  return { id, name: users.find((u) => u.id === id)?.name ?? 'User' }
}

/** 07:00 UTC of a company day (10–11 am in the Gulf), the moment a seed action happened. */
const atDay = (day: string, minutes = 0) => new Date(Date.parse(`${day}T07:00:00Z`) + minutes * 60_000)

/** The year's earlier trading (data/financeHistorySeed.ts): issued in date order with the rows above. */
function historyRows(co: string, today: string): SeedInvoice[] {
  const dayMs = 86_400_000
  return historyInvoicesOf(co, today).map((h) => ({
    id: h.id,
    customerId: h.customerId,
    vat: h.vat || undefined,
    issuedAgo: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${h.issueDate}T00:00:00Z`)) / dayMs),
    lines: h.lines,
    event: h.eventId ?? undefined,
  }))
}

function seedCompany(co: string, ownRows: SeedInvoice[], now: Date): void {
  const s = invoiceSettingsFor(co)
  const today = todayIsoIn(s.timezone, now)
  const rows = [...ownRows, ...historyRows(co, today)]
  const by = actorOf(CREATOR[co])
  type Ev = { day: string; order: number; run: () => void }
  const events: Ev[] = []
  const made = new Map<string, ReturnType<typeof newInvoiceRecord>>()
  rows.forEach((r, i) => {
    const created = addDaysIso(today, -(r.issuedAgo ?? 2))
    let src: { lines: InvoiceLineInput[]; currency: string; billingPct: number | null; milestone: string } = { lines: r.lines ?? [], currency: r.currency ?? s.baseCurrency, billingPct: null, milestone: '' }
    let quotationId: string | null = null
    let contractId: string | null = null
    let leadId: string | null = null
    if (r.quotation) {
      const q = quotations.find((x) => x.companyId === co && x.id === r.quotation!.id)!
      src = linesFromQuotation(co, q, r.quotation.pct, r.quotation.milestone ?? '')
      quotationId = q.id
      leadId = q.leadId
    } else if (r.contract) {
      const c = contracts.find((x) => x.companyId === co && x.id === r.contract!.id)!
      const q = c.quotationId ? quotations.find((x) => x.companyId === co && x.id === c.quotationId) : undefined
      src = linesFromContract(co, c, r.contract.pct, r.contract.milestone ?? '', q)
      if (c.billing === 'Annual' && r.contract.milestone) src.lines = src.lines.map((l) => ({ ...l, unitPrice: Math.round(l.unitPrice / 2) }))
      contractId = c.id
      quotationId = c.quotationId ?? null
    }
    const inv = newInvoiceRecord(co, {
      id: r.id,
      customerId: r.customerId,
      customerVatNumber: r.vat ?? '',
      currency: src.currency,
      exchangeRate: r.rate ?? 1,
      paymentTermsDays: r.terms ?? s.paymentTermsDays,
      issueDate: r.issuedAgo === null ? null : created,
      dueDate: null,
      notes: NOTES,
      terms: `Payment due within ${r.terms ?? s.paymentTermsDays} days by bank transfer.`,
      quotationId,
      contractId,
      leadId,
      recurringId: r.recurring ?? null,
      projectId: r.project ?? null,
      eventId: r.event ?? null,
      billingPct: src.billingPct,
      milestone: src.milestone,
      lines: src.lines,
      createdBy: by,
      at: atDay(created, -60 + i).toISOString(),
    })
    inv.createdAt = atDay(created, -60 + i).toISOString()
    inv.history[0].at = inv.createdAt
    made.set(r.id, inv)
    if (r.issuedAgo === null) return
    events.push({ day: created, order: i, run: () => issueCore(inv, by, atDay(created, i)) })
    if (r.void) {
      const d = addDaysIso(created, r.void.daysAfter)
      events.push({ day: d, order: 100 + i, run: () => voidCore(inv, by, r.void!.reason, atDay(d, 30 + i)) })
    }
    if (r.credit) {
      const d = addDaysIso(created, r.credit.daysAfter)
      events.push({
        day: d,
        order: 100 + i,
        run: () => {
          const l = inv.lines[0]
          creditCore(inv, { reason: r.credit!.reason, date: d, full: false, lines: [{ invoiceLineId: l.id, amount: r.credit!.amount }] }, by, atDay(d, 30 + i))
        },
      })
    }
  })
  events.sort((a, b) => (a.day === b.day ? a.order - b.order : a.day < b.day ? -1 : 1))
  for (const e of events) e.run()

  // Recurring schedules: the source invoice is period 1; the next period is in the future.
  for (const r of rows) {
    if (!r.recurring) continue
    const inv = made.get(r.id)!
    const start = inv.issueDate!
    financeRecurring.push({
      companyId: co,
      id: r.recurring,
      customerId: inv.customerId,
      sourceInvoiceId: inv.id,
      contractId: inv.contractId,
      frequency: 'monthly',
      startDate: start,
      endDate: null,
      nextDate: addMonthsIso(start, 1),
      periodIndex: 1,
      mode: co === APEX_ID ? 'auto_issue' : 'draft',
      status: 'active',
      template: {
        currency: inv.currency,
        customerVatNumber: inv.customerVatNumber,
        paymentTermsDays: inv.paymentTermsDays,
        lines: inv.lines.map((l) => ({ description: l.description, serviceId: l.serviceId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxCodeId: l.taxCodeId, revenueAccountId: l.revenueAccountId })),
        notes: inv.notes,
        terms: inv.terms,
        projectId: inv.projectId,
      },
      generated: [{ period: start, invoiceId: inv.id, at: inv.issuedAt! }],
      lastError: null,
      createdBy: CREATOR[co],
      createdAt: inv.createdAt,
      updatedAt: inv.createdAt,
    })
  }
}

let seeded = false

/** Seeds both companies once (module load), then moves the shared id counters past the seeded ids. */
export function seedFinanceInvoices(now = new Date()): void {
  if (seeded || invoiceRecords.length > 0) return
  seeded = true
  if (companyById(APEX_ID)) seedCompany(APEX_ID, APEX, now)
  // Crest's credit notes start at CN-5001 like its invoices (the counter is shared, ids stay unique).
  financeSeq.ids.creditNote = Math.max(financeSeq.ids.creditNote ?? 1000, 5000)
  if (companyById(CREST_ID)) seedCompany(CREST_ID, CREST, now)
  const top = (prefix: string, rows: { id: string }[]) => Math.max(0, ...rows.filter((r) => r.id.startsWith(prefix)).map((r) => Number(r.id.slice(prefix.length)) || 0))
  financeSeq.ids.invoice = Math.max(financeSeq.ids.invoice ?? 1000, top('INV-', invoiceRecords))
  financeSeq.ids.recurring = Math.max(financeSeq.ids.recurring ?? 1000, top('REC-', financeRecurring))
}

seedFinanceInvoices()
