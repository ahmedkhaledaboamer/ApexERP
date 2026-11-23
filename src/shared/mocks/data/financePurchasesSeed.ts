import type { BillLineInput, PoLineInput } from '@/modules/finance/purchases/types'
import { addDaysIso } from '@/modules/finance/invoices/calc'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { financeSeq } from '@/shared/mocks/data/finance'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import '@/shared/mocks/data/eventLibrarySeed'
import { finPurchaseOrders, finBills, type BillRecord, type PoRecord } from './financePurchases'
import {
  advanceCore,
  approveBillCore,
  approvePoCore,
  debitNoteCore,
  ensureProfile,
  linesFromPo,
  newBillRecord,
  newPoRecord,
  newRunRecord,
  paymentCore,
  postBillCore,
  receivePoCore,
  rejectPoCore,
  submitBillCore,
  submitPoCore,
  todayOf,
  voidBillCore,
  type Actor,
} from '@/shared/mocks/services/financePurchasesCore'
import { rateOrDefault } from '@/shared/mocks/services/financePurchasesCore'

/**
 * Seed of Accounts & finance › Purchases & payables, per company (different suppliers and data), relative to the
 * company's today so statuses stay meaningful: finance profiles for most vendors (IBANs synthetic but mod-97 valid),
 * purchase orders in every status (draft, pending at step 1 and 2, rejected, approved, partially received, received,
 * closed after a 3-way matched bill, cancelled), ~11 bills (open, overdue, 90+, partially paid, paid, USD, one with a
 * debit note, draft, pending, void) and a payment run. Everything goes through the same core as the API (postJournal,
 * dated after the lock date — Crest locks 2025). Ids: Apex PO-1001… / BILL-1001…, Crest PO-5001… / BILL-5001….
 * Synthetic data only.
 */

/** A valid IBAN for a country and BBAN (ISO 13616 check digits). */
export function ibanFor(country: string, bban: string): string {
  const digits = (bban + country + '00').split('').map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('')
  let rem = 0
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97
  return `${country}${String(98 - rem).padStart(2, '0')}${bban}`
}

type L = [description: string, qty: number, price: number, extra?: Partial<PoLineInput>]
const lines = (rows: L[]): PoLineInput[] => rows.map(([description, quantity, unitPrice, extra]) => ({ description, quantity, unitPrice, ...extra }))

interface PoSpec {
  id: string
  requester: string
  vendor: string
  ago: number
  lines: L[]
  submit?: boolean
  approvers?: string[]
  reject?: { by: string; reason: string }
  receive?: { ago: number; share: number[] }
  cancel?: string
  event?: boolean
  /** Advance % on approval, paid `ago` days ago by the finance user from the main bank (Supplier advances). */
  advance?: { pct: number; ago: number; by: string }
}

interface BillSpec {
  id: string
  vendor: string
  ref: string
  ago: number
  lines?: L[]
  po?: string
  currency?: string
  creator: string
  /** 'post' (direct), 'approve' (each listed user approves in order), 'draft', 'pending' (submit only). */
  flow: 'post' | 'draft' | 'pending' | { approvers: string[] }
  debitNote?: { ago: number; amount: number; reason: string }
  void?: string
  /** Lines charged to this delivery project (Accounts & finance › Profitability). */
  project?: string
  /** Lines charged to the seeded event; 'line' also links the first line to its first budget line (no double counting). */
  event?: 'event' | 'line'
}

interface CompanySeed {
  co: string
  base: number
  profiles: { vendor: string; vat?: string; terms: number; account: string; bank: string; iban: string }[]
  pos: PoSpec[]
  bills: BillSpec[]
  run: { ago: number; items: [billId: string, amount: number | 'full'][] }
}

const APEX: CompanySeed = {
  co: APEX_ID,
  base: 1000,
  profiles: [
    { vendor: 'VND-1001', vat: '100345678900003', terms: 30, account: 'ACC-6450', bank: 'Emirates NBD', iban: ibanFor('AE', '0260001015123456789') },
    { vendor: 'VND-1002', vat: '100456789100003', terms: 30, account: 'ACC-6400', bank: 'Mashreq Bank', iban: ibanFor('AE', '0330000014455667788') },
    { vendor: 'VND-1003', vat: '', terms: 15, account: 'ACC-6450', bank: 'ADCB', iban: ibanFor('AE', '0030000012233445566') },
    { vendor: 'VND-1005', vat: '100567891200003', terms: 15, account: 'ACC-6400', bank: 'First Abu Dhabi Bank', iban: ibanFor('AE', '0350000017788990011') },
  ],
  pos: [
    { id: 'PO-1001', requester: 'u11', vendor: 'VND-1002', ago: 2, lines: [['Client workshop handouts (A4, colour)', 400, 5]] },
    { id: 'PO-1002', requester: 'u14', vendor: 'VND-1005', ago: 4, lines: [['Team headshots — half-day shoot', 1, 3500]], submit: true },
    { id: 'PO-1003', requester: 'u15', vendor: 'VND-1001', ago: 6, lines: [['Demo pod for the client showcase', 1, 11000], ['Install and dismantle', 1, 2400]], submit: true, approvers: ['u10'] },
    { id: 'PO-1004', requester: 'u16', vendor: 'VND-1003', ago: 9, lines: [['Sprint review lunch (25 pax)', 25, 80]], submit: true, reject: { by: 'u10', reason: 'Use the in-house caterer for internal events.' } },
    { id: 'PO-1005', requester: 'u7', vendor: 'VND-1002', ago: 12, lines: [['Brochures — Q1 campaign (5,000 copies)', 5000, 1.2]], submit: true, approvers: ['u2'], advance: { pct: 30, ago: 10, by: 'u8' } },
    {
      id: 'PO-1006', requester: 'u11', vendor: 'VND-1001', ago: 25, event: true,
      lines: [['Exhibition stand build (6 × 4 m)', 1, 9500], ['Stand graphics and branding', 1, 2500]],
      submit: true, approvers: ['u10', 'u8'], receive: { ago: 15, share: [1, 0] },
    },
    { id: 'PO-1007', requester: 'u14', vendor: 'VND-1005', ago: 18, lines: [['Product video — 60 s edit', 1, 2400]], submit: true, approvers: ['u10'], receive: { ago: 10, share: [1] } },
    { id: 'PO-1008', requester: 'u11', vendor: 'VND-1002', ago: 40, lines: [['Case-study booklets', 1000, 6], ['Roll-up banners', 4, 500]], submit: true, approvers: ['u10'], receive: { ago: 28, share: [1, 1] } },
    { id: 'PO-1009', requester: 'u15', vendor: 'VND-1003', ago: 20, lines: [['Team offsite catering', 30, 95]], cancel: 'Offsite moved to next quarter.' },
  ],
  bills: [
    { id: 'BILL-1001', vendor: 'VND-1002', ref: 'EPH-26-0412', ago: 20, po: 'PO-1008', creator: 'u8', flow: 'post' },
    { id: 'BILL-1002', vendor: 'VND-1002', ref: 'EPH-26-0388', ago: 10, event: 'event', lines: [['Event flyers', 2000, 1.6]], creator: 'u8', flow: { approvers: ['u2'] } },
    { id: 'BILL-1003', vendor: 'VND-1003', ref: 'SEC-7781', ago: 50, project: 'PRJ-104', lines: [['Client dinner catering (40 pax)', 40, 112.5, { taxCodeId: 'OOS' }]], creator: 'u8', flow: { approvers: ['u2'] } },
    { id: 'BILL-1004', vendor: 'VND-1001', ref: 'ECS-INV-2291', ago: 40, lines: [['Meeting-room pods (2)', 2, 4500]], creator: 'u8', flow: { approvers: ['u2'] } },
    { id: 'BILL-1005', vendor: 'VND-1005', ref: 'PFS-1180', ago: 25, event: 'line', lines: [['Event photography (1 day)', 1, 2000]], creator: 'u8', flow: { approvers: ['u2'] } },
    { id: 'BILL-1006', vendor: 'VND-1005', ref: 'PFS-USD-77', ago: 12, currency: 'USD', lines: [['Drone footage licence (USD)', 1, 1500, { taxCodeId: 'ZR' }]], creator: 'u8', flow: { approvers: ['u2'] } },
    { id: 'BILL-1007', vendor: 'VND-1002', ref: 'EPH-26-0301', ago: 30, lines: [['Product brochures', 2500, 2]], creator: 'u8', flow: { approvers: ['u2'] }, debitNote: { ago: 22, amount: 1050, reason: '500 brochures misprinted — credited by the supplier' } },
    { id: 'BILL-1008', vendor: 'VND-1001', ref: 'ECS-INV-2340', ago: 2, lines: [['Showroom shelving', 1, 3200]], creator: 'u8', flow: 'draft' },
    { id: 'BILL-1009', vendor: 'VND-1001', ref: 'ECS-INV-2302', ago: 5, lines: [['Flagship stand — GITEX 2027 (deposit)', 1, 60000]], creator: 'u1', flow: 'pending' },
    { id: 'BILL-1010', vendor: 'VND-1003', ref: 'SEC-7702', ago: 35, lines: [['Coffee breaks', 1, 900, { taxCodeId: 'OOS' }]], creator: 'u8', flow: { approvers: ['u2'] }, void: 'Duplicate of SEC-7701 (entered twice).' },
    { id: 'BILL-1011', vendor: 'VND-1001', ref: 'ECS-INV-2101', ago: 135, lines: [['Booth storage and handling (annual)', 1, 8000]], creator: 'u8', flow: { approvers: ['u2'] } },
  ],
  run: { ago: 3, items: [['BILL-1005', 'full'], ['BILL-1004', 4000]] },
}

const CREST: CompanySeed = {
  co: CREST_ID,
  base: 5000,
  profiles: [
    { vendor: 'VND-5001', vat: '310987654300003', terms: 30, account: 'ACC-6450', bank: 'Al Rajhi Bank', iban: ibanFor('SA', '80000000608010167519') },
    { vendor: 'VND-5002', vat: '311122233300003', terms: 30, account: 'ACC-6400', bank: 'Saudi National Bank', iban: ibanFor('SA', '10000000123456789012') },
    { vendor: 'VND-5003', vat: '', terms: 15, account: 'ACC-6450', bank: 'Riyad Bank', iban: ibanFor('SA', '20000002480000123456') },
  ],
  pos: [
    { id: 'PO-5001', requester: 'u107', vendor: 'VND-5002', ago: 1, lines: [['Shipping labels (rolls)', 50, 30]] },
    { id: 'PO-5002', requester: 'u104', vendor: 'VND-5003', ago: 3, lines: [['Screen rental for client pitch', 1, 5000]], submit: true },
    { id: 'PO-5003', requester: 'u107', vendor: 'VND-5001', ago: 7, lines: [['Cold-chain demo stand', 1, 18000]], submit: true, approvers: ['u106'] },
    { id: 'PO-5004', requester: 'u105', vendor: 'VND-5002', ago: 10, lines: [['Personal business cards (premium)', 10, 150]], submit: true, reject: { by: 'u103', reason: 'Standard cards only; order through the office.' } },
    { id: 'PO-5005', requester: 'u107', vendor: 'VND-5003', ago: 14, lines: [['PA system for the depot open day', 1, 3000]], submit: true, approvers: ['u106'], advance: { pct: 30, ago: 12, by: 'u101' } },
    {
      id: 'PO-5006', requester: 'u104', vendor: 'VND-5001', ago: 30, event: true,
      lines: [['Expo stand (9 × 3 m)', 1, 8000], ['Reefer demo integration', 1, 2500]],
      submit: true, approvers: ['u103', 'u102'], receive: { ago: 20, share: [1, 0] },
    },
    { id: 'PO-5007', requester: 'u107', vendor: 'VND-5002', ago: 21, lines: [['Warehouse signage', 20, 100]], submit: true, approvers: ['u106'], receive: { ago: 12, share: [1] } },
    { id: 'PO-5008', requester: 'u107', vendor: 'VND-5003', ago: 35, lines: [['Video wall for the control room', 1, 4000]], submit: true, approvers: ['u106'], receive: { ago: 25, share: [1] } },
    { id: 'PO-5009', requester: 'u105', vendor: 'VND-5002', ago: 16, lines: [['Tender binders', 40, 25]], cancel: 'Tender withdrawn by the customer.' },
  ],
  bills: [
    { id: 'BILL-5001', vendor: 'VND-5003', ref: 'RAV-2026-118', ago: 15, po: 'PO-5008', creator: 'u101', flow: 'post' },
    { id: 'BILL-5002', vendor: 'VND-5002', ref: 'YPP-5521', ago: 8, lines: [['Delivery notes printing', 4000, 0.7]], creator: 'u101', flow: { approvers: ['u102'] } },
    { id: 'BILL-5003', vendor: 'VND-5003', ref: 'RAV-2026-090', ago: 45, project: 'PRJ-107', lines: [['AV support — customer day', 1, 3800, { taxCodeId: 'OOS' }]], creator: 'u101', flow: { approvers: ['u102'] } },
    { id: 'BILL-5004', vendor: 'VND-5001', ref: 'NBB-INV-778', ago: 35, lines: [['Showroom display units', 3, 6000]], creator: 'u101', flow: { approvers: ['u102'] } },
    { id: 'BILL-5005', vendor: 'VND-5002', ref: 'YPP-5480', ago: 28, lines: [['Safety posters', 60, 20]], creator: 'u101', flow: { approvers: ['u102'] } },
    { id: 'BILL-5006', vendor: 'VND-5001', ref: 'NBB-USD-31', ago: 14, currency: 'USD', lines: [['Imported modular frames (USD)', 4, 600, { taxCodeId: 'ZR' }]], creator: 'u101', flow: { approvers: ['u102'] } },
    { id: 'BILL-5007', vendor: 'VND-5002', ref: 'YPP-5430', ago: 33, lines: [['Fleet decals', 30, 200]], creator: 'u101', flow: { approvers: ['u102'] }, debitNote: { ago: 25, amount: 690, reason: '3 decals rejected for colour mismatch' } },
    { id: 'BILL-5008', vendor: 'VND-5003', ref: 'RAV-2026-131', ago: 1, lines: [['Projector lamp replacement', 2, 450, { taxCodeId: 'OOS' }]], creator: 'u101', flow: 'draft' },
    { id: 'BILL-5009', vendor: 'VND-5001', ref: 'NBB-INV-801', ago: 4, lines: [['Dammam cross-dock fit-out (stage 1)', 1, 75000]], creator: 'u101', flow: 'pending' },
    { id: 'BILL-5010', vendor: 'VND-5003', ref: 'RAV-2026-071', ago: 40, lines: [['Microphone rental', 4, 150, { taxCodeId: 'OOS' }]], creator: 'u101', flow: { approvers: ['u102'] }, void: 'Wrong supplier — belongs to another vendor.' },
    { id: 'BILL-5011', vendor: 'VND-5002', ref: 'YPP-5100', ago: 135, lines: [['Annual report printing', 500, 12]], creator: 'u101', flow: { approvers: ['u102'] } },
  ],
  run: { ago: 2, items: [['BILL-5005', 'full'], ['BILL-5004', 8000]] },
}

const SERIES = ['purchaseOrder', 'bill', 'debitNote', 'billPayment', 'paymentRun', 'supplierAdvance'] as const

function seedCompany(s: CompanySeed): void {
  const co = s.co
  if (finPurchaseOrders.some((p) => p.companyId === co) || finBills.some((b) => b.companyId === co)) return
  for (const k of SERIES) financeSeq.ids[k] = Math.max(financeSeq.ids[k] ?? 1000, s.base)
  const today = todayOf(co)
  const day = (ago: number) => addDaysIso(today, -ago)
  const iso = (ago: number, h = 8) => `${day(ago)}T${String(h).padStart(2, '0')}:00:00.000Z`
  const who = (id: string): Actor & { id: string } => {
    const u = users.find((x) => x.id === id && x.companyId === co)
    if (!u) throw new Error(`purchases seed: no user ${id} in ${co}`)
    return { id: u.id, name: u.name }
  }

  for (const p of s.profiles) {
    const row = ensureProfile(co, p.vendor)
    Object.assign(row, { vatNumber: p.vat ?? row.vatNumber, paymentTermsDays: p.terms, defaultExpenseAccountId: p.account, bankName: p.bank, iban: p.iban, updatedAt: iso(60), updatedBy: null })
  }

  // An event with budget lines for the event-linked PO (Events › budget seam).
  const ev = events.find((e) => e.companyId === co && e.status !== 'cancelled' && eventBudgetLines.some((l) => l.companyId === co && l.eventId === e.id))
  const evLine = ev ? eventBudgetLines.find((l) => l.companyId === co && l.eventId === ev.id) : undefined

  const pos = new Map<string, PoRecord>()
  for (const p of s.pos) {
    const req = who(p.requester)
    const dept = users.find((u) => u.id === p.requester)?.departmentId || null
    const ls = lines(p.lines).map((l, i) => (p.event && ev ? { ...l, eventId: ev.id, budgetLineId: i === 0 ? (evLine?.id ?? null) : null } : l))
    const po = newPoRecord(co, { id: p.id, vendorId: p.vendor, requester: req, departmentId: dept, orderDate: day(p.ago), expectedDate: day(p.ago - 14), currency: co === APEX_ID ? 'AED' : 'SAR', exchangeRate: 1, notes: '', deliveryAddress: '', advancePct: p.advance?.pct ?? null, lines: ls, at: iso(p.ago) })
    pos.set(p.id, po)
    if (p.submit) submitPoCore(co, po, req, iso(p.ago, 9))
    for (const a of p.approvers ?? []) approvePoCore(co, po, who(a), iso(p.ago - 1, 10))
    if (p.reject) rejectPoCore(co, po, who(p.reject.by), p.reject.reason, iso(p.ago - 1, 11))
    if (p.advance && po.status === 'approved') {
      const amount = Math.round(po.total * p.advance.pct) / 100
      advanceCore(co, { vendorId: po.vendorId, poId: po.id, date: day(p.advance.ago), paymentAccountId: 'ACC-1120', method: 'bank_transfer', reference: `ADV-${po.number}`, currency: po.currency, exchangeRate: 1, amount, notes: `${p.advance.pct}% advance on approval` }, who(p.advance.by), iso(p.advance.ago, 10))
    }
    if (p.receive) receivePoCore(co, po, { date: day(p.receive.ago), note: 'Delivered and checked', lines: po.lines.map((l, i) => ({ lineId: l.id, quantity: l.quantity * (p.receive!.share[i] ?? 0) })).filter((l) => l.quantity > 0) }, req, iso(p.receive.ago, 12))
    if (p.cancel) {
      po.status = 'cancelled'
      po.cancelReason = p.cancel
      po.history.push({ at: iso(p.ago - 2), byName: req.name, action: 'cancelled', summary: `Cancelled: ${p.cancel}` })
    }
  }

  const bills = new Map<string, BillRecord>()
  for (const b of s.bills) {
    const creator = who(b.creator)
    const po = b.po ? pos.get(b.po)! : null
    const currency = b.currency ?? (co === APEX_ID ? 'AED' : 'SAR')
    const billDate = day(b.ago)
    const ls: BillLineInput[] = (po ? linesFromPo(co, po) : lines(b.lines ?? [])).map((l, i) => ({
      ...l,
      ...(b.project ? { projectId: b.project } : {}),
      ...(b.event && ev ? { eventId: ev.id, budgetLineId: b.event === 'line' && i === 0 ? (evLine?.id ?? null) : null } : {}),
    }))
    const bill = newBillRecord(co, {
      id: b.id, vendorId: b.vendor, po, supplierInvoiceNumber: b.ref, billDate, dueDate: null, currency, exchangeRate: rateOrDefault(co, currency, undefined, billDate),
      notes: '', lines: ls, creator, departmentId: po?.departmentId ?? (users.find((u) => u.id === b.creator)?.departmentId || null), at: iso(b.ago),
    })
    bills.set(b.id, bill)
    if (b.flow === 'post') postBillCore(co, bill, creator, iso(b.ago, 9))
    else if (b.flow === 'pending') submitBillCore(co, bill, creator, iso(b.ago, 9))
    else if (b.flow !== 'draft') {
      submitBillCore(co, bill, creator, iso(b.ago, 9))
      for (const a of b.flow.approvers) approveBillCore(co, bill, who(a), iso(b.ago, 11))
    }
    if (b.debitNote) debitNoteCore(co, bill, { date: day(b.debitNote.ago), reason: b.debitNote.reason, amount: b.debitNote.amount, accountId: null }, creator, iso(b.debitNote.ago))
    if (b.void) voidBillCore(co, bill, creator, b.void, iso(b.ago - 2))
  }

  // A payment run: one voucher per supplier from the main bank account.
  const payer = who(s.bills[0].creator)
  const date = day(s.run.ago)
  const run = newRunRecord(co, date, 'ACC-1120', payer, iso(s.run.ago, 10))
  const groups = new Map<string, { bill: BillRecord; amount: number }[]>()
  for (const [id, amt] of s.run.items) {
    const bill = bills.get(id)!
    groups.set(bill.vendorId, [...(groups.get(bill.vendorId) ?? []), { bill, amount: amt === 'full' ? bill.balanceDue : amt }])
  }
  for (const g of groups.values()) {
    const p = paymentCore(co, { vendorId: g[0].bill.vendorId, date, paymentAccountId: 'ACC-1120', method: 'bank_transfer', reference: run.number, exchangeRate: null, bankCharges: 0, allocations: g, notes: `Payment run ${run.number}`, runId: run.id }, payer, iso(s.run.ago, 10))
    run.paymentIds.push(p.id)
  }
  // Explicit seed ids don't move the shared counters: continue after the highest.
  const top = (ids: string[]) => Math.max(...ids.map((id) => Number(id.replace(/\D+/g, '')) || 0))
  financeSeq.ids.purchaseOrder = Math.max(financeSeq.ids.purchaseOrder ?? 0, top(s.pos.map((p) => p.id)))
  financeSeq.ids.bill = Math.max(financeSeq.ids.bill ?? 0, top(s.bills.map((b) => b.id)))
}

seedCompany(APEX)
seedCompany(CREST)
