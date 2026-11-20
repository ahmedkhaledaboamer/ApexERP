import { describe, expect, it } from 'vitest'
import { leads } from '@/shared/mocks/db'
import { tasks } from '@/shared/mocks/data/tasks'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { audiences } from '@/shared/mocks/data/marketingGrowth'
import { matchRules } from '@/shared/mocks/services/audiences'
import { followUpKey } from '@/shared/mocks/services/eventFollowUp'
import { EMPTY_RULES } from '@/modules/marketing/growth/types'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { checklistDueDate } from '@/modules/events/lib/checklistPlan'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Post-event automation: follow-up tasks once, attended / no-show segments, the two follow-up emails. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
let n = 0
const email = () => `fu-${++n}-${Date.now().toString(36)}@visitor-${n}.ae`

async function eventWithPeople(call = apexAdmin): Promise<{ id: string; came: string; missed: string; waiting: string }> {
  const r = await call('POST', '/events', { name: `Follow-up ${++n}`, type: 'meeting', start_date: '2026-11-01', capacity: 2, follow_up_days: 3 })
  const id = r.body.id
  const a = await call('POST', `/events/${id}/attendees`, { name: 'Came Along', email: email() })
  const b = await call('POST', `/events/${id}/attendees`, { name: 'Missed It', email: email() })
  const c = await call('POST', `/events/${id}/attendees`, { name: 'Wait Listed', email: email() })
  expect(c.body.status).toBe('waitlisted')
  await call('POST', `/events/${id}/attendees/${a.body.attendee.id}/check-in`, {})
  return { id, came: a.body.lead_id, missed: b.body.lead_id, waiting: c.body.lead_id }
}

describe('follow-up tasks when the event is completed', () => {
  it('one task per lead with a seat (not the waitlist), for the lead’s owner, due N days later (company calendar); once only', async () => {
    const { id, came, missed, waiting } = await eventWithPeople()
    const r = await apexAdmin('PATCH', `/events/${id}`, { status: 'completed' })
    expect(r.status).toBe(200)
    const mine = tasks.filter((t) => t.templateTaskId === followUpKey(id))
    expect(mine.map((t) => t.link?.id).sort()).toEqual([came, missed].sort())
    expect(mine.some((t) => t.link?.id === waiting)).toBe(false)
    const due = checklistDueDate(companyDayOf('co_apex').today, 3, [0, 6])
    for (const t of mine) {
      expect(t.dueDate).toBe(due)
      expect(t.ownerId).toBe(leads.find((l) => l.id === t.link!.id)!.ownerId)
      expect(t.companyId).toBe('co_apex')
    }
    expect(events.find((e) => e.id === id)!.followUpTasksAt).toBeTruthy()
    // Reopen and complete again: nothing new.
    await apexAdmin('PATCH', `/events/${id}`, { status: 'confirmed' })
    await apexAdmin('PATCH', `/events/${id}`, { status: 'completed' })
    expect(tasks.filter((t) => t.templateTaskId === followUpKey(id))).toHaveLength(2)
  })

  it('the company default comes from Settings › Automation; Crest’s weekend applies', async () => {
    const saved = await crestAdmin('PUT', '/settings/automation', { event_follow_up_days: 1, event_reminder_hours: 6 })
    expect(saved.status).toBe(200)
    const r = await crestAdmin('POST', '/events', { name: 'Crest fu', type: 'meeting', start_date: '2026-11-01' })
    expect(r.body).toMatchObject({ follow_up_days: 1, reminder_hours: 6 })
    const att = await crestAdmin('POST', `/events/${r.body.id}/attendees`, { name: 'Crest Person', email: email() })
    await crestAdmin('PATCH', `/events/${r.body.id}`, { status: 'completed' })
    const t = tasks.find((x) => x.templateTaskId === followUpKey(r.body.id))!
    expect(t.link).toEqual({ type: 'lead', id: att.body.lead_id })
    expect(t.dueDate).toBe(checklistDueDate(companyDayOf('co_crest').today, r.body.follow_up_days, [5, 6]))
  })

  it('seeded completed events already had their follow-ups (no burst on first edit)', async () => {
    const before = tasks.length
    await apexAdmin('PATCH', '/events/EV-1001', { location: 'DWTC Hall 7' })
    expect(tasks.length).toBe(before)
  })
})

describe('attended / no-show segments (Audiences rules)', () => {
  it('attended = checked in; no_show = seat, never checked in; waitlist excluded', async () => {
    const { id, came, missed, waiting } = await eventWithPeople()
    const ids = (presence: 'any' | 'attended' | 'no_show') => matchRules('co_apex', { ...EMPTY_RULES, eventIds: [id], eventPresence: presence }).map((l) => l.id)
    expect(ids('attended')).toEqual([came])
    expect(ids('no_show')).toEqual([missed])
    expect(ids('any').sort()).toEqual([came, missed, waiting].sort())
    // Through the API: a rule needs events.
    expect((await apexAdmin('POST', '/marketing/audiences/preview', { rules: { event_presence: 'attended' } })).status).toBe(422)
    const p = await apexAdmin('POST', '/marketing/audiences/preview', { rules: { event_ids: [id], event_presence: 'no_show' } })
    expect(p.status).toBe(200)
  })
})

describe('send follow-up', () => {
  it('composes two drafts (attended vs no-shows) on two dynamic audiences; the survey link renders for attendees', async () => {
    const { id, came } = await eventWithPeople()
    expect((await apexAdmin('POST', `/events/${id}/follow-up`, {})).status).toBe(409) // not completed yet
    await apexAdmin('PATCH', `/events/${id}`, { status: 'completed' })
    const r = await apexAdmin('POST', `/events/${id}/follow-up`, {})
    expect(r.status).toBe(200)
    expect(r.body.attended).toMatchObject({ status: 'draft', event_id: id })
    expect(r.body.attended.body).toContain('{{event.survey_url}}')
    expect(r.body.no_show.audience.audience_id).toBe(r.body.no_show_audience_id)
    expect(audiences.find((a) => a.id === r.body.attended_audience_id)?.rules.eventPresence).toBe('attended')
    // Again: the audiences are reused.
    const again = await apexAdmin('POST', `/events/${id}/follow-up`, {})
    expect(again.body.attended_audience_id).toBe(r.body.attended_audience_id)
    // The test send of the attended email renders this lead's survey link when it's the first recipient.
    const test = await apexAdmin('POST', `/marketing/emails/${r.body.attended.id}/test`, { to: 'me@apexaora.ae' })
    const token = eventAttendees.find((a) => a.eventId === id && a.leadId === came)!.surveyToken
    expect(test.body.html).toContain(`/s/${token}`)
    // No Marketing edit right → 403 (u6 Sales Agent).
    expect((await as('u6')('POST', `/events/${id}/follow-up`, {})).status).toBe(403)
  })
})
