import { describe, expect, it } from 'vitest'
import { activities, leads, users } from '@/shared/mocks/db'
import { eventAttendees, eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventCaptures, eventSurveyResponses } from '@/shared/mocks/data/eventExtras'
import { captureFollowUpNotices } from '@/shared/mocks/data/eventSections'
import { automationRulesFor, isWonStatus } from '@/shared/mocks/data/lookups'
import { notifications } from '@/shared/mocks/data/tasks'
import { companyById } from '@/shared/mocks/data/tenancy'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { zonedParts } from '@/shared/lib/zonedTime'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'
import { followUpDueOf, followUpStateOf, personKeyOf, runBoothFollowUps } from '@/shared/mocks/services/eventSections'
import { matchesPerson, matchesBoothLead, NO_ATTENDEE_FILTERS, NO_BOOTH_FILTERS, typeInsights } from '@/modules/events/lib/sections'
import { attendeeDirectoryMapper, boothLeadsMapper } from '@/shared/api/eventSectionMappers'

/**
 * Cross-event sections (docs/API.md › Events › Attendees directory, Booth leads, Event analytics):
 * de-duplication, follow-up states + overdue notices (once, company timezone), bulk assign through the
 * lead update path, analytics numbers recomputed from the raw rows in both companies.
 */

useSeedPerTest()

const APEX = 'co_apex'
const CREST = 'co_crest'
const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const admin = { [APEX]: as('u1'), [CREST]: as('u101') } as const
const tz = (co: string) => companyById(co)!.regional.timezone

describe('attendees directory', () => {
  it('one row per person (email, else lead): a repeat attendee is merged across events', async () => {
    for (const co of [APEX, CREST] as const) {
      const r = await admin[co]('GET', '/events/attendees')
      expect(r.status).toBe(200)
      const dir = attendeeDirectoryMapper.fromApi(r.body)
      const expectedKeys = new Set(eventAttendees.filter((a) => a.companyId === co).map(personKeyOf))
      expect(dir.people).toHaveLength(expectedKeys.size)
      expect(new Set(dir.people.map((p) => p.key)).size).toBe(dir.people.length)
      // The seed's repeat people attend 2+ events.
      const repeat = dir.people.filter((p) => p.registrations.length >= 2)
      expect(repeat.length).toBeGreaterThan(0)
      for (const p of repeat) {
        expect(new Set(p.registrations.map((x) => x.eventId)).size).toBe(p.registrations.length)
        expect(p.eventsRegistered).toBe(p.registrations.filter((x) => x.status !== 'cancelled').length)
      }
      // Keys never carry the email.
      expect(dir.people.every((p) => !p.key.includes('@'))).toBe(true)
    }
  })

  it('a person without an email is grouped by lead; the same email in another case is the same person', () => {
    expect(personKeyOf({ email: 'A@B.co', leadId: 'L1', id: 'x' })).toBe(personKeyOf({ email: 'a@b.co', leadId: 'L2', id: 'y' }))
    expect(personKeyOf({ email: '', leadId: 'L1', id: 'x' })).toBe(personKeyOf({ email: '', leadId: 'L1', id: 'y' }))
    expect(personKeyOf({ email: '', leadId: null, id: 'x' })).not.toBe(personKeyOf({ email: '', leadId: null, id: 'y' }))
  })

  it('filters: event, type, checked in, lead, company', async () => {
    const dir = attendeeDirectoryMapper.fromApi((await admin[APEX]('GET', '/events/attendees')).body)
    const at = (f: Partial<typeof NO_ATTENDEE_FILTERS>) => dir.people.filter((p) => matchesPerson(p, { ...NO_ATTENDEE_FILTERS, ...f }))
    expect(at({}).length).toBe(dir.people.length)
    const webinar = at({ eventId: 'EV-1006' })
    expect(webinar.length).toBeGreaterThan(0)
    expect(webinar.every((p) => p.registrations.some((r) => r.eventId === 'EV-1006'))).toBe(true)
    expect(at({ type: 'webinar' }).length).toBeGreaterThanOrEqual(webinar.length)
    expect(at({ checkedIn: 'no' }).every((p) => p.eventsAttended === 0)).toBe(true)
    expect(at({ lead: 'without' }).every((p) => !p.leadId)).toBe(true)
    const first = dir.people.find((p) => p.companyName)!
    expect(at({ company: first.companyName.slice(0, 4).toUpperCase() }).some((p) => p.key === first.key)).toBe(true)
  })

  it('export: marketing full only; Do Not Contact people without email / mobile', async () => {
    const ok = await as('u7')('GET', '/events/attendees/export')
    expect(ok.status).toBe(200)
    for (const row of ok.body as { do_not_contact: boolean; email: string; mobile: string }[]) {
      if (row.do_not_contact) expect([row.email, row.mobile]).toEqual(['', ''])
    }
    expect((await as('u3')('GET', '/events/attendees/export')).status).toBe(403)
    expect((await as('u4')('GET', '/events/attendees/export')).status).toBe(403)
  })
})

describe('booth leads: follow-up state', () => {
  const capture = (co: string, leadId: string, capturedAt: string) => ({ id: `T-${leadId}`, companyId: co, leadId, capturedAt })
  const openLead = (co: string) => leads.find((l) => l.companyId === co && l.status === 'New' && !eventCaptures.some((c) => c.leadId === l.id))!

  it('untouched → contacted (outreach after the capture) → meeting; won / lost from the status; no lead', () => {
    const lead = openLead(APEX)
    const at = '2026-03-01T08:00:00.000Z'
    // An activity BEFORE the capture and the capture's own meeting activity don't count.
    activities.push({ companyId: APEX, id: 'A-T-before', leadId: lead.id, type: 'call', summary: 'x', userId: 'u4', at: '2026-02-01T08:00:00.000Z' })
    activities.push({ companyId: APEX, id: 'A-ECP-T1', leadId: lead.id, type: 'meeting', summary: 'Booth capture', userId: 'u4', at: '2026-03-01T08:00:01.000Z' })
    expect(followUpStateOf(capture(APEX, lead.id, at))).toBe('untouched')
    activities.push({ companyId: APEX, id: 'A-T-call', leadId: lead.id, type: 'email', summary: 'x', userId: 'u4', at: '2026-03-02T08:00:00.000Z' })
    expect(followUpStateOf(capture(APEX, lead.id, at))).toBe('contacted')
    activities.push({ companyId: APEX, id: 'A-T-meet', leadId: lead.id, type: 'meeting', summary: 'x', userId: 'u4', at: '2026-03-03T08:00:00.000Z' })
    expect(followUpStateOf(capture(APEX, lead.id, at))).toBe('meeting')
    lead.status = 'Won'
    expect(followUpStateOf(capture(APEX, lead.id, at))).toBe('won')
    lead.status = 'Not interested'
    expect(followUpStateOf(capture(APEX, lead.id, at))).toBe('lost')
    expect(followUpStateOf({ id: 'T-none', companyId: APEX, leadId: null, capturedAt: at })).toBe('no_lead')
    // Another company's activity on a same-id lead never counts.
    const crest = openLead(CREST)
    activities.push({ companyId: APEX, id: 'A-T-x', leadId: crest.id, type: 'call', summary: 'x', userId: 'u4', at: '2026-03-02T08:00:00.000Z' })
    expect(followUpStateOf(capture(CREST, crest.id, at))).toBe('untouched')
  })

  it('the due day is the capture day in the COMPANY timezone + eventFollowUpDays', () => {
    // 20:30 UTC = 00:30 the next day in Dubai (UTC+4) but 23:30 the same day in Riyadh (UTC+3).
    const capturedAt = '2027-01-10T20:30:00.000Z'
    expect(followUpDueOf({ companyId: APEX, capturedAt }, '2027-01-13', 2)).toEqual({ due: '2027-01-13', daysOverdue: 0 })
    expect(followUpDueOf({ companyId: CREST, capturedAt }, '2027-01-13', 2)).toEqual({ due: '2027-01-12', daysOverdue: 1 })
  })

  it('the seed has mixed states in both companies, including overdue and not-yet-due untouched captures', async () => {
    for (const co of [APEX, CREST] as const) {
      const b = boothLeadsMapper.fromApi((await admin[co]('GET', '/events/booth-leads')).body)
      const states = new Set(b.rows.map((r) => r.state))
      for (const s of ['untouched', 'contacted', 'meeting', 'won', 'lost'] as const) expect(states, `${co} ${s}`).toContain(s)
      expect(b.rows.some((r) => r.overdue)).toBe(true)
      expect(b.rows.some((r) => r.state === 'untouched' && !r.overdue)).toBe(true)
      expect(b.followUpDays).toBe(automationRulesFor(co).eventFollowUpDays)
      expect(b.rows.filter((r) => matchesBoothLead(r, { ...NO_BOOTH_FILTERS, overdueOnly: true })).every((r) => r.overdue && r.state === 'untouched')).toBe(true)
      // Overdue = untouched and past capture day + N (company calendar).
      const today = todayIsoIn(tz(co))
      for (const r of b.rows) expect(r.overdue).toBe(r.state === 'untouched' && r.followUpDue < today)
    }
  })

  it('a longer follow-up window (Settings › Automation) moves the overdue line', async () => {
    automationRulesFor(APEX).eventFollowUpDays = 60
    const b = boothLeadsMapper.fromApi((await admin[APEX]('GET', '/events/booth-leads')).body)
    const today = todayIsoIn(tz(APEX))
    for (const r of b.rows) expect(r.followUpDue).toBe(addDaysIso(zonedParts(r.capturedAt, tz(APEX)).date, 60))
    expect(b.rows.filter((r) => r.overdue).every((r) => r.followUpDue < today)).toBe(true)
  })
})

describe('booth leads: overdue notice, once per capture', () => {
  it('notifies the lead owner once; re-running (alerts, list) never duplicates; the other company is untouched', async () => {
    const crestBefore = notifications.filter((n) => n.companyId === CREST).length
    const sent = runBoothFollowUps(APEX)
    expect(sent).toBeGreaterThan(0)
    const notes = notifications.filter((n) => n.companyId === APEX && n.type === 'event-follow-up')
    expect(notes).toHaveLength(sent)
    for (const n of notes) expect(users.find((u) => u.id === n.userId)?.companyId).toBe(APEX)
    expect(runBoothFollowUps(APEX)).toBe(0)
    await admin[APEX]('GET', '/alerts')
    await admin[APEX]('GET', '/events/booth-leads')
    expect(notifications.filter((n) => n.companyId === APEX && n.type === 'event-follow-up')).toHaveLength(sent)
    expect(notifications.filter((n) => n.companyId === CREST).length).toBe(crestBefore)
    // Every overdue capture with a lead is marked, so it's never re-checked.
    const overdue = boothLeadsMapper.fromApi((await admin[APEX]('GET', '/events/booth-leads')).body).rows.filter((r) => r.overdue)
    for (const r of overdue) expect(captureFollowUpNotices.some((n) => n.companyId === APEX && n.captureId === r.id)).toBe(true)
  })

  it('the owner sees it in their alerts (stored, follow-up type)', async () => {
    runBoothFollowUps(CREST)
    const note = notifications.find((n) => n.companyId === CREST && n.type === 'event-follow-up')!
    expect(note).toBeTruthy()
    const alerts = await as(note.userId)('GET', '/alerts')
    expect((alerts.body as { id: string; type: string }[]).some((a) => a.id === note.id && a.type === 'follow-up')).toBe(true)
  })

  it('a capture contacted before it fell due is never notified', () => {
    const c = eventCaptures.find((x) => x.companyId === APEX && x.leadId && followUpStateOf(x) === 'untouched')!
    activities.push({ companyId: APEX, id: 'A-T-touch', leadId: c.leadId!, type: 'call', summary: 'x', userId: 'u4', at: new Date(Date.parse(c.capturedAt) + 3_600_000).toISOString() })
    runBoothFollowUps(APEX)
    expect(captureFollowUpNotices.some((n) => n.captureId === c.id)).toBe(false)
  })
})

describe('booth leads: bulk assign owner through the lead update', () => {
  const capturesOf = (co: string) => eventCaptures.filter((c) => c.companyId === co && c.leadId)

  it('Sales Manager (sales full) reassigns; the lead owner changes', async () => {
    const c = capturesOf(APEX)[0]
    const r = await as('u3')('POST', '/events/booth-leads/assign', { capture_ids: [c.id], owner_id: 'u5' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ updated: 1, skipped: [] })
    expect(leads.find((l) => l.id === c.leadId)!.ownerId).toBe('u5')
  })

  it('Sales Agent and Marketing Manager (no lead reassign right) → 403', async () => {
    const c = capturesOf(APEX)[0]
    expect((await as('u4')('POST', '/events/booth-leads/assign', { capture_ids: [c.id], owner_id: 'u4' })).status).toBe(403)
    expect((await as('u7')('POST', '/events/booth-leads/assign', { capture_ids: [c.id], owner_id: 'u4' })).status).toBe(403)
  })

  it('Department Head (sales team): lead scope applies per lead — outside the team is skipped', async () => {
    // u10 heads delivery (u11, u12, u14…); u12 is a Sales Agent in u10's team. Put u10 on the events so the captures are visible.
    for (const e of events.filter((x) => x.companyId === APEX)) await admin[APEX]('POST', `/events/${e.id}/team`, { user_id: 'u10' })
    const ids = capturesOf(APEX).map((c) => c.id)
    const r = await as('u10')('POST', '/events/booth-leads/assign', { capture_ids: ids, owner_id: 'u12' })
    expect(r.status).toBe(200)
    expect(r.body.skipped.length).toBeGreaterThan(0)
    expect(r.body.updated + r.body.skipped.length).toBeLessThanOrEqual(ids.length)
    // Outside the team: refused by the lead update (403 message), the lead keeps its owner.
    expect((r.body.skipped as { reason: string }[]).every((s) => s.reason !== 'not_found')).toBe(true)
  })

  it('unknown / foreign captures are skipped as not_found; a foreign owner is a 422 like a missing one', async () => {
    const foreign = capturesOf(CREST)[0]
    const r = await as('u3')('POST', '/events/booth-leads/assign', { capture_ids: [foreign.id, 'ECP-NOPE'], owner_id: 'u5' })
    expect(r.body).toEqual({ updated: 0, skipped: [{ capture_id: foreign.id, reason: 'not_found' }, { capture_id: 'ECP-NOPE', reason: 'not_found' }] })
    expect(leads.find((l) => l.id === foreign.leadId)!.ownerId).not.toBe('u5')
    const own = capturesOf(APEX)[0]
    const a = await as('u3')('POST', '/events/booth-leads/assign', { capture_ids: [own.id], owner_id: 'u104' })
    const b = await as('u3')('POST', '/events/booth-leads/assign', { capture_ids: [own.id], owner_id: 'u-missing' })
    expect([a.status, b.status]).toEqual([422, 422])
    expect(a.body).toEqual(b.body)
  })
})

describe('event analytics', () => {
  /** Recomputed from the raw stores (not through the service). */
  function recompute(co: string, from: string, to: string) {
    const today = todayIsoIn(tz(co))
    const held = events.filter((e) => {
      const d = zonedParts(e.startsAt, tz(co)).date
      return e.companyId === co && e.status !== 'cancelled' && d >= from && d <= to && d <= today
    })
    let attendees = 0
    let checkedIn = 0
    let created = 0
    let won = 0
    let wonValue = 0
    let cplCost = 0
    let cplLeads = 0
    for (const e of held) {
      const atts = eventAttendees.filter((a) => a.companyId === co && a.eventId === e.id)
      const seated = atts.filter((a) => a.status === 'registered')
      attendees += seated.length
      checkedIn += seated.filter((a) => a.checkedInAt).length
      const c = atts.filter((a) => a.leadOutcome === 'created').length
      created += c
      const leadIds = [...new Set(atts.map((a) => a.leadId).filter(Boolean))]
      const wonLeads = leads.filter((l) => l.companyId === co && leadIds.includes(l.id) && isWonStatus(co, l.status))
      won += wonLeads.length
      wonValue += wonLeads.reduce((s, l) => s + l.value, 0)
      const lines = eventBudgetLines.filter((l) => l.companyId === co && l.eventId === e.id)
      const actual = lines.length ? lines.reduce((s, l) => s + l.actual, 0) : e.actualCost
      const cost = actual ?? e.budget
      if (cost !== null && c > 0) {
        cplCost += cost
        cplLeads += c
      }
    }
    return { held, attendees, checkedIn, created, won, wonValue, cpl: cplLeads ? Math.round((cplCost / cplLeads) * 100) / 100 : null }
  }

  for (const co of [APEX, CREST] as const) {
    it(`${co}: KPIs equal a recomputation from the raw rows for a fixed range; each row's CPL equals the event stats`, async () => {
      const today = todayIsoIn(tz(co))
      const from = addDaysIso(today, -365)
      const r = await admin[co]('GET', `/events/analytics?preset=custom&from=${from}&to=${today}&compare=false`)
      expect(r.status).toBe(200)
      const x = recompute(co, from, today)
      expect(x.held.length).toBeGreaterThanOrEqual(3)
      expect(r.body.kpis).toMatchObject({ events: x.held.length, attendees: x.attendees, checked_in: x.checkedIn, leads_created: x.created, deals_won: x.won, won_value: x.wonValue, cost_per_lead: x.cpl })
      expect(r.body.previous_kpis).toBeNull()
      expect((r.body.rows as { id: string }[]).map((row) => row.id).sort()).toEqual(x.held.map((e) => e.id).sort())
      for (const row of r.body.rows as { id: string; cost_per_lead: number | null; cost_per_lead_basis: string | null; nps: number | null }[]) {
        const stats = await admin[co]('GET', `/events/${row.id}/stats`)
        expect(row.cost_per_lead, row.id).toBe(stats.body.cost_per_lead)
        expect(row.cost_per_lead_basis, row.id).toBe(stats.body.cost_per_lead_basis)
        const survey = await admin[co]('GET', `/events/${row.id}/survey`)
        expect(row.nps).toBe(survey.body.nps)
      }
      // The budget basis is used when there's no actual cost (a webinar held yesterday).
      expect((r.body.rows as { cost_per_lead_basis: string | null }[]).some((row) => row.cost_per_lead_basis === 'budget')).toBe(true)
      // Average NPS = mean of the events' NPS.
      const npsRows = (r.body.rows as { nps: number | null }[]).filter((row) => row.nps !== null)
      expect(r.body.kpis.average_nps).toBe(Math.round(npsRows.reduce((s, row) => s + (row.nps ?? 0), 0) / npsRows.length))
      expect(eventSurveyResponses.some((s) => s.companyId === co)).toBe(true)
    })
  }

  it('previous period and presets; access needs marketing view + reports full | marketing', async () => {
    const r = await admin[APEX]('GET', '/events/analytics?preset=ytd')
    expect(r.status).toBe(200)
    expect(r.body.previous).not.toBeNull()
    expect(r.body.previous_kpis).not.toBeNull()
    expect((await as('u7')('GET', '/events/analytics')).status).toBe(200)
    expect((await as('u3')('GET', '/events/analytics')).status).toBe(403)
    expect((await as('u4')('GET', '/events/analytics')).status).toBe(403)
    expect((await admin[APEX]('GET', '/events/analytics?preset=custom&from=2026-05-01&to=2026-04-01')).status).toBe(400)
    expect((await admin[APEX]('GET', '/events/analytics?preset=nope')).status).toBe(400)
  })

  it('insight cards pick the best / weakest type by ROI, else by cost per lead', () => {
    const t = (type: 'meeting' | 'webinar' | 'exhibition', roi: number | null, cpl: number | null) => ({ type, events: 1, leadsCreated: 1, cost: 1, costPerLead: cpl, wonValue: 0, roi })
    expect(typeInsights([t('meeting', 10, 5), t('webinar', -20, 1), t('exhibition', null, 2)])).toMatchObject({ best: { type: 'meeting' }, worst: { type: 'webinar' }, by: 'roi' })
    expect(typeInsights([t('meeting', null, 50), t('webinar', null, 10)])).toMatchObject({ best: { type: 'webinar' }, worst: { type: 'meeting' }, by: 'cpl' })
    expect(typeInsights([])).toEqual({ best: null, worst: null, by: null })
  })
})
