import { useState } from 'react'
import type { LogisticsDeadline, LogisticsEventOption, Shipment, ShipmentStatus, Trip, TripInput, TripStatus, VisaStatus } from '@/modules/events/logisticsTypes'
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABEL, TRIP_STATUSES, TRIP_STATUS_LABEL, VISA_STATUSES, VISA_STATUS_LABEL } from '@/modules/events/logisticsTypes'
import { useSaveDeadline, useSaveShipment, useSaveTrip } from '@/modules/events/hooks/useSponsorsLogistics'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/** Event picker for a new row on the cross-event page (events the caller can manage). */
function EventSelect({ id, events, value, onChange }: { id: string; events: LogisticsEventOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field id={id} label="Event">
      <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {events.filter((e) => e.canManage).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </SelectInput>
    </Field>
  )
}

const num = (v: string) => (v === '' ? 0 : Number(v))
const firstManaged = (events: LogisticsEventOption[], fixed?: string) => fixed ?? events.find((e) => e.canManage)?.id ?? ''

/* ---------------- Trip ---------------- */

export function TripModal({ events, eventId: fixed, trip, onClose }: { events: LogisticsEventOption[]; eventId?: string; trip: Trip | null; onClose: () => void }) {
  const save = useSaveTrip()
  const toast = useToast()
  const users = useUsersQuery()
  const [eventId, setEventId] = useState(trip?.eventId ?? firstManaged(events, fixed))
  const [f, setF] = useState({
    userId: trip?.userId ?? '',
    flightFrom: trip?.flightFrom ?? '',
    flightTo: trip?.flightTo ?? '',
    departDate: trip?.departDate ?? '',
    returnDate: trip?.returnDate ?? '',
    airline: trip?.airline ?? '',
    bookingRef: trip?.bookingRef ?? '',
    flightCost: trip ? String(trip.flightCost) : '',
    hotelName: trip?.hotelName ?? '',
    checkIn: trip?.checkIn ?? '',
    checkOut: trip?.checkOut ?? '',
    hotelCost: trip ? String(trip.hotelCost) : '',
    visaRequired: trip?.visaRequired ?? false,
    visaStatus: (trip?.visaStatus ?? 'applied') as VisaStatus,
    visaExpiry: trip?.visaExpiry ?? '',
    visaNumber: '',
    perDiem: trip ? String(trip.perDiem) : '',
    otherCosts: trip ? String(trip.otherCosts) : '',
    status: (trip?.status ?? 'planned') as TripStatus,
    notes: trip?.notes ?? '',
  })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const total = num(f.flightCost) + num(f.hotelCost) + num(f.perDiem) + num(f.otherCosts)

  function submit() {
    const input: Partial<TripInput> = {
      ...f,
      departDate: f.departDate || null,
      returnDate: f.returnDate || null,
      checkIn: f.checkIn || null,
      checkOut: f.checkOut || null,
      visaExpiry: f.visaExpiry || null,
      flightCost: num(f.flightCost),
      hotelCost: num(f.hotelCost),
      perDiem: num(f.perDiem),
      otherCosts: num(f.otherCosts),
      visaStatus: f.visaRequired ? f.visaStatus : 'not_needed',
    }
    // Write-only: send the number only when typed (an empty field keeps the stored last 4).
    if (!f.visaNumber.trim()) delete input.visaNumber
    save.mutate(
      { eventId, tripId: trip?.id, input },
      { onSuccess: (t) => { toast.success(trip ? 'Trip saved' : 'Trip added', `${t.userName} · ${t.eventName}`); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={trip ? `Trip · ${trip.userName}` : 'Add a trip'}
      description="Flights, hotel, visa and allowances for one person. The trip’s total is posted to the event’s budget as a travel line."
      footer={
        <>
          <span className="me-auto num text-[0.8125rem] text-muted">Total {total.toLocaleString('en')}</span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{trip ? 'Save trip' : 'Add trip'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {!fixed && !trip && <EventSelect id="trip-event" events={events} value={eventId} onChange={setEventId} />}
          <Field id="trip-user" label="Traveller" required>
            <SelectInput id="trip-user" value={f.userId} onChange={(e) => set({ userId: e.target.value })}>
              <option value="">Pick a person</option>
              {(users.data ?? []).filter((u) => u.active !== false || u.id === f.userId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="trip-status" label="Status">
            <SelectInput id="trip-status" value={f.status} onChange={(e) => set({ status: e.target.value as TripStatus })}>
              {TRIP_STATUSES.map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
            </SelectInput>
          </Field>
        </div>
        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <legend className="col-span-full mb-1 text-[0.8125rem] font-semibold">Flight</legend>
          <Field id="trip-from" label="From"><TextInput id="trip-from" placeholder="DXB" value={f.flightFrom} onChange={(e) => set({ flightFrom: e.target.value })} /></Field>
          <Field id="trip-to" label="To"><TextInput id="trip-to" placeholder="LAS" value={f.flightTo} onChange={(e) => set({ flightTo: e.target.value })} /></Field>
          <Field id="trip-depart" label="Departure"><TextInput id="trip-depart" type="date" value={f.departDate} onChange={(e) => set({ departDate: e.target.value })} /></Field>
          <Field id="trip-return" label="Return"><TextInput id="trip-return" type="date" value={f.returnDate} onChange={(e) => set({ returnDate: e.target.value })} /></Field>
          <Field id="trip-airline" label="Airline"><TextInput id="trip-airline" value={f.airline} onChange={(e) => set({ airline: e.target.value })} /></Field>
          <Field id="trip-ref" label="Booking ref"><TextInput id="trip-ref" value={f.bookingRef} onChange={(e) => set({ bookingRef: e.target.value })} /></Field>
          <Field id="trip-flight-cost" label="Flight cost"><TextInput id="trip-flight-cost" type="number" min={0} value={f.flightCost} onChange={(e) => set({ flightCost: e.target.value })} /></Field>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <legend className="col-span-full mb-1 text-[0.8125rem] font-semibold">Hotel</legend>
          <div className="col-span-2 sm:col-span-1"><Field id="trip-hotel" label="Hotel"><TextInput id="trip-hotel" value={f.hotelName} onChange={(e) => set({ hotelName: e.target.value })} /></Field></div>
          <Field id="trip-in" label="Check-in"><TextInput id="trip-in" type="date" value={f.checkIn} onChange={(e) => set({ checkIn: e.target.value })} /></Field>
          <Field id="trip-out" label="Check-out"><TextInput id="trip-out" type="date" value={f.checkOut} onChange={(e) => set({ checkOut: e.target.value })} /></Field>
          <Field id="trip-hotel-cost" label="Hotel cost"><TextInput id="trip-hotel-cost" type="number" min={0} value={f.hotelCost} onChange={(e) => set({ hotelCost: e.target.value })} /></Field>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <legend className="col-span-full mb-1 text-[0.8125rem] font-semibold">Visa</legend>
          <label className="col-span-full flex items-center gap-2 text-[0.8125rem]">
            <Checkbox checked={f.visaRequired} onChange={(e) => set({ visaRequired: e.target.checked })} />
            Visa required
          </label>
          {f.visaRequired && (
            <>
              <Field id="trip-visa-status" label="Visa status">
                <SelectInput id="trip-visa-status" value={f.visaStatus} onChange={(e) => set({ visaStatus: e.target.value as VisaStatus })}>
                  {VISA_STATUSES.filter((s) => s !== 'not_needed').map((s) => <option key={s} value={s}>{VISA_STATUS_LABEL[s]}</option>)}
                </SelectInput>
              </Field>
              <Field id="trip-visa-expiry" label="Visa expiry"><TextInput id="trip-visa-expiry" type="date" value={f.visaExpiry} onChange={(e) => set({ visaExpiry: e.target.value })} /></Field>
              <div className="col-span-2">
                <Field id="trip-visa-number" label="Visa / document number" hint={trip?.visaNumberMasked ? `Stored: ${trip.visaNumberMasked}. Only the last 4 are kept.` : 'Only the last 4 characters are kept.'}>
                  <TextInput id="trip-visa-number" autoComplete="off" value={f.visaNumber} onChange={(e) => set({ visaNumber: e.target.value })} />
                </Field>
              </div>
            </>
          )}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field id="trip-per-diem" label="Per-diem"><TextInput id="trip-per-diem" type="number" min={0} value={f.perDiem} onChange={(e) => set({ perDiem: e.target.value })} /></Field>
          <Field id="trip-other" label="Other costs"><TextInput id="trip-other" type="number" min={0} value={f.otherCosts} onChange={(e) => set({ otherCosts: e.target.value })} /></Field>
        </div>
        <Field id="trip-notes" label="Notes"><TextArea id="trip-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

/* ---------------- Shipment ---------------- */

export function ShipmentModal({ events, vendors, eventId: fixed, shipment, onClose }: { events: LogisticsEventOption[]; vendors: { id: string; name: string }[]; eventId?: string; shipment: Shipment | null; onClose: () => void }) {
  const save = useSaveShipment()
  const toast = useToast()
  const [eventId, setEventId] = useState(shipment?.eventId ?? firstManaged(events, fixed))
  const [f, setF] = useState({
    vendorId: shipment?.vendorId ?? '',
    vendorName: shipment?.vendorId ? '' : (shipment?.vendorName ?? ''),
    trackingNumber: shipment?.trackingNumber ?? '',
    items: shipment?.items ?? '',
    shipDate: shipment?.shipDate ?? '',
    arrivalDate: shipment?.arrivalDate ?? '',
    status: (shipment?.status ?? 'preparing') as ShipmentStatus,
    cost: shipment ? String(shipment.cost) : '',
    notes: shipment?.notes ?? '',
  })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))

  function submit() {
    save.mutate(
      { eventId, shipmentId: shipment?.id, input: { ...f, vendorId: f.vendorId || null, shipDate: f.shipDate || null, arrivalDate: f.arrivalDate || null, cost: num(f.cost) } },
      { onSuccess: () => { toast.success(shipment ? 'Shipment saved' : 'Shipment added'); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={shipment ? 'Edit shipment' : 'Add a shipment'}
      description="Booth materials and freight. The cost is posted to the event’s budget as a logistics line."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{shipment ? 'Save shipment' : 'Add shipment'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fixed && !shipment && <EventSelect id="ship-event" events={events} value={eventId} onChange={setEventId} />}
        <div className="sm:col-span-2">
          <Field id="ship-items" label="Items" required><TextInput id="ship-items" placeholder="Booth graphics, demo kiosks…" value={f.items} onChange={(e) => set({ items: e.target.value })} /></Field>
        </div>
        <Field id="ship-vendor" label="Vendor" hint={vendors.length ? 'From your vendor library, or type a name.' : undefined}>
          {vendors.length ? (
            <SelectInput id="ship-vendor" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
              <option value="">Other (type below)</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </SelectInput>
          ) : (
            <TextInput id="ship-vendor" value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value })} />
          )}
        </Field>
        {vendors.length > 0 && !f.vendorId ? (
          <Field id="ship-vendor-name" label="Vendor name"><TextInput id="ship-vendor-name" value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value })} /></Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Field id="ship-tracking" label="Tracking number"><TextInput id="ship-tracking" value={f.trackingNumber} onChange={(e) => set({ trackingNumber: e.target.value })} /></Field>
        <Field id="ship-status" label="Status">
          <SelectInput id="ship-status" value={f.status} onChange={(e) => set({ status: e.target.value as ShipmentStatus })}>
            {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABEL[s]}</option>)}
          </SelectInput>
        </Field>
        <Field id="ship-date" label="Ship date"><TextInput id="ship-date" type="date" value={f.shipDate} onChange={(e) => set({ shipDate: e.target.value })} /></Field>
        <Field id="ship-arrival" label="Arrival"><TextInput id="ship-arrival" type="date" value={f.arrivalDate} onChange={(e) => set({ arrivalDate: e.target.value })} /></Field>
        <Field id="ship-cost" label="Cost"><TextInput id="ship-cost" type="number" min={0} value={f.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field id="ship-notes" label="Notes"><TextArea id="ship-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field></div>
      </div>
    </Modal>
  )
}

/* ---------------- Deadline ---------------- */

export function DeadlineModal({ events, eventId: fixed, deadline, onClose }: { events: LogisticsEventOption[]; eventId?: string; deadline: LogisticsDeadline | null; onClose: () => void }) {
  const save = useSaveDeadline()
  const toast = useToast()
  const users = useUsersQuery()
  const [eventId, setEventId] = useState(deadline?.eventId ?? firstManaged(events, fixed))
  const [f, setF] = useState({ title: deadline?.title ?? '', dueDate: deadline?.dueDate ?? '', ownerId: deadline?.ownerId ?? '', notes: deadline?.notes ?? '' })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))

  function submit() {
    save.mutate(
      { eventId, deadlineId: deadline?.id, input: { title: f.title, dueDate: f.dueDate, notes: f.notes, ...(f.ownerId || deadline ? { ownerId: f.ownerId || null } : {}) } },
      { onSuccess: () => { toast.success(deadline ? 'Deadline saved' : 'Deadline added', f.title); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
    )
  }

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={deadline ? 'Edit deadline' : 'Add a deadline'}
      description="Exhibitor manual, badge registration, power / internet order… The owner gets a reminder 3 days before."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{deadline ? 'Save deadline' : 'Add deadline'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!fixed && !deadline && <EventSelect id="dl-event" events={events} value={eventId} onChange={setEventId} />}
        <Field id="dl-title" label="Deadline" required><TextInput id="dl-title" value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field id="dl-due" label="Due date" required><TextInput id="dl-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        <Field id="dl-owner" label="Owner" hint="The event owner when empty.">
          <SelectInput id="dl-owner" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Event owner</option>
            {(users.data ?? []).filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="dl-notes" label="Notes"><TextArea id="dl-notes" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
