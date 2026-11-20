import { useState } from 'react'
import { displayMobile } from '@/shared/lib/phone'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarCheck2, CalendarClock, ExternalLink, MapPin, MapPinned, Pencil, Trash2, Users } from 'lucide-react'
import type { VenueEventEntry } from '@/modules/events/libraryTypes'
import { VENUE_TYPE_LABEL } from '@/modules/events/libraryTypes'
import { useDeleteVenue, useVenueQuery } from '@/modules/events/hooks/useEventLibrary'
import { EVENT_STATUS_LABEL, type EventStatus } from '@/modules/events/types'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { LibraryError, Rating, Tags, VenueStatusBadge } from '@/modules/events/components/library/LibraryBits'
import { VenueDrawer } from '@/modules/events/components/library/VenueDrawer'
import { mapLink } from '@/modules/quotations/lib/company'
import { PATHS, eventPath } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

/** `/events/venues/:id`: a venue — details, rooms, past / upcoming events there, average attendance, notes. */
export default function VenueDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const query = useVenueQuery(id)
  const remove = useDeleteVenue()
  const toast = useToast()
  const [editing, setEditing] = useState(false)

  if (query.isPending) return <PageBody><Skeleton className="h-64 rounded-card" /></PageBody>
  if (query.error) return <PageBody><LibraryError error={query.error} onRetry={() => query.refetch()} what="Venues" /></PageBody>
  const v = query.data
  const map = v.lat !== null && v.lng !== null ? mapLink({ lat: v.lat, lng: v.lng }) : v.mapUrl || null

  return (
    <>
      <PageHeader
        icon={<IconTile><MapPinned /></IconTile>}
        title={v.name}
        description={
          <>
            {VENUE_TYPE_LABEL[v.type]} · {[v.city, v.country].filter(Boolean).join(', ') || '—'} ·{' '}
            <Link to={PATHS.eventVenues} className="font-medium text-brand-700 hover:underline dark:text-brand-300">All venues</Link>
          </>
        }
        actions={
          v.canManage && (
            <>
              <Button
                write
                variant="ghost"
                onClick={() => remove.mutate(v.id, { onSuccess: () => { toast.success('Venue deleted', v.name); navigate(PATHS.eventVenues) }, onError: (err) => toast.error('Not deleted', err.message) })}
              >
                <Trash2 />
                Delete
              </Button>
              <Button write variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            </>
          )
        }
      />
      <PageBody className="space-y-6">
        <section aria-label="Venue figures" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <StatCard label="Capacity" icon={<Users />} value={v.capacity ?? '—'} hint={v.rooms.length ? `${v.rooms.length} room${v.rooms.length === 1 ? '' : 's'}` : 'No rooms listed'} />
          <StatCard label="Events here" icon={<CalendarCheck2 />} value={v.past.length + v.upcoming.length + v.hiddenEvents} hint={`${v.upcoming.length} upcoming`} />
          <StatCard label="Average attendance" icon={<Users />} value={v.averageAttendance ?? '—'} hint="Past events: checked in, else registered" />
        </section>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <EventList title="Upcoming events" entries={v.upcoming} empty="Nothing planned here." />
            <EventList title="Past events" entries={v.past} empty="No past events here." />
            {v.hiddenEvents > 0 && <p className="text-xs text-muted">{v.hiddenEvents} more event{v.hiddenEvents === 1 ? '' : 's'} you can’t see.</p>}
          </div>
          <Card className="self-start">
            <CardHeader title="Details" icon={<MapPin />} action={<VenueStatusBadge status={v.status} />} />
            <CardBody>
              <PropertyList>
                <Property label="Address">{v.address || '—'}</Property>
                <Property label="Map">
                  {map ? (
                    <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
                      Open map <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    '—'
                  )}
                </Property>
                <Property label="Contact">{[v.contactName, displayMobile(v.contactMobile), v.contactEmail].filter(Boolean).join(' · ') || '—'}</Property>
                <Property label="Day rate">{moneyIn(v.dayRate, v.currency)}</Property>
                <Property label="Rating"><Rating value={v.rating} /></Property>
                <Property label="Amenities"><Tags tags={v.amenities} /></Property>
              </PropertyList>
              {v.rooms.length > 0 && (
                <table className="mt-4 w-full text-[0.8125rem]" aria-label="Rooms">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 text-start font-medium">Room</th>
                      <th className="py-1 text-end font-medium">Capacity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {v.rooms.map((r) => (
                      <tr key={r.id}>
                        <td className="py-1.5">{r.name}</td>
                        <td className="num py-1.5 text-end">{r.capacity ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {v.priceNotes && <p className="mt-4 text-xs text-ink-2">{v.priceNotes}</p>}
              {v.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-sunken px-3 py-2 text-xs text-muted">{v.notes}</p>}
            </CardBody>
          </Card>
        </div>
      </PageBody>
      {v.canManage && <VenueDrawer open={editing} onClose={() => setEditing(false)} venue={v} />}
    </>
  )
}

function EventList({ title, entries, empty }: { title: string; entries: VenueEventEntry[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} icon={<CalendarClock />} />
      {entries.length === 0 ? (
        <CardBody>
          <p className="text-[0.8125rem] text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-line" aria-label={title}>
          {entries.map((e) => (
            <li key={e.eventId} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <Link to={eventPath(e.eventId)} className="font-medium text-ink hover:underline">{e.eventName}</Link>
                <p className="text-xs text-muted">
                  {fmtDate(e.startDate)}
                  {e.endDate !== e.startDate && ` – ${fmtDate(e.endDate)}`} · {EVENT_STATUS_LABEL[e.status as EventStatus] ?? e.status}
                </p>
              </div>
              <span className="num text-xs text-ink-2">
                {e.attendeeCount} registered{e.checkedInCount > 0 && ` · ${e.checkedInCount} in`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
