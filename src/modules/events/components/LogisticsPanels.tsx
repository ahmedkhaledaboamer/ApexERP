import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { CalendarClock, Pencil, Plane, Plus, Trash2, Truck } from 'lucide-react'
import type { LogisticsBundle, LogisticsDeadline, Shipment, Trip } from '@/modules/events/logisticsTypes'
import { SHIPMENT_STATUS_LABEL, TRIP_STATUS_LABEL, VISA_STATUS_LABEL } from '@/modules/events/logisticsTypes'
import { useDeleteDeadline, useDeleteShipment, useDeleteTrip, useSaveDeadline } from '@/modules/events/hooks/useSponsorsLogistics'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { fmtDate } from '@/shared/lib/utils'
import { DeadlineModal, ShipmentModal, TripModal } from '@/modules/events/components/LogisticsForms'
import { eventPath } from '@/app/paths'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox } from '@/shared/components/form/Field'

/** Trips, shipments and deadlines panels, shared by `/events/logistics` and the event's Logistics tab. */

const TRIP_TONE: Record<Trip['status'], Tone> = { planned: 'sky', booked: 'brand', completed: 'green', cancelled: 'neutral' }
const VISA_TONE: Record<Trip['visaStatus'], Tone> = { not_needed: 'neutral', applied: 'amber', approved: 'green', rejected: 'red' }
const SHIP_TONE: Record<Shipment['status'], Tone> = { preparing: 'sky', in_transit: 'amber', delivered: 'green', returned: 'neutral', cancelled: 'neutral' }
// Dates in the company's date format (date-only values are never shifted by the timezone).
const day = (v: string | null) => (v ? fmtDate(v) : '?')
const span = (a: string | null, b: string | null) => (a || b ? `${day(a)} → ${day(b)}` : '—')

function useCanAdd(b: LogisticsBundle, eventId?: string) {
  return b.events.some((e) => e.canManage && (!eventId || e.id === eventId))
}

/* ---------------- Trips ---------------- */

export function TripsPanel({ bundle: b, eventId, showEvent }: { bundle: LogisticsBundle; eventId?: string; showEvent: boolean }) {
  const [editing, setEditing] = useState<Trip | 'new' | null>(null)
  const remove = useDeleteTrip()
  const toast = useToast()
  const canAdd = useCanAdd(b, eventId)
  const groups = b.events.map((e) => ({ event: e, trips: b.trips.filter((t) => t.eventId === e.id) })).filter((g) => g.trips.length || (eventId && g.event.id === eventId))
  const perPerson = new Map<string, { name: string; total: number; trips: number }>()
  for (const t of b.trips) {
    const p = perPerson.get(t.userId) ?? { name: t.userName, total: 0, trips: 0 }
    p.total += t.total
    p.trips++
    perPerson.set(t.userId, p)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!b.seesAll && <p className="text-[0.8125rem] text-muted">Showing your own trips on events you’re not part of.</p>}
        {canAdd && (
          <Button write size="sm" className="ms-auto" onClick={() => setEditing('new')}>
            <Plus />
            Add trip
          </Button>
        )}
      </div>
      {groups.length === 0 && <Card className="p-5 text-[0.8125rem] text-muted">No trips yet.</Card>}
      {groups.map(({ event: e, trips }) => (
        <Card key={e.id} className="overflow-x-auto">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <Plane className="size-4 text-muted" aria-hidden />
            {showEvent ? <Link to={eventPath(e.id, 'logistics')} className="font-semibold hover:underline">{e.name}</Link> : <span className="font-semibold">Trips</span>}
            <span className="text-xs text-muted">{fmtDate(e.startDate)}</span>
            <span className="num ms-auto text-[0.8125rem] font-medium">{moneyIn(trips.reduce((s, t) => s + t.total, 0), b.currency)}</span>
          </div>
          <table className="w-full text-[0.8125rem]" aria-label={`Trips · ${e.name}`}>
            <thead className="border-y border-line bg-sunken/50 text-xs text-muted">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Traveller</th>
                <th className="px-3 py-2 text-start font-medium">Flight</th>
                <th className="px-3 py-2 text-start font-medium">Hotel</th>
                <th className="px-3 py-2 text-start font-medium">Visa</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-end font-medium">Total</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {trips.length === 0 && <tr><td colSpan={7} className="px-5 py-3 text-muted">No trips yet.</td></tr>}
              {trips.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-2 font-medium">{t.userName}</td>
                  <td className="px-3 py-2">
                    <p>{t.flightFrom || t.flightTo ? `${t.flightFrom || '?'} → ${t.flightTo || '?'}` : '—'}{t.airline && <span className="text-muted"> · {t.airline}</span>}</p>
                    <p className="num text-xs text-muted">{span(t.departDate, t.returnDate)}{t.bookingRef && ` · ${t.bookingRef}`}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p>{t.hotelName || '—'}</p>
                    <p className="num text-xs text-muted">{t.hotelName ? span(t.checkIn, t.checkOut) : ''}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={VISA_TONE[t.visaStatus]}>{VISA_STATUS_LABEL[t.visaStatus]}</Badge>
                    {t.visaNumberMasked && <p className="num mt-0.5 text-xs text-muted" aria-label="Visa number (masked)">{t.visaNumberMasked}</p>}
                    {t.visaExpiry && <p className="num text-xs text-muted">Expires {fmtDate(t.visaExpiry)}</p>}
                  </td>
                  <td className="px-3 py-2"><Badge tone={TRIP_TONE[t.status]} variant="dot">{TRIP_STATUS_LABEL[t.status]}</Badge></td>
                  <td className="num px-3 py-2 text-end">{moneyIn(t.total, b.currency)}</td>
                  <td className="px-5 py-2 text-end whitespace-nowrap">
                    {t.canManage && (
                      <>
                        <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit trip of ${t.userName}`} onClick={() => setEditing(t)}><Pencil /></Button>
                        <Button
                          write
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Delete trip of ${t.userName}`}
                          onClick={() => remove.mutate({ eventId: t.eventId, tripId: t.id }, { onSuccess: () => toast.success('Trip removed', 'Its budget line is gone too.'), onError: (err) => toast.error('Not removed', err.message) })}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      {perPerson.size > 1 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Per-person totals">
            <thead className="border-b border-line bg-sunken/50 text-xs text-muted">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Per person</th>
                <th className="px-3 py-2 text-end font-medium">Trips</th>
                <th className="px-5 py-2 text-end font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...perPerson.entries()].sort((a, b) => b[1].total - a[1].total).map(([id, p]) => (
                <tr key={id}>
                  <td className="px-5 py-2">{p.name}</td>
                  <td className="num px-3 py-2 text-end">{p.trips}</td>
                  <td className="num px-5 py-2 text-end">{moneyIn(p.total, b.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <TripModal events={b.events} eventId={eventId} trip={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/* ---------------- Shipments ---------------- */

export function ShipmentsPanel({ bundle: b, eventId, showEvent }: { bundle: LogisticsBundle; eventId?: string; showEvent: boolean }) {
  const [editing, setEditing] = useState<Shipment | 'new' | null>(null)
  const remove = useDeleteShipment()
  const toast = useToast()
  const canAdd = useCanAdd(b, eventId)
  return (
    <div className="space-y-4">
      {canAdd && (
        <div className="flex">
          <Button write size="sm" className="ms-auto" onClick={() => setEditing('new')}>
            <Plus />
            Add shipment
          </Button>
        </div>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-[0.8125rem]" aria-label="Shipments">
          <thead className="border-b border-line bg-sunken/50 text-xs text-muted">
            <tr>
              <th className="px-5 py-2 text-start font-medium">Items</th>
              {showEvent && <th className="px-3 py-2 text-start font-medium">Event</th>}
              <th className="px-3 py-2 text-start font-medium">Vendor · tracking</th>
              <th className="px-3 py-2 text-start font-medium">Ship → arrival</th>
              <th className="px-3 py-2 text-start font-medium">Status</th>
              <th className="px-3 py-2 text-end font-medium">Cost</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {b.shipments.length === 0 && <tr><td colSpan={7} className="px-5 py-4 text-muted">No shipments yet.</td></tr>}
            {b.shipments.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-2 font-medium"><Truck className="me-1.5 inline size-3.5 text-muted" aria-hidden />{s.items}</td>
                {showEvent && <td className="px-3 py-2"><Link className="hover:underline" to={eventPath(s.eventId, 'logistics')}>{s.eventName}</Link></td>}
                <td className="px-3 py-2">
                  <p>{s.vendorName || '—'}</p>
                  {s.trackingNumber && <p className="num text-xs text-muted">{s.trackingNumber}</p>}
                </td>
                <td className="num px-3 py-2">{span(s.shipDate, s.arrivalDate)}</td>
                <td className="px-3 py-2"><Badge tone={SHIP_TONE[s.status]} variant="dot">{SHIPMENT_STATUS_LABEL[s.status]}</Badge></td>
                <td className="num px-3 py-2 text-end">{moneyIn(s.cost, b.currency)}</td>
                <td className="px-5 py-2 text-end whitespace-nowrap">
                  {s.canManage && (
                    <>
                      <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit shipment ${s.items}`} onClick={() => setEditing(s)}><Pencil /></Button>
                      <Button write variant="ghost" size="xs" iconOnly aria-label={`Delete shipment ${s.items}`} onClick={() => remove.mutate({ eventId: s.eventId, shipmentId: s.id }, { onSuccess: () => toast.success('Shipment removed'), onError: (err) => toast.error('Not removed', err.message) })}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <ShipmentModal events={b.events} vendors={b.vendors} eventId={eventId} shipment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/* ---------------- Deadlines ---------------- */

export function DeadlinesPanel({ bundle: b, eventId, showEvent }: { bundle: LogisticsBundle; eventId?: string; showEvent: boolean }) {
  const [editing, setEditing] = useState<LogisticsDeadline | 'new' | null>(null)
  const save = useSaveDeadline()
  const remove = useDeleteDeadline()
  const toast = useToast()
  const canAdd = useCanAdd(b, eventId)
  const months = new Map<string, LogisticsDeadline[]>()
  for (const d of b.deadlines) months.set(d.dueDate.slice(0, 7), [...(months.get(d.dueDate.slice(0, 7)) ?? []), d])
  return (
    <div className="space-y-4">
      {canAdd && (
        <div className="flex">
          <Button write size="sm" className="ms-auto" onClick={() => setEditing('new')}>
            <Plus />
            Add deadline
          </Button>
        </div>
      )}
      {b.deadlines.length === 0 && <Card className="p-5 text-[0.8125rem] text-muted">No deadlines yet.</Card>}
      {[...months.entries()].map(([month, rows]) => (
        <Card key={month}>
          <h3 className="flex items-center gap-2 px-5 pt-4 pb-2 text-[0.8125rem] font-semibold">
            <CalendarClock className="size-4 text-muted" aria-hidden />
            {format(parseISO(`${month}-01`), 'MMMM yyyy')}
          </h3>
          <ul className="divide-y divide-line border-t border-line" aria-label={`Deadlines ${month}`}>
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-2 text-[0.8125rem]">
                <Checkbox
                  aria-label={`${d.title} done`}
                  checked={d.done}
                  disabled={!d.canManage}
                  onChange={(e) => save.mutate({ eventId: d.eventId, deadlineId: d.id, input: { done: e.target.checked } }, { onError: (err) => toast.error('Not saved', err.message) })}
                />
                <span className="num w-24 shrink-0 text-xs text-muted">{format(parseISO(d.dueDate), 'EEE d MMM')}</span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${d.done ? 'text-muted line-through' : ''}`}>{d.title}</p>
                  <p className="truncate text-xs text-muted">
                    {showEvent && <Link className="hover:underline" to={eventPath(d.eventId, 'logistics')}>{d.eventName}</Link>}
                    {showEvent && d.ownerName ? ' · ' : ''}
                    {d.ownerName}
                  </p>
                </div>
                {!d.done && (d.overdue ? <Badge tone="red">Overdue</Badge> : d.daysLeft <= 3 ? <Badge tone="amber">{d.daysLeft === 0 ? 'Today' : `In ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`}</Badge> : null)}
                {d.canManage && (
                  <span className="whitespace-nowrap">
                    <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}><Pencil /></Button>
                    <Button write variant="ghost" size="xs" iconOnly aria-label={`Delete ${d.title}`} onClick={() => remove.mutate({ eventId: d.eventId, deadlineId: d.id }, { onSuccess: () => toast.success('Deadline removed'), onError: (err) => toast.error('Not removed', err.message) })}>
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {editing && <DeadlineModal events={b.events} eventId={eventId} deadline={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
