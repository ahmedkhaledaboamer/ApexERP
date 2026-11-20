import { events } from '@/shared/mocks/data/events'
import { sponsorDeals, sponsorDeliverables, sponsorPackages } from '@/shared/mocks/data/eventSponsors'
import { eventDeadlines, eventShipments, eventTrips } from '@/shared/mocks/data/eventLogistics'
import { companyById } from '@/shared/mocks/data/tenancy'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { ADMIN, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Sponsors & exhibitors and Travel & logistics (handlers/eventSponsorsLogistics.ts),
 * spread into ENDPOINTS (endpoints.ts). Samples name the company's own seed rows (Apex: EV-1003 sponsors,
 * EV-1101 trips; Crest: EV-5101 sponsors, EV-5002 trips); writes act as the company admin (marketing full).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}
const live = (co: Co) => new Set(events.filter((e) => e.companyId === co && e.status !== 'cancelled').map((e) => e.id))
const day = (co: Co, n: number) => addDaysIso(todayIsoIn(companyById(co)?.regional.timezone ?? 'Asia/Dubai'), n)

const pkg = (co: Co) => first(sponsorPackages, co, 'sponsor package')
const deal = (co: Co) => first(sponsorDeals, co, 'sponsor deal')
const openDeal = (co: Co) => first(sponsorDeals, co, 'prospect sponsor', (d) => d.stage === 'prospect')
const deliverable = (co: Co) => first(sponsorDeliverables, co, 'sponsor deliverable')
const trip = (co: Co) => first(eventTrips, co, 'trip')
const shipment = (co: Co) => first(eventShipments, co, 'shipment')
const deadline = (co: Co) => first(eventDeadlines, co, 'deadline')

export const SPONSORS_LOGISTICS_ENDPOINTS: Endpoint[] = [
  /* ---- sponsors & exhibitors ---- */
  {
    method: 'GET', path: '/events/sponsors', kind: 'company-list', module: 'events', sample: () => ({}),
    count: { of: (b) => ((b as { deals?: unknown[] })?.deals ?? []).length, expected: (co) => sponsorDeals.filter((d) => d.companyId === co && live(co).has(d.eventId)).length },
  },
  { method: 'GET', path: '/events/sponsor-organizations', kind: 'company-search', module: 'events', sample: () => ({ query: { q: '' } }) },
  { method: 'GET', path: '/events/:id/sponsorship', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pkg(co).eventId } }) },
  { method: 'POST', path: '/events/:id/sponsor-packages', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pkg(co).eventId }, body: { name: `Iso package ${uniq()}`, price: 1000, quantity: 2, benefits: ['Iso benefit'], deliverables: [{ title: 'Iso logo', offset_days: -3 }] } }) },
  { method: 'PATCH', path: '/events/:id/sponsor-packages/:packageId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pkg(co).eventId, packageId: pkg(co).id }, body: { benefits: ['Isolation benefit'] } }) },
  { method: 'DELETE', path: '/events/:id/sponsor-packages/:packageId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pkg(co).eventId, packageId: pkg(co).id }, expect: 409 }), note: 'Sponsors use the seeded package: 409 package_in_use (the isolation checks still run).' },
  {
    method: 'POST', path: '/events/:id/sponsors', kind: 'company-item', module: 'events',
    sample: (co) => { const u = uniq(); return { params: { id: pkg(co).eventId }, body: { package_id: pkg(co).id, new_lead: { company: `Iso Sponsor ${u}`, contact_name: 'Iso Contact', email: `iso-sponsor-${u}@iso-sponsor-${u}.test` } } } },
  },
  { method: 'GET', path: '/events/:id/sponsors/:sponsorId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: deal(co).eventId, sponsorId: deal(co).id } }) },
  { method: 'PATCH', path: '/events/:id/sponsors/:sponsorId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: deal(co).eventId, sponsorId: deal(co).id }, body: { notes: 'Isolation note' } }) },
  { method: 'DELETE', path: '/events/:id/sponsors/:sponsorId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openDeal(co).eventId, sponsorId: openDeal(co).id } }) },
  { method: 'POST', path: '/events/:id/sponsors/:sponsorId/stage', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openDeal(co).eventId, sponsorId: openDeal(co).id }, body: { stage: 'contacted' } }) },
  {
    method: 'PATCH', path: '/events/:id/sponsors/:sponsorId/deliverables/:deliverableId', kind: 'company-item', module: 'events',
    sample: (co) => ({ params: { id: deliverable(co).eventId, sponsorId: deliverable(co).dealId, deliverableId: deliverable(co).id }, body: { status: 'done' } }),
  },
  {
    method: 'POST', path: '/events/:id/sponsors/:sponsorId/deliverables/:deliverableId/task', kind: 'company-item', module: 'events',
    sample: (co) => ({ params: { id: deliverable(co).eventId, sponsorId: deliverable(co).dealId, deliverableId: deliverable(co).id } }),
  },
  /* ---- travel & logistics ---- */
  {
    method: 'GET', path: '/events/logistics', kind: 'company-list', module: 'events', sample: () => ({}),
    count: { of: (b) => ((b as { trips?: unknown[] })?.trips ?? []).length, expected: (co) => eventTrips.filter((t) => t.companyId === co && live(co).has(t.eventId)).length },
  },
  { method: 'GET', path: '/events/:id/logistics', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: trip(co).eventId } }) },
  {
    method: 'POST', path: '/events/:id/trips', kind: 'company-item', module: 'events',
    sample: (co) => ({ params: { id: trip(co).eventId }, body: { user_id: ADMIN[co], flight_from: 'ISO', flight_to: 'LAT', flight_cost: 100, visa_required: true, visa_status: 'applied', visa_number: 'ISO99887766' } }),
  },
  { method: 'PATCH', path: '/events/:id/trips/:tripId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: trip(co).eventId, tripId: trip(co).id }, body: { hotel_cost: 999 } }) },
  { method: 'DELETE', path: '/events/:id/trips/:tripId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: trip(co).eventId, tripId: trip(co).id } }) },
  { method: 'POST', path: '/events/:id/shipments', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: shipment(co).eventId }, body: { items: 'Isolation crate', vendor_name: 'Iso Freight', cost: 50 } }) },
  { method: 'PATCH', path: '/events/:id/shipments/:shipmentId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: shipment(co).eventId, shipmentId: shipment(co).id }, body: { status: 'in_transit' } }) },
  { method: 'DELETE', path: '/events/:id/shipments/:shipmentId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: shipment(co).eventId, shipmentId: shipment(co).id } }) },
  { method: 'POST', path: '/events/:id/deadlines', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: deadline(co).eventId }, body: { title: 'Isolation deadline', due_date: day(co, 9) } }) },
  { method: 'PATCH', path: '/events/:id/deadlines/:deadlineId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: deadline(co).eventId, deadlineId: deadline(co).id }, body: { done: true } }) },
  { method: 'DELETE', path: '/events/:id/deadlines/:deadlineId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: deadline(co).eventId, deadlineId: deadline(co).id } }) },
]
