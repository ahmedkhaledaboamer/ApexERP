import { describe, expect, it } from 'vitest'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { normalizeCode, TICKET_LOOKUP_LIMIT } from '@/shared/mocks/services/eventCheckIn'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Ticket codes (unique, not the registration token), check-in by code (idempotent, undo), counters, public ticket. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
let n = 0
const email = () => `ci-${++n}-${Date.now().toString(36)}@visitor-${n}.ae`

describe('ticket codes', () => {
  it('every attendee has a unique, well-formed code that isn’t the registration token; seed codes are stable', async () => {
    const codes = eventAttendees.map((a) => a.ticketCode)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    const tokens = new Set(events.map((e) => e.registrationToken))
    expect(codes.some((c) => tokens.has(c))).toBe(false)
    const r = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Code Person', email: email() })
    expect(r.body.attendee.ticket_code).toMatch(/^[A-Z2-9]{4}-/)
    // Only editors see codes: u4 (not on the team, marketing hidden) can't even see the event; a viewer (Sales Manager u3 owns it, use another).
    expect(normalizeCode(' abcd efgh-jkmn ')).toBe('ABCD-EFGH-JKMN')
    expect(normalizeCode('short')).toBeNull()
  })
})

describe('check-in by code', () => {
  it('checks in once; again → already checked in at …; undo; counters by ticket type', async () => {
    const a = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'registered')!
    const before = (await apexAdmin('GET', '/events/EV-1004/check-in')).body
    expect(before.registered).toBeGreaterThan(0)
    const first = await apexAdmin('POST', '/events/EV-1004/check-in', { code: a.ticketCode.toLowerCase().replace(/-/g, ' ') })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ already_checked_in: false })
    expect(first.body.attendee.checked_in_at).toBeTruthy()
    const at = first.body.attendee.checked_in_at
    const again = await apexAdmin('POST', '/events/EV-1004/check-in', { code: a.ticketCode })
    expect(again.body.already_checked_in).toBe(true)
    expect(again.body.attendee.checked_in_at).toBe(at)
    expect(again.body.message).toContain('already checked in')
    const sum = (await apexAdmin('GET', '/events/EV-1004/check-in')).body
    expect(sum.checked_in).toBe(before.checked_in + 1)
    expect(sum.recent[0].id).toBe(a.id)
    const row = sum.by_ticket_type.find((t: { ticket_type_id: string }) => t.ticket_type_id === a.ticketTypeId)
    expect(row.checked_in).toBeGreaterThanOrEqual(1)
    expect(sum.waitlisted).toBe(1)
    const undo = await apexAdmin('POST', '/events/EV-1004/check-in', { code: a.ticketCode, undo: true })
    expect(undo.body.attendee.checked_in_at).toBeNull()
    expect((await apexAdmin('GET', '/events/EV-1004/check-in')).body.checked_in).toBe(before.checked_in)
  })

  it('unknown code, another event’s or company’s code → 404; waitlisted → 409; needs the edit right', async () => {
    const own = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'registered')!
    const crest = eventAttendees.find((x) => x.companyId === 'co_crest' && x.status === 'registered')!
    const waiting = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'waitlisted')!
    expect((await apexAdmin('POST', '/events/EV-1004/check-in', { code: 'AAAA-BBBB-CCCC' })).status).toBe(404)
    expect((await apexAdmin('POST', '/events/EV-1003/check-in', { code: own.ticketCode })).status).toBe(404)
    const foreign = await apexAdmin('POST', '/events/EV-1004/check-in', { code: crest.ticketCode })
    expect(foreign.status).toBe(404)
    expect(foreign.body.code).toBe('ticket_not_found')
    const w = await apexAdmin('POST', '/events/EV-1004/check-in', { code: waiting.ticketCode })
    expect(w.status).toBe(409)
    expect(w.body.code).toBe('not_registered')
    // EV-1004 team: owner u7 + u12. u4 (Sales Agent, not on it) → 403; u12 → 200.
    expect((await as('u4')('POST', '/events/EV-1004/check-in', { code: own.ticketCode })).status).toBe(403)
    expect((await as('u12')('POST', '/events/EV-1004/check-in', { code: own.ticketCode })).status).toBe(200)
    // Crest's own check-in works with Crest's code.
    expect((await crestAdmin('POST', `/events/${crest.eventId}/check-in`, { code: crest.ticketCode })).status).toBe(200)
  })
})

describe('public ticket', () => {
  it('shows the attendee’s own ticket and the event’s public fields; unknown / cancelled / module off → the same 404', async () => {
    const a = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'registered')!
    const r = await api(null, 'GET', `/public/tickets/${a.ticketCode}`)
    expect(r.body.attendee_name).toBe(a.name)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ code: a.ticketCode, attendee_name: a.name, status: 'registered', event: { name: 'AI for Hotels Webinar', timezone: 'Asia/Dubai' } })
    expect(JSON.stringify(r.body)).not.toMatch(/EV-1004|lead|u7|budget|EA-/)
    const missing = await api(null, 'GET', '/public/tickets/ZZZZ-ZZZZ-ZZZZ')
    expect(missing.status).toBe(404)
    await apexAdmin('POST', `/events/EV-1004/attendees/${a.id}/cancel`)
    const cancelled = await api(null, 'GET', `/public/tickets/${a.ticketCode}`)
    expect(cancelled.status).toBe(404)
    expect(cancelled.text).toBe(missing.text)
    const crest = eventAttendees.find((x) => x.companyId === 'co_crest' && x.status === 'registered')!
    moduleOverrides.push({ companyId: 'co_crest', module: 'events', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const gated = await api(null, 'GET', `/public/tickets/${crest.ticketCode}`)
    expect(gated.status).toBe(404)
    expect(gated.text).toBe(missing.text)
  })

  it('lookups are rate limited per client', async () => {
    const a = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'registered')!
    const get = () => api(null, 'GET', `/public/tickets/${a.ticketCode}`, { headers: { 'X-Client-Id': 'scanner-1' } })
    for (let i = 0; i < TICKET_LOOKUP_LIMIT; i++) expect((await get()).status).toBe(200)
    const limited = await get()
    expect(limited.status).toBe(429)
    expect(limited.body.code).toBe('rate_limited')
  })
})
