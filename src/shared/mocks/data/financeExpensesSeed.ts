import type { ClaimLineInput, ExpenseInput, PettyExpenseInput, ReceiptFile } from '@/modules/finance/expenses/types'
import type { User } from '@/shared/types'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { users } from '@/shared/mocks/db'
import { financeSeq } from '@/shared/mocks/data/finance'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { employeeForUser } from '@/shared/mocks/data/hrEmployees'
import { finExpenseCategories, finExpenses, type CategoryRecord } from './financeExpenses'
import type { Tenant } from '@/shared/mocks/tenant'
import { canActNow, currentStep } from '@/shared/mocks/services/financeExpensesCore'
import { expenseFields, finishExpense, newExpense } from '@/shared/mocks/services/financeExpenses'
import { approveCore, claimLines, newClaim, reimburseCore, rejectCore, submitCore } from '@/shared/mocks/services/financeExpensesClaims'
import { countCore, newFund, recordPettyCore, replenishCore, topUpCore } from '@/shared/mocks/services/financeExpensesPetty'
import { reverseJournal } from '@/shared/mocks/services/ledger'
// Suppliers (vendor directory) must be seeded first: some expenses reference them.
import '@/shared/mocks/data/eventLibrarySeed'

/**
 * Seed of Accounts & finance › Expenses per company (different data), relative to the company's today and posted
 * through the same store-level code as the API (postJournal; every date in 2026, after Crest's 2025 lock):
 *   categories mapped to expense accounts (monthly limits on travel / meals / fuel / telecom);
 *   ~15 expenses: approved (with and without a valid TRN), pending, one void (reversed), one in USD, one paid by petty cash;
 *   claims in every state: draft, pending department head, pending accountant, approved to reimburse, in payroll
 *   (a `reimbursement` payroll adjustment), reimbursed (paid now), rejected;
 *   two petty cash funds with expenses, one replenishment and a cash count.
 * Ids: Apex from 1001, Crest from 5001 (shared counters). Synthetic data only; TRNs are made up and never pass Luhn.
 */

const day = (today: string, n: number) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const at = (date: string, hh = '08') => `${date}T${hh}:00:00.000Z`

function luhn(digits: string): boolean {
  let s = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    s += d
    dbl = !dbl
  }
  return s % 10 === 0
}
/** A made-up tax number that keeps its country format and never looks like a card number. */
function trn(v: string): string {
  let out = v
  for (let i = 0; luhn(out) && i < 10; i++) out = out.slice(0, 7) + String((Number(out[7]) + 1) % 10) + out.slice(8)
  return out
}

const svg = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#f8fafc"/><text x="10" y="60" font-size="14">${label}</text></svg>`)}`
const receipt = (name: string, kb: number): ReceiptFile => ({ name, sizeBytes: kb * 1024, mimeType: 'image/svg+xml', url: svg(name) })

interface CompanySeed {
  categories: [name: string, code: string, limit: number | null, description: string][]
  creator: string
  approvers: string[]
  vat: string[]
  expenses: (ExpenseInput & { ago: number; cat: string; state: 'approved' | 'pending' | 'void' | 'rejected'; fundIdx?: number })[]
  claims: { user: string; title: string; ago: number; state: 'draft' | 'pending_head' | 'pending_accountant' | 'approved' | 'in_payroll' | 'reimbursed' | 'rejected'; lines: (ClaimLineInput & { cat: string; daysAgo: number })[] }[]
  funds: { name: string; custodian: string; float: number; ago: number; spent: (PettyExpenseInput & { cat: string; daysAgo: number })[]; replenishAgo?: number; pending: (PettyExpenseInput & { cat: string; daysAgo: number })[]; count?: { ago: number; diff: number; reason: string } }[]
  replenisher: string
}

const SEEDS: Record<string, CompanySeed> = {
  [APEX_ID]: {
    categories: [
      ['Travel', '6500', 3000, 'Flights, hotels, taxis and visas for business trips.'],
      ['Meals and entertainment', '6560', 800, 'Client meals and team entertainment.'],
      ['Fuel and parking', '6570', 1000, 'Fuel, Salik tolls and parking.'],
      ['Office supplies', '6550', null, 'Stationery, printer ink, small office items.'],
      ['Marketing and advertising', '6400', null, 'Ads, printing and promotional material.'],
      ['Events', '6450', null, 'Exhibition and event costs.'],
      ['Software and subscriptions', '6600', null, 'SaaS tools and licences.'],
      ['Professional fees', '6700', null, 'Legal, audit and consulting.'],
      ['Telecom', '6300', 300, 'Mobile and internet bills.'],
      ['Bank charges', '6800', null, 'Transfer fees and card charges.'],
    ],
    creator: 'u8',
    approvers: ['u2', 'u1'],
    vat: [trn('100345678900003'), trn('100456123700003'), trn('100567234800003')],
    expenses: [
      { ago: 40, cat: 'Software and subscriptions', payeeName: 'CloudDesk FZ-LLC', payeeVatNumber: 'V0', amount: 1050, paymentMethod: 'card', description: 'Help desk licences (annual)', state: 'approved' },
      { ago: 38, cat: 'Office supplies', payeeName: 'Al Futtaim Office Mart', payeeVatNumber: 'V1', amount: 420, paymentMethod: 'card', description: 'Printer toner and paper', state: 'approved' },
      { ago: 35, cat: 'Events', vendorId: 'VND-1001', amount: 12600, paymentMethod: 'bank_transfer', description: 'GITEX stand balance payment', state: 'approved' },
      { ago: 33, cat: 'Marketing and advertising', vendorId: 'VND-1002', payeeVatNumber: '', amount: 2310, paymentMethod: 'bank_transfer', description: 'Brochures (supplier invoice without TRN)', state: 'approved' },
      { ago: 30, cat: 'Software and subscriptions', payeeName: 'Figma Inc.', amount: 540, currency: 'USD', taxCodeId: 'OOS', paymentMethod: 'card', description: 'Design seats (USD)', state: 'approved' },
      { ago: 28, cat: 'Professional fees', payeeName: 'Kanoo Legal Consultants', payeeVatNumber: 'V2', amount: 6300, paymentMethod: 'bank_transfer', description: 'Contract review', state: 'approved' },
      { ago: 26, cat: 'Meals and entertainment', payeeName: 'Zuma Dubai', amount: 980, paymentMethod: 'card', description: 'Client dinner (receipt without TRN)', state: 'approved' },
      { ago: 22, cat: 'Telecom', payeeName: 'du', payeeVatNumber: 'V0', amount: 682.5, paymentMethod: 'bank_transfer', description: 'Office internet October', state: 'void' },
      { ago: 20, cat: 'Bank charges', payeeName: 'Emirates NBD', taxCodeId: 'EX', amount: 75, paymentMethod: 'bank_transfer', description: 'International transfer fee', state: 'approved' },
      { ago: 18, cat: 'Office supplies', payeeName: 'Carrefour Business', payeeVatNumber: 'V1', amount: 157.5, paymentMethod: 'petty_cash', fundIdx: 0, description: 'Pantry supplies', state: 'approved' },
      { ago: 14, cat: 'Travel', payeeName: 'Emirates Airline', payeeVatNumber: 'V2', amount: 3150, paymentMethod: 'card', description: 'Riyadh client visit flights', state: 'approved' },
      { ago: 10, cat: 'Marketing and advertising', payeeName: 'LinkedIn Ireland', taxCodeId: 'OOS', amount: 4200, paymentMethod: 'card', description: 'Sponsored content November', state: 'approved' },
      { ago: 6, cat: 'Events', vendorId: 'VND-1003', amount: 24500, paymentMethod: 'bank_transfer', description: 'Customer summit catering', state: 'pending' },
      { ago: 4, cat: 'Professional fees', payeeName: 'PwC Middle East', payeeVatNumber: 'V0', amount: 8400, paymentMethod: 'bank_transfer', description: 'Q3 review fees', state: 'pending' },
      { ago: 2, cat: 'Software and subscriptions', payeeName: 'Notion Labs', taxCodeId: 'OOS', amount: 96, currency: 'USD', paymentMethod: 'card', description: 'Wiki workspace', state: 'pending' },
    ],
    claims: [
      { user: 'u4', title: 'Client visits — Sharjah', ago: 1, state: 'draft', lines: [{ cat: 'Fuel and parking', daysAgo: 3, description: 'Fuel for client visits', merchant: 'ENOC', amount: 160 }] },
      { user: 'u6', title: 'Prospect lunch and taxi', ago: 2, state: 'pending_head', lines: [{ cat: 'Meals and entertainment', daysAgo: 5, description: 'Lunch with Gulf Retail prospect', merchant: 'Operation Falafel', merchantVatNumber: 'V0', amount: 245 }, { cat: 'Travel', daysAgo: 5, description: 'Taxi to Business Bay', merchant: 'Careem', amount: 58 }] },
      { user: 'u14', title: 'Developer conference', ago: 6, state: 'pending_accountant', lines: [{ cat: 'Travel', daysAgo: 12, description: 'Conference ticket', merchant: 'Step Conference', merchantVatNumber: 'V1', amount: 1250 }, { cat: 'Meals and entertainment', daysAgo: 12, description: 'Team dinner', merchant: 'Al Ustad', amount: 180 }] },
      { user: 'u11', title: 'On-site workshop supplies', ago: 9, state: 'approved', lines: [{ cat: 'Office supplies', daysAgo: 14, description: 'Flip charts and markers', merchant: 'Office Mart', merchantVatNumber: 'V2', amount: 315 }] },
      { user: 'u15', title: 'Device testing SIMs', ago: 12, state: 'in_payroll', lines: [{ cat: 'Telecom', daysAgo: 16, description: 'Prepaid SIMs for QA', merchant: 'Etisalat', merchantVatNumber: 'V0', amount: 210 }, { cat: 'Fuel and parking', daysAgo: 16, description: 'Parking at Dubai Mall', merchant: 'Emaar Parking', amount: 40 }] },
      { user: 'u16', title: 'AI meetup Abu Dhabi', ago: 20, state: 'reimbursed', lines: [{ cat: 'Travel', daysAgo: 25, description: 'Bus and taxi to Abu Dhabi', merchant: 'RTA', amount: 95 }, { cat: 'Meals and entertainment', daysAgo: 25, description: 'Lunch', merchant: 'Shake Shack', merchantVatNumber: 'V1', amount: 72 }] },
      { user: 'u17', title: 'Design books', ago: 15, state: 'rejected', lines: [{ cat: 'Office supplies', daysAgo: 70, description: 'Typography books', merchant: 'Kinokuniya', merchantVatNumber: 'V2', amount: 380 }] },
    ],
    funds: [
      {
        name: 'Head office petty cash', custodian: 'u11', float: 3000, ago: 45,
        spent: [{ cat: 'Office supplies', daysAgo: 30, payeeName: 'Union Coop', payeeVatNumber: 'V1', amount: 262.5, description: 'Pantry restock' }, { cat: 'Fuel and parking', daysAgo: 28, payeeName: 'Emarat', amount: 120, description: 'Courier fuel' }, { cat: 'Office supplies', daysAgo: 26, payeeName: 'Daiso', amount: 88, description: 'Cables and adapters' }],
        replenishAgo: 24,
        pending: [{ cat: 'Meals and entertainment', daysAgo: 8, payeeName: 'Tim Hortons', amount: 96, description: 'Coffee for client workshop' }, { cat: 'Office supplies', daysAgo: 6, payeeName: 'Ace Hardware', payeeVatNumber: 'V0', amount: 1575, description: 'Meeting room whiteboards' }, { cat: 'Fuel and parking', daysAgo: 3, payeeName: 'RTA Parking', amount: 650, description: 'Parking cards (monthly)' }],
        count: { ago: 20, diff: -15, reason: 'Coins short after the courier tip' },
      },
      { name: 'Events team float', custodian: 'u12', float: 1500, ago: 30, spent: [], pending: [{ cat: 'Events', daysAgo: 4, payeeName: 'Dragon Mart', amount: 230, description: 'Booth decoration' }] },
    ],
    replenisher: 'u8',
  },
  [CREST_ID]: {
    categories: [
      ['Site visits and travel', '6500', 4000, 'Trips to warehouses, ports and customer sites.'],
      ['Meals', '6560', 600, 'Customer and driver meals.'],
      ['Fuel and tolls', '6570', 1500, 'Fleet fuel top-ups, tolls and parking.'],
      ['Stationery', '6550', null, 'Paper, labels and office items.'],
      ['Advertising', '6400', null, 'Tender portals and adverts.'],
      ['Exhibitions', '6450', null, 'Trade shows and events.'],
      ['Software', '6600', null, 'Fleet tracking and SaaS.'],
      ['Consulting and legal', '6700', null, 'Customs brokers, lawyers, auditors.'],
      ['Mobile and internet', '6300', 400, 'SIM cards and data.'],
    ],
    creator: 'u101',
    approvers: ['u102'],
    vat: [trn('310123987600003'), trn('300987612300003'), trn('311456789000003')],
    expenses: [
      { ago: 42, cat: 'Software', payeeName: 'Fleetio Inc.', taxCodeId: 'OOS', amount: 1200, currency: 'USD', paymentMethod: 'card', description: 'Fleet maintenance software (USD)', state: 'approved' },
      { ago: 39, cat: 'Fuel and tolls', payeeName: 'Aldrees Petroleum', payeeVatNumber: 'V0', amount: 2875, paymentMethod: 'card', description: 'Fleet fuel cards top-up', state: 'approved' },
      { ago: 36, cat: 'Exhibitions', vendorId: 'VND-5001', amount: 18400, paymentMethod: 'bank_transfer', description: 'Saudi Logistics Expo stand', state: 'approved' },
      { ago: 33, cat: 'Stationery', payeeName: 'Jarir Bookstore', payeeVatNumber: 'V1', amount: 345, paymentMethod: 'card', description: 'Shipping labels and binders', state: 'approved' },
      { ago: 31, cat: 'Advertising', vendorId: 'VND-5002', amount: 3450, paymentMethod: 'bank_transfer', description: 'Printed rate cards (no VAT number)', state: 'approved' },
      { ago: 27, cat: 'Consulting and legal', payeeName: 'Al Tamimi Customs Brokers', payeeVatNumber: 'V2', amount: 5750, paymentMethod: 'bank_transfer', description: 'Customs clearance advisory', state: 'approved' },
      { ago: 25, cat: 'Meals', payeeName: 'Al Baik', amount: 230, paymentMethod: 'cash', description: 'Driver meals (simplified receipt)', state: 'approved' },
      { ago: 23, cat: 'Mobile and internet', payeeName: 'STC', payeeVatNumber: 'V0', amount: 1150, paymentMethod: 'bank_transfer', description: 'Fleet SIM data (duplicate entry)', state: 'void' },
      { ago: 21, cat: 'Mobile and internet', payeeName: 'STC', payeeVatNumber: 'V0', amount: 1150, paymentMethod: 'bank_transfer', description: 'Fleet SIM data October', state: 'approved' },
      { ago: 17, cat: 'Site visits and travel', payeeName: 'Saudia', payeeVatNumber: 'V1', amount: 2160, paymentMethod: 'card', description: 'Dammam site visit flights', state: 'approved' },
      { ago: 15, cat: 'Stationery', payeeName: 'Panda Retail', amount: 92, paymentMethod: 'petty_cash', fundIdx: 0, description: 'Water and cups for the dock', state: 'approved' },
      { ago: 11, cat: 'Advertising', payeeName: 'Etimad tender portal', taxCodeId: 'EX', amount: 500, paymentMethod: 'bank_transfer', description: 'Tender documents fee', state: 'approved' },
      { ago: 8, cat: 'Consulting and legal', payeeName: 'KPMG Al Fozan', payeeVatNumber: 'V2', amount: 9775, paymentMethod: 'bank_transfer', description: 'Zakat advisory', state: 'pending' },
      { ago: 5, cat: 'Exhibitions', vendorId: 'VND-5003', amount: 4600, paymentMethod: 'bank_transfer', description: 'AV rental for open day', state: 'pending' },
      { ago: 3, cat: 'Fuel and tolls', payeeName: 'SASCO', payeeVatNumber: 'V0', amount: 690, paymentMethod: 'card', description: 'Fuel for Jeddah run', state: 'rejected' },
    ],
    claims: [
      { user: 'u104', title: 'Tender visit Riyadh', ago: 1, state: 'draft', lines: [{ cat: 'Fuel and tolls', daysAgo: 2, description: 'Fuel to KAFD', merchant: 'Petromin', amount: 140 }] },
      { user: 'u105', title: 'Customer lunch Olaya', ago: 3, state: 'pending_head', lines: [{ cat: 'Meals', daysAgo: 4, description: 'Lunch with SABIC logistics team', merchant: 'Nozomi', merchantVatNumber: 'V1', amount: 460 }] },
      { user: 'u107', title: 'Dock supplies', ago: 5, state: 'pending_accountant', lines: [{ cat: 'Stationery', daysAgo: 9, description: 'Pallet labels', merchant: 'Jarir', merchantVatNumber: 'V0', amount: 287.5 }, { cat: 'Meals', daysAgo: 9, description: 'Night shift meals', merchant: 'Kudu', amount: 115 }] },
      { user: 'u104', title: 'Jeddah port trip', ago: 10, state: 'approved', lines: [{ cat: 'Site visits and travel', daysAgo: 15, description: 'Hotel one night', merchant: 'Novotel Jeddah', merchantVatNumber: 'V2', amount: 690 }, { cat: 'Fuel and tolls', daysAgo: 15, description: 'Taxi to the port', merchant: 'Uber', amount: 85 }] },
      { user: 'u107', title: 'Warehouse SIM top-ups', ago: 13, state: 'in_payroll', lines: [{ cat: 'Mobile and internet', daysAgo: 18, description: 'Scanner SIM data', merchant: 'Mobily', merchantVatNumber: 'V1', amount: 230 }] },
      { user: 'u105', title: 'Dammam customer visit', ago: 22, state: 'reimbursed', lines: [{ cat: 'Site visits and travel', daysAgo: 28, description: 'Train to Dammam', merchant: 'SAR', merchantVatNumber: 'V0', amount: 310.5 }, { cat: 'Meals', daysAgo: 28, description: 'Lunch', merchant: 'Herfy', amount: 48 }] },
      { user: 'u107', title: 'Personal phone accessories', ago: 16, state: 'rejected', lines: [{ cat: 'Mobile and internet', daysAgo: 19, description: 'Phone case and charger', merchant: 'eXtra', merchantVatNumber: 'V2', amount: 199 }] },
    ],
    funds: [
      {
        name: 'Riyadh warehouse petty cash', custodian: 'u107', float: 2500, ago: 40,
        spent: [{ cat: 'Stationery', daysAgo: 32, payeeName: 'Bin Dawood', amount: 140, description: 'Cleaning supplies' }, { cat: 'Fuel and tolls', daysAgo: 30, payeeName: 'Aldrees', payeeVatNumber: 'V0', amount: 230, description: 'Forklift gas refill' }],
        replenishAgo: 27,
        pending: [{ cat: 'Meals', daysAgo: 7, payeeName: 'Al Romansiah', amount: 185, description: 'Inventory night meals' }, { cat: 'Stationery', daysAgo: 4, payeeName: 'Jarir', payeeVatNumber: 'V1', amount: 172.5, description: 'Clipboards and pens' }],
        count: { ago: 26, diff: 5, reason: 'Change from a supplier not recorded' },
      },
      { name: 'Sales team float', custodian: 'u105', float: 1000, ago: 25, spent: [], pending: [{ cat: 'Meals', daysAgo: 2, payeeName: 'Starbucks', amount: 64, description: 'Coffee with a prospect' }] },
    ],
    replenisher: 'u102',
  },
}

function seedCompany(co: string): void {
  const s = SEEDS[co]
  const c = companyById(co)
  if (!s || !c) return
  const today = todayIsoIn(c.regional.timezone, clockNow())
  const u = (id: string) => users.find((x) => x.id === id && x.companyId === co) as User
  const vat = (v: string | undefined) => (v && /^V\d$/.test(v) ? s.vat[Number(v[1])] : v)

  /* categories */
  const cats = new Map<string, Tenant<CategoryRecord>>()
  for (const [name, code, limit, description] of s.categories) {
    const row: Tenant<CategoryRecord> = { companyId: co, id: `ECAT-${(financeSeq.ids.expenseCategory = (financeSeq.ids.expenseCategory ?? 1000) + 1)}`, name, accountId: `ACC-${code}`, description, monthlyLimit: limit, active: true, createdAt: at(`${today.slice(0, 4)}-01-02`), updatedAt: at(`${today.slice(0, 4)}-01-02`) }
    finExpenseCategories.push(row)
    cats.set(name, row)
  }
  const cat = (name: string) => cats.get(name)!.id

  /* petty funds (before the expenses: one expense is paid from a fund) */
  const funds = s.funds.map((fs) => {
    const emp = employeeForUser(co, fs.custodian)!
    const f = newFund(co, { name: fs.name, custodianEmployeeId: emp.id, accountId: 'ACC-1115', floatLimit: fs.float }, s.replenisher, at(day(today, fs.ago)))
    topUpCore(f, fs.float, 'ACC-1120', day(today, fs.ago), s.replenisher, at(day(today, fs.ago), '09'))
    const spent = fs.spent.map((p) => recordPettyCore(f, { ...p, categoryId: cat(p.cat), payeeVatNumber: vat(p.payeeVatNumber), date: day(today, p.daysAgo), receipt: receipt(`${p.payeeName}.svg`, 40) }, fs.custodian, at(day(today, p.daysAgo), '12')))
    if (fs.replenishAgo !== undefined) replenishCore(f, spent, [], 'ACC-1120', day(today, fs.replenishAgo), s.replenisher, at(day(today, fs.replenishAgo), '10'))
    return { f, fs }
  })
  for (const { f, fs } of funds) {
    // The count comes after the replenishment (the box is back at its float) and before the newer expenses.
    if (fs.count) countCore(f, fs.float + fs.count.diff, fs.count.reason, day(today, fs.count.ago), s.replenisher, at(day(today, fs.count.ago), '16'))
    for (const p of fs.pending) recordPettyCore(f, { ...p, categoryId: cat(p.cat), payeeVatNumber: vat(p.payeeVatNumber), date: day(today, p.daysAgo), receipt: (p.amount ?? 0) > 100 ? receipt(`${p.payeeName}.svg`, 55) : null }, fs.custodian, at(day(today, p.daysAgo), '13'))
  }

  /* expenses */
  const creator = u(s.creator)
  for (const [n, e] of s.expenses.entries()) {
    const date = day(today, e.ago)
    const { ago: _a, cat: cname, state, fundIdx, ...input } = e
    const fields = expenseFields(
      co,
      {
        ...input,
        date,
        categoryId: cat(cname),
        payeeVatNumber: vat(input.payeeVatNumber),
        paidFromAccountId: 'ACC-1120',
        pettyFundId: fundIdx !== undefined ? funds[fundIdx].f.id : null,
        receipt: receipt(`receipt-${n + 1}.svg`, 60 + n * 7),
      },
      null,
    )
    const rec = newExpense(co, fields, { id: creator.id, name: creator.name }, at(date, '09'))
    if (state === 'pending') continue
    if (state === 'rejected') {
      Object.assign(rec, { status: 'rejected', rejectReason: 'Fuel goes on the fleet cards, not a company card.' })
      continue
    }
    // Approvals of every step by distinct approvers (never the creator), then the posting.
    if (rec.status === 'pending') {
      for (const id of s.approvers) {
        if (!currentStep(rec.approval)) break
        rec.approval.approvals.push({ userId: id, at: at(date, '11') })
      }
      if (rec.approval.approvals.length >= rec.approval.steps.length) finishExpense(rec, { id: s.approvers[0], name: u(s.approvers[0]).name }, at(date, '11'))
    }
    if (state === 'void' && rec.journalEntryId) {
      const rev = reverseJournal(co, rec.journalEntryId, day(today, e.ago - 1), `Void of expense ${rec.number}: entered twice`, creator.id)
      Object.assign(rec, { status: 'void', voidJournalEntryId: rev.id, voidedAt: at(day(today, e.ago - 1), '10'), voidReason: 'Entered twice' })
    }
  }

  /* claims */
  for (const cl of s.claims) {
    const owner = u(cl.user)
    const emp = employeeForUser(co, cl.user)
    if (!owner || !emp) continue
    const created = at(day(today, cl.ago + 1), '18')
    const lines = claimLines(
      co,
      cl.lines.map((l) => ({ ...l, categoryId: cat(l.cat), date: day(today, l.daysAgo), merchantVatNumber: vat(l.merchantVatNumber), receipt: Number(l.amount) > 100 ? receipt(`${l.merchant}.svg`, 45) : null })),
    )
    const c = newClaim(co, { id: emp.id, userId: owner.id, departmentId: emp.departmentId ?? null }, cl.title, lines, created)
    if (cl.state === 'draft') continue
    const submitted = at(day(today, cl.ago), '09')
    if (cl.state === 'rejected') {
      // Policy (age) is a warning by default: submit as-is, the department head rejects.
      submitCore(c, submitted)
      const head = users.find((x) => x.companyId === co && x.active && c.approval.steps[0] && x.id !== owner.id && currentApproverOf(c, x as User))
      if (head) rejectCore(c, head as User, 'Not a business expense under the policy.', at(day(today, cl.ago - 1), '10'))
      continue
    }
    submitCore(c, submitted)
    const want = cl.state === 'pending_head' ? 0 : cl.state === 'pending_accountant' ? 1 : c.approval.steps.length
    for (let i = c.approval.approvals.length; i < want; i++) {
      const by = users.find((x) => x.companyId === co && x.active && x.id !== owner.id && currentApproverOf(c, x as User))
      if (!by) break
      approveCore(c, by as User, at(day(today, Math.max(0, cl.ago - 1 - i)), '11'))
    }
    if (cl.state === 'in_payroll' || cl.state === 'reimbursed') {
      const acc = u(s.replenisher)
      reimburseCore(c, { id: acc.id, name: acc.name }, cl.state === 'reimbursed' ? { method: 'payment', accountId: 'ACC-1120', date: day(today, Math.max(0, cl.ago - 4)) } : { method: 'payroll' }, at(day(today, Math.max(0, cl.ago - 4)), '12'))
    }
  }
}

const currentApproverOf = (c: Parameters<typeof canActNow>[1], u: User) => canActNow(u, c)

let seeded = false
/** Seeds both companies once (module load); Crest's ids start at 5001. */
export function seedFinanceExpenses(): void {
  if (seeded || finExpenses.length > 0 || finExpenseCategories.length > 0) return
  seeded = true
  if (companyById(APEX_ID)) seedCompany(APEX_ID)
  for (const k of ['expense', 'expenseCategory', 'claim', 'claimLine', 'pettyFund', 'pettyExpense', 'pettyMovement']) financeSeq.ids[k] = Math.max(financeSeq.ids[k] ?? 1000, 5000)
  if (companyById(CREST_ID)) seedCompany(CREST_ID)
}

seedFinanceExpenses()
