import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Printer, ScanLine, Undo2, UserCheck, Users, XCircle } from 'lucide-react'
import type { CheckInResult } from '@/modules/events/types'
import { useEventQuery } from '@/modules/events/hooks/useEvents'
import { useCheckInByCode, useCheckInSummaryQuery } from '@/modules/events/hooks/useEventsAdvanced'
import { eventBadgesPath, eventPath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { zonedParts } from '@/shared/lib/zonedTime'
import { useRegion } from '@/modules/tenancy/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/**
 * `/events/:id/check-in`: the door. Type, paste or scan (a scanner types the code) a ticket code;
 * live counters (registered, checked in, by ticket type) and the latest check-ins with undo.
 * Event team members and marketing managers (the event's edit right).
 */
export default function EventCheckInPage() {
  const { id = '' } = useParams()
  const event = useEventQuery(id)
  const summary = useCheckInSummaryQuery(id)
  const checkIn = useCheckInByCode()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [last, setLast] = useState<{ ok: boolean; result?: CheckInResult; error?: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const region = useRegion()
  /** An instant in the company's timezone: "20 Nov 2026, 09:12". */
  const fmtDateTime = (iso: string) => {
    const p = zonedParts(iso, region.timezone)
    return `${fmtDate(p.date)}, ${p.time}`
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!code.trim()) return
    checkIn.mutate(
      { id, code },
      {
        onSuccess: (r) => setLast({ ok: !r.alreadyCheckedIn, result: r }),
        onError: (err) => setLast({ ok: false, error: err.message }),
        onSettled: () => {
          setCode('')
          input.current?.focus()
        },
      },
    )
  }

  if (event.isPending) return <PageBody><Skeleton className="h-40 rounded-card" /></PageBody>
  if (event.error) return <PageBody><ErrorState message={event.error.message} onRetry={() => event.refetch()} /></PageBody>
  const e = event.data
  if (!e.canEdit) {
    return (
      <PageBody>
        <EmptyState icon={<ScanLine />} title="Check-in isn’t available to you" body="Event team members and marketing managers check people in." />
      </PageBody>
    )
  }
  const s = summary.data

  return (
    <>
      <PageHeader
        icon={<IconTile><ScanLine /></IconTile>}
        title={`Check-in · ${e.name}`}
        description={<Link to={eventPath(e.id, 'attendees')} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to the event</Link>}
        actions={
          <Link to={eventBadgesPath(e.id)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-sunken">
            <Printer className="size-4" aria-hidden />
            Print badges
          </Link>
        }
      />
      <PageBody className="space-y-6">
        <Card>
          <CardBody>
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row" aria-label="Check in by ticket code">
              <TextInput
                ref={input}
                autoFocus
                aria-label="Ticket code"
                placeholder="Scan or type the ticket code (XXXX-XXXX-XXXX)"
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                className="num text-lg tracking-wider sm:flex-1"
                autoComplete="off"
              />
              <Button write type="submit" size="lg" loading={checkIn.isPending}>
                <UserCheck />
                Check in
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted">A barcode / QR scanner that types into this field works; no camera needed.</p>
            {last && (
              <div
                role="status"
                className={`mt-4 flex items-center gap-3 rounded-lg px-4 py-3 text-[0.875rem] ${last.ok ? 'bg-success-50 text-success-700 dark:bg-success-700/20' : last.result ? 'bg-warning-50 text-warning-700 dark:bg-warning-700/20' : 'bg-danger-50 text-danger-700 dark:bg-danger-700/20'}`}
              >
                {last.ok ? <CheckCircle2 className="size-5" /> : last.result ? <AlertTriangle className="size-5" /> : <XCircle className="size-5" />}
                <div className="min-w-0 flex-1">
                  {last.result ? (
                    <>
                      <p className="font-semibold">
                        {last.result.attendee.name}
                        {last.result.attendee.ticketTypeName && ` · ${last.result.attendee.ticketTypeName}`}
                      </p>
                      <p>
                        {last.result.alreadyCheckedIn
                          ? `Already checked in at ${fmtDateTime(last.result.attendee.checkedInAt!)}${last.result.attendee.checkedInByName ? ` by ${last.result.attendee.checkedInByName}` : ''}.`
                          : last.result.attendee.checkedInAt
                            ? 'Checked in.'
                            : last.result.message}
                      </p>
                    </>
                  ) : (
                    <p>{last.error}</p>
                  )}
                </div>
                {last.result?.attendee.checkedInAt && last.result.attendee.ticketCode && (
                  <Button
                    write
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      checkIn.mutate(
                        { id, code: last.result!.attendee.ticketCode!, undo: true },
                        { onSuccess: (r) => { setLast({ ok: false, result: r }); toast.success('Check-in undone', r.attendee.name) } },
                      )
                    }
                  >
                    <Undo2 />
                    Undo
                  </Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <section aria-label="Check-in counters" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <StatCard label="Checked in" icon={<UserCheck />} value={s ? s.checkedIn : '—'} hint={s ? `${s.registered ? Math.round((s.checkedIn / s.registered) * 100) : 0}% of registered` : undefined} />
          <StatCard label="Registered" icon={<Users />} value={s ? s.registered : '—'} hint={s ? `${s.registered - s.checkedIn} still to arrive` : undefined} />
          <StatCard label="Waitlist" icon={<Users />} value={s ? s.waitlisted : '—'} hint="Not admitted yet" />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="By ticket type" />
            <CardBody>
              {!s ? (
                <Skeleton className="h-16" />
              ) : (
                <ul className="space-y-2" aria-label="Check-ins by ticket type">
                  {s.byTicketType.map((t) => (
                    <li key={t.ticketTypeId ?? 'none'} className="flex items-center gap-3 text-[0.8125rem]">
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="num text-ink-2">
                        {t.checkedIn} / {t.registered}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Latest check-ins" />
            {!s || s.recent.length === 0 ? (
              <CardBody>
                <p className="text-[0.8125rem] text-muted">Nobody yet.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line" aria-label="Latest check-ins">
                {s.recent.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                    <span className="num text-xs text-muted">{a.checkedInAt ? fmtDateTime(a.checkedInAt) : ''}</span>
                    {a.ticketCode && (
                      <Button write variant="ghost" size="xs" aria-label={`Undo check-in of ${a.name}`} onClick={() => checkIn.mutate({ id, code: a.ticketCode!, undo: true })}>
                        <Undo2 />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  )
}
