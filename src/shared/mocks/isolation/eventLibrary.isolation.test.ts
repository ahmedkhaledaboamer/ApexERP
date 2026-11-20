import { describe, expect, it } from 'vitest'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventSpeakers } from '@/shared/mocks/data/eventExtras'
import { eventVendors, eventVenues, speakerDirectory } from '@/shared/mocks/data/eventLibrary'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { COMPANIES, adminToken, api, label, leaksIn, other, sliceText, useSeedPerTest, type Co } from './harness'

/**
 * Event libraries (speakers directory, venues, vendors): ids of the OTHER company inside a body behave exactly
 * like ids that don't exist (same status, same body), nothing of theirs changes and nothing of theirs leaks.
 * Lists hold own rows only (also covered by the endpoint table's counts); duplicate-name checks are per company.
 */

useSeedPerTest()

const one = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true): T => {
  const r = rows.find((x) => x.companyId === co && pred(x))
  if (!r) throw new Error(`no row in ${co}`)
  return r
}
const openEvent = (co: Co) => one(events, co, (e) => e.status === 'confirmed').id
const completedWithVendor = (co: Co) => one(eventBudgetLines, co, (l) => !!l.vendorId && events.some((e) => e.id === l.eventId && e.status === 'completed'))
const day = '2027-06-01'

interface Ref {
  name: string
  method: string
  path: (co: Co) => string
  body: (co: Co, id: string) => unknown
  id: (co: Co) => string
}

const REFS: Ref[] = [
  { name: 'event venue on create', method: 'POST', path: () => '/events', id: (co) => one(eventVenues, co, (v) => v.status === 'active').id, body: (_co, id) => ({ name: 'Ref event', type: 'meeting', start_date: day, venue_id: id }) },
  { name: 'event venue on edit', method: 'PATCH', path: (co) => `/events/${openEvent(co)}`, id: (co) => one(eventVenues, co, (v) => v.status === 'active').id, body: (_co, id) => ({ venue_id: id }) },
  { name: 'agenda pick speaker', method: 'POST', path: (co) => `/events/${openEvent(co)}/speakers`, id: (co) => one(speakerDirectory, co).id, body: (_co, id) => ({ speaker_id: id }) },
  { name: 'session speaker', method: 'POST', path: (co) => `/events/${openEvent(co)}/sessions`, id: (co) => one(speakerDirectory, co).id, body: (_co, id) => ({ title: 'Ref', date: day, start_time: '10:00', end_time: '10:30', speaker_ids: [id] }) },
  { name: 'budget line vendor', method: 'POST', path: (co) => `/events/${openEvent(co)}/budget-lines`, id: (co) => one(eventVendors, co, (v) => v.status !== 'blacklisted').id, body: (_co, id) => ({ category: 'printing', planned: 10, vendor_id: id }) },
  { name: 'speaker rating event', method: 'POST', path: (co) => `/event-speakers/${one(eventSpeakers, co, (l) => events.some((e) => e.id === l.eventId && e.status === 'completed')).speakerId}/ratings`, id: (co) => one(events, co, (e) => e.status === 'completed').id, body: (_co, id) => ({ event_id: id, rating: 4 }) },
  { name: 'vendor review event', method: 'POST', path: (co) => `/event-vendors/${completedWithVendor(co).vendorId}/reviews`, id: (co) => completedWithVendor(co).eventId, body: (_co, id) => ({ event_id: id, rating: 4 }) },
  { name: 'internal speaker employee', method: 'POST', path: () => '/event-speakers', id: (co) => (co === 'co_apex' ? 'u7' : 'u103'), body: (_co, id) => ({ name: 'Ref Internal', kind: 'internal', user_id: id }) },
]

describe('Event libraries: ids of the other company in a body behave like ids that don’t exist', () => {
  for (const ref of REFS) {
    for (const co of COMPANIES) {
      const them = other(co)
      it(`${label(co)}: ${ref.name} with a ${label(them)} id`, async () => {
        const foreignId = ref.id(them)
        const missingId = 'zz-missing-ref'
        const send = (id: string) => api(adminToken(co), ref.method, ref.path(co), { body: ref.body(co, id) })
        const start = takeSnapshot(true)
        const before = sliceText(them)
        const theirs = await send(foreignId)
        expect(sliceText(them), `${ref.name}: ${label(them)} data changed`).toBe(before)
        expect(leaksIn(theirs.body, co), ref.name).toEqual([])
        expect(restoreSnapshot(start)).toBe(true)
        const missing = await send(missingId)
        expect(theirs.status, `${ref.name}: foreign ${theirs.text} vs missing ${missing.text}`).toBe(missing.status)
        expect(theirs.text.split(foreignId).join('<id>'), ref.name).toBe(missing.text.split(missingId).join('<id>'))
      })
    }
  }
})

describe('Event libraries: lists and uniqueness are per company', () => {
  for (const co of COMPANIES) {
    it(`${label(co)}: lists hold own rows only; a name taken in the other company is free here`, async () => {
      const them = other(co)
      for (const [path, rows] of [['/event-speakers', speakerDirectory], ['/event-venues', eventVenues], ['/event-vendors', eventVendors]] as const) {
        const r = await api(adminToken(co), 'GET', path)
        expect(r.status).toBe(200)
        expect((r.body as { id: string }[]).map((x) => x.id).sort()).toEqual(rows.filter((x) => x.companyId === co).map((x) => x.id).sort())
        expect(leaksIn(r.body, co), path).toEqual([])
      }
      const venue = await api(adminToken(co), 'POST', '/event-venues', { body: { name: one(eventVenues, them).name } })
      expect(venue.status, venue.text).toBe(200)
      const v = one(eventVendors, them)
      const vendor = await api(adminToken(co), 'POST', '/event-vendors', { body: { name: v.name, category: v.category } })
      expect(vendor.status, vendor.text).toBe(200)
      const s = one(speakerDirectory, them)
      const speaker = await api(adminToken(co), 'POST', '/event-speakers', { body: { name: s.name, company: s.company, email: s.email } })
      expect(speaker.status, speaker.text).toBe(200)
    })
  }
})
