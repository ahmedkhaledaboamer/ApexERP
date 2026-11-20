import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Venue, VenueInput, VenueStatus, VenueType } from '@/modules/events/libraryTypes'
import { VENUE_TYPES, VENUE_TYPE_LABEL } from '@/modules/events/libraryTypes'
import { useSaveVenue } from '@/modules/events/hooks/useEventLibrary'
import { useRegion } from '@/modules/tenancy/hooks'
import { isMobile, mobileError } from '@/shared/lib/phone'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { CurrencySelect, RatingInput, TagsInput } from './LibraryBits'

type Room = { key: string; id?: string; name: string; capacity: string }
let roomSeq = 0

interface Draft {
  name: string
  type: VenueType
  address: string
  city: string
  country: string
  mapUrl: string
  lat: string
  lng: string
  capacity: string
  rooms: Room[]
  contactName: string
  contactMobile: string
  contactEmail: string
  dayRate: string
  currency: string
  priceNotes: string
  amenities: string[]
  notes: string
  rating: number
  status: VenueStatus
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function draftOf(v: Venue | null, region: { country: string; currency: string }): Draft {
  return {
    name: v?.name ?? '',
    type: v?.type ?? 'hotel',
    address: v?.address ?? '',
    city: v?.city ?? '',
    country: v?.country ?? region.country,
    mapUrl: v?.mapUrl ?? '',
    lat: num(v?.lat),
    lng: num(v?.lng),
    capacity: num(v?.capacity),
    rooms: (v?.rooms ?? []).map((r) => ({ key: `r${++roomSeq}`, id: r.id, name: r.name, capacity: num(r.capacity) })),
    contactName: v?.contactName ?? '',
    contactMobile: v?.contactMobile ?? '',
    contactEmail: v?.contactEmail ?? '',
    dayRate: num(v?.dayRate),
    currency: v?.currency ?? region.currency,
    priceNotes: v?.priceNotes ?? '',
    amenities: v?.amenities ?? [],
    notes: v?.notes ?? '',
    rating: v?.rating ?? 0,
    status: v?.status ?? 'active',
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Create / edit a venue (marketing full): address, map pin, capacity and rooms, contact, rates, amenities. */
export function VenueDrawer({ open, onClose, venue, onSaved }: { open: boolean; onClose: () => void; venue: Venue | null; onSaved?: (v: Venue) => void }) {
  const region = useRegion()
  const save = useSaveVenue()
  const toast = useToast()
  const [d, setD] = useState<Draft>(() => draftOf(venue, region))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setD(draftOf(venue, region))
    setTouched(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, venue?.id])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setRoom = (key: string, patch: Partial<Room>) => setD((x) => ({ ...x, rooms: x.rooms.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const errs: Partial<Record<keyof Draft, string>> = {}
  if (touched) {
    if (d.name.trim().length < 2) errs.name = 'Give the venue a name.'
    if (d.contactMobile && !isMobile(d.contactMobile, region.country)) errs.contactMobile = mobileError(region.country)
    if (d.contactEmail && !EMAIL_RE.test(d.contactEmail.trim())) errs.contactEmail = 'Enter a valid email address.'
    if (!!d.lat !== !!d.lng) errs.lat = 'Give both latitude and longitude, or neither.'
    if (d.capacity && !(Number.isInteger(Number(d.capacity)) && Number(d.capacity) > 0)) errs.capacity = 'A whole number of people.'
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    if (d.name.trim().length < 2) return
    const input: Partial<VenueInput> = {
      ...d,
      lat: d.lat === '' ? null : d.lat,
      lng: d.lng === '' ? null : d.lng,
      capacity: d.capacity === '' ? null : Number(d.capacity),
      rooms: d.rooms.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity === '' ? null : Number(r.capacity) })),
      dayRate: d.dayRate === '' ? null : Number(d.dayRate),
      rating: d.rating || null,
    }
    save.mutate(
      { id: venue?.id, input },
      {
        onSuccess: (v) => {
          toast.success(venue ? 'Venue saved' : 'Venue added', v.name)
          onSaved?.(v)
          onClose()
        },
      },
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={venue ? `Edit ${venue.name}` : 'New venue'}
      description="Picked on events: the event’s location fills from it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="venue-form" loading={save.isPending}>
            {venue ? 'Save venue' : 'Add venue'}
          </Button>
        </>
      }
    >
      <form id="venue-form" noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field id="vn-name" label="Name" required error={errs.name}>
            <TextInput id="vn-name" value={d.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="vn-type" label="Type">
            <SelectInput id="vn-type" value={d.type} onChange={(e) => set('type', e.target.value as VenueType)}>
              {VENUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VENUE_TYPE_LABEL[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field id="vn-address" label="Address">
          <TextInput id="vn-address" value={d.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field id="vn-city" label="City">
            <TextInput id="vn-city" value={d.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field id="vn-country" label="Country" hint="AE, SA…">
            <TextInput id="vn-country" maxLength={2} value={d.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
          </Field>
          <Field id="vn-lat" label="Latitude" error={errs.lat}>
            <TextInput id="vn-lat" inputMode="decimal" value={d.lat} invalid={!!errs.lat} onChange={(e) => set('lat', e.target.value)} />
          </Field>
          <Field id="vn-lng" label="Longitude">
            <TextInput id="vn-lng" inputMode="decimal" value={d.lng} onChange={(e) => set('lng', e.target.value)} />
          </Field>
        </div>
        <Field id="vn-map" label="Map link" hint="Optional when the pin (latitude / longitude) is set.">
          <TextInput id="vn-map" type="url" value={d.mapUrl} placeholder="https://maps.google.com/…" onChange={(e) => set('mapUrl', e.target.value)} />
        </Field>
        <Field id="vn-capacity" label="Total capacity" error={errs.capacity}>
          <TextInput id="vn-capacity" inputMode="numeric" value={d.capacity} invalid={!!errs.capacity} onChange={(e) => set('capacity', e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium">Rooms</legend>
          {d.rooms.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
              <TextInput aria-label={`Room ${i + 1} name`} placeholder="Room / hall" value={r.name} onChange={(e) => setRoom(r.key, { name: e.target.value })} />
              <TextInput aria-label={`Room ${i + 1} capacity`} inputMode="numeric" placeholder="Capacity" value={r.capacity} onChange={(e) => setRoom(r.key, { capacity: e.target.value })} />
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove room ${i + 1}`} onClick={() => set('rooms', d.rooms.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => set('rooms', [...d.rooms, { key: `r${++roomSeq}`, name: '', capacity: '' }])}>
            <Plus />
            Add room
          </Button>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id="vn-contact" label="Contact person">
            <TextInput id="vn-contact" value={d.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field id="vn-contact-mobile" label="Contact mobile" error={errs.contactMobile}>
            <TextInput id="vn-contact-mobile" inputMode="tel" value={d.contactMobile} invalid={!!errs.contactMobile} onChange={(e) => set('contactMobile', e.target.value)} />
          </Field>
          <Field id="vn-contact-email" label="Contact email" error={errs.contactEmail}>
            <TextInput id="vn-contact-email" type="email" value={d.contactEmail} invalid={!!errs.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field id="vn-rate" label="Day rate">
            <TextInput id="vn-rate" inputMode="decimal" value={d.dayRate} onChange={(e) => set('dayRate', e.target.value)} />
          </Field>
          <Field id="vn-currency" label="Currency">
            <CurrencySelect id="vn-currency" value={d.currency} onChange={(v) => set('currency', v)} />
          </Field>
        </div>
        <Field id="vn-price" label="Price notes">
          <TextArea id="vn-price" rows={2} value={d.priceNotes} onChange={(e) => set('priceNotes', e.target.value)} />
        </Field>
        <Field id="vn-amenities" label="Amenities" hint="Comma-separated, e.g. Parking, Wi-Fi, AV included.">
          <TagsInput key={`${venue?.id ?? 'new'}-${open}`} id="vn-amenities" value={d.amenities} onChange={(v) => set('amenities', v)} />
        </Field>
        <Field id="vn-notes" label="Notes">
          <TextArea id="vn-notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="mb-1 text-[0.8125rem] font-medium">Rating</p>
            <RatingInput value={d.rating} onChange={(v) => set('rating', v)} label="Venue rating" />
          </div>
          <Field id="vn-status" label="Status">
            <SelectInput id="vn-status" value={d.status} onChange={(e) => set('status', e.target.value as VenueStatus)}>
              <option value="active">Active</option>
              <option value="archived">Archived (can’t be picked for events)</option>
            </SelectInput>
          </Field>
        </div>
        {save.error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {save.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
