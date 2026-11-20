import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { CalendarDays, MapPin, Printer, Ticket } from 'lucide-react'
import { EVENT_TYPE_LABEL } from '@/modules/events/types'
import { getPublicTicket } from '@/modules/events/api/eventsAdvancedApi'
import { eventWhen } from '@/modules/events/components/eventMeta'
import { AddToCalendar } from '@/modules/events/components/AddToCalendar'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/t/:code`: an attendee's printable ticket with its QR code (no sign-in). */
export default function PublicTicketPage() {
  const { code = '' } = useParams()
  const q = useQuery({ queryKey: ['public-ticket', code], queryFn: () => getPublicTicket(code), retry: false, staleTime: 60_000 })
  return (
    <div className="min-h-full bg-canvas px-4 py-10 sm:py-16 print:bg-white print:p-0">
      <PrintStyles orientation="portrait" />
      <main className="mx-auto w-full max-w-md">
        {q.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : q.error ? (
          <div role="alert" className="rounded-card border border-line bg-surface p-8 text-center shadow-soft">
            <Ticket className="mx-auto mb-3 size-8 text-muted" aria-hidden />
            <h1 className="text-[1.25rem] font-semibold">Ticket not found</h1>
            <p className="mt-2 text-[0.875rem] text-muted">Check the link you were sent, or ask the organizer.</p>
          </div>
        ) : (
          <article className="overflow-hidden rounded-card border border-line bg-surface shadow-soft" aria-label="Ticket">
            <header className="border-b border-dashed border-line p-6">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                {EVENT_TYPE_LABEL[q.data.event.type]} · {q.data.event.organizerName}
              </p>
              <h1 className="mt-1 text-[1.375rem] leading-tight font-semibold">{q.data.event.name}</h1>
              <p className="num mt-2 flex items-center gap-2 text-[0.875rem] text-ink-2">
                <CalendarDays className="size-4 text-muted" aria-hidden />
                {eventWhen(q.data.event)} <span className="text-xs text-muted">({q.data.event.timezone})</span>
              </p>
              {q.data.event.location && (
                <p className="mt-1 flex items-center gap-2 text-[0.875rem] text-ink-2">
                  <MapPin className="size-4 text-muted" aria-hidden />
                  {q.data.event.location}
                </p>
              )}
            </header>
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-lg font-semibold">{q.data.attendeeName}</p>
              {q.data.companyName && <p className="-mt-2 text-[0.875rem] text-muted">{q.data.companyName}</p>}
              {q.data.ticketTypeName && <p className="rounded-full bg-sunken px-3 py-0.5 text-xs font-medium">{q.data.ticketTypeName}</p>}
              {q.data.status === 'waitlisted' ? (
                <p role="status" className="rounded-lg bg-warning-50 px-4 py-2 text-[0.875rem] text-warning-700 dark:bg-warning-700/20">
                  You’re number {q.data.waitlistPosition} on the waitlist. This ticket becomes valid if a seat opens up.
                </p>
              ) : (
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG value={q.data.code} size={180} level="M" aria-label="Ticket QR code" />
                </div>
              )}
              <p className="num text-lg font-semibold tracking-widest" data-testid="ticket-code">{q.data.code}</p>
              <p className="text-xs text-muted">Show this code at the entrance.</p>
            </div>
            <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-line p-4 print:hidden">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                <Printer />
                Print ticket
              </Button>
              <AddToCalendar code={q.data.code} event={q.data.event} />
            </footer>
          </article>
        )}
        <p className="mt-6 text-center text-[0.75rem] text-subtle print:hidden">{PRODUCT_NAME}</p>
      </main>
    </div>
  )
}
