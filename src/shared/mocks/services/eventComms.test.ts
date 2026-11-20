import { describe, expect, it } from 'vitest'
import { bulkEmails } from '@/shared/mocks/data/marketing'
import { eventAttendees, eventEmails, events } from '@/shared/mocks/data/events'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { remainingCapacity, usedOf } from '@/shared/mocks/services/billing'
import { runEventReminders } from '@/shared/mocks/services/eventComms'
import { googleCalendarUrl, outlookCalendarUrl } from '@/modules/events/lib/calendar'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Invitations (bulk email linked to the event), reminders (once, timezone, email limit), calendar files and links. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
const HOUR = 3_600_000
let n = 0
const email = () => `cm-${++n}-${Date.now().toString(36)}@visitor-${n}.ae`

describe('invite an audience', () => {
  it('creates a draft bulk email linked to the event; {{event.registration_url}} renders in the test send', async () => {
    const r = await apexAdmin('POST', '/events/EV-1003/invite', { statuses: [] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'draft', event_id: 'EV-1003' })
    expect(r.body.body).toContain('{{event.registration_url}}')
    const row = bulkEmails.find((b) => b.id === r.body.id)!
    expect(row.companyId).toBe('co_apex')
    expect(row.eventId).toBe('EV-1003')
    // The bulk email builder's own endpoints work on it (test send renders the variables).
    const test = await apexAdmin('POST', `/marketing/emails/${r.body.id}/test`, { to: 'me@apexaora.ae' })
    expect(test.status).toBe(200)
    const token = events.find((e) => e.id === 'EV-1003')!.registrationToken
    expect(test.body.html).toContain(`/e/${token}`)
    expect(test.body.subject).toContain('Dubai Business Breakfast')
  })

  it('needs the Marketing edit right; a team member without it gets 403; another company’s event 404', async () => {
    // u6 (Sales Agent) is on EV-1003's team but has no Marketing access.
    expect((await as('u6')('POST', '/events/EV-1003/invite', {})).status).toBe(403)
    expect((await crestAdmin('POST', '/events/EV-1003/invite', {})).status).toBe(404)
    expect((await apexAdmin('POST', '/events/EV-1001/invite', {})).status).toBe(409) // completed
  })
})

describe('reminders', () => {
  it('once per registered attendee, reminder_hours before the start (UTC instant), not to the waitlist', async () => {
    const e = events.find((x) => x.id === 'EV-1004')! // webinar, 24 h default, has a waitlist
    const start = Date.parse(e.startsAt)
    const registered = eventAttendees.filter((a) => a.eventId === e.id && a.status === 'registered')
    expect(runEventReminders('co_apex', start - 25 * HOUR)).toBe(0)
    const before = usedOf('co_apex', 'emailsPerMonth')
    expect(runEventReminders('co_apex', start - 23 * HOUR)).toBe(registered.length)
    expect(usedOf('co_apex', 'emailsPerMonth')).toBe(before + registered.length)
    // Once only.
    expect(runEventReminders('co_apex', start - 22 * HOUR)).toBe(0)
    const logged = eventEmails.filter((m) => m.eventId === e.id && m.kind === 'reminder')
    expect(logged).toHaveLength(registered.length)
    // Company time in the subject (Dubai: 14:00 local).
    expect(logged[0].subject).toContain('at 14:00 (Asia/Dubai)')
    expect(eventAttendees.filter((a) => a.eventId === e.id && a.status === 'waitlisted').every((a) => !a.reminderSentAt)).toBe(true)
    // After the start nothing is sent; another company's run touches nothing here.
    expect(runEventReminders('co_crest', start - 23 * HOUR)).toBe(0)
  })

  it('a custom reminder window; 0 turns it off; the email allowance running out logs skipped (still once)', async () => {
    const r = await crestAdmin('POST', '/events', { name: 'Crest reminder', type: 'meeting', start_date: '2027-06-01', start_time: '10:00', reminder_hours: 2 })
    const id = r.body.id
    await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Remind Me', email: email() })
    await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Remind Two', email: email() })
    const e = events.find((x) => x.id === id)!
    // Riyadh is UTC+3: 10:00 local = 07:00 UTC.
    expect(e.startsAt).toBe('2027-06-01T07:00:00.000Z')
    const start = Date.parse(e.startsAt)
    expect(runEventReminders('co_crest', start - 3 * HOUR)).toBe(0)
    usageSimulation.push({ companyId: 'co_crest', key: 'emailsPerMonth', offset: remainingCapacity('co_crest', 'emailsPerMonth') })
    expect(remainingCapacity('co_crest', 'emailsPerMonth')).toBe(0)
    expect(runEventReminders('co_crest', start - 1 * HOUR)).toBe(2)
    const logged = eventEmails.filter((m) => m.eventId === id && m.kind === 'reminder')
    expect(logged.every((m) => m.status === 'skipped' && m.skipReason === 'limit')).toBe(true)
    expect(runEventReminders('co_crest', start - 0.5 * HOUR)).toBe(0)
    // 0 = off.
    const off = await crestAdmin('POST', '/events', { name: 'No reminder', type: 'meeting', start_date: '2027-06-02', start_time: '10:00', reminder_hours: 0 })
    await crestAdmin('POST', `/events/${off.body.id}/attendees`, { name: 'Nobody Reminds', email: email() })
    expect(runEventReminders('co_crest', Date.parse(events.find((x) => x.id === off.body.id)!.startsAt) - HOUR)).toBe(0)
    // The email log is served to people who see the event.
    const log = await crestAdmin('GET', `/events/${id}/emails`)
    expect(log.body.some((m: { kind: string; skip_reason: string }) => m.kind === 'reminder' && m.skip_reason === 'limit')).toBe(true)
  })
})

describe('calendar', () => {
  it('.ics for the event (token) and per attendee (code); unknown → 404', async () => {
    const e = events.find((x) => x.id === 'EV-1004')!
    const r = await api(null, 'GET', `/public/events/${e.registrationToken}/calendar.ics`)
    expect(r.status).toBe(200)
    expect(r.text).toContain('BEGIN:VCALENDAR')
    expect(r.text).toContain('SUMMARY:AI for Hotels Webinar')
    expect(r.text).toMatch(/DTSTART:\d{8}T100000Z/) // 14:00 Dubai = 10:00 UTC
    expect(r.text).not.toContain('EV-1004')
    const a = eventAttendees.find((x) => x.eventId === e.id && x.status === 'registered')!
    const mine = await api(null, 'GET', `/public/tickets/${a.ticketCode}/calendar.ics`)
    expect(mine.status).toBe(200)
    expect(mine.text).toContain(`/t/${a.ticketCode}`)
    expect((await api(null, 'GET', '/public/tickets/ZZZZ-ZZZZ-ZZZZ/calendar.ics')).status).toBe(404)
    expect((await api(null, 'GET', '/public/events/nosuchtoken/calendar.ics')).status).toBe(404)
  })

  it('Google / Outlook links carry the UTC times (timed) or dates (all day)', () => {
    const timed = { uid: 'x', name: 'Expo', location: 'Hall 1', onlineUrl: '', startsAt: '2027-03-10T05:00:00.000Z', endsAt: '2027-03-10T13:00:00.000Z', startDate: '2027-03-10', endDate: '2027-03-10', startTime: '09:00' }
    expect(googleCalendarUrl(timed)).toContain('dates=20270310T050000Z%2F20270310T130000Z')
    expect(outlookCalendarUrl(timed)).toContain('startdt=2027-03-10T05%3A00%3A00.000Z')
    const allDay = { ...timed, startTime: null, endDate: '2027-03-12' }
    expect(googleCalendarUrl(allDay)).toContain('dates=20270310%2F20270313')
    expect(outlookCalendarUrl(allDay)).toContain('allday=true')
  })
})
