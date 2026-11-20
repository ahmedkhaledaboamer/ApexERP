import { events } from '@/shared/mocks/data/events'
import { eventSpeakers } from '@/shared/mocks/data/eventExtras'
import { eventVendors, eventVenues, speakerDirectory } from '@/shared/mocks/data/eventLibrary'
import { adminToken, api, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of the event libraries (handlers/eventLibrary.ts: speaker directory, venues,
 * vendors), spread into ENDPOINTS (endpoints.ts). Samples name the company's own seed rows (as the company
 * admin, marketing full) or create fresh ones through the API (deletes).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const ownCount = <T extends { companyId: string }>(rows: readonly T[]) => (co: Co) => rows.filter((r) => r.companyId === co).length
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}

async function created(co: Co, path: string, body: unknown): Promise<string> {
  const r = await api(adminToken(co), 'POST', path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: POST ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id as string
}

/** A speaker on a completed event's agenda (rating sample). */
const ratedSpeaker = (co: Co) => {
  const link = first(eventSpeakers, co, 'speaker on a completed event', (l) => events.some((e) => e.id === l.eventId && e.status === 'completed'))
  return { speakerId: link.speakerId, eventId: link.eventId }
}
const speaker = (co: Co) => first(speakerDirectory, co, 'directory speaker').id
const venue = (co: Co) => first(eventVenues, co, 'venue', (v) => v.status === 'active').id
const vendor = (co: Co) => first(eventVendors, co, 'vendor with reviews', (v) => v.reviews.length > 0)
const mobile = (co: Co) => (co === 'co_apex' ? '+971 50 555 0199' : '+966 55 555 0199')

export const EVENT_LIBRARY_ENDPOINTS: Endpoint[] = [
  /* ---- speaker directory ---- */
  { method: 'GET', path: '/event-speakers', kind: 'company-list', module: 'events', sample: () => ({}), count: { of: len, expected: ownCount(speakerDirectory) } },
  {
    method: 'POST', path: '/event-speakers', kind: 'company-write', module: 'events',
    sample: (co) => ({ body: { name: `Iso Speaker ${uniq()}`, company: 'Iso Talks', email: `iso-${uniq()}@speakers.test`, mobile: mobile(co), topics: ['Isolation'] } }),
  },
  { method: 'GET', path: '/event-speakers/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: speaker(co) } }) },
  { method: 'PATCH', path: '/event-speakers/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: speaker(co) }, body: { notes: 'Isolation note' } }) },
  { method: 'DELETE', path: '/event-speakers/:id', kind: 'company-item', module: 'events', sample: async (co) => ({ params: { id: await created(co, '/event-speakers', { name: `Iso Delete ${uniq()}`, company: 'Iso' }) } }) },
  {
    method: 'POST', path: '/event-speakers/:id/ratings', kind: 'company-item', module: 'events',
    sample: (co) => ({ params: { id: ratedSpeaker(co).speakerId }, body: { event_id: ratedSpeaker(co).eventId, rating: 4, note: 'Isolation rating' } }),
  },
  /* ---- venues ---- */
  { method: 'GET', path: '/event-venues', kind: 'company-list', module: 'events', sample: () => ({}), count: { of: len, expected: ownCount(eventVenues) } },
  {
    method: 'POST', path: '/event-venues', kind: 'company-write', module: 'events',
    sample: (co) => ({ body: { name: `Iso Venue ${uniq()}`, type: 'hotel', city: 'Iso City', capacity: 80, rooms: [{ name: 'Iso room', capacity: 40 }], contact_mobile: mobile(co) } }),
  },
  { method: 'GET', path: '/event-venues/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: venue(co) } }) },
  { method: 'PATCH', path: '/event-venues/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: venue(co) }, body: { notes: 'Isolation note' } }) },
  { method: 'DELETE', path: '/event-venues/:id', kind: 'company-item', module: 'events', sample: async (co) => ({ params: { id: await created(co, '/event-venues', { name: `Iso Delete ${uniq()}`, type: 'other' }) } }) },
  /* ---- vendors ---- */
  { method: 'GET', path: '/event-vendors', kind: 'company-list', module: 'events', sample: () => ({}), count: { of: len, expected: ownCount(eventVendors) } },
  {
    method: 'POST', path: '/event-vendors', kind: 'company-write', module: 'events',
    sample: (co) => ({ body: { category: 'printing', name: `Iso Vendor ${uniq()}`, mobile: mobile(co), documents: [{ name: 'Licence', url: 'https://iso.test/licence.pdf' }] } }),
  },
  { method: 'GET', path: '/event-vendors/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: vendor(co).id } }) },
  { method: 'PATCH', path: '/event-vendors/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: vendor(co).id }, body: { payment_terms: 'Isolation terms' } }) },
  { method: 'DELETE', path: '/event-vendors/:id', kind: 'company-item', module: 'events', sample: async (co) => ({ params: { id: await created(co, '/event-vendors', { name: `Iso Delete ${uniq()}`, category: 'other' }) } }) },
  {
    method: 'POST', path: '/event-vendors/:id/reviews', kind: 'company-item', module: 'events',
    sample: (co) => ({ params: { id: vendor(co).id }, body: { event_id: vendor(co).reviews[0].eventId, rating: 5, notes: 'Isolation review' } }),
  },
]
