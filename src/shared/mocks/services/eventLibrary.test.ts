import { describe, expect, it } from 'vitest'
import { averageRating, libraryAccess, sameSpeaker, vendorSpend, venueCapacityWarning, venueLocation } from '@/modules/events/lib/library'
import { eventSessions, eventSpeakers } from '@/shared/mocks/data/eventExtras'
import { speakerDirectory } from '@/shared/mocks/data/eventLibrary'
import { migrateLegacySpeakers, type LegacySpeakerRow } from '@/shared/mocks/services/speakerMigration'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Speaker directory, venues and vendors (docs/API.md › Events › Speakers, venues & vendors). */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')

const legacy = (v: Partial<LegacySpeakerRow> & Pick<LegacySpeakerRow, 'id' | 'name'>): LegacySpeakerRow => ({
  companyId: 'co_apex', eventId: 'EV-1', title: '', company: '', bio: '', photoUrl: '', createdAt: '2026-01-01T00:00:00.000Z', ...v,
})

describe('speaker migration (per-event speakers → directory)', () => {
  it('dedupes by email, else by name + company (case / spaces), per company; sessions re-point through idMap', () => {
    let n = 0
    const m = migrateLegacySpeakers(
      [
        legacy({ id: 'A1', eventId: 'EV-1', name: 'Huda Saeed', company: 'Saeed Group', bio: '' }),
        legacy({ id: 'A2', eventId: 'EV-2', name: '  huda   SAEED ', company: 'saeed group', bio: 'CEO of Saeed Group.' }),
        legacy({ id: 'A3', eventId: 'EV-2', name: 'Huda Saeed', company: 'Other Co', email: 'huda@other.test' }),
        legacy({ id: 'A4', eventId: 'EV-3', name: 'H. Saeed', company: 'Other Co', email: 'HUDA@other.test' }),
        legacy({ id: 'A5', eventId: 'EV-3', name: 'Huda Saeed', company: 'Saeed Group', companyId: 'co_crest' }),
        legacy({ id: 'A6', eventId: 'EV-1', name: 'Huda Saeed', company: 'Saeed Group' }),
      ],
      [],
      (co) => `NEW-${co}-${++n}`,
    )
    expect(m.added.map((s) => [s.companyId, s.name])).toEqual([
      ['co_apex', 'Huda Saeed'],
      ['co_apex', 'Huda Saeed'],
      ['co_crest', 'Huda Saeed'],
    ])
    // Same name + company → one entry (gaps filled from the later row); same email → one entry despite another name.
    expect(m.idMap.get('A1')).toBe(m.idMap.get('A2'))
    expect(m.added[0].bio).toBe('CEO of Saeed Group.')
    expect(m.idMap.get('A3')).toBe(m.idMap.get('A4'))
    expect(m.idMap.get('A3')).not.toBe(m.idMap.get('A1'))
    // Never merged across companies.
    expect(m.idMap.get('A5')).not.toBe(m.idMap.get('A1'))
    // One roster link per (event, speaker): A1 and A6 are the same person on EV-1.
    expect(m.links.filter((l) => l.eventId === 'EV-1')).toHaveLength(1)
    expect(m.links).toHaveLength(5)
  })

  it('reuses an existing directory entry and only fills its empty fields', () => {
    const existing = { ...speakerDirectory.find((s) => s.companyId === 'co_apex')! }
    const m = migrateLegacySpeakers([legacy({ id: 'X1', name: existing.name, company: existing.company, title: 'Overwritten?' })], [existing], () => 'never')
    expect(m.added).toEqual([])
    expect(m.idMap.get('X1')).toBe(existing.id)
    expect(existing.title).not.toBe('Overwritten?')
  })

  it('the seed is migrated: Omar Farouk is one Apex directory entry on three events; every session names directory speakers', () => {
    const omar = speakerDirectory.filter((s) => s.companyId === 'co_apex' && s.name.toLowerCase().replace(/\s+/g, ' ') === 'omar farouk')
    expect(omar).toHaveLength(1)
    expect(omar[0].email).toBe('omar.farouk@apex-speakers.example')
    expect(eventSpeakers.filter((l) => l.speakerId === omar[0].id).map((l) => l.eventId).sort()).toEqual(['EV-1001', 'EV-1003', 'EV-1004'])
    for (const s of eventSessions) for (const id of s.speakerIds) expect(speakerDirectory.some((d) => d.id === id && d.companyId === s.companyId)).toBe(true)
    expect(sameSpeaker({ name: 'A', company: 'B', email: 'x@y.z' }, { name: 'A', company: 'B', email: 'q@y.z' })).toBe(false)
  })
})

describe('speakers: directory ↔ agenda', () => {
  it('agenda: pick a directory speaker, or add a new one (creates / reuses a directory entry); removing keeps the entry', async () => {
    const ev = await apexAdmin('POST', '/events', { name: 'Directory test', type: 'conference', start_date: '2027-04-06', start_time: '09:00', end_time: '17:00' })
    const id = ev.body.id
    const dir = await apexAdmin('POST', '/event-speakers', { name: 'Layal Haddad', company: 'Cedar AI', email: 'layal@cedar-ai.test', topics: ['LLMs', 'llms', 'Agents'] })
    expect(dir.status).toBe(200)
    expect(dir.body.topics).toEqual(['LLMs', 'Agents'])
    expect((await apexAdmin('POST', '/event-speakers', { name: 'Someone', email: 'LAYAL@cedar-ai.test' })).body.code).toBe('speaker_exists')
    // Pick from the directory.
    const pick = await apexAdmin('POST', `/events/${id}/speakers`, { speaker_id: dir.body.id })
    expect(pick.body.id).toBe(dir.body.id)
    // "Add new speaker" from the agenda: a new directory entry; the same person again is reused, not duplicated.
    const fresh = await apexAdmin('POST', `/events/${id}/speakers`, { name: 'Tariq Mansour', company: 'Gulf Ventures', title: 'Partner' })
    expect(fresh.body.id).toMatch(/^SPK-/)
    const again = await apexAdmin('POST', `/events/${id}/speakers`, { name: 'tariq mansour', company: 'GULF VENTURES' })
    expect(again.body.id).toBe(fresh.body.id)
    const list = await apexAdmin('GET', '/event-speakers')
    expect(list.body.filter((s: { name: string }) => s.name === 'Tariq Mansour')).toHaveLength(1)
    // Sessions reference directory ids (speaker_id); the session shows the directory profile.
    const ses = await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Agents in production', date: '2027-04-06', start_time: '10:00', end_time: '11:00', speaker_ids: [dir.body.id, fresh.body.id] })
    expect(ses.body.speakers.map((s: { name: string }) => s.name)).toEqual(['Layal Haddad', 'Tariq Mansour'])
    // Speaker page: events and sessions they speak at.
    const page = await apexAdmin('GET', `/event-speakers/${dir.body.id}`)
    expect(page.body.events).toHaveLength(1)
    expect(page.body.events[0]).toMatchObject({ event_id: id, sessions: [{ title: 'Agents in production', start_time: '10:00' }] })
    // Removing from the event takes them off its sessions; the directory entry stays.
    await apexAdmin('DELETE', `/events/${id}/speakers/${dir.body.id}`)
    const agenda = await apexAdmin('GET', `/events/${id}/agenda`)
    expect(agenda.body.sessions[0].speaker_ids).toEqual([fresh.body.id])
    expect((await apexAdmin('GET', `/event-speakers/${dir.body.id}`)).status).toBe(200)
    // A speaker on an event can't be deleted from the directory.
    expect((await apexAdmin('DELETE', `/event-speakers/${fresh.body.id}`)).body.code).toBe('speaker_in_use')
    expect((await apexAdmin('DELETE', `/event-speakers/${dir.body.id}`)).status).toBe(200)
  })

  it('team members pick and add, but only marketing full edits a profile; the public agenda has no contact details', async () => {
    // u6 (Sales Agent) is on EV-1003's team.
    const omar = speakerDirectory.find((s) => s.companyId === 'co_apex' && s.name === 'Omar Farouk')!
    const hessa = speakerDirectory.find((s) => s.id === 'SPK-1102')!
    expect((await as('u6')('POST', '/events/EV-1003/speakers', { speaker_id: hessa.id })).status).toBe(200)
    expect((await as('u6')('PATCH', `/events/EV-1003/speakers/${omar.id}`, { bio: 'Changed by a team member' })).status).toBe(403)
    expect((await apexAdmin('PATCH', `/events/EV-1003/speakers/${omar.id}`, { bio: 'Updated bio' })).status).toBe(200)
    expect(speakerDirectory.find((s) => s.id === omar.id)!.bio).toBe('Updated bio')
    expect((await as('u6')('GET', '/events/EV-1003/agenda')).body.can_edit_speakers).toBe(false)
    const pub = await api(null, 'GET', `/public/events/${(await apexAdmin('GET', '/events/EV-1003')).body.registration_token}`)
    expect(JSON.stringify(pub.body.agenda)).not.toMatch(/SPK-|@|"fee"|"email"|"mobile"/)
  })

  it('ratings after the talk: completed events they spoke at, by the event owner or marketing full; average on the directory', async () => {
    const omar = speakerDirectory.find((s) => s.companyId === 'co_apex' && s.name === 'Omar Farouk')!
    // EV-1003 isn't completed yet.
    expect((await apexAdmin('POST', `/event-speakers/${omar.id}/ratings`, { event_id: 'EV-1003', rating: 4 })).status).toBe(422)
    // u4 isn't EV-1001's owner nor marketing full (EV-1001 is owned by u7; u4 is on its team).
    expect((await as('u4')('POST', `/event-speakers/${omar.id}/ratings`, { event_id: 'EV-1001', rating: 3 })).status).toBe(403)
    expect((await apexAdmin('POST', `/event-speakers/${omar.id}/ratings`, { event_id: 'EV-1001', rating: 6 })).status).toBe(422)
    const r = await as('u7')('POST', `/event-speakers/${omar.id}/ratings`, { event_id: 'EV-1001', rating: 3, note: 'Shorter next time' })
    expect(r.status).toBe(200)
    // Re-rating replaces the event's rating.
    expect(r.body.ratings.filter((x: { event_id: string }) => x.event_id === 'EV-1001')).toHaveLength(1)
    expect(r.body.rating).toBe(3)
    // A speaker who wasn't on that agenda can't be rated for it.
    expect((await apexAdmin('POST', '/event-speakers/SPK-1102/ratings', { event_id: 'EV-1001', rating: 5 })).status).toBe(422)
    expect(averageRating([5, 4, 4])).toBe(4.3)
    expect(averageRating([])).toBeNull()
  })
})

describe('venues', () => {
  it('capacity vs event capacity: a WARNING on the event (never a refusal)', async () => {
    expect(venueCapacityWarning(120, 100)).toMatch(/120.*100/)
    expect(venueCapacityWarning(80, 100)).toBeNull()
    expect(venueCapacityWarning(null, 100, 130)).toMatch(/130 people/)
    expect(venueCapacityWarning(500, null)).toBeNull()
    // Seed: Crest's forum (capacity 120) at the Hilton (100).
    const forum = await crestAdmin('GET', '/events/EV-5002')
    expect(forum.body).toMatchObject({ venue_id: 'VEN-5002', venue_name: 'Hilton Riyadh Hotel & Residences', venue_capacity: 100 })
    expect(forum.body.venue_warning).toMatch(/above the venue/)
    // Raising the capacity further still saves.
    expect((await crestAdmin('PATCH', '/events/EV-5002', { capacity: 150 })).status).toBe(200)
  })

  it('picking a venue fills an empty location; archived venues can’t be picked; a foreign venue is like a missing one', async () => {
    const v = await apexAdmin('POST', '/event-venues', { name: 'Coca-Cola Arena', type: 'conference_hall', city: 'Dubai', capacity: 300, rooms: [{ name: 'Main floor', capacity: 300 }], lat: 25.19, lng: 55.26 })
    expect(v.status).toBe(200)
    expect(v.body.country).toBe('AE')
    expect(venueLocation({ name: 'Coca-Cola Arena', city: 'Dubai' })).toBe('Coca-Cola Arena, Dubai')
    const ev = await apexAdmin('POST', '/events', { name: 'Arena launch', type: 'conference', start_date: '2027-05-01', venue_id: v.body.id })
    expect(ev.body).toMatchObject({ venue_id: v.body.id, location: 'Coca-Cola Arena, Dubai' })
    // The free text stays an override.
    expect((await apexAdmin('PATCH', `/events/${ev.body.id}`, { location: 'Arena, gate 3' })).body.location).toBe('Arena, gate 3')
    expect((await apexAdmin('POST', '/events', { name: 'Old hotel', type: 'meeting', start_date: '2027-05-02', venue_id: 'VEN-1004' })).status).toBe(422)
    const foreign = await apexAdmin('POST', '/events', { name: 'Foreign', type: 'meeting', start_date: '2027-05-02', venue_id: 'VEN-5001' })
    const missing = await apexAdmin('POST', '/events', { name: 'Foreign', type: 'meeting', start_date: '2027-05-02', venue_id: 'VEN-none' })
    expect([foreign.status, foreign.body.message]).toEqual([missing.status, missing.body.message])
    // Venue page: past events and the average attendance; a used venue can't be deleted (archive instead).
    const dwtc = await apexAdmin('GET', '/event-venues/VEN-1001')
    expect(dwtc.body.past.map((e: { event_id: string }) => e.event_id).sort()).toEqual(['EV-1001', 'EV-1002'])
    expect(dwtc.body.average_attendance).toBeGreaterThan(0)
    expect((await apexAdmin('DELETE', '/event-venues/VEN-1001')).body.code).toBe('venue_in_use')
    expect((await apexAdmin('POST', '/event-venues', { name: 'dubai world trade centre' })).body.code).toBe('venue_exists')
    expect((await apexAdmin('POST', '/event-venues', { name: 'Bad pin', lat: 25 })).status).toBe(422)
  })
})

describe('vendors', () => {
  it('spend aggregates the budget lines’ actuals per event and in total', async () => {
    const pure = vendorSpend([
      { eventId: 'E1', planned: 10, actual: 12.5 },
      { eventId: 'E1', planned: 5, actual: 0 },
      { eventId: 'E2', planned: 100, actual: 90.25 },
    ])
    expect(pure.totalActual).toBe(102.75)
    expect(pure.totalPlanned).toBe(115)
    expect(pure.perEvent.get('E1')).toEqual({ lines: 2, planned: 15, actual: 12.5 })
    // Seed: Expo Craft built GITEX (line actual 52,000).
    const before = await apexAdmin('GET', '/event-vendors/VND-1001')
    expect(before.body).toMatchObject({ total_actual: 52000, event_count: 1, currency: 'AED' })
    // A new line on another event adds to the total and a spend row.
    await apexAdmin('POST', '/events/EV-1002/budget-lines', { category: 'venue', planned: 9000, actual: 8000.5, vendor_id: 'VND-1001' })
    const after = await apexAdmin('GET', '/event-vendors/VND-1001')
    expect(after.body.total_actual).toBe(60000.5)
    expect(after.body.spend.find((s: { event_id: string }) => s.event_id === 'EV-1002')).toMatchObject({ lines: 1, actual: 8000.5, needs_rating: true })
    const budget = await apexAdmin('GET', '/events/EV-1002/budget')
    expect(budget.body.lines.find((l: { vendor_id: string | null }) => l.vendor_id === 'VND-1001').vendor_name).toBe('Expo Craft Stands LLC')
  })

  it('blacklisted vendors can’t be picked for new lines; lines that had them keep them', async () => {
    const r = await apexAdmin('POST', '/events/EV-1001/budget-lines', { category: 'marketing', planned: 100, vendor_id: 'VND-1004' })
    expect(r.status).toBe(422)
    expect(r.body.code).toBe('vendor_blacklisted')
    expect(r.body.message).toMatch(/blacklisted/)
    // Blacklist a vendor already on a line: the line keeps it and stays editable; re-picking it elsewhere is refused.
    expect((await apexAdmin('PATCH', '/event-vendors/VND-1002', { status: 'blacklisted' })).status).toBe(200)
    expect((await apexAdmin('PATCH', '/events/EV-1001/budget-lines/EBL-1001-3', { actual: 4500 })).status).toBe(200)
    expect((await apexAdmin('PATCH', '/events/EV-1001/budget-lines/EBL-1001-2', { vendor_id: 'VND-1002' })).body.code).toBe('vendor_blacklisted')
    // Clearing a vendor is always allowed; a foreign vendor id answers like a missing one.
    expect((await apexAdmin('PATCH', '/events/EV-1001/budget-lines/EBL-1001-3', { vendor_id: null })).status).toBe(200)
    const foreign = await apexAdmin('POST', '/events/EV-1001/budget-lines', { category: 'other', vendor_id: 'VND-5001' })
    const missing = await apexAdmin('POST', '/events/EV-1001/budget-lines', { category: 'other', vendor_id: 'VND-none' })
    expect([foreign.status, foreign.body.message]).toEqual([422, missing.body.message])
  })

  it('“Rate after the event”: completed events list the vendors not yet reviewed; a review clears the prompt', async () => {
    const b = await apexAdmin('GET', '/events/EV-1001/budget')
    expect(b.body.vendors_to_rate.map((v: { vendor_id: string }) => v.vendor_id).sort()).toEqual(['VND-1002', 'VND-1003'])
    expect((await apexAdmin('GET', '/events/EV-1003/budget')).body.vendors_to_rate).toEqual([])
    // A vendor without lines on the event can't be reviewed for it.
    expect((await apexAdmin('POST', '/event-vendors/VND-1005/reviews', { event_id: 'EV-1001', rating: 4 })).status).toBe(422)
    const rev = await as('u7')('POST', '/event-vendors/VND-1002/reviews', { event_id: 'EV-1001', rating: 4, notes: 'On time' })
    expect(rev.status).toBe(200)
    expect(rev.body).toMatchObject({ rating: 4, review_count: 1 })
    expect((await apexAdmin('GET', '/events/EV-1001/budget')).body.vendors_to_rate.map((v: { vendor_id: string }) => v.vendor_id)).toEqual(['VND-1003'])
    expect((await apexAdmin('DELETE', '/event-vendors/VND-1001')).body.code).toBe('vendor_in_use')
    expect((await apexAdmin('POST', '/event-vendors', { category: 'printing', name: 'Bad site', website: 'not a url' })).status).toBe(422)
  })

  it('access helper follows the marketing column plus team membership', () => {
    expect(libraryAccess('full', false)).toBe('manage')
    expect(libraryAccess('view', false)).toBe('read')
    expect(libraryAccess('hidden', true)).toBe('read')
    expect(libraryAccess('hidden', false)).toBe('none')
  })
})

describe('contact mobiles abroad', () => {
  it('a venue abroad takes its own country’s rules or an international number; a home number is still checked', async () => {
    // A UAE company exhibiting in Las Vegas: the venue's contact has a US number.
    const us = await apexAdmin('POST', '/event-venues', { name: 'Las Vegas Convention Center', type: 'exhibition_centre', city: 'Las Vegas', country: 'US', contact_mobile: '+1 702 892 0711' })
    expect(us.status).toBe(200)
    expect(us.body.contact_mobile).toBe('+17028920711')
    // A Saudi venue for the same company: Saudi rules apply (local form normalized).
    const sa = await apexAdmin('POST', '/event-venues', { name: 'Riyadh Front Expo', type: 'exhibition_centre', city: 'Riyadh', country: 'SA', contact_mobile: '0551234567' })
    expect(sa.status).toBe(200)
    expect(sa.body.contact_mobile).toMatch(/^\+966\s?55/)
    // A UAE venue with a broken UAE number is still refused (no bypass via the international form).
    const bad = await apexAdmin('POST', '/event-venues', { name: 'Expo City Hall X', type: 'exhibition_centre', city: 'Dubai', country: 'AE', contact_mobile: '+971 12' })
    expect(bad.status).toBe(422)
    // Garbage is refused.
    expect((await apexAdmin('POST', '/event-venues', { name: 'Nowhere Hall', type: 'other', city: 'X', country: 'US', contact_mobile: 'call me' })).status).toBe(422)
  })
})
