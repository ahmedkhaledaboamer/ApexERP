import type { User } from '@/shared/types'
import type {
  Speaker,
  SpeakerDetail,
  SpeakerInput,
  SpeakerRatingInput,
  Vendor,
  VendorDetail,
  VendorInput,
  VendorReviewInput,
  Venue,
  VenueDetail,
  VenueEventEntry,
  VenueInput,
} from '@/modules/events/libraryTypes'
import { vendorSpend } from '@/modules/events/lib/library'
import { zonedParts } from '@/shared/lib/zonedTime'
import { events, type EventRecord } from '@/shared/mocks/data/events'
import { eventSessions, eventSpeakers } from '@/shared/mocks/data/eventExtras'
import { eventVendors, eventVenues, speakerDirectory } from '@/shared/mocks/data/eventLibrary'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { canManageEvent, canSeeEvent } from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { attendeesOf, localOf, tzOf } from '@/shared/mocks/services/events'
import {
  cleanSpeaker,
  cleanVendor,
  cleanVenue,
  findSameSpeaker,
  requireManage,
  requireRead,
  speakerView,
  vendorLines,
  vendorView,
  venueView,
} from '@/shared/mocks/services/eventLibraryCore'

/**
 * Speakers directory, venues and vendors (docs/API.md › Events › Speakers, venues & vendors).
 * Company-wide libraries under `/event-speakers`, `/event-venues`, `/event-vendors` (plan module `events`).
 *   read   marketing full / view + anyone on an event's team (they pick from the libraries in their events)
 *   manage marketing full (create, edit, delete when unused, archive venues, blacklist vendors)
 *   rate   the event's owner or marketing full, after the event (status completed): speakers they had on the
 *          agenda, vendors with budget lines on the event (one rating per event, re-rating replaces it)
 * Details list only the events the caller can see (the rest are counted in `hidden_events`).
 */

let seq = 0
const nextId = (prefix: string) => `${prefix}-${nowMs().toString(36)}${(++seq).toString(36)}`
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

const SPEAKER_NOT_FOUND = 'That speaker doesn’t exist.'
const VENUE_NOT_FOUND = 'That venue doesn’t exist.'
const VENDOR_NOT_FOUND = 'That vendor doesn’t exist.'

const eventName = (companyId: string, id: string) => events.find((e) => e.id === id && e.companyId === companyId)?.name ?? '—'

/** An event of the caller's company named in a body (foreign = missing → 422), which the caller may rate for. */
async function ratableEvent(user: User, eventId: unknown): Promise<Tenant<EventRecord>> {
  const e = findInTenant(events, user, (x) => x.id === str(eventId))
  if (!e || !canSeeEvent(user, e)) return fail('That event doesn’t exist.', 422)
  if (!canManageEvent(user, e)) return fail('Only the event owner or a marketing manager can rate for this event.', 403)
  if (e.status !== 'completed') return fail('Rate after the event: mark the event completed first.', 422)
  return e
}

function ratingOf(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/* ---------------- Speakers ---------------- */

export async function listSpeakers(user: User): Promise<Speaker[]> {
  requireRead(user)
  return delay(speakerDirectory.filter((s) => s.companyId === tenantOf(user)).sort(byName).map(speakerView))
}

function speakerFor(user: User, id: string) {
  return findInTenant(speakerDirectory, user, (s) => s.id === id)
}

export async function getSpeaker(user: User, id: string): Promise<SpeakerDetail> {
  const access = requireRead(user)
  const s = speakerFor(user, id)
  if (!s) return fail(SPEAKER_NOT_FOUND, 404)
  const tz = tzOf(s.companyId)
  const eventIds = [...new Set(eventSpeakers.filter((l) => l.companyId === s.companyId && l.speakerId === s.id).map((l) => l.eventId))]
  const linked = eventIds.map((eid) => events.find((e) => e.id === eid && e.companyId === s.companyId)).filter((e): e is Tenant<EventRecord> => !!e)
  const visible = linked.filter((e) => canSeeEvent(user, e)).sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return delay({
    ...speakerView(s),
    events: visible.map((e) => ({
      eventId: e.id,
      eventName: e.name,
      startDate: localOf(e).startDate,
      status: e.status,
      sessions: eventSessions
        .filter((x) => x.companyId === e.companyId && x.eventId === e.id && x.speakerIds.includes(s.id))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((x) => ({ id: x.id, title: x.title, date: zonedParts(x.startsAt, tz).date, startTime: zonedParts(x.startsAt, tz).time, endTime: zonedParts(x.endsAt, tz).time })),
      rating: s.ratings.find((r) => r.eventId === e.id)?.rating ?? null,
      canRate: e.status === 'completed' && canManageEvent(user, e),
    })),
    hiddenEvents: linked.length - visible.length,
    ratings: s.ratings
      .filter((r) => visible.some((e) => e.id === r.eventId))
      .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))
      .map((r) => ({ eventId: r.eventId, eventName: eventName(s.companyId, r.eventId), rating: r.rating, note: r.note, ratedByName: r.ratedBy ? ownerName(r.ratedBy) : '', ratedAt: r.ratedAt })),
    canManage: access === 'manage',
  })
}

export async function createSpeaker(user: User, input: Partial<SpeakerInput> | null): Promise<Speaker> {
  requireManage(user)
  const co = tenantOf(user)
  const clean = cleanSpeaker(co, input)
  if (typeof clean === 'string') return fail(clean, 422)
  const same = findSameSpeaker(co, clean)
  if (same) throw new CodedApiError(`${same.name} is already in the directory${same.email ? ` (${same.email})` : ''}.`, 409, 'speaker_exists', { speakerId: same.id })
  const now = nowIso()
  const row: Tenant<typeof speakerDirectory[number]> = { companyId: co, id: nextId('SPK'), ...clean, ratings: [], createdBy: user.id, createdAt: now, updatedAt: now }
  speakerDirectory.push(row)
  return delay(speakerView(row))
}

export async function updateSpeaker(user: User, id: string, input: Partial<SpeakerInput> | null): Promise<Speaker> {
  requireManage(user)
  const s = speakerFor(user, id)
  if (!s) return fail(SPEAKER_NOT_FOUND, 404)
  const clean = cleanSpeaker(s.companyId, input, s)
  if (typeof clean === 'string') return fail(clean, 422)
  const same = findSameSpeaker(s.companyId, clean, s.id)
  if (same) throw new CodedApiError(`${same.name} is already in the directory.`, 409, 'speaker_exists', { speakerId: same.id })
  Object.assign(s, clean, { updatedAt: nowIso() })
  return delay(speakerView(s))
}

/** Delete: only a speaker on no event (else 409 `speaker_in_use`; take them off the agendas first). */
export async function deleteSpeaker(user: User, id: string): Promise<{ deleted: true }> {
  requireManage(user)
  const s = speakerFor(user, id)
  if (!s) return fail(SPEAKER_NOT_FOUND, 404)
  const used = eventSpeakers.filter((l) => l.companyId === s.companyId && l.speakerId === s.id).length
  if (used) throw new CodedApiError(`${s.name} is on ${used} event${used === 1 ? '' : 's'}; remove them from those agendas first.`, 409, 'speaker_in_use')
  speakerDirectory.splice(speakerDirectory.indexOf(s), 1)
  return delay({ deleted: true as const })
}

/** POST /event-speakers/:id/ratings { event_id, rating 1–5, note? } — after a completed event they spoke at. */
export async function rateSpeaker(user: User, id: string, input: Partial<SpeakerRatingInput> | null): Promise<SpeakerDetail> {
  requireRead(user)
  const s = speakerFor(user, id)
  if (!s) return fail(SPEAKER_NOT_FOUND, 404)
  const e = await ratableEvent(user, input?.eventId)
  if (!eventSpeakers.some((l) => l.companyId === e.companyId && l.eventId === e.id && l.speakerId === s.id)) return fail(`${s.name} isn’t on this event’s agenda.`, 422)
  const rating = ratingOf(input?.rating)
  if (rating === null) return fail('A rating is a whole number from 1 to 5.', 422)
  const note = str(input?.note)
  if (note.length > 1000) return fail('Keep the note under 1,000 characters.', 422)
  s.ratings = [...s.ratings.filter((r) => r.eventId !== e.id), { eventId: e.id, rating, note, ratedBy: user.id, ratedAt: nowIso() }]
  s.updatedAt = nowIso()
  return getSpeaker(user, s.id)
}

/* ---------------- Venues ---------------- */

export async function listVenues(user: User): Promise<Venue[]> {
  requireRead(user)
  return delay(eventVenues.filter((v) => v.companyId === tenantOf(user)).sort(byName).map(venueView))
}

function venueFor(user: User, id: string) {
  return findInTenant(eventVenues, user, (v) => v.id === id)
}

function nameTaken<T extends { companyId: string; id: string; name: string }>(rows: readonly T[], companyId: string, name: string, exceptId?: string): T | undefined {
  return rows.find((r) => r.companyId === companyId && r.id !== exceptId && r.name.trim().toLowerCase() === name.toLowerCase())
}

export async function getVenue(user: User, id: string): Promise<VenueDetail> {
  const access = requireRead(user)
  const v = venueFor(user, id)
  if (!v) return fail(VENUE_NOT_FOUND, 404)
  const today = companyDayOf(v.companyId).today
  const linked = events.filter((e) => e.companyId === v.companyId && e.venueId === v.id)
  const visible = linked.filter((e) => canSeeEvent(user, e))
  const entries: VenueEventEntry[] = visible.map((e) => {
    const local = localOf(e)
    const atts = attendeesOf(e).filter((a) => a.status === 'registered')
    return {
      eventId: e.id,
      eventName: e.name,
      startDate: local.startDate,
      endDate: local.endDate,
      status: e.status,
      attendeeCount: atts.length,
      checkedInCount: atts.filter((a) => a.checkedInAt).length,
      capacity: e.capacity,
      upcoming: e.status !== 'completed' && local.endDate >= today,
    }
  })
  const past = entries.filter((x) => !x.upcoming).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const upcoming = entries.filter((x) => x.upcoming).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const attended = past.filter((x) => x.status !== 'cancelled').map((x) => (x.checkedInCount > 0 ? x.checkedInCount : x.attendeeCount))
  return delay({
    ...venueView(v),
    past,
    upcoming,
    hiddenEvents: linked.length - visible.length,
    averageAttendance: attended.length ? Math.round(attended.reduce((s, n) => s + n, 0) / attended.length) : null,
    canManage: access === 'manage',
  })
}

export async function createVenue(user: User, input: Partial<VenueInput> | null): Promise<Venue> {
  requireManage(user)
  const co = tenantOf(user)
  const clean = cleanVenue(co, input, undefined, () => nextId('VRM'))
  if (typeof clean === 'string') return fail(clean, 422)
  if (nameTaken(eventVenues, co, clean.name)) throw new CodedApiError(`A venue named ${clean.name} already exists.`, 409, 'venue_exists')
  const now = nowIso()
  const row = { companyId: co, id: nextId('VEN'), ...clean, createdBy: user.id, createdAt: now, updatedAt: now }
  eventVenues.push(row)
  return delay(venueView(row))
}

export async function updateVenue(user: User, id: string, input: Partial<VenueInput> | null): Promise<Venue> {
  requireManage(user)
  const v = venueFor(user, id)
  if (!v) return fail(VENUE_NOT_FOUND, 404)
  const clean = cleanVenue(v.companyId, input, v, () => nextId('VRM'))
  if (typeof clean === 'string') return fail(clean, 422)
  if (nameTaken(eventVenues, v.companyId, clean.name, v.id)) throw new CodedApiError(`A venue named ${clean.name} already exists.`, 409, 'venue_exists')
  Object.assign(v, clean, { updatedAt: nowIso() })
  return delay(venueView(v))
}

/** Delete: only a venue no event uses (else 409 `venue_in_use`: archive it instead). */
export async function deleteVenue(user: User, id: string): Promise<{ deleted: true }> {
  requireManage(user)
  const v = venueFor(user, id)
  if (!v) return fail(VENUE_NOT_FOUND, 404)
  const used = events.filter((e) => e.companyId === v.companyId && e.venueId === v.id).length
  if (used) throw new CodedApiError(`${used} event${used === 1 ? ' uses' : 's use'} ${v.name}; archive it instead.`, 409, 'venue_in_use')
  eventVenues.splice(eventVenues.indexOf(v), 1)
  return delay({ deleted: true as const })
}

/* ---------------- Vendors ---------------- */

export async function listVendors(user: User): Promise<Vendor[]> {
  requireRead(user)
  return delay(eventVendors.filter((v) => v.companyId === tenantOf(user)).sort(byName).map(vendorView))
}

function vendorFor(user: User, id: string) {
  return findInTenant(eventVendors, user, (v) => v.id === id)
}

export async function getVendor(user: User, id: string): Promise<VendorDetail> {
  const access = requireRead(user)
  const v = vendorFor(user, id)
  if (!v) return fail(VENDOR_NOT_FOUND, 404)
  const lines = vendorLines(v)
  const { perEvent, totalPlanned } = vendorSpend(lines)
  const linked = [...perEvent.keys()].map((eid) => events.find((e) => e.id === eid && e.companyId === v.companyId)).filter((e): e is Tenant<EventRecord> => !!e)
  const visible = linked.filter((e) => canSeeEvent(user, e)).sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return delay({
    ...vendorView(v),
    totalPlanned,
    spend: visible.map((e) => {
      const row = perEvent.get(e.id)!
      const review = v.reviews.find((r) => r.eventId === e.id)
      return {
        eventId: e.id,
        eventName: e.name,
        startDate: localOf(e).startDate,
        status: e.status,
        ...row,
        rating: review?.rating ?? null,
        needsRating: e.status === 'completed' && !review,
        canRate: e.status === 'completed' && canManageEvent(user, e),
      }
    }),
    hiddenEvents: linked.length - visible.length,
    reviews: v.reviews
      .filter((r) => visible.some((e) => e.id === r.eventId))
      .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))
      .map((r) => ({ id: r.id, eventId: r.eventId, eventName: eventName(v.companyId, r.eventId), rating: r.rating, notes: r.notes, ratedByName: r.ratedBy ? ownerName(r.ratedBy) : '', ratedAt: r.ratedAt })),
    canManage: access === 'manage',
  })
}

export async function createVendor(user: User, input: Partial<VendorInput> | null): Promise<Vendor> {
  requireManage(user)
  const co = tenantOf(user)
  const clean = cleanVendor(co, input, undefined, () => nextId('VDOC'))
  if (typeof clean === 'string') return fail(clean, 422)
  if (nameTaken(eventVendors, co, clean.name)) throw new CodedApiError(`A vendor named ${clean.name} already exists.`, 409, 'vendor_exists')
  const now = nowIso()
  const row = { companyId: co, id: nextId('VND'), ...clean, reviews: [], createdBy: user.id, createdAt: now, updatedAt: now }
  eventVendors.push(row)
  return delay(vendorView(row))
}

export async function updateVendor(user: User, id: string, input: Partial<VendorInput> | null): Promise<Vendor> {
  requireManage(user)
  const v = vendorFor(user, id)
  if (!v) return fail(VENDOR_NOT_FOUND, 404)
  const clean = cleanVendor(v.companyId, input, v, () => nextId('VDOC'))
  if (typeof clean === 'string') return fail(clean, 422)
  if (nameTaken(eventVendors, v.companyId, clean.name, v.id)) throw new CodedApiError(`A vendor named ${clean.name} already exists.`, 409, 'vendor_exists')
  Object.assign(v, clean, { updatedAt: nowIso() })
  return delay(vendorView(v))
}

/** Delete: only a vendor with no budget lines (else 409 `vendor_in_use`). */
export async function deleteVendor(user: User, id: string): Promise<{ deleted: true }> {
  requireManage(user)
  const v = vendorFor(user, id)
  if (!v) return fail(VENDOR_NOT_FOUND, 404)
  const used = vendorLines(v).length
  if (used) throw new CodedApiError(`${v.name} has ${used} budget line${used === 1 ? '' : 's'}; set its status instead.`, 409, 'vendor_in_use')
  eventVendors.splice(eventVendors.indexOf(v), 1)
  return delay({ deleted: true as const })
}

/** POST /event-vendors/:id/reviews { event_id, rating 1–5, notes? } — "Rate after the event" for an event with its lines. */
export async function reviewVendor(user: User, id: string, input: Partial<VendorReviewInput> | null): Promise<VendorDetail> {
  requireRead(user)
  const v = vendorFor(user, id)
  if (!v) return fail(VENDOR_NOT_FOUND, 404)
  const e = await ratableEvent(user, input?.eventId)
  if (!vendorLines(v).some((l) => l.eventId === e.id)) return fail(`${v.name} has no budget lines on this event.`, 422)
  const rating = ratingOf(input?.rating)
  if (rating === null) return fail('A rating is a whole number from 1 to 5.', 422)
  const notes = str(input?.notes)
  if (notes.length > 1000) return fail('Keep the review under 1,000 characters.', 422)
  const prev = v.reviews.find((r) => r.eventId === e.id)
  v.reviews = [...v.reviews.filter((r) => r.eventId !== e.id), { id: prev?.id ?? nextId('VRV'), eventId: e.id, rating, notes, ratedBy: user.id, ratedAt: nowIso() }]
  v.updatedAt = nowIso()
  return getVendor(user, v.id)
}
