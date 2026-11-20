import { eventAttendees, eventBudgetLines, events, eventTicketTypes } from '@/shared/mocks/data/events'
import { campaigns } from '@/shared/mocks/data/marketing'
import { eventSessions, eventSpeakers, eventTemplates } from '@/shared/mocks/data/eventExtras'
import { companyById } from '@/shared/mocks/data/tenancy'
import { logisticsSourceOf } from '@/shared/mocks/data/eventLogistics'
import { zonedParts } from '@/shared/lib/zonedTime'
import type { Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of the advanced Events features (handlers/eventsAdvanced.ts), spread into
 * ENDPOINTS (endpoints.ts). Samples name the company's own seed rows; writes act on them as the
 * company admin (marketing full).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const ownCount = <T extends { companyId: string }>(rows: readonly T[]) => (co: Co) => rows.filter((r) => r.companyId === co).length
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}

const pastEvent = (co: Co) => first(events, co, 'completed event', (e) => e.status === 'completed').id
const openEvent = (co: Co) => first(events, co, 'confirmed event', (e) => e.status === 'confirmed').id
const template = (co: Co) => first(eventTemplates, co, 'event template').id
const openStartDate = (co: Co) => zonedParts(first(events, co, 'confirmed event', (e) => e.status === 'confirmed').startsAt, companyById(co)?.regional.timezone ?? 'Asia/Dubai').date
const session = (co: Co) => first(eventSessions, co, 'agenda session', (s) => s.eventId === openEvent(co))
// A manual line (lines kept in step by Travel & logistics refuse direct edits: 409 managed_by_logistics).
const budgetLine = (co: Co) => first(eventBudgetLines, co, 'budget line', (l) => !logisticsSourceOf(co, l.id))
const campaign = (co: Co) => first(campaigns, co, 'campaign').id
const ticket = (co: Co) => first(eventTicketTypes, co, 'ticket type')
const seatedAttendee = (co: Co) => first(eventAttendees, co, 'registered attendee with a ticket', (a) => a.status === 'registered' && a.eventId === ticket(co).eventId)
/** A directory speaker on the open event's roster (`:speakerId` is the directory id). */
const speaker = (co: Co) => ({ id: first(eventSpeakers, co, 'speaker', (s) => s.eventId === openEvent(co)).speakerId })

const PUBLIC_TICKET = 'An attendee’s ticket page (no sign-in by design): found by its unguessable 12-character ticket code (not the registration token); only the attendee’s own name, ticket and the event’s public fields are served. Unknown or cancelled codes, a company without the Events module or a deleted / suspended workspace answer the same 404; lookups are rate-limited per client.'

const PUBLIC_SURVEY = 'An attendee’s feedback survey (no sign-in by design): found by its unguessable survey token (24 letters); only the event name, organizer and the attendee’s first name are served. Unknown tokens, waitlisted / cancelled registrations, a company without the Events module or a deleted / suspended workspace answer the same 404; rate-limited per client.'

export const EVENTS_ADVANCED_ENDPOINTS: Endpoint[] = [
  /* ---- templates + checklist ---- */
  { method: 'GET', path: '/event-templates', kind: 'company-list', module: 'events', sample: () => ({}), count: { of: len, expected: ownCount(eventTemplates) } },
  {
    method: 'POST', path: '/event-templates', kind: 'company-write', module: 'events',
    sample: () => ({ body: { name: `Isolation template ${uniq()}`, event_type: 'meeting', default_duration_days: 1, tasks: [{ title: 'Book the room', offset_days: -7, role: 'owner', priority: 'high' }] } }),
  },
  { method: 'GET', path: '/event-templates/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: template(co) } }) },
  { method: 'PATCH', path: '/event-templates/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: template(co) }, body: { default_duration_days: 2 } }) },
  { method: 'DELETE', path: '/event-templates/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: template(co) } }) },
  { method: 'GET', path: '/events/:id/checklist', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) } }) },
  { method: 'POST', path: '/events/:id/apply-template', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { template_id: template(co) } }) },
  /* ---- agenda & speakers ---- */
  { method: 'GET', path: '/events/:id/agenda', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) } }) },
  { method: 'POST', path: '/events/:id/sessions', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { title: 'Isolation session', date: openStartDate(co), start_time: '10:20', end_time: '10:25', room: `Iso ${uniq()}`, speaker_ids: [speaker(co).id] } }) },
  { method: 'PATCH', path: '/events/:id/sessions/:sessionId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co), sessionId: session(co).id }, body: { description: 'Isolation description' } }) },
  { method: 'DELETE', path: '/events/:id/sessions/:sessionId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co), sessionId: session(co).id } }) },
  { method: 'POST', path: '/events/:id/speakers', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { name: 'Iso Speaker', title: 'CTO', company: 'Iso Co' } }) },
  { method: 'PATCH', path: '/events/:id/speakers/:speakerId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co), speakerId: speaker(co).id }, body: { bio: 'Isolation bio' } }) },
  { method: 'DELETE', path: '/events/:id/speakers/:speakerId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co), speakerId: speaker(co).id } }) },
  /* ---- tickets, capacity & waitlist ---- */
  { method: 'GET', path: '/events/:id/ticket-types', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: ticket(co).eventId } }) },
  { method: 'POST', path: '/events/:id/ticket-types', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: ticket(co).eventId }, body: { name: `Iso ticket ${uniq()}`, capacity: 5, price: 10 } }) },
  { method: 'PATCH', path: '/events/:id/ticket-types/:ticketTypeId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: ticket(co).eventId, ticketTypeId: ticket(co).id }, body: { price: 99 } }) },
  { method: 'DELETE', path: '/events/:id/ticket-types/:ticketTypeId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: ticket(co).eventId, ticketTypeId: ticket(co).id }, expect: 409 }), note: 'People hold the seeded ticket: 409 (the isolation checks still run).' },
  { method: 'POST', path: '/events/:id/attendees/:attendeeId/cancel', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: seatedAttendee(co).eventId, attendeeId: seatedAttendee(co).id } }) },
  /* ---- check-in by code, public ticket ---- */
  { method: 'GET', path: '/events/:id/check-in', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: seatedAttendee(co).eventId } }) },
  { method: 'POST', path: '/events/:id/check-in', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: seatedAttendee(co).eventId }, body: { code: seatedAttendee(co).ticketCode } }) },
  { method: 'GET', path: '/public/tickets/:code', kind: 'public', module: 'events', reason: PUBLIC_TICKET },
  /* ---- invitations, email log, calendar files ---- */
  { method: 'POST', path: '/events/:id/invite', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { name: `Iso invite ${uniq()}`, statuses: [] } }) },
  { method: 'GET', path: '/events/:id/emails', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: ticket(co).eventId } }) },
  { method: 'GET', path: '/public/events/:token/calendar.ics', kind: 'public', module: 'events', reason: 'Calendar file of an event’s public registration page (no sign-in by design): found by the unguessable registration token, public fields only, the same 404 rules as GET /public/events/:token; rate-limited per client.' },
  { method: 'GET', path: '/public/tickets/:code/calendar.ics', kind: 'public', module: 'events', reason: 'An attendee’s calendar entry (no sign-in by design): found by the unguessable ticket code, the same 404 rules as GET /public/tickets/:code; rate-limited per client.' },
  /* ---- booth capture + leaderboard ---- */
  { method: 'GET', path: '/events/:id/captures', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) } }) },
  { method: 'POST', path: '/events/:id/captures', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { name: 'Iso Visitor', company_name: 'Iso Booth Co', email: `iso-cap-${uniq()}@iso-${co}.test`, rating: 'hot', notes: 'Isolation capture' } }) },
  { method: 'GET', path: '/events/:id/leaderboard', kind: 'company-export', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) } }) },
  /* ---- after the event ---- */
  { method: 'POST', path: '/events/:id/follow-up', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) }, body: {} }) },
  /* ---- feedback survey ---- */
  { method: 'GET', path: '/events/:id/survey', kind: 'company-export', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) } }) },
  { method: 'GET', path: '/public/surveys/:token', kind: 'public', module: 'events', reason: PUBLIC_SURVEY },
  { method: 'POST', path: '/public/surveys/:token', kind: 'public', module: 'events', reason: PUBLIC_SURVEY + ' One answer per attendee; it lands in the attendee’s company only.' },
  /* ---- budget lines, campaign link ---- */
  { method: 'GET', path: '/events/:id/budget', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) } }) },
  { method: 'POST', path: '/events/:id/budget-lines', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co) }, body: { category: 'printing', planned: 500, actual: 450, note: 'Isolation' } }) },
  { method: 'PATCH', path: '/events/:id/budget-lines/:lineId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: budgetLine(co).eventId, lineId: budgetLine(co).id }, body: { actual: 1234 } }) },
  { method: 'DELETE', path: '/events/:id/budget-lines/:lineId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: budgetLine(co).eventId, lineId: budgetLine(co).id } }) },
  { method: 'PUT', path: '/events/:id/campaign', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pastEvent(co) }, body: { campaign_id: campaign(co) } }) },
]