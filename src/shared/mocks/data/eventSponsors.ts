import type { DeliverableStatus, DeliverableTemplate, SponsorshipIncome, SponsorStage } from '@/modules/events/sponsorTypes'
import { customers, leads } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { events, type EventRecord } from '@/shared/mocks/data/events'
import { registerArray } from '@/shared/mocks/persist/registry'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { zonedParts } from '@/shared/lib/zonedTime'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Sponsors & exhibitors stores (docs/API.md › Events › Sponsors & exhibitors; DB-ALIGNMENT › Design gaps ›
 * Events): event_sponsor_packages, event_sponsors (deals) and event_sponsor_deliverables. Every row carries
 * its company and its event (events the company organizes). Seeded per company (different data).
 */

export interface SponsorPackageRecord {
  id: string
  eventId: string
  name: string
  price: number
  currency: string
  quantity: number
  benefits: string[]
  deliverables: DeliverableTemplate[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface SponsorDealRecord {
  id: string
  eventId: string
  packageId: string
  leadId: string | null
  customerId: string | null
  /** Snapshot of the lead's / customer's name (kept when the record is renamed or removed). */
  organizationName: string
  contactName: string
  contactEmail: string
  amount: number
  stage: SponsorStage
  lostReason: string
  ownerId: string | null
  expectedPaymentDate: string | null
  actualPaymentDate: string | null
  notes: string
  signedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface SponsorDeliverableRecord {
  id: string
  eventId: string
  dealId: string
  title: string
  offsetDays: number
  /** Company-local date (yyyy-MM-dd). */
  dueDate: string
  status: DeliverableStatus
  ownerId: string | null
  taskId: string | null
  /** The overdue notice was sent (once only; cleared when the due date changes). */
  overdueNotifiedAt: string | null
  createdAt: string
  updatedAt: string
}

export const sponsorPackages = registerArray<Tenant<SponsorPackageRecord>>('eventSponsorPackages', [])
export const sponsorDeals = registerArray<Tenant<SponsorDealRecord>>('eventSponsorDeals', [])
export const sponsorDeliverables = registerArray<Tenant<SponsorDeliverableRecord>>('eventSponsorDeliverables', [])

const round2 = (n: number) => Math.round(n * 100) / 100

/** Signed + paid deals of an event (the ONE place sponsorship income is computed: stats, budget, tab). */
export function sponsorshipIncomeOf(e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>): SponsorshipIncome {
  let signed = 0
  let paid = 0
  for (const d of sponsorDeals) {
    if (d.companyId !== e.companyId || d.eventId !== e.id) continue
    if (d.stage === 'signed') signed += d.amount
    else if (d.stage === 'paid') paid += d.amount
  }
  return { signed: round2(signed), paid: round2(paid), total: round2(signed + paid) }
}

/** The event's start date in the company's timezone. */
export function eventStartDate(e: Pick<Tenant<EventRecord>, 'startsAt' | 'companyId'>): string {
  return zonedParts(e.startsAt, companyById(e.companyId)?.regional.timezone ?? 'Asia/Dubai').date
}

/* ---------------- Seed ---------------- */


type SeedPackage = [name: string, price: number, quantity: number, benefits: string[], deliverables: [title: string, offset: number][]]
type SeedDeal = [pkg: number, org: 'lead' | 'customer', orgIndex: number, stage: SponsorStage, amount: number | null, ownerId: string, extra?: { lostReason?: string; paidDaysAgo?: number; expectedIn?: number; done?: number }]

function seedSponsors(eventId: string, pkgs: SeedPackage[], deals: SeedDeal[]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e || sponsorPackages.some((p) => p.eventId === eventId)) return
  const co = e.companyId
  const tz = companyById(co)?.regional.timezone ?? 'Asia/Dubai'
  const today = todayIsoIn(tz)
  const currency = companyById(co)?.regional.currency ?? 'AED'
  const start = eventStartDate(e)
  const seedAt = new Date().toISOString()
  const ids = pkgs.map(([name, price, quantity, benefits, deliverables], i) => {
    const id = `ESP-${eventId.slice(3)}-${i + 1}`
    sponsorPackages.push({
      companyId: co, id, eventId, name, price, currency, quantity, benefits, sortOrder: i + 1,
      deliverables: deliverables.map(([title, offsetDays]) => ({ title, offsetDays })),
      createdAt: e.createdAt, updatedAt: e.createdAt,
    })
    return id
  })
  const coLeads = leads.filter((l) => l.companyId === co)
  const coCustomers = customers.filter((c) => c.companyId === co)
  deals.forEach(([pkgIndex, org, orgIndex, stage, amount, ownerId, extra = {}], i) => {
    const pkg = sponsorPackages.find((p) => p.id === ids[pkgIndex])!
    const customer = org === 'customer' ? coCustomers[orgIndex % Math.max(1, coCustomers.length)] : undefined
    const lead = customer ? undefined : coLeads[orgIndex % coLeads.length]
    const id = `ESD-${eventId.slice(3)}-${i + 1}`
    const won = stage === 'signed' || stage === 'paid'
    sponsorDeals.push({
      companyId: co,
      id,
      eventId,
      packageId: pkg.id,
      leadId: lead?.id ?? null,
      customerId: customer?.id ?? null,
      organizationName: customer?.name ?? lead?.company ?? 'Sponsor',
      contactName: lead?.contactName ?? '',
      contactEmail: lead?.contactEmail ?? '',
      amount: amount ?? pkg.price,
      stage,
      lostReason: extra.lostReason ?? '',
      ownerId,
      expectedPaymentDate: extra.expectedIn !== undefined ? addDaysIso(today, extra.expectedIn) : null,
      actualPaymentDate: extra.paidDaysAgo !== undefined ? addDaysIso(today, -extra.paidDaysAgo) : null,
      notes: '',
      signedAt: won ? e.createdAt : null,
      createdBy: ownerId,
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
    })
    if (!won) return
    pkg.deliverables.forEach((t, k) => {
      const dueDate = addDaysIso(start, t.offsetDays)
      const status: DeliverableStatus = k < (extra.done ?? 0) ? 'done' : k === (extra.done ?? 0) ? 'in_progress' : 'todo'
      sponsorDeliverables.push({
        companyId: co,
        id: `ESV-${id.slice(4)}-${k + 1}`,
        eventId,
        dealId: id,
        title: t.title,
        offsetDays: t.offsetDays,
        dueDate,
        status,
        ownerId,
        taskId: null,
        // Seeded deliverables already overdue count as notified (the demo starts without a burst of notices).
        overdueNotifiedAt: status !== 'done' && dueDate < today ? seedAt : null,
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
      })
    })
  })
}


// Apex: the Dubai Business Breakfast (EV-1003, organized, in 6 days).
seedSponsors(
  'EV-1003',
  [
    ['Platinum', 25000, 1, ['Opening keynote slot (10 min)', 'Logo on every screen and the invitation', '6 guest seats'], [['Logo received', -21], ['Talk slot confirmed', -10], ['Social media mentions', -7], ['Banner printed', -3]]],
    ['Gold', 15000, 2, ['Logo on the invitation', 'Table branding', '4 guest seats'], [['Logo received', -14], ['Social media mention', -5], ['Banner printed', -3]]],
    ['Exhibitor table', 4000, 4, ['Display table in the foyer', '2 guest seats'], [['Logo received', -10], ['Stand allocated', -5]]],
  ],
  [
    [0, 'lead', 0, 'paid', null, 'u7', { paidDaysAgo: 5, done: 2 }],
    [1, 'customer', 0, 'signed', 13500, 'u7', { expectedIn: 10, done: 1 }],
    [1, 'lead', 1, 'negotiating', null, 'u6', { expectedIn: 20 }],
    [2, 'customer', 1, 'signed', null, 'u6', { expectedIn: 3, done: 0 }],
    [2, 'lead', 2, 'proposal_sent', null, 'u6'],
    [2, 'lead', 3, 'contacted', null, 'u7'],
    [2, 'lead', 4, 'prospect', null, 'u7'],
    [1, 'lead', 5, 'lost', null, 'u6', { lostReason: 'Sponsorship budget moved to next quarter' }],
  ],
)

// Crest: its own partner day (EV-5101, organized, in 60 days).
seedSponsors(
  'EV-5101',
  [
    ['Title sponsor', 120000, 1, ['Naming on the event', 'Keynote panel seat', 'Premium exhibitor space (36 m²)'], [['Logo received', -45], ['Keynote speaker confirmed', -30], ['Exhibitor space allocated', -14], ['Banner and signage printed', -5]]],
    ['Gold partner', 60000, 2, ['Panel seat', 'Exhibitor space (18 m²)'], [['Logo received', -30], ['Exhibitor space allocated', -14]]],
    ['Exhibitor space', 15000, 8, ['Exhibitor space (9 m²)', 'Listing in the partner guide'], [['Company profile received', -21], ['Stand allocated', -10]]],
  ],
  [
    [0, 'lead', 0, 'negotiating', null, 'u102', { expectedIn: 25 }],
    [1, 'customer', 0, 'signed', 55000, 'u102', { expectedIn: 15, done: 0 }],
    [2, 'lead', 1, 'paid', null, 'u104', { paidDaysAgo: 3, done: 1 }],
    [2, 'lead', 2, 'prospect', null, 'u104'],
  ],
)
