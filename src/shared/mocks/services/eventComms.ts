import type { Lead, User } from '@/shared/types'
import type { AudienceFilter, BulkEmailDetail } from '@/modules/marketing/types'
import type { EventEmailLog, InviteInput } from '@/modules/events/types'
import { buildIcs, type CalendarInfo } from '@/modules/events/lib/calendar'
import { eventWhen } from '@/modules/events/components/eventMeta'
import { bulkEmails } from '@/shared/mocks/data/marketing'
import { companyById } from '@/shared/mocks/data/tenancy'
import { eventAttendees, eventEmails, events, registrationHits, type EventRecord } from '@/shared/mocks/data/events'
import { eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { onLifecycleTick } from '@/shared/mocks/services/billing'
import { createBulkEmail, setBulkEmailContext } from '@/shared/mocks/services/marketing'
import { hitRateLimit } from '@/shared/mocks/services/rateLimit'
import { eventFor, localOf, publicEventByToken, sendEventEmail, tzOf } from '@/shared/mocks/services/events'
import { attendeeByCode, TICKET_LOOKUP_LIMIT, TICKET_LOOKUP_WINDOW_MINUTES } from '@/shared/mocks/services/eventCheckIn'

/**
 * Invitations, reminders and "add to calendar" (docs/API.md › Events › Invitations & reminders).
 *  - Invite an audience: a Marketing bulk email (draft) linked to the event — the bulk email builder,
 *    exclusions (DNC, not interested, no email, duplicates), the monthly emailsPerMonth allowance and
 *    the fair send queue all apply as for any bulk email. `{{event.registration_url}}` and the other
 *    `{{event.*}}` variables are filled for emails linked to an event.
 *  - Reminder: each registered attendee gets ONE reminder email `reminder_hours` before the start
 *    (event setting; default from Settings › Automation, 24 h; 0 = off), counted against emailsPerMonth
 *    (no allowance left → logged as skipped, never retried). Runs lazily on the lifecycle tick.
 *  - Calendar: .ics files for the event (registration token) and per attendee (ticket code); Google /
 *    Outlook links are built on the page (modules/events/lib/calendar.ts).
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Absolute links in emails: the app's origin in the browser, a placeholder host in tests. */
export function publicOrigin(): string {
  const o = typeof location !== 'undefined' ? location.origin : ''
  return o && o !== 'null' ? o : 'https://app.apexcrm.example'
}

export const registrationUrl = (e: Pick<EventRecord, 'registrationToken'>) => `${publicOrigin()}/e/${e.registrationToken}`

/* ---------------- {{event.*}} in bulk emails ---------------- */

setBulkEmailContext((email, lead: Lead | null): Record<string, Record<string, string>> => {
  const e = events.find((x) => x.id === email.eventId && x.companyId === email.companyId)
  if (!e) return {}
  const attendee = lead ? eventAttendees.find((a) => a.eventId === e.id && a.companyId === e.companyId && a.leadId === lead.id && a.status !== 'cancelled') : undefined
  return {
    event: {
      name: e.name,
      date: eventWhen(localOf(e)),
      location: e.location || (e.onlineUrl ? 'Online' : ''),
      registration_url: registrationUrl(e),
      ...(attendee ? { survey_url: `${publicOrigin()}/s/${attendee.surveyToken}` } : {}),
    },
  }
})

/* ---------------- Invite an audience ---------------- */

export const DEFAULT_INVITE_SUBJECT = 'You’re invited: {{event.name}}'
export const DEFAULT_INVITE_BODY =
  'Hi {{lead.firstName}},\n\nWe’d love to see you at {{event.name}} ({{event.date}}, {{event.location}}).\n\nSave your seat: {{event.registration_url}}\n\n{{agent.name}}\n{{company.name}}'

/**
 * POST /events/:id/invite — a draft bulk email linked to the event (and to its campaign, when linked).
 * Needs the event's view right AND the Marketing edit right (bulk emails are Marketing's). The caller
 * finishes it in the bulk email builder (audience preview, test send, schedule / send).
 */
export async function inviteAudience(user: User, id: string, input: InviteInput | null): Promise<BulkEmailDetail> {
  const e = await eventFor(user, id)
  if (e.status === 'cancelled' || e.status === 'completed') return fail(`This event is ${e.status}: there’s nothing to invite people to.`, 409)
  const v = input ?? {}
  const audience: Partial<AudienceFilter> = {
    industries: Array.isArray(v.industries) ? v.industries : [],
    statuses: Array.isArray(v.statuses) ? v.statuses : [],
    sources: Array.isArray(v.sources) ? v.sources : [],
    ownerIds: Array.isArray(v.ownerIds) ? v.ownerIds : [],
    ...(str(v.audienceId) ? { audienceId: str(v.audienceId) } : {}),
  }
  const templateId = str(v.templateId) || null
  const created = await createBulkEmail(user, {
    name: str(v.name) || `Invitation · ${e.name}`,
    campaignId: e.campaignId,
    ...(templateId ? { templateId } : { subject: str(v.subject) || DEFAULT_INVITE_SUBJECT, body: typeof v.body === 'string' && v.body.trim() ? v.body : DEFAULT_INVITE_BODY }),
    audience,
  })
  const row = bulkEmails.find((b) => b.id === created.id && b.companyId === e.companyId)!
  row.eventId = e.id
  return delay({ ...created, eventId: e.id })
}

/* ---------------- Email log ---------------- */

export async function listEventEmails(user: User, id: string): Promise<EventEmailLog[]> {
  const e = await eventFor(user, id)
  const rows = eventEmails
    .filter((m) => m.eventId === e.id && m.companyId === e.companyId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((m) => ({
      id: m.id,
      attendeeId: m.attendeeId,
      attendeeName: eventAttendees.find((a) => a.id === m.attendeeId && a.companyId === e.companyId)?.name ?? '',
      kind: m.kind,
      to: m.to,
      subject: m.subject,
      status: m.status,
      skipReason: m.skipReason,
      at: m.at,
    }))
  return delay(rows)
}

/* ---------------- Reminders (lifecycle tick) ---------------- */

const HOUR = 3_600_000

/**
 * Sends the due reminders of a company at `until` (mock clock): events planned / confirmed whose start
 * is within their `reminder_hours` (and not started yet), to registered attendees not reminded yet.
 * Once only per attendee (`reminder_sent_at`), whatever the outcome (sent, or skipped for the limit /
 * no email). Returns how many were handled.
 */
export function runEventReminders(companyId: string, until: number = nowMs()): number {
  if (!eventsEnabledIn(companyId)) return 0
  let n = 0
  for (const e of events) {
    if (e.companyId !== companyId || (e.status !== 'planned' && e.status !== 'confirmed') || e.reminderHours <= 0) continue
    const start = Date.parse(e.startsAt)
    if (until >= start || until < start - e.reminderHours * HOUR) continue
    const local = localOf(e)
    const when = `${local.startDate}${local.startTime ? ` at ${local.startTime}` : ''}`
    for (const a of eventAttendees) {
      if (a.eventId !== e.id || a.companyId !== companyId || a.status !== 'registered' || a.reminderSentAt) continue
      sendEventEmail(e, a, 'reminder', `Reminder: ${e.name} starts ${when} (${tzOf(companyId)})`)
      a.reminderSentAt = new Date(until).toISOString()
      n++
    }
  }
  return n
}

onLifecycleTick('events.reminders', (companyId, until) => runEventReminders(companyId, until))

/* ---------------- Calendar files (no auth) ---------------- */

function calendarOf(e: Tenant<EventRecord>, uid: string, url: string): CalendarInfo {
  const c = companyById(e.companyId)
  return {
    uid,
    name: e.name,
    description: e.description,
    location: e.location,
    onlineUrl: e.onlineUrl,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    ...localOf(e),
    organizerName: c?.branding.displayName ?? c?.name ?? '',
    url,
  }
}

function limitLookups(clientKey: string): void {
  hitRateLimit(registrationHits, [`ics:${clientKey || 'anonymous'}`], { limit: TICKET_LOOKUP_LIMIT, windowMs: TICKET_LOOKUP_WINDOW_MINUTES * 60_000, what: 'calendar' })
}

/** GET /public/events/:token/calendar.ics — the event (same 404 rules as the registration page). */
export async function eventIcs(token: string, clientKey = 'anonymous'): Promise<string> {
  await delay(null)
  limitLookups(clientKey)
  const e = publicEventByToken(token)
  if (e.status === 'cancelled') throw new CodedApiError('This event was cancelled.', 409, 'event_cancelled')
  return buildIcs(calendarOf(e, `event-${e.registrationToken}@apexcrm`, registrationUrl(e)), nowIso())
}

/** GET /public/tickets/:code/calendar.ics — the attendee's own entry (with the ticket link). */
export async function ticketIcs(code: string, clientKey = 'anonymous'): Promise<string> {
  await delay(null)
  limitLookups(clientKey)
  const { a, e } = attendeeByCode(code)
  if (e.status === 'cancelled') throw new CodedApiError('This event was cancelled.', 409, 'event_cancelled')
  return buildIcs(calendarOf(e, `ticket-${a.ticketCode}@apexcrm`, `${publicOrigin()}/t/${a.ticketCode}`), nowIso())
}
