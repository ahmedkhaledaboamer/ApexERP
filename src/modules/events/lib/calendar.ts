import { addDaysIso } from '@/shared/lib/companyDay'

/**
 * "Add to calendar" helpers (pure, shared by the pages and the mock API): Google / Outlook links and an
 * iCalendar (.ics, RFC 5545) file. Timed events use UTC instants; all-day events use dates (the end
 * date is exclusive, as calendars expect).
 */

export interface CalendarInfo {
  uid: string
  name: string
  description?: string
  location: string
  onlineUrl: string
  /** UTC instants. */
  startsAt: string
  endsAt: string | null
  /** Company-local dates; `startTime` null = all day. */
  startDate: string
  endDate: string
  startTime: string | null
  organizerName?: string
  /** Absolute link shown in the event (ticket page, registration page). */
  url?: string
}

const HOUR = 3_600_000
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const day = (iso: string) => iso.replace(/-/g, '')

function endOf(e: CalendarInfo): string {
  return e.endsAt && e.endsAt > e.startsAt ? e.endsAt : new Date(Date.parse(e.startsAt) + HOUR).toISOString()
}

const whereOf = (e: CalendarInfo) => e.location || e.onlineUrl
const detailsOf = (e: CalendarInfo) => [e.description, e.onlineUrl && `Join online: ${e.onlineUrl}`, e.url].filter(Boolean).join('\n\n')

export function googleCalendarUrl(e: CalendarInfo): string {
  const dates = e.startTime ? `${stamp(e.startsAt)}/${stamp(endOf(e))}` : `${day(e.startDate)}/${day(addDaysIso(e.endDate, 1))}`
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.name, dates, details: detailsOf(e), location: whereOf(e) })
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

export function outlookCalendarUrl(e: CalendarInfo): string {
  const allDay = !e.startTime
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.name,
    startdt: allDay ? e.startDate : new Date(e.startsAt).toISOString(),
    enddt: allDay ? addDaysIso(e.endDate, 1) : new Date(endOf(e)).toISOString(),
    allday: String(allDay),
    body: detailsOf(e),
    location: whereOf(e),
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`
}

/** RFC 5545 TEXT escaping. */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets are folded (CRLF + space). */
function fold(line: string): string {
  if (line.length <= 74) return line
  const parts: string[] = []
  for (let i = 0; i < line.length; i += 74) parts.push((i ? ' ' : '') + line.slice(i, i + 74))
  return parts.join('\r\n')
}

export function buildIcs(e: CalendarInfo, nowIso: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apex CRM//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(nowIso)}`,
    ...(e.startTime ? [`DTSTART:${stamp(e.startsAt)}`, `DTEND:${stamp(endOf(e))}`] : [`DTSTART;VALUE=DATE:${day(e.startDate)}`, `DTEND;VALUE=DATE:${day(addDaysIso(e.endDate, 1))}`]),
    `SUMMARY:${text(e.name)}`,
    ...(detailsOf(e) ? [`DESCRIPTION:${text(detailsOf(e))}`] : []),
    ...(whereOf(e) ? [`LOCATION:${text(whereOf(e))}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    ...(e.organizerName ? [`ORGANIZER;CN=${text(e.organizerName)}:mailto:noreply@apexcrm.example`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
