import { describe, expect, it } from 'vitest'
import { activities, contacts, leads } from '@/shared/mocks/db'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { usedOf } from '@/shared/mocks/services/billing'
import { eventLocalDate, eventsAttendedBy } from '@/shared/mocks/selectors/events'
import { PUBLIC_REGISTER_LIMIT, EVENT_SOURCE_MISSING } from '@/shared/mocks/services/events'
import { APEX, CREST, api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * Events module rules through the real MSW handlers (snake_case wire format): registration → lead
 * with the Event source, duplicate email → linked lead, the plan's lead limit, the public page
 * (closed, rate limit, honeypot, unknown token), stats, team rules, module gating, targets and task links.
 */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
const ev = (id: string) => events.find((e) => e.id === id)!
let n = 0
const email = (tag = 'att') => `${tag}-${++n}-${Date.now().toString(36)}@visitor-${n}.ae`

function setUsage(companyId: string, target: number): void {
  for (let i = usageSimulation.length - 1; i >= 0; i--) {
    if (usageSimulation[i].companyId === companyId && usageSimulation[i].key === 'leadsContacts') usageSimulation.splice(i, 1)
  }
  usageSimulation.push({ companyId, key: 'leadsContacts', offset: target - usedOf(companyId, 'leadsContacts') })
}

function disableEvents(companyId: string): void {
  moduleOverrides.push({ companyId, module: 'events', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
}

describe('registration creates a lead', () => {
  it('new attendee → lead with the Event source, source detail = event name, event_id, owner round-robin', async () => {
    const before = leads.length
    const r1 = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Mona Saleh', company_name: 'Saleh Hotels', email: email(), mobile: '+971 50 123 4567', title: 'GM' })
    expect(r1.status).toBe(200)
    expect(r1.body.outcome).toBe('created')
    expect(r1.body.limit_reached).toBeNull()
    expect(leads.length).toBe(before + 1)
    const lead = await apexAdmin('GET', `/leads/${r1.body.lead_id}`)
    expect(lead.status).toBe(200)
    expect(lead.body).toMatchObject({ source_id: 'Event', source_detail: 'Dubai Business Breakfast', event_id: 'EV-1003', company_name: 'Saleh Hotels', status_id: 'New' })
    // EV-1003: owner u3 (Sales Manager) then team member u6 (Sales Agent), in turn.
    expect(lead.body.owner_id).toBe('u3')
    const r2 = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Karim Daher', email: email() })
    expect(leads.find((l) => l.id === r2.body.lead_id)?.ownerId).toBe('u6')
    // The attendee row points at the lead, and the event counts it.
    const atts = await apexAdmin('GET', '/events/EV-1003/attendees')
    expect(atts.body.find((a: { id: string }) => a.id === r1.body.attendee.id)).toMatchObject({ lead_id: r1.body.lead_id, lead_outcome: 'created', source: 'manual', can_open_lead: true })
    expect((await apexAdmin('GET', '/events/EV-1003')).body.leads_created).toBe(2)
  })

  it('an existing lead’s email links the attendee to that lead (no duplicate) and logs an activity', async () => {
    const existing = leads.find((l) => l.companyId === APEX && l.contactEmail)!
    const before = leads.length
    const acts = activities.length
    const r = await apexAdmin('POST', '/events/EV-1003/attendees', { name: existing.contactName, email: existing.contactEmail.toUpperCase() })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ outcome: 'linked', lead_id: existing.id })
    expect(leads.length).toBe(before)
    expect(activities.length).toBe(acts + 1)
    const timeline = await apexAdmin('GET', `/leads/${existing.id}/activities`)
    expect(JSON.stringify(timeline.body)).toContain('registered at Dubai Business Breakfast')
    // A contact's email (not the primary) links too.
    const contact = contacts.find((c) => c.companyId === APEX && c.leadId && c.email && leads.find((l) => l.id === c.leadId)?.contactEmail !== c.email)
    if (contact) {
      const r2 = await apexAdmin('POST', '/events/EV-1003/attendees', { name: contact.name, email: contact.email })
      expect(r2.body).toMatchObject({ outcome: 'linked', lead_id: contact.leadId })
    }
  })

  it('the same email twice at one event → 409 already_registered', async () => {
    const e = email()
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Twice Person', email: e })).status).toBe(200)
    const again = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Twice Person', email: e })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('already_registered')
  })

  it('validates the attendee: name, email, mobile by the company’s country, a way to follow up', async () => {
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'X', email: email() })).status).toBe(422)
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'No Contact' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Bad Mail', email: 'nope' })).status).toBe(422)
    // A Saudi mobile isn't a UAE mobile (Apex); it is for Crest.
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Saudi Mobile', mobile: '+966 55 123 4567' })).status).toBe(422)
    expect((await crestAdmin('POST', '/events/EV-5002/attendees', { name: 'Saudi Mobile', mobile: '+966 55 123 4567' })).status).toBe(200)
  })

  it('LIMIT_REACHED: the attendee is saved without a lead and the answer says so', async () => {
    // Crest is on Business (25,000 leads + contacts): fill it up.
    setUsage(CREST, 25000)
    const before = leads.length
    const r = await crestAdmin('POST', '/events/EV-5002/attendees', { name: 'Late Visitor', email: email() })
    expect(r.status).toBe(200)
    expect(r.body.outcome).toBe('none')
    expect(r.body.lead_id).toBeNull()
    expect(r.body.limit_reached).toMatchObject({ code: 'LIMIT_REACHED', limit: 'leadsContacts', max: 25000, planId: 'business' })
    expect(r.body.message).toMatch(/limit/i)
    expect(leads.length).toBe(before)
    expect(eventAttendees.some((a) => a.id === r.body.attendee.id && a.leadOutcome === 'none')).toBe(true)
    // An existing lead still links: linking adds nothing to the count.
    const existing = leads.find((l) => l.companyId === CREST && l.contactEmail)!
    expect((await crestAdmin('POST', '/events/EV-5002/attendees', { name: existing.contactName, email: existing.contactEmail })).body.outcome).toBe('linked')
  })

  it('no active Event source → 422 event_source_missing (a matching lead still links)', async () => {
    for (const s of lookupsFor(APEX).sources) if (s.key === 'Event') s.active = false
    const r = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'No Source', email: email() })
    expect(r.status).toBe(422)
    expect(r.body).toMatchObject({ code: 'event_source_missing', message: EVENT_SOURCE_MISSING })
    const existing = leads.find((l) => l.companyId === APEX && l.contactEmail)!
    expect((await apexAdmin('POST', '/events/EV-1003/attendees', { name: existing.contactName, email: existing.contactEmail })).body.outcome).toBe('linked')
  })

  it('imports rows: new leads, linked leads, failures; stops creating leads at the plan limit', async () => {
    const existing = leads.find((l) => l.companyId === CREST && l.contactEmail)!
    const rows = [
      { row: 2, name: 'Import One', company_name: 'One Co', email: email('imp') },
      { row: 3, name: 'Import Two', email: existing.contactEmail },
      { row: 4, name: 'Bad', email: 'x' },
    ]
    const r = await crestAdmin('POST', '/events/EV-5002/attendees/import', { file_name: 'expo.csv', rows })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ added: 2, leads_created: 1, leads_linked: 1, without_lead: 0, limit_reached: null })
    expect(r.body.failed).toEqual([expect.objectContaining({ row: 4 })])
    setUsage(CREST, 25000)
    const r2 = await crestAdmin('POST', '/events/EV-5002/attendees/import', { rows: [{ row: 2, name: 'Over Limit', email: email('imp') }] })
    expect(r2.body).toMatchObject({ added: 1, leads_created: 0, without_lead: 1 })
    expect(r2.body.limit_reached.code).toBe('LIMIT_REACHED')
    expect((await crestAdmin('POST', '/events/EV-5002/attendees/import', { rows: [] })).status).toBe(422)
  })
})

describe('check-in and stats', () => {
  it('check-in sets checked_in_at (undo clears it) and the stats follow', async () => {
    const r = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Check Me', email: email() })
    const id = r.body.attendee.id
    const s0 = (await apexAdmin('GET', '/events/EV-1003/stats')).body
    const c = await apexAdmin('POST', `/events/EV-1003/attendees/${id}/check-in`, {})
    expect(c.body.checked_in_at).toBeTruthy()
    expect((await apexAdmin('GET', '/events/EV-1003/stats')).body.checked_in).toBe(s0.checked_in + 1)
    const u = await apexAdmin('POST', `/events/EV-1003/attendees/${id}/check-in`, { undo: true })
    expect(u.body.checked_in_at).toBeNull()
  })

  it('stats: attendees, leads created / linked, deals won and value from those leads, cost per lead = actual cost (else budget) / new leads', async () => {
    const e = ev('EV-1001')
    const atts = eventAttendees.filter((a) => a.eventId === e.id)
    const eventLeads = leads.filter((l) => atts.some((a) => a.leadId === l.id))
    const won = eventLeads.filter((l) => l.status === 'Won')
    const created = atts.filter((a) => a.leadOutcome === 'created').length
    expect(atts.length).toBeGreaterThan(0)
    const s = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s).toMatchObject({
      attendees: atts.length,
      leads_created: created,
      leads_linked: 0,
      leads: eventLeads.length,
      deals_won: won.length,
      won_value: won.reduce((t, l) => t + l.value, 0),
      budget: 85000,
      // EV-1001 has budget lines, so the actual cost (not the planned budget) is the basis, like ROI.
      cost_per_lead_basis: 'actual',
      cost_per_lead: Math.round((s.actual_cost / created) * 100) / 100,
      currency: 'AED',
    })
    // A linked lead adds to `leads_linked` / `leads` but not to cost per lead.
    const other = leads.find((l) => l.companyId === APEX && l.contactEmail && !eventLeads.includes(l))!
    await apexAdmin('POST', '/events/EV-1001/attendees', { name: other.contactName, email: other.contactEmail })
    const s2 = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s2).toMatchObject({ leads_linked: 1, leads: eventLeads.length + 1, cost_per_lead: s.cost_per_lead })
  })
})

describe('events: create, update, team, cancel', () => {
  it('creates an event in the company timezone with its team; validates dates and fields', async () => {
    const r = await apexAdmin('POST', '/events', { name: 'Expo Dubai', type: 'exhibition', start_date: '2027-02-10', start_time: '09:00', end_date: '2027-02-12', end_time: '18:00', budget: 5000, team_ids: ['u4'] })
    expect(r.status).toBe(200)
    // 09:00 in Dubai (UTC+4) = 05:00 UTC.
    expect(r.body).toMatchObject({ start_date: '2027-02-10', start_time: '09:00', end_date: '2027-02-12', end_time: '18:00', starts_at: '2027-02-10T05:00:00.000Z', owner_id: 'u1', status: 'planned', currency: 'AED' })
    expect(r.body.team.map((t: { user_id: string }) => t.user_id)).toEqual(['u1', 'u4'])
    expect(r.body.registration_token).toMatch(/^[a-z]{20}$/)
    expect((await apexAdmin('POST', '/events', { name: 'Backwards', type: 'meeting', start_date: '2027-02-10', end_date: '2027-02-09' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events', { name: 'Bad type', type: 'party', start_date: '2027-02-10' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events', { name: 'Bad date', type: 'meeting', start_date: '2027-02-30' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events', { name: 'Foreign team', type: 'meeting', start_date: '2027-02-10', team_ids: ['u101'] })).status).toBe(422)
  })

  it('team: add / remove by the owner or marketing; the owner can’t be removed; a team member can edit but not manage', async () => {
    expect((await apexAdmin('POST', '/events/EV-1003/team', { user_id: 'u12' })).status).toBe(200)
    expect((await apexAdmin('POST', '/events/EV-1003/team', { user_id: 'u12' })).status).toBe(409)
    expect((await apexAdmin('DELETE', '/events/EV-1003/team/u3')).status).toBe(422)
    // u12 (Sales Agent, marketing hidden) is now on the team: can edit, not manage.
    const agent = as('u12')
    expect((await agent('PATCH', '/events/EV-1003', { location: 'Ballroom C' })).status).toBe(200)
    expect((await agent('POST', '/events/EV-1003/team', { user_id: 'u13' })).status).toBe(403)
    expect((await agent('DELETE', '/events/EV-1003')).status).toBe(403)
    expect((await apexAdmin('DELETE', '/events/EV-1003/team/u12')).status).toBe(200)
    expect((await agent('GET', '/events/EV-1003')).status).toBe(403)
  })

  it('DELETE cancels (soft): status cancelled, registration closed, attendees kept; no new attendees', async () => {
    const before = eventAttendees.filter((a) => a.eventId === 'EV-1003').length
    const r = await apexAdmin('DELETE', '/events/EV-1003')
    expect(r.body).toMatchObject({ status: 'cancelled', registration_open: false })
    expect(eventAttendees.filter((a) => a.eventId === 'EV-1003').length).toBe(before)
    const add = await apexAdmin('POST', '/events/EV-1003/attendees', { name: 'Too Late', email: email() })
    expect(add.status).toBe(409)
    expect(add.body.code).toBe('event_cancelled')
  })

  it('history records changes', async () => {
    await apexAdmin('PATCH', '/events/EV-1003', { budget: 15000, status: 'completed' })
    const d = (await apexAdmin('GET', '/events/EV-1003')).body
    // Completing also logs the follow-up tasks it created (eventFollowUp.ts), so look the change entry up.
    const change = d.history.find((h: { summary: string }) => h.summary.includes('Budget:'))
    expect(change.summary).toMatch(/Budget: 12000 → 15000/)
    expect(change.summary).toMatch(/Status: Confirmed → Completed/)
    expect(d.history.some((h: { summary: string }) => /follow-up task/.test(h.summary))).toBe(true)
  })
})

describe('public registration page', () => {
  const token = (id: string) => ev(id).registrationToken
  const pub = (id: string, body: unknown, client = 'client-a') =>
    api(null, 'POST', `/public/events/${token(id)}/register`, { body, headers: { 'X-Client-Id': client } })

  it('shows public fields only and registers → a lead with source Event', async () => {
    const info = await api(null, 'GET', `/public/events/${token('EV-1003')}`)
    expect(info.status).toBe(200)
    expect(info.body).toMatchObject({ name: 'Dubai Business Breakfast', registration_open: true, closed_reason: null, country: 'AE' })
    expect(JSON.stringify(info.body)).not.toMatch(/budget|owner|u3|EV-1003/)
    const before = leads.length
    const mail = email('pub')
    const r = await pub('EV-1003', { name: 'Public Person', company_name: 'Public Co', email: mail, mobile: '050 123 4567' })
    expect(r.status).toBe(200)
    // A new registration gets its ticket code (QR); nothing about the lead.
    expect(r.body).toEqual({ registered: true, message: expect.any(String), status: 'registered', waitlist_position: null, ticket_code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/) })
    expect(leads.length).toBe(before + 1)
    const lead = leads[leads.length - 1]
    expect(lead).toMatchObject({ sourceType: 'Event', sourceDetail: 'Dubai Business Breakfast', eventId: 'EV-1003', company: 'Public Co' })
    expect(eventAttendees.find((a) => a.email === mail)).toMatchObject({ source: 'public', mobile: '+971501234567' })
    // Registering again: the same answer, nothing new.
    const again = await pub('EV-1003', { name: 'Public Person', email: mail }, 'client-b')
    expect(again.status).toBe(200)
    expect(eventAttendees.filter((a) => a.email === mail)).toHaveLength(1)
  })

  it('unknown token → 404; a company without the Events module → the same 404', async () => {
    const missing = await api(null, 'GET', '/public/events/nosuchtokenatall')
    expect(missing.status).toBe(404)
    expect((await api(null, 'POST', '/public/events/nosuchtokenatall/register', { body: { name: 'A B', email: email() } })).status).toBe(404)
    disableEvents(CREST)
    const gated = await api(null, 'GET', `/public/events/${token('EV-5002')}`)
    expect(gated.status).toBe(404)
    expect(gated.text).toBe(missing.text)
  })

  it('closed registration → 409 registration_closed (closed flag, completed, cancelled)', async () => {
    const done = await pub('EV-1001', { name: 'Closed One', email: email() })
    expect(done.status).toBe(409)
    expect(done.body.code).toBe('registration_closed')
    await apexAdmin('PATCH', '/events/EV-1003', { registration_open: false })
    expect((await pub('EV-1003', { name: 'Closed Two', email: email() })).status).toBe(409)
    expect((await api(null, 'GET', `/public/events/${token('EV-1003')}`)).body.registration_open).toBe(false)
  })

  it('honeypot → a success answer, nothing stored', async () => {
    const before = eventAttendees.length
    const leadCount = leads.length
    const r = await pub('EV-1003', { name: 'Bot Bot', email: email(), website: 'http://spam.example' })
    expect(r.status).toBe(200)
    expect(r.body.registered).toBe(true)
    expect(eventAttendees.length).toBe(before)
    expect(leads.length).toBe(leadCount)
  })

  it('rate limit per client: the next attempt in the window → 429 rate_limited', async () => {
    for (let i = 0; i < PUBLIC_REGISTER_LIMIT; i++) expect((await pub('EV-1003', { name: `Rate ${i} Person`, email: email() }, 'client-r')).status).toBe(200)
    const blocked = await pub('EV-1003', { name: 'Rate Last', email: email() }, 'client-r')
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('rate_limited')
    // Another client isn't affected.
    expect((await pub('EV-1003', { name: 'Other Client', email: email() }, 'client-s')).status).toBe(200)
  })

  it('requires an email; invalid input → 422', async () => {
    expect((await pub('EV-1003', { name: 'No Email' })).status).toBe(422)
  })
})

describe('module gating', () => {
  it('a plan without Events → 403 module_not_in_plan on every /events path; task links to events refused', async () => {
    disableEvents(CREST)
    for (const [m, p] of [['GET', '/events'], ['POST', '/events'], ['GET', '/events/EV-5002'], ['POST', '/events/EV-5002/attendees']] as const) {
      const r = await crestAdmin(m, p, {})
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(r.body.code).toBe('module_not_in_plan')
    }
    expect((await crestAdmin('POST', '/tasks', { title: 'Booth', link: { type: 'event', id: 'EV-5002' } })).status).toBe(422)
    // Apex (Enterprise) keeps them.
    expect((await apexAdmin('GET', '/events')).status).toBe(200)
  })

  it('Starter / Trial plans don’t include events; Business and Enterprise do', async () => {
    const { planById } = await import('@/shared/mocks/data/plans')
    expect(planById('starter')?.modules).not.toContain('events')
    expect(planById('trial')?.modules).not.toContain('events')
    expect(planById('business')?.modules).toContain('events')
    expect(planById('enterprise')?.modules).toContain('events')
  })
})

describe('targets: events attended', () => {
  it('counts completed events (or started with a check-in) per team member and month', async () => {
    const gitex = ev('EV-1001')
    const month = eventLocalDate(gitex).slice(0, 7)
    const expected = eventsAttendedBy(APEX, 'u4', month)
    expect(expected).toBeGreaterThanOrEqual(1)
    const res = await apexAdmin('GET', `/targets?month=${month}`)
    const row = res.body.rows.find((r: { user_id: string }) => r.user_id === 'u4')
    expect(row.actuals.events).toBe(expected)
    // EV-1003 (upcoming, u6 on its team): counts once completed.
    const m2 = eventLocalDate(ev('EV-1003')).slice(0, 7)
    const before = eventsAttendedBy(APEX, 'u6', m2)
    await apexAdmin('PATCH', '/events/EV-1003', { status: 'completed' })
    expect(eventsAttendedBy(APEX, 'u6', m2)).toBe(before + 1)
    // Without the module: 0 (n/a).
    disableEvents(CREST)
    const crestMonth = eventLocalDate(ev('EV-5001')).slice(0, 7)
    expect(eventsAttendedBy(CREST, 'u104', crestMonth)).toBe(0)
  })
})

describe('tasks linked to events', () => {
  it('a task links to an event: the chip carries the event name and opens for people who can see it', async () => {
    const r = await apexAdmin('POST', '/tasks', { title: 'Book the stand', link: { type: 'event', id: 'EV-1003' } })
    expect(r.status).toBe(200)
    expect(r.body.link_view).toMatchObject({ type: 'event', id: 'EV-1003', label: 'Dubai Business Breakfast', available: true })
    const list = await apexAdmin('GET', '/tasks?related_type=event&related_id=EV-1003')
    expect(list.body.some((t: { id: string }) => t.id === r.body.id)).toBe(true)
    // Another company's event is unknown.
    expect((await apexAdmin('POST', '/tasks', { title: 'Foreign', link: { type: 'event', id: 'EV-5002' } })).status).toBe(422)
  })
})

describe('seeded registration links and cancelling', () => {
  it('demo events have stable, unique, 20-letter public tokens (a copied link survives a reseed)', async () => {
    const seeded = events.map((e) => e.registrationToken)
    expect(new Set(seeded).size).toBe(seeded.length)
    for (const t of seeded) expect(t).toMatch(/^[a-z]{20}$/)
    // Re-importing the seed module in a fresh module graph yields the same tokens.
    const { vi } = await import('vitest')
    vi.resetModules()
    const fresh = await import('@/shared/mocks/data/events')
    expect(fresh.events.map((e) => e.registrationToken)).toEqual(seeded)
  })

  it('a completed event can’t be cancelled (it would rewrite stats and the Events attended target)', async () => {
    const completed = events.find((e) => e.companyId === APEX && e.status === 'completed')!
    const res = await api(userToken('u1'), 'DELETE', `/events/${completed.id}`)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('event_completed')
    expect(events.find((e) => e.id === completed.id)!.status).toBe('completed')
  })
})
