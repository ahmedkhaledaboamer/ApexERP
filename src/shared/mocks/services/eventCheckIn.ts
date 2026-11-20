import type { User } from '@/shared/types'
import type { CheckInResult, CheckInSummary, PublicTicket } from '@/modules/events/types'
import { eventAttendees, events, registrationHits, type AttendeeRecord, type EventRecord } from '@/shared/mocks/data/events'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { hitRateLimit } from '@/shared/mocks/services/rateLimit'
import { assertOpenForAttendees, assertSeated, attendeesOf, eventFor, localOf, log, seated, ticketTypesOf, toAttendee, tzOf, waitlistPositionOf } from '@/shared/mocks/services/events'

/**
 * Check-in by ticket code and the public ticket (docs/API.md › Events › Check-in, tickets & badges).
 * Every attendee has an unguessable ticket code (12 characters, XXXX-XXXX-XXXX; not the registration
 * token). The check-in page (team members + marketing full: the event's edit right) types / pastes /
 * scans a code: first time → checked in; again → 200 with `already_checked_in: true` and when (nothing
 * changes); `undo` clears it. Codes are matched case-insensitively, ignoring spaces and dashes.
 */

export const TICKET_LOOKUP_LIMIT = 30
export const TICKET_LOOKUP_WINDOW_MINUTES = 10

/** "abcd efgh-jklm" → "ABCD-EFGH-JKLM" (null when it can't be a code). */
export function normalizeCode(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : null
}

const NOT_FOUND_CODE = 'No ticket with that code for this event.'

/** POST /events/:id/check-in { code, undo? } */
export async function checkInByCode(user: User, id: string, input: { code?: unknown; undo?: unknown } | null): Promise<CheckInResult> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const code = normalizeCode(input?.code)
  // Another event's (or company's) code answers like an unknown one.
  const a = code ? attendeesOf(e).find((x) => x.ticketCode === code) : undefined
  if (!a) throw new CodedApiError(NOT_FOUND_CODE, 404, 'ticket_not_found')
  if (input?.undo) {
    const was = !!a.checkedInAt
    a.checkedInAt = null
    a.checkedInBy = null
    if (was) log(e, user, `Undid the check-in of ${a.name}`)
    return delay({ attendee: toAttendee(a, user), alreadyCheckedIn: false, message: was ? `Check-in of ${a.name} undone.` : `${a.name} wasn’t checked in.` })
  }
  assertSeated(a)
  if (a.checkedInAt) {
    return delay({ attendee: toAttendee(a, user), alreadyCheckedIn: true, message: `${a.name} is already checked in (at ${a.checkedInAt}).` })
  }
  a.checkedInAt = nowIso()
  a.checkedInBy = user.id
  log(e, user, `Checked in ${a.name} (ticket code)`)
  return delay({ attendee: toAttendee(a, user), alreadyCheckedIn: false, message: `${a.name} checked in.` })
}

export function summaryOf(e: Tenant<EventRecord>, viewer: User): CheckInSummary {
  const seats = seated(e)
  const types = ticketTypesOf(e)
  const rows: CheckInSummary['byTicketType'] = types.map((t) => {
    const mine = seats.filter((a) => a.ticketTypeId === t.id)
    return { ticketTypeId: t.id, name: t.name, registered: mine.length, checkedIn: mine.filter((a) => a.checkedInAt).length }
  })
  const untyped = seats.filter((a) => !a.ticketTypeId || !types.some((t) => t.id === a.ticketTypeId))
  if (untyped.length) rows.push({ ticketTypeId: null, name: types.length ? 'No ticket type' : 'General', registered: untyped.length, checkedIn: untyped.filter((a) => a.checkedInAt).length })
  return {
    registered: seats.length,
    checkedIn: seats.filter((a) => a.checkedInAt).length,
    waitlisted: attendeesOf(e).filter((a) => a.status === 'waitlisted').length,
    byTicketType: rows,
    recent: seats
      .filter((a) => a.checkedInAt)
      .sort((x, y) => (y.checkedInAt ?? '').localeCompare(x.checkedInAt ?? ''))
      .slice(0, 20)
      .map((a) => toAttendee(a, viewer)),
  }
}

/** GET /events/:id/check-in — live counters (check-in page). */
export async function getCheckInSummary(user: User, id: string): Promise<CheckInSummary> {
  const e = await eventFor(user, id, 'edit')
  return delay(summaryOf(e, user))
}

/* ---------------- Public ticket (no auth) ---------------- */

/**
 * The attendee and event behind a ticket code. Unknown code, a company without the Events module or
 * a deleted / suspended workspace → the same 404 (codes can't be probed); the company comes from the
 * attendee row, never from the request.
 */
export function attendeeByCode(code: string): { a: Tenant<AttendeeRecord>; e: Tenant<EventRecord> } {
  const norm = normalizeCode(code)
  const a = norm ? eventAttendees.find((x) => x.ticketCode === norm) : undefined
  const e = a ? events.find((x) => x.id === a.eventId && x.companyId === a.companyId) : undefined
  const sub = e ? subscriptionOf(e.companyId) : undefined
  if (!a || !e || a.status === 'cancelled' || !eventsEnabledIn(e.companyId) || !sub || sub.status === 'deleted' || companyById(e.companyId)?.status === 'suspended') {
    throw new CodedApiError('This ticket link isn’t valid.', 404, 'ticket_not_found')
  }
  return { a, e }
}

export function publicTicketOf(a: Tenant<AttendeeRecord>, e: Tenant<EventRecord>): PublicTicket {
  const c = companyById(e.companyId)
  return {
    code: a.ticketCode,
    status: a.status,
    waitlistPosition: waitlistPositionOf(a),
    attendeeName: a.name,
    companyName: a.companyName,
    ticketTypeName: a.ticketTypeId ? (ticketTypesOf(e).find((t) => t.id === a.ticketTypeId)?.name ?? '') : '',
    checkedIn: !!a.checkedInAt,
    event: {
      name: e.name,
      type: e.type,
      ...localOf(e),
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      timezone: tzOf(e.companyId),
      location: e.location,
      onlineUrl: e.onlineUrl,
      organizerName: c?.branding.displayName ?? c?.name ?? '',
      status: e.status,
    },
  }
}

/** GET /public/tickets/:code — rate limited per client (lookups), like the registration page. */
export async function getPublicTicket(code: string, clientKey = 'anonymous'): Promise<PublicTicket> {
  await delay(null)
  hitRateLimit(registrationHits, [`ticket:${clientKey || 'anonymous'}`], { limit: TICKET_LOOKUP_LIMIT, windowMs: TICKET_LOOKUP_WINDOW_MINUTES * 60_000, what: 'ticket lookup' })
  const { a, e } = attendeeByCode(code)
  return publicTicketOf(a, e)
}
