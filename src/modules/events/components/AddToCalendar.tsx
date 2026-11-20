import { CalendarPlus } from 'lucide-react'
import type { PublicTicket } from '@/modules/events/types'
import { googleCalendarUrl, outlookCalendarUrl, type CalendarInfo } from '@/modules/events/lib/calendar'
import { http } from '@/shared/lib/axios'

const enc = encodeURIComponent

/**
 * "Add to calendar": Google and Outlook links plus the .ics file (Apple Calendar and others). With a
 * ticket code the .ics is the attendee's own (GET /public/tickets/:code/calendar.ics); with a
 * registration token, the event's (GET /public/events/:token/calendar.ics).
 */
export function AddToCalendar({ event, code, token }: { event: Omit<PublicTicket['event'], 'type' | 'status'> & { name: string }; code?: string; token?: string }) {
  const info: CalendarInfo = {
    uid: code ? `ticket-${code}` : `event-${token}`,
    name: event.name,
    location: event.location,
    onlineUrl: event.onlineUrl,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    startDate: event.startDate,
    endDate: event.endDate,
    startTime: event.startTime,
    url: code ? `${window.location.origin}/t/${enc(code)}` : undefined,
  }
  const ics = code ? `/public/tickets/${enc(code)}/calendar.ics` : token ? `/public/events/${enc(token)}/calendar.ics` : null
  const link = 'inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-sunken'
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Add to calendar" role="group">
      <CalendarPlus className="size-4 text-muted" aria-hidden />
      <a className={link} href={googleCalendarUrl(info)} target="_blank" rel="noreferrer">
        Google
      </a>
      <a className={link} href={outlookCalendarUrl(info)} target="_blank" rel="noreferrer">
        Outlook
      </a>
      {ics && (
        <button type="button" className={link} onClick={() => void downloadIcs(ics, event.name)}>
          .ics file
        </button>
      )}
    </div>
  )
}

/** Fetches the .ics through the API (the mock answers fetches, not navigations) and saves it. */
async function downloadIcs(path: string, name: string): Promise<void> {
  const res = await http.get<string>(path, { responseType: 'text' })
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'event'}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}