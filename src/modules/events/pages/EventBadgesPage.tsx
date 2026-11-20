import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { IdCard, Printer } from 'lucide-react'
import { useAttendeesQuery, useEventQuery } from '@/modules/events/hooks/useEvents'
import { eventCheckInPath, eventPath } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput } from '@/shared/components/form/Field'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/**
 * `/events/:id/badges`: printable name badges — an A4 portrait sheet of 8 (2 × 4), each with the
 * name, company, ticket type and the ticket's QR code (scanned at the door's check-in page).
 */
export default function EventBadgesPage() {
  const { id = '' } = useParams()
  const event = useEventQuery(id)
  const attendees = useAttendeesQuery(id)
  const [ticket, setTicket] = useState('')
  const rows = useMemo(
    () => (attendees.data ?? []).filter((a) => a.status === 'registered' && a.ticketCode && (!ticket || a.ticketTypeId === ticket)).sort((a, b) => a.name.localeCompare(b.name)),
    [attendees.data, ticket],
  )
  if (event.isPending || attendees.isPending) return <PageBody><Skeleton className="h-64 rounded-card" /></PageBody>
  if (event.error) return <PageBody><ErrorState message={event.error.message} /></PageBody>
  if (attendees.error) return <PageBody><ErrorState message={attendees.error.message} onRetry={() => attendees.refetch()} /></PageBody>
  const e = event.data
  const types = [...new Map((attendees.data ?? []).filter((a) => a.ticketTypeId).map((a) => [a.ticketTypeId!, a.ticketTypeName])).entries()]
  const sheets: (typeof rows)[] = []
  for (let i = 0; i < rows.length; i += 8) sheets.push(rows.slice(i, i + 8))

  return (
    <>
      <PrintStyles orientation="portrait" margin="10mm" />
      <div className="print:hidden">
        <PageHeader
          icon={<IconTile><IdCard /></IconTile>}
          title={`Badges · ${e.name}`}
          description={
            <>
              {rows.length} badge{rows.length === 1 ? '' : 's'} on {sheets.length} A4 sheet{sheets.length === 1 ? '' : 's'} (registered attendees).{' '}
              <Link to={eventPath(e.id, 'attendees')} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to the event</Link>
              {' · '}
              <Link to={eventCheckInPath(e.id)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Check-in</Link>
            </>
          }
          actions={
            <>
              {types.length > 0 && (
                <SelectInput aria-label="Ticket type" value={ticket} onChange={(ev) => setTicket(ev.target.value)}>
                  <option value="">All ticket types</option>
                  {types.map(([tid, name]) => <option key={tid} value={tid}>{name}</option>)}
                </SelectInput>
              )}
              <Button onClick={() => window.print()} disabled={!rows.length}>
                <Printer />
                Print
              </Button>
            </>
          }
        />
      </div>
      <PageBody className="print:p-0">
        {rows.length === 0 ? (
          <EmptyState icon={<IdCard />} title="No badges to print" body="Registered attendees get a badge with their ticket QR code." />
        ) : (
          <div className="space-y-6 print:space-y-0">
            {sheets.map((sheet, i) => (
              <section
                key={i}
                aria-label={`Badge sheet ${i + 1}`}
                className="mx-auto grid w-full max-w-[210mm] grid-cols-2 gap-[4mm] bg-white p-[6mm] text-black shadow-soft print:shadow-none"
                style={{ breakAfter: i < sheets.length - 1 ? 'page' : 'auto' }}
              >
                {sheet.map((a) => (
                  <article key={a.id} className="flex h-[64mm] flex-col justify-between rounded-[3mm] border border-neutral-300 p-[5mm]" aria-label={`Badge ${a.name}`}>
                    <p className="truncate text-[9pt] font-medium tracking-wide text-neutral-500 uppercase">{e.name}</p>
                    <div className="flex items-end gap-[4mm]">
                      <div className="min-w-0 flex-1">
                        <p className="text-[18pt] leading-tight font-bold break-words">{a.name}</p>
                        {a.companyName && <p className="mt-[1mm] truncate text-[11pt] text-neutral-700">{a.companyName}</p>}
                        {a.ticketTypeName && <p className="mt-[2mm] inline-block rounded bg-neutral-900 px-[2mm] py-[0.5mm] text-[8pt] font-semibold text-white">{a.ticketTypeName}</p>}
                      </div>
                      <QRCodeSVG value={a.ticketCode!} size={96} level="M" aria-label={`QR code ${a.ticketCode}`} />
                    </div>
                    <p className="num text-[7pt] text-neutral-500">{a.ticketCode}</p>
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </>
  )
}
