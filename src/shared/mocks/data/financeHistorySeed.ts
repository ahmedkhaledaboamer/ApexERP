import type { JournalLine } from '@/modules/finance/types'
import type { InvoiceLineInput } from '@/modules/finance/invoices/types'
import { addDaysIso } from '@/modules/finance/invoices/calc'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { events } from '@/shared/mocks/data/events'
import { eventStartDate } from '@/shared/mocks/data/eventSponsors'

/**
 * A year of trading for the demo books (both companies, different numbers), so the management screens add up:
 * revenue that carries the payroll, cost of sales, overheads, event revenue. Everything is relative to the company's
 * today, from the start of its fiscal year (January):
 *  - invoices (`historyInvoicesOf`): monthly service retainers per customer + project milestones, paid by the
 *    customers 2–6 weeks later (`historyPaymentDays`, recorded by the collections seed through the payments service),
 *    and invoices tagged to the exhibitions (deals sourced there) / the organised summit (sponsorships);
 *  - ledger entries (`historyLedgerEntriesOf`, posted by the ledger seed): payroll before the HR payroll go-live (the
 *    payroll runs start three months ago; earlier months come from the payroll bureau as one summary per month, by
 *    department), cost of sales every month (5100 / 5200), and the running overheads (rent, utilities, depreciation,
 *    marketing, fees, end-of-service provision) of the months the other seeds don't cover.
 * Sizing: Apex payroll ≈ 52 % of revenue, gross margin ≈ 75 %; Crest payroll ≈ 47 %, gross margin ≈ 72 %; both a
 * positive net margin of roughly 10–15 %. Synthetic data only.
 */

export interface HistoryInvoice {
  id: string
  customerId: string
  vat: string
  issueDate: string
  lines: InvoiceLineInput[]
  eventId: string | null
  /** Days after the issue date the customer paid (clamped to yesterday). */
  paidAfter: number
  reference: string
}

const VAT_EGD = '300123456700003'
const VAT_JPT = '310987654300003'
const VAT_RGS = '302468135700003'

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const addMonths = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()
const dayOf = (ym: string, d: number) => `${ym}-${pad(Math.min(d, lastDay(ym)))}`

/** Months of the fiscal year up to the current one (fiscal year = calendar year for both companies). */
function yearMonths(today: string): string[] {
  const out: string[] = []
  for (let m = `${today.slice(0, 4)}-01`; m <= today.slice(0, 7); m = addMonths(m, 1)) out.push(m)
  return out
}
/** Business growth over the year (0.92 in January → about 1.08 in November): volumes and direct costs. */
const growth = (i: number) => 0.92 + 0.016 * i

/* ---------------- invoices ---------------- */

type Tpl = [serviceId: string | null, description: string, quantity: number, unitPrice: number, hourly: boolean, taxCodeId?: string]
interface Retainer {
  customerId: string
  vat: string
  title: string
  day: number
  paidAfter: number
  lines: Tpl[]
}

const APEX_RETAINERS: Retainer[] = [
  { customerId: 'C-1004', vat: '', title: 'AI concierge managed service', day: 3, paidAfter: 24, lines: [['S-102', 'Chatbot hosting & tuning — 14 properties', 14, 2500, false], ['S-701', 'Support & maintenance retainer', 4, 4500, false], ['S-501', 'PMS integration work (hours)', 70, 350, true]] },
  { customerId: 'C-1012', vat: '', title: 'BI managed service', day: 3, paidAfter: 32, lines: [['S-402', 'Dashboard support & new reports (hours)', 160, 300, true], ['S-701', 'Support & maintenance retainer', 3, 4500, false], ['S-501', 'POS integration work (hours)', 45, 350, true]] },
  { customerId: 'C-1017', vat: '', title: 'Booking & chatbot operations', day: 4, paidAfter: 18, lines: [['S-102', 'Chatbot hosting & tuning — 10 sites', 10, 2500, false], ['S-701', 'Support & maintenance retainer', 3, 4500, false], ['S-402', 'Reporting support (hours)', 70, 300, true]] },
  { customerId: 'C-1021', vat: '', title: 'CRM automation managed service', day: 4, paidAfter: 38, lines: [['S-701', 'Support & maintenance retainer', 5, 4500, false], ['S-302', 'Emirates ID & passport scanning — rental desks', 14, 1800, false], ['S-501', 'Fleet system integration (hours)', 55, 350, true]] },
  { customerId: 'C-1025', vat: '', title: 'Document AI service', day: 5, paidAfter: 28, lines: [['S-402', 'Analytics & reporting (hours)', 140, 300, true], ['S-302', 'Document scanning — client onboarding batches', 12, 1800, false], ['S-701', 'Support & maintenance retainer', 4, 4500, false]] },
  { customerId: 'C-1030', vat: '', title: 'OCR processing service', day: 5, paidAfter: 35, lines: [['S-302', 'Document scanning — audit season batches', 18, 1800, true], ['S-701', 'Support & maintenance retainer', 3, 4500, false], ['S-501', 'Accounting system integration (hours)', 50, 350, true]] },
]
const APEX_MILESTONES: [customerId: string, serviceId: string, description: string, price: number][] = [
  ['C-1004', 'S-601', 'Booking app — release milestone', 24000],
  ['C-1012', 'S-401', 'Executive BI dashboards — new dashboard pack', 30000],
  ['C-1017', 'S-101', 'Chatbot — new language and flows', 28000],
  ['C-1021', 'S-201', 'CRM automation — workflow phase', 35000],
  ['C-1025', 'S-301', 'Document OCR — new document types', 42000],
  ['C-1030', 'S-202', 'Data migration & clean-up — legacy ledgers', 12000],
  ['C-1004', 'S-103', 'Voice assistant — call-centre pilot', 46000],
]

const CREST_RETAINERS: Retainer[] = [
  { customerId: 'C-5007', vat: VAT_JPT, title: 'Port logistics', day: 2, paidAfter: 30, lines: [['S-903', 'Customs clearance — Jeddah Islamic Port shipments', 14, 2200, true], ['S-901', 'Freight forwarding — Jeddah to Riyadh', 4, 8500, true]] },
  { customerId: 'C-5018', vat: VAT_RGS, title: 'Warehousing & distribution', day: 2, paidAfter: 42, lines: [['S-902', 'Contract warehousing — Riyadh DC (2 zones)', 2, 18000, false], ['S-901', 'Store distribution runs', 4, 8500, true]] },
  { customerId: 'C-5003', vat: VAT_EGD, title: 'Oilfield logistics', day: 3, paidAfter: 36, lines: [['S-901', 'Freight forwarding — rig spares, Dammam', 3, 8500, true], [null, 'Export freight to Bahrain (zero-rated)', 2, 9250, false, 'ZR'], ['S-903', 'Customs clearance', 3, 2200, true]] },
  { customerId: 'C-5010', vat: '', title: 'Cold-chain freight', day: 3, paidAfter: 25, lines: [['S-901', 'Cold-chain freight — Tabuk to Riyadh', 3, 8500, true], ['S-902', 'Cold storage — Riyadh', 1, 18000, false]] },
]
const CREST_MILESTONES: [customerId: string, vat: string, description: string][] = [
  ['C-5003', VAT_EGD, 'Supply chain assessment — rig spares inventory'],
  ['C-5018', VAT_RGS, 'Supply chain assessment — store replenishment'],
  ['C-5007', VAT_JPT, 'Supply chain assessment — import flows'],
]

const vatFor = (co: string) => (co === CREST_ID ? 'VAT15' : 'VAT5')
const tplLine = (co: string, t: Tpl, f: number): InvoiceLineInput => ({
  description: t[1],
  serviceId: t[0] ?? undefined,
  quantity: t[4] ? Math.max(1, Math.round(t[2] * f)) : t[2],
  unitPrice: t[3],
  discount: 0,
  taxCodeId: t[5] ?? vatFor(co),
})

/** Days after the event start (negative = before) and what was billed: deals sourced at an exhibition / sponsorships. */
const EVENT_INVOICES: Record<string, { eventId: string; offset: number; customerId: string; vat: string; paidAfter: number; lines: InvoiceLineInput[] }[]> = {
  [APEX_ID]: [
    { eventId: 'EV-1001', offset: 10, customerId: 'C-1025', vat: '', paidAfter: 21, lines: [{ description: 'Document OCR — claims desk pilot (GITEX lead)', serviceId: 'S-301', quantity: 1, unitPrice: 42000, discount: 0, taxCodeId: 'VAT5' }, { description: 'Integration with the claims system (hours)', serviceId: 'S-501', quantity: 60, unitPrice: 350, discount: 0, taxCodeId: 'VAT5' }] },
    { eventId: 'EV-1001', offset: 19, customerId: 'C-1017', vat: '', paidAfter: 12, lines: [{ description: 'Voice assistant — reservations pilot (GITEX lead)', serviceId: 'S-103', quantity: 1, unitPrice: 46000, discount: 0, taxCodeId: 'VAT5' }] },
  ],
  [CREST_ID]: [
    { eventId: 'EV-5003', offset: -20, customerId: 'C-5018', vat: VAT_RGS, paidAfter: 14, lines: [{ description: 'Gold sponsorship — Jeddah Cold Chain Summit', quantity: 1, unitPrice: 30000, discount: 0, taxCodeId: 'VAT15', revenueAccountId: 'ACC-4300' }] },
    { eventId: 'EV-5003', offset: -16, customerId: 'C-5010', vat: '', paidAfter: 10, lines: [{ description: 'Exhibitor space — Jeddah Cold Chain Summit', quantity: 1, unitPrice: 15000, discount: 0, taxCodeId: 'VAT15', revenueAccountId: 'ACC-4300' }] },
    { eventId: 'EV-5003', offset: -14, customerId: 'C-5007', vat: VAT_JPT, paidAfter: 9, lines: [{ description: 'Exhibitor space — Jeddah Cold Chain Summit', quantity: 1, unitPrice: 15000, discount: 0, taxCodeId: 'VAT15', revenueAccountId: 'ACC-4300' }] },
    { eventId: 'EV-5003', offset: -10, customerId: 'C-5003', vat: VAT_EGD, paidAfter: 8, lines: [{ description: 'Delegate passes — Jeddah Cold Chain Summit', quantity: 8, unitPrice: 1250, discount: 0, taxCodeId: 'VAT15', revenueAccountId: 'ACC-4300' }] },
    { eventId: 'EV-5001', offset: 13, customerId: 'C-5010', vat: '', paidAfter: 20, lines: [{ description: 'Cold storage — Jeddah overflow (Expo lead)', serviceId: 'S-902', quantity: 3, unitPrice: 18000, discount: 0, taxCodeId: 'VAT15' }, { description: 'Cold-chain freight — Jeddah to Tabuk', serviceId: 'S-901', quantity: 4, unitPrice: 8500, discount: 0, taxCodeId: 'VAT15' }] },
    { eventId: 'EV-5001', offset: 27, customerId: 'C-5007', vat: VAT_JPT, paidAfter: 11, lines: [{ description: 'Port logistics assessment (Expo lead)', serviceId: 'S-905', quantity: 1, unitPrice: 35000, discount: 0, taxCodeId: 'VAT15' }, { description: 'Customs clearance — project cargo', serviceId: 'S-903', quantity: 10, unitPrice: 2200, discount: 0, taxCodeId: 'VAT15' }] },
  ],
}

/** The seeded history invoices of a company, in issue order (ids INV-1101… for Apex, INV-5101… for Crest). */
export function historyInvoicesOf(co: string, today: string): HistoryInvoice[] {
  const retainers = co === APEX_ID ? APEX_RETAINERS : co === CREST_ID ? CREST_RETAINERS : []
  if (!retainers.length) return []
  const latest = addDaysIso(today, -2) // issued at least two days ago, so it can be paid by yesterday
  const rows: Omit<HistoryInvoice, 'id'>[] = []
  yearMonths(today).forEach((ym, i) => {
    const f = growth(i)
    for (const r of retainers) {
      rows.push({ customerId: r.customerId, vat: r.vat, issueDate: dayOf(ym, r.day), eventId: null, paidAfter: r.paidAfter, reference: '', lines: r.lines.map((t) => tplLine(co, t, f)) })
    }
    if (co === APEX_ID) {
      for (let k = 0; k < 3; k++) {
        const [customerId, serviceId, description, price] = APEX_MILESTONES[(i * 3 + k) % APEX_MILESTONES.length]
        rows.push({ customerId, vat: '', issueDate: dayOf(ym, 12 + k * 5), eventId: null, paidAfter: 30, reference: '', lines: [{ description, serviceId, quantity: 1, unitPrice: price, discount: 0, taxCodeId: 'VAT5' }] })
      }
    } else if (i % 2 === 1) {
      const [customerId, vat, description] = CREST_MILESTONES[((i - 1) / 2) % CREST_MILESTONES.length]
      rows.push({ customerId, vat, issueDate: dayOf(ym, 16), eventId: null, paidAfter: 30, reference: '', lines: [{ description, serviceId: 'S-905', quantity: 1, unitPrice: 35000, discount: 0, taxCodeId: 'VAT15' }] })
    }
  })
  for (const x of EVENT_INVOICES[co] ?? []) {
    const e = events.find((ev) => ev.companyId === co && ev.id === x.eventId)
    if (!e) continue
    const day = addDaysIso(eventStartDate(e), x.offset)
    if (day < `${today.slice(0, 4)}-01-01`) continue
    rows.push({ customerId: x.customerId, vat: x.vat, issueDate: day, eventId: x.eventId, paidAfter: x.paidAfter, reference: '', lines: x.lines.map((l) => ({ ...l })) })
  }
  const base = co === APEX_ID ? 1100 : 5100
  return rows
    .filter((r) => r.issueDate <= latest)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
    .map((r, k) => ({ ...r, id: `INV-${base + k + 1}`, reference: `${co === APEX_ID ? 'TT' : 'SARIE'} ${String(70411 + k * 37).padStart(6, '0')}` }))
}

/** History invoice ids are INV-1101…1399 (Apex) and INV-5101…5399 (Crest). */
export function isHistoryInvoiceId(id: string): boolean {
  const n = Number(id.replace(/^INV-/, ''))
  return (n > 1100 && n < 1400) || (n > 5100 && n < 5400)
}

/* ---------------- ledger entries ---------------- */

export interface HistoryEntry {
  date: string
  memo: string
  sourceType: 'manual' | 'payroll'
  sourceId: string | null
  lines: JournalLine[]
}

const ln = (accountId: string, debit: number, credit: number, description = '', dims: Partial<JournalLine> = {}): JournalLine => ({ accountId, debit, credit, description, ...dims })
const r50 = (n: number) => Math.round(n / 50) * 50
const r2 = (n: number) => Math.round(n * 100) / 100

/** August-like payroll by department (basic, allowances, employer pension / GOSI), monthly. */
const PAYROLL: Record<string, [dept: string, basic: number, allowances: number, employer: number][]> = {
  [APEX_ID]: [
    ['d-management', 21000, 7250, 0],
    ['d-sales', 74000, 23350, 0],
    ['d-marketing', 16500, 5425, 0],
    ['d-delivery', 81500, 27075, 1800],
    ['d-finance', 18000, 5500, 0],
    ['d-hr', 27500, 7100, 3125],
    ['d-it', 6000, 2800, 950],
  ],
  [CREST_ID]: [
    ['c2-management', 7500, 2875, 1100],
    ['c2-sales', 34500, 11475, 2550],
    ['c2-ops', 69000, 21350, 3900],
    ['c2-it', 6000, 2800, 900],
  ],
}
/** Headcount grew through the year: January payroll ≈ 90 % of August's. */
const PAYROLL_FACTOR = [0.9, 0.9, 0.93, 0.93, 0.95, 0.96, 0.98, 1, 1, 1, 1, 1]

interface CostPlan {
  bank: string
  payDay: number
  /** Monthly cost of sales: [account, description, base amount, VAT recoverable, department, day]. */
  cos: [string, string, number, boolean, string, number][]
  /** Rent per quarter, paid in these months of the quarter cycle (month numbers). */
  rent: { amount: number; months: number[]; dept: string; memo: string; vat: boolean }
  /** Monthly overheads up to (not including) the given offset from the current month: [account, memo, amount, VAT, dept, day, lastOffset]. */
  monthly: [string, string, number, boolean, string, number, number][]
  /** Quarterly costs: [account, memo, amount, VAT, dept, months]. */
  quarterly: [string, string, number, boolean, string, number[]][]
  /** End-of-service provision per month (non-cash: Cr 2500), up to last month. */
  eosb: { amount: number; dept: string }
  vatRate: number
  vatCode: string
}

const PLANS: Record<string, CostPlan> = {
  [APEX_ID]: {
    bank: 'ACC-1120',
    payDay: 28,
    vatRate: 5,
    vatCode: 'VAT5',
    cos: [
      ['ACC-5100', 'Cloud hosting and AI model usage (reseller invoice)', 46000, true, 'd-delivery', 10],
      ['ACC-5200', 'Subcontracted developers — Nexa Dev Studio', 96000, true, 'd-delivery', 25],
    ],
    rent: { amount: 30000, months: [1, 4, 7], dept: 'd-management', memo: 'Office rent, Business Bay', vat: false },
    monthly: [
      ['ACC-6300', 'Utilities and telecom (DEWA, du)', 4200, true, 'd-management', 18, -1],
      ['ACC-6850', 'Monthly depreciation', 1750, false, '', 30, -2],
      ['ACC-6400', 'LinkedIn and Google ads', 6000, true, 'd-marketing', 20, -2],
      ['ACC-6500', 'Client visits and travel', 2200, true, 'd-sales', 22, -2],
    ],
    quarterly: [
      ['ACC-6700', 'Legal and advisory fees', 7500, true, 'd-finance', [3, 6, 9]],
      ['ACC-6140', 'Visa and labour fees (renewals)', 9000, false, 'd-hr', [2, 5, 8]],
    ],
    eosb: { amount: 9500, dept: 'd-hr' },
  },
  [CREST_ID]: {
    bank: 'ACC-1120',
    payDay: 27,
    vatRate: 15,
    vatCode: 'VAT15',
    cos: [
      ['ACC-5200', 'Subcontracted haulage — owner-operators', 58000, true, 'c2-ops', 24],
      ['ACC-5100', 'Fuel, tolls and port handling', 30000, true, 'c2-ops', 12],
    ],
    rent: { amount: 45000, months: [2, 5, 8], dept: 'c2-ops', memo: 'Warehouse rent, Riyadh 2nd Industrial City', vat: true },
    monthly: [
      ['ACC-6300', 'Utilities and telecom (SEC, STC)', 2800, true, 'c2-ops', 18, -1],
      ['ACC-6850', 'Fleet depreciation', 7000, false, 'c2-ops', 30, -2],
      ['ACC-6400', 'Trade marketing and online ads', 3500, true, 'c2-sales', 20, -2],
      ['ACC-6570', 'Pool cars — fuel and service', 1800, true, 'c2-ops', 21, -2],
    ],
    quarterly: [['ACC-6140', 'Iqama and government fees', 16000, false, 'c2-management', [3, 6, 9]]],
    eosb: { amount: 5500, dept: 'c2-management' },
  },
}

/** Ledger entries of the year the other seeds don't post (dates ≤ today), in date order. */
export function historyLedgerEntriesOf(co: string, today: string): HistoryEntry[] {
  const plan = PLANS[co]
  const payroll = PAYROLL[co]
  if (!plan || !payroll) return []
  const cur = today.slice(0, 7)
  const firstRun = addMonths(cur, -3) // the HR payroll runs cover the last three months
  const out: HistoryEntry[] = []
  const vatLine = (net: number) => ln('ACC-1300', r2((net * plan.vatRate) / 100), 0, `VAT ${plan.vatRate}% recoverable`, { taxCode: plan.vatCode })
  const paid = (date: string, memo: string, account: string, net: number, vat: boolean, dept: string) => {
    const lines = [ln(account, net, 0, memo, dept ? { departmentId: dept } : {}), ...(vat ? [vatLine(net)] : [])]
    const total = r2(lines.reduce((s, l) => s + l.debit, 0))
    out.push({ date, memo, sourceType: 'manual', sourceId: null, lines: [...lines, ln(plan.bank, 0, total, 'Bank transfer')] })
  }
  yearMonths(today).forEach((ym, i) => {
    const month = Number(ym.slice(5, 7))
    const f = growth(i)
    // Payroll before the HR payroll go-live: one bureau summary per month, by department.
    if (ym < firstRun) {
      const pf = PAYROLL_FACTOR[month - 1] ?? 1
      const lines: JournalLine[] = []
      for (const [dept, basic, allowances, employer] of payroll) {
        lines.push(ln('ACC-6100', r50(basic * pf), 0, 'Basic salaries', { departmentId: dept }))
        lines.push(ln('ACC-6110', r50(allowances * pf), 0, 'Allowances', { departmentId: dept }))
        if (employer) lines.push(ln('ACC-6130', r50(employer * pf), 0, 'Social insurance (employer share)', { departmentId: dept }))
      }
      const total = r2(lines.reduce((s, l) => s + l.debit, 0))
      lines.push(ln(plan.bank, 0, total, 'Salaries and contributions paid (bureau)'))
      out.push({ date: dayOf(ym, plan.payDay), memo: `Payroll ${monthName(ym)} — payroll bureau summary (before the HR payroll went live)`, sourceType: 'payroll', sourceId: `PRH-${ym}`, lines })
    }
    // Cost of sales, every month.
    for (const [account, memo, amount, vat, dept, day] of plan.cos) paid(dayOf(ym, day), `${memo} — ${monthName(ym)}`, account, r50(amount * f), vat, dept)
    if (plan.rent.months.includes(month) && ym < addMonths(cur, -1)) paid(dayOf(ym, 4), `${plan.rent.memo} — quarter from ${monthName(ym)}`, 'ACC-6200', plan.rent.amount, plan.rent.vat, plan.rent.dept)
    for (const [account, memo, amount, vat, dept, day, last] of plan.monthly) {
      if (ym > addMonths(cur, last)) continue
      if (account === 'ACC-6850') {
        out.push({ date: dayOf(ym, day), memo: `${memo} — ${monthName(ym)}`, sourceType: 'manual', sourceId: null, lines: [ln(account, amount, 0, memo, dept ? { departmentId: dept } : {}), ln('ACC-1590', 0, amount, 'Accumulated depreciation')] })
      } else paid(dayOf(ym, day), `${memo} — ${monthName(ym)}`, account, amount, vat, dept)
    }
    for (const [account, memo, amount, vat, dept, months] of plan.quarterly) if (months.includes(month) && ym < cur) paid(dayOf(ym, 15), `${memo} — ${monthName(ym)}`, account, amount, vat, dept)
    if (ym < cur) {
      out.push({ date: dayOf(ym, 31), memo: `End-of-service benefits provision — ${monthName(ym)}`, sourceType: 'manual', sourceId: null, lines: [ln('ACC-6120', plan.eosb.amount, 0, 'Provision for the month', { departmentId: plan.eosb.dept }), ln('ACC-2500', 0, plan.eosb.amount, 'End-of-service provision')] })
    }
  })
  return out.filter((e) => e.date <= today).sort((a, b) => a.date.localeCompare(b.date))
}
