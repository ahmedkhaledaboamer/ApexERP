import { describe, expect, it } from 'vitest'
import { events } from '@/shared/mocks/data/events'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Agenda & speakers: sessions inside the event (company timezone), no overlap in the same room, public agenda. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')

async function fixture(co: 'apex' | 'crest' = 'apex'): Promise<string> {
  const call = co === 'apex' ? apexAdmin : crestAdmin
  // Two days, 09:00 → 17:00 on the second day, company time.
  const r = await call('POST', '/events', { name: `Agenda ${co}`, type: 'conference', start_date: '2027-04-06', end_date: '2027-04-07', start_time: '09:00', end_time: '17:00' })
  expect(r.status).toBe(200)
  return r.body.id
}

describe('agenda', () => {
  it('stores sessions in the company timezone and serves them in time order with speakers', async () => {
    const id = await fixture()
    const sp = await apexAdmin('POST', `/events/${id}/speakers`, { name: 'Huda Saeed', title: 'CEO', company: 'Saeed Group', photo_url: 'https://example.com/huda.jpg' })
    expect(sp.status).toBe(200)
    const s2 = await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Closing', date: '2027-04-07', start_time: '16:00', end_time: '16:45', room: 'Hall A' })
    const s1 = await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Keynote', date: '2027-04-06', start_time: '09:00', end_time: '10:00', room: 'Hall A', speaker_ids: [sp.body.id] })
    expect(s1.status).toBe(200)
    // Dubai is UTC+4: 09:00 local = 05:00 UTC.
    expect(s1.body.starts_at).toBe('2027-04-06T05:00:00.000Z')
    const agenda = await apexAdmin('GET', `/events/${id}/agenda`)
    expect(agenda.body.sessions.map((s: { id: string }) => s.id)).toEqual([s1.body.id, s2.body.id])
    expect(agenda.body.sessions[0].speakers[0]).toMatchObject({ name: 'Huda Saeed', company: 'Saeed Group' })
    expect(agenda.body.timezone).toBe('Asia/Dubai')
    // Removing a speaker takes them off the sessions.
    await apexAdmin('DELETE', `/events/${id}/speakers/${sp.body.id}`)
    expect((await apexAdmin('GET', `/events/${id}/agenda`)).body.sessions[0].speaker_ids).toEqual([])
  })

  it('refuses a session outside the event (dates or times)', async () => {
    const id = await fixture()
    const before = await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Too early', date: '2027-04-05', start_time: '10:00', end_time: '11:00' })
    expect(before.status).toBe(422)
    expect(before.body.code).toBe('session_outside_event')
    expect((await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Before 9', date: '2027-04-06', start_time: '08:00', end_time: '09:30' })).body.code).toBe('session_outside_event')
    expect((await apexAdmin('POST', `/events/${id}/sessions`, { title: 'After 17', date: '2027-04-07', start_time: '16:30', end_time: '17:30' })).body.code).toBe('session_outside_event')
    expect((await apexAdmin('POST', `/events/${id}/sessions`, { title: 'Backwards', date: '2027-04-06', start_time: '11:00', end_time: '10:00' })).status).toBe(422)
    // All-day events: any time on their days.
    const allDay = await apexAdmin('POST', '/events', { name: 'All day', type: 'exhibition', start_date: '2027-04-06' })
    expect((await apexAdmin('POST', `/events/${allDay.body.id}/sessions`, { title: 'Late', date: '2027-04-06', start_time: '22:00', end_time: '23:30' })).status).toBe(200)
  })

  it('refuses overlapping sessions in the same room (409), allows other rooms and edits in place', async () => {
    const id = await fixture('crest')
    const a = await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Panel', date: '2027-04-06', start_time: '10:00', end_time: '11:00', room: 'Main hall' })
    const clash = await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Clash', date: '2027-04-06', start_time: '10:30', end_time: '11:30', room: 'main HALL' })
    expect(clash.status).toBe(409)
    expect(clash.body.code).toBe('session_overlap')
    expect(clash.body.message).toContain('Panel')
    expect((await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Parallel', date: '2027-04-06', start_time: '10:30', end_time: '11:30', room: 'Room 2' })).status).toBe(200)
    // Back-to-back is fine; editing a session doesn't clash with itself.
    expect((await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Next', date: '2027-04-06', start_time: '11:00', end_time: '12:00', room: 'Main hall' })).status).toBe(200)
    expect((await crestAdmin('PATCH', `/events/${id}/sessions/${a.body.id}`, { end_time: '10:45' })).status).toBe(200)
    // Speakers come from the company's speaker directory (behaviour change with the directory, docs/API.md ›
    // Events › Speakers): a directory speaker of another event may speak here too and joins this event's roster;
    // an id that isn't in the directory is refused.
    const other = await crestAdmin('POST', '/events', { name: 'Other', type: 'meeting', start_date: '2027-04-06' })
    const sp = await crestAdmin('POST', `/events/${other.body.id}/speakers`, { name: 'Elsewhere' })
    expect((await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Shared speaker', date: '2027-04-06', start_time: '13:00', end_time: '14:00', speaker_ids: [sp.body.id] })).status).toBe(200)
    expect((await crestAdmin('GET', `/events/${id}/agenda`)).body.speakers.map((s: { id: string }) => s.id)).toContain(sp.body.id)
    expect((await crestAdmin('POST', `/events/${id}/sessions`, { title: 'Unknown speaker', date: '2027-04-06', start_time: '15:00', end_time: '16:00', speaker_ids: ['SPK-nope'] })).status).toBe(422)
  })

  it('the public page shows the agenda without ids; edits need the edit right; another company’s session is 404', async () => {
    const e = events.find((x) => x.id === 'EV-5002')!
    const pub = await api(null, 'GET', `/public/events/${e.registrationToken}`)
    expect(pub.status).toBe(200)
    expect(pub.body.agenda.length).toBeGreaterThanOrEqual(3)
    expect(pub.body.agenda[0]).toHaveProperty('start_time')
    expect(JSON.stringify(pub.body.agenda)).not.toMatch(/ESS-|ESP-/)
    // u4 (Sales Agent, not on EV-1003's team) can't add sessions; u6 (on the team) can.
    const agendaApex = await apexAdmin('GET', '/events/EV-1003/agenda')
    const date = agendaApex.body.sessions[0].date
    expect((await as('u4')('POST', '/events/EV-1003/sessions', { title: 'X', date, start_time: '10:16', end_time: '10:20' })).status).toBe(403)
    expect((await as('u6')('POST', '/events/EV-1003/sessions', { title: 'Team member session', date, start_time: '10:16', end_time: '10:20', room: 'Side room' })).status).toBe(200)
    expect((await apexAdmin('PATCH', '/events/EV-1003/sessions/ESS-5002-1', { title: 'Hijack' })).status).toBe(404)
  })
})
