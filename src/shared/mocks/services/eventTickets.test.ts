import { describe, expect, it } from 'vitest'
import { leads } from '@/shared/mocks/db'
import { eventAttendees, eventEmails, events } from '@/shared/mocks/data/events'
import { notifications } from '@/shared/mocks/data/tasks'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Tickets, capacity, waitlist (promotion on cancel), custom questions; existing registration rules kept. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
let n = 0
const email = () => `tix-${++n}-${Date.now().toString(36)}@visitor-${n}.ae`

async function fixture(): Promise<{ id: string; token: string }> {
  const r = await apexAdmin('POST', '/events', {
    name: 'Ticketed summit',
    type: 'conference',
    start_date: '2027-05-04',
    registration_open: true,
    capacity: 3,
    questions: [
      { label: 'Dietary requirements', type: 'single', options: ['None', 'Vegan'], required: true },
      { label: 'Interests', type: 'multi', options: ['AI', 'OCR', 'BI'] },
    ],
  })
  expect(r.status).toBe(200)
  return { id: r.body.id, token: events.find((e) => e.id === r.body.id)!.registrationToken }
}
const pub = (token: string, body: unknown, client = `c-${++n}`) => api(null, 'POST', `/public/events/${token}/register`, { body, headers: { 'X-Client-Id': client } })

describe('ticket types', () => {
  it('create / list with counts; unique names; capacity can’t drop below the seats taken; delete only when unused', async () => {
    const { id } = await fixture()
    const vip = await apexAdmin('POST', `/events/${id}/ticket-types`, { name: 'VIP', capacity: 1, price: 500 })
    expect(vip.status).toBe(200)
    expect(vip.body).toMatchObject({ name: 'VIP', capacity: 1, price: 500, currency: 'AED', remaining: 1, on_sale: true })
    expect((await apexAdmin('POST', `/events/${id}/ticket-types`, { name: 'vip' })).status).toBe(409)
    expect((await apexAdmin('POST', `/events/${id}/ticket-types`, { name: 'Bad', price: -1 })).status).toBe(422)
    await apexAdmin('POST', `/events/${id}/attendees`, { name: 'Vip Person', email: email(), ticket_type_id: vip.body.id })
    const list = await apexAdmin('GET', `/events/${id}/ticket-types`)
    expect(list.body[0]).toMatchObject({ registered: 1, remaining: 0 })
    expect((await apexAdmin('PATCH', `/events/${id}/ticket-types/${vip.body.id}`, { capacity: null })).body.remaining).toBe(2) // bounded by the event (3 − 1)
    expect((await apexAdmin('DELETE', `/events/${id}/ticket-types/${vip.body.id}`)).status).toBe(409)
    // Another company's event / ticket: 404.
    expect((await crestAdmin('GET', `/events/${id}/ticket-types`)).status).toBe(404)
  })

  it('the public page shows tickets, remaining seats and questions; registration needs a ticket on sale and required answers', async () => {
    const { id, token } = await fixture()
    const t = await apexAdmin('POST', `/events/${id}/ticket-types`, { name: 'Standard', capacity: 10 })
    const late = await apexAdmin('POST', `/events/${id}/ticket-types`, { name: 'Late', sales_open: '2099-01-01' })
    const info = await api(null, 'GET', `/public/events/${token}`)
    expect(info.body.remaining_seats).toBe(3)
    expect(info.body.tickets.map((x: { name: string }) => x.name)).toEqual(['Standard', 'Late'])
    expect(info.body.tickets[1].on_sale).toBe(false)
    expect(info.body.questions[0]).toMatchObject({ label: 'Dietary requirements', required: true })
    const qid = info.body.questions[0].id
    expect((await pub(token, { name: 'No Ticket', email: email(), answers: { [qid]: 'None' } })).status).toBe(422)
    expect((await pub(token, { name: 'No Answer', email: email(), ticket_type_id: t.body.id })).status).toBe(422)
    expect((await pub(token, { name: 'Bad Choice', email: email(), ticket_type_id: t.body.id, answers: { [qid]: 'Pizza' } })).status).toBe(422)
    const notOnSale = await pub(token, { name: 'Too Early', email: email(), ticket_type_id: late.body.id, answers: { [qid]: 'None' } })
    expect(notOnSale.status).toBe(409)
    expect(notOnSale.body.code).toBe('ticket_not_on_sale')
    const mail = email()
    const ok = await pub(token, { name: 'Answer Person', email: mail, ticket_type_id: t.body.id, answers: { [qid]: 'Vegan', [info.body.questions[1].id]: ['AI', 'BI'], unknown: 'x' } })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('registered')
    // Stored with the attendee and shown in the attendees list (still a lead with source Event).
    const att = eventAttendees.find((a) => a.email === mail)!
    expect(att.answers).toEqual({ [qid]: 'Vegan', [info.body.questions[1].id]: ['AI', 'BI'] })
    const rows = await apexAdmin('GET', `/events/${id}/attendees`)
    expect(rows.body.find((a: { email: string }) => a.email === mail)).toMatchObject({ ticket_type_name: 'Standard', answers: { [qid]: 'Vegan' }, lead_outcome: 'created' })
    expect(leads.find((l) => l.id === att.leadId)?.sourceType).toBe('Event')
  })
})

describe('capacity and waitlist', () => {
  it('full → waitlist with a position (still a lead); cancelling promotes the first in line with an email + notification', async () => {
    const { id, token } = await fixture()
    const qid = events.find((e) => e.id === id)!.questions[0].id
    const reg = (name: string) => pub(token, { name, email: email(), answers: { [qid]: 'None' } })
    for (const name of ['Seat One', 'Seat Two', 'Seat Three']) expect((await reg(name)).body.status).toBe('registered')
    const w1 = await reg('Wait One')
    const w2 = await reg('Wait Two')
    expect(w1.body).toMatchObject({ status: 'waitlisted', waitlist_position: 1 })
    expect(w2.body.waitlist_position).toBe(2)
    expect(w1.body.message).toMatch(/waitlist/)
    const waiting = eventAttendees.find((a) => a.eventId === id && a.name === 'Wait One')!
    expect(waiting.leadId).not.toBeNull()
    const detail = await apexAdmin('GET', `/events/${id}`)
    expect(detail.body).toMatchObject({ attendee_count: 3, waitlist_count: 2, remaining_seats: 0 })
    expect((await api(null, 'GET', `/public/events/${token}`)).body.remaining_seats).toBe(0)
    // A waitlisted person can't be checked in.
    expect((await apexAdmin('POST', `/events/${id}/attendees/${waiting.id}/check-in`, {})).body.code).toBe('not_registered')

    const seat = eventAttendees.find((a) => a.eventId === id && a.name === 'Seat Two')!
    const notes = notifications.length
    const cancel = await apexAdmin('POST', `/events/${id}/attendees/${seat.id}/cancel`)
    expect(cancel.status).toBe(200)
    expect(cancel.body.attendee.status).toBe('cancelled')
    expect(cancel.body.promoted.map((p: { name: string }) => p.name)).toEqual(['Wait One'])
    expect(waiting.status).toBe('registered')
    expect(eventAttendees.find((a) => a.name === 'Wait Two' && a.eventId === id)!.status).toBe('waitlisted')
    expect(eventEmails.some((m) => m.attendeeId === waiting.id && m.kind === 'promoted')).toBe(true)
    expect(notifications.length).toBe(notes + 1)
    expect((await apexAdmin('POST', `/events/${id}/attendees/${seat.id}/cancel`)).status).toBe(409)
    // Cancelling a waitlisted person promotes nobody; raising the capacity promotes the rest.
    await apexAdmin('PATCH', `/events/${id}`, { capacity: 5 })
    expect(eventAttendees.find((a) => a.name === 'Wait Two' && a.eventId === id)!.status).toBe('registered')
  })

  it('a full ticket type waitlists only that ticket; removing a seated attendee promotes too', async () => {
    const r = await crestAdmin('POST', '/events', { name: 'Crest tickets', type: 'meeting', start_date: '2027-05-04' })
    const id = r.body.id
    const small = await crestAdmin('POST', `/events/${id}/ticket-types`, { name: 'Small', capacity: 1 })
    const big = await crestAdmin('POST', `/events/${id}/ticket-types`, { name: 'Big' })
    const a1 = await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Small One', email: email(), ticket_type_id: small.body.id })
    const a2 = await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Small Two', email: email(), ticket_type_id: small.body.id })
    const a3 = await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Big One', email: email(), ticket_type_id: big.body.id })
    expect([a1.body.status, a2.body.status, a3.body.status]).toEqual(['registered', 'waitlisted', 'registered'])
    expect(a2.body.message).toMatch(/waitlist/)
    // Team adds without a ticket get the first type.
    const a4 = await crestAdmin('POST', `/events/${id}/attendees`, { name: 'Default Ticket', email: email() })
    expect(a4.body.attendee.ticket_type_name).toBe('Small')
    expect(a4.body.status).toBe('waitlisted')
    await crestAdmin('DELETE', `/events/${id}/attendees/${a1.body.attendee.id}`)
    expect(eventAttendees.find((a) => a.id === a2.body.attendee.id)!.status).toBe('registered')
  })

  it('existing rules still hold: duplicate email 409, honeypot, the same answer for an already registered email', async () => {
    const { id, token } = await fixture()
    const qid = events.find((e) => e.id === id)!.questions[0].id
    const mail = email()
    expect((await pub(token, { name: 'Dup Person', email: mail, answers: { [qid]: 'None' } })).status).toBe(200)
    const again = await pub(token, { name: 'Dup Person', email: mail, answers: { [qid]: 'None' } })
    expect(again.body).toMatchObject({ registered: true, ticket_code: null, status: null })
    expect((await apexAdmin('POST', `/events/${id}/attendees`, { name: 'Dup', email: mail })).status).toBe(409)
    const before = eventAttendees.length
    expect((await pub(token, { name: 'Bot', email: email(), website: 'spam.example' })).body.ticket_code).toBeNull()
    expect(eventAttendees.length).toBe(before)
  })

  it('seed: waitlists and tickets differ per company', () => {
    const apex = eventAttendees.filter((a) => a.companyId === 'co_apex' && a.status === 'waitlisted')
    const crest = eventAttendees.filter((a) => a.companyId === 'co_crest' && a.status === 'waitlisted')
    expect(apex.length).toBeGreaterThan(0)
    expect(crest.length).toBeGreaterThan(0)
    expect(apex[0].eventId).not.toBe(crest[0].eventId)
  })
})
