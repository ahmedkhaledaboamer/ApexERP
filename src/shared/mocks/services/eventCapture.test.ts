import { describe, expect, it } from 'vitest'
import { activities, leads } from '@/shared/mocks/db'
import { eventAttendees } from '@/shared/mocks/data/events'
import { eventCaptures } from '@/shared/mocks/data/eventExtras'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Booth capture → lead (owner = capturer or round-robin), rating, activity; leaderboard. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
let n = 0
const email = () => `cap-${++n}-${Date.now().toString(36)}@booth-${n}.ae`

describe('booth capture', () => {
  it('a team member who can own leads captures → a new hot lead owned by them, attendee checked in, activity logged', async () => {
    // EV-1003: owner u3 (Sales Manager), team u6 (Sales Agent: can own leads).
    const mail = email()
    const r = await as('u6')('POST', '/events/EV-1003/captures', { name: 'Booth Visitor', company_name: 'Booth Co', email: mail, title: 'COO', rating: 'hot', notes: 'Wants pricing' })
    expect(r.status).toBe(200)
    expect(r.body.outcome).toBe('created')
    const lead = leads.find((l) => l.id === r.body.lead_id)!
    expect(lead).toMatchObject({ sourceType: 'Event', eventId: 'EV-1003', ownerId: 'u6', company: 'Booth Co' })
    const att = eventAttendees.find((a) => a.email === mail)!
    expect(att).toMatchObject({ source: 'capture', status: 'registered' })
    expect(att.checkedInAt).toBeTruthy()
    expect(r.body.capture).toMatchObject({ rating: 'hot', captured_by: 'u6', notes: 'Wants pricing' })
    expect(activities.some((x) => x.leadId === lead.id && x.type === 'meeting' && x.summary.includes('Hot lead') && x.summary.includes('Wants pricing'))).toBe(true)
  })

  it('a capturer who can’t own leads → the event’s round-robin owner; an existing lead’s email links it', async () => {
    // u7 (Marketing Manager: Sales scope hidden) captures at EV-1004 (owner u7, team u12).
    const r = await as('u7')('POST', '/events/EV-1004/captures', { name: 'Robin Visitor', email: email(), rating: 'warm' })
    expect(r.status).toBe(200)
    const owner = leads.find((l) => l.id === r.body.lead_id)!.ownerId
    expect(owner).not.toBe('u7')
    const existing = leads.find((l) => l.companyId === 'co_apex' && l.contactEmail && !eventAttendees.some((a) => a.leadId === l.id))!
    const before = leads.length
    const linked = await apexAdmin('POST', '/events/EV-1003/captures', { name: existing.contactName, email: existing.contactEmail, rating: 'cold' })
    expect(linked.body).toMatchObject({ outcome: 'linked', lead_id: existing.id })
    expect(leads.length).toBe(before)
  })

  it('a person already registered at the event is linked and checked in (no second attendee)', async () => {
    const reg = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Pre Registered', email: email() })
    const count = eventAttendees.length
    const r = await apexAdmin('POST', '/events/EV-1003/captures', { name: 'Pre Registered', email: reg.body.attendee.email, rating: 'hot' })
    expect(r.status).toBe(200)
    expect(eventAttendees.length).toBe(count)
    expect(eventAttendees.find((a) => a.id === reg.body.attendee.id)!.checkedInAt).toBeTruthy()
    expect(r.body.capture.attendee_id).toBe(reg.body.attendee.id)
  })

  it('validation and access: rating required; not on the team → 403; another company → 404; no Event source → 422', async () => {
    expect((await apexAdmin('POST', '/events/EV-1003/captures', { name: 'No Rating', email: email() })).status).toBe(422)
    expect((await apexAdmin('POST', '/events/EV-1003/captures', { name: 'Bad Url', email: email(), rating: 'hot', card_photo_url: 'nope' })).status).toBe(422)
    expect((await as('u4')('POST', '/events/EV-1003/captures', { name: 'X Y', email: email(), rating: 'hot' })).status).toBe(403)
    expect((await as('u101')('POST', '/events/EV-1003/captures', { name: 'X Y', email: email(), rating: 'hot' })).status).toBe(404)
    for (const s of lookupsFor('co_apex').sources) if (s.key === 'Event') s.active = false
    const r = await apexAdmin('POST', '/events/EV-1003/captures', { name: 'No Source', email: email(), rating: 'hot' })
    expect(r.status).toBe(422)
    expect(r.body.code).toBe('event_source_missing')
  })
})

describe('leaderboard', () => {
  it('per team member: captures, hot leads, deals later won', async () => {
    const r1 = await as('u6')('POST', '/events/EV-1003/captures', { name: 'Lb One', email: email(), rating: 'hot' })
    await as('u6')('POST', '/events/EV-1003/captures', { name: 'Lb Two', email: email(), rating: 'warm' })
    await as('u3')('POST', '/events/EV-1003/captures', { name: 'Lb Three', email: email(), rating: 'hot' })
    const lead = leads.find((l) => l.id === r1.body.lead_id)!
    lead.status = lookupsFor('co_apex').statuses.find((s) => s.type === 'won')!.key
    lead.value = 50000
    const board = await apexAdmin('GET', '/events/EV-1003/leaderboard')
    expect(board.status).toBe(200)
    const u6 = board.body.find((r: { user_id: string }) => r.user_id === 'u6')
    expect(u6).toMatchObject({ captures: 2, hot_leads: 1, warm_leads: 1, deals_won: 1, won_value: 50000 })
    expect(board.body[0].user_id).toBe('u6')
    expect(board.body.find((r: { user_id: string }) => r.user_id === 'u3')).toMatchObject({ captures: 1, hot_leads: 1, deals_won: 0 })
  })

  it('seed: captures with ratings on both companies’ completed exhibitions, own company only', async () => {
    expect(eventCaptures.filter((c) => c.companyId === 'co_apex').length).toBeGreaterThan(0)
    expect(eventCaptures.filter((c) => c.companyId === 'co_crest').length).toBeGreaterThan(0)
    const list = await apexAdmin('GET', '/events/EV-1001/captures')
    expect(list.body.length).toBe(eventCaptures.filter((c) => c.eventId === 'EV-1001').length)
    expect((await apexAdmin('GET', '/events/EV-5001/leaderboard')).status).toBe(404)
  })
})
