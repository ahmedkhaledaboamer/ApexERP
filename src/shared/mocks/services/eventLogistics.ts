import type { User } from '@/shared/types'
import type { DeadlineInput, LogisticsBundle, LogisticsDeadline, Shipment, ShipmentInput, ShipmentStatus, Trip, TripInput, TripStatus, VisaStatus } from '@/modules/events/logisticsTypes'
import { SHIPMENT_STATUSES, TRIP_STATUSES, VISA_STATUSES } from '@/modules/events/logisticsTypes'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { users } from '@/shared/mocks/db'
import { events, type EventRecord } from '@/shared/mocks/data/events'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { eventStartDate } from '@/shared/mocks/data/eventSponsors'
import {
  eventDeadlines,
  eventLogisticsLines,
  eventShipments,
  eventTrips,
  maskLast4,
  syncLogisticsLines,
  tripTotal,
  type DeadlineRecord,
  type ShipmentRecord,
  type TripRecord,
} from '@/shared/mocks/data/eventLogistics'
import { canEditEvent, canSeeEvent } from '@/shared/mocks/selectors/events'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { now as clockNow, nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertModule, onLifecycleTick } from '@/shared/mocks/services/billing'
import { currencyOf, eventFor, log } from '@/shared/mocks/services/events'
import { syncCampaignCosts } from '@/shared/mocks/services/eventBudget'

/**
 * Travel & logistics (docs/API.md › Events › Travel & logistics), for events the company attends or organizes.
 *  - Trips: one per person (a user of the company) per event — flights, hotel, visa, per-diem / other costs,
 *    status. The visa document number is write-only: only its last 4 characters are kept and it is served
 *    masked ("•••• 4821"); the full number is never stored nor returned.
 *  - Shipments: booth materials (vendor from the company's vendor library or free text, tracking, items,
 *    dates, status, cost).
 *  - Deadlines: the event's checklist of dated deadlines (exhibitor manual, badges, power / internet…) with a
 *    once-only reminder to the owner 3 days before (company calendar).
 *  - Costs: every trip (travel) and shipment (logistics) keeps ONE budget line of the event in step
 *    (idempotent: create → line, edit → same line updated, delete or cost 0 → line removed), so the event's
 *    actual cost, ROI and cost per lead include them; a linked campaign gets the cost entries too.
 * Access: read = sees the event (marketing view / full: every event; team members: theirs); write = the
 * event's edit right (marketing full or the event team). Everyone with the module always sees their OWN trips.
 */

export const DEADLINE_REMINDER_DAYS = 3
const TRIP_NOT_FOUND = 'That trip doesn’t exist.'
const SHIPMENT_NOT_FOUND = 'That shipment doesn’t exist.'
const DEADLINE_NOT_FOUND = 'That deadline doesn’t exist.'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const round2 = (n: number) => Math.round(n * 100) / 100
let seq = 0
const nextId = (prefix: string) => `${prefix}-${nowMs().toString(36)}${(++seq).toString(36)}`

/* ---------------- Views ---------------- */

const lineIdOf = (companyId: string, kind: 'trip' | 'shipment', id: string) =>
  eventLogisticsLines.find((k) => k.companyId === companyId && k.kind === kind && k.sourceId === id)?.lineId ?? null

function tripView(t: Tenant<TripRecord>, e: Tenant<EventRecord>, viewer: User): Trip {
  return {
    id: t.id,
    eventId: t.eventId,
    eventName: e.name,
    eventStartDate: eventStartDate(e),
    userId: t.userId,
    userName: ownerName(t.userId),
    flightFrom: t.flightFrom,
    flightTo: t.flightTo,
    departDate: t.departDate,
    returnDate: t.returnDate,
    airline: t.airline,
    bookingRef: t.bookingRef,
    flightCost: t.flightCost,
    hotelName: t.hotelName,
    checkIn: t.checkIn,
    checkOut: t.checkOut,
    hotelCost: t.hotelCost,
    visaRequired: t.visaRequired,
    visaStatus: t.visaStatus,
    visaExpiry: t.visaExpiry,
    visaNumberMasked: maskLast4(t.visaNumberLast4),
    perDiem: t.perDiem,
    otherCosts: t.otherCosts,
    total: tripTotal(t),
    status: t.status,
    notes: t.notes,
    budgetLineId: lineIdOf(t.companyId, 'trip', t.id),
    canManage: canEditEvent(viewer, e),
  }
}

function shipmentView(s: Tenant<ShipmentRecord>, e: Tenant<EventRecord>, viewer: User): Shipment {
  return {
    id: s.id,
    eventId: s.eventId,
    eventName: e.name,
    vendorId: s.vendorId,
    vendorName: s.vendorName,
    trackingNumber: s.trackingNumber,
    items: s.items,
    shipDate: s.shipDate,
    arrivalDate: s.arrivalDate,
    status: s.status,
    cost: s.cost,
    notes: s.notes,
    budgetLineId: lineIdOf(s.companyId, 'shipment', s.id),
    canManage: canEditEvent(viewer, e),
  }
}

function deadlineView(d: Tenant<DeadlineRecord>, e: Tenant<EventRecord>, viewer: User, today: string): LogisticsDeadline {
  const daysLeft = daysBetweenIso(today, d.dueDate)
  return {
    id: d.id,
    eventId: d.eventId,
    eventName: e.name,
    title: d.title,
    dueDate: d.dueDate,
    ownerId: d.ownerId,
    ownerName: d.ownerId ? ownerName(d.ownerId) : '',
    done: d.done,
    doneAt: d.doneAt,
    notes: d.notes,
    overdue: !d.done && daysLeft < 0,
    daysLeft,
    canManage: canEditEvent(viewer, e),
  }
}

const byTripOrder = (a: TripRecord, b: TripRecord) => (a.departDate ?? '9999').localeCompare(b.departDate ?? '9999') || a.createdAt.localeCompare(b.createdAt)

/** The bundle for a set of events the caller sees fully, plus their own trips on other events. */
function bundleOf(user: User, full: Tenant<EventRecord>[], ownOnly: Tenant<EventRecord>[]): LogisticsBundle {
  const co = tenantOf(user)
  const today = companyDayOf(co).today
  const fullIds = new Map(full.map((e) => [e.id, e]))
  const ownIds = new Map(ownOnly.map((e) => [e.id, e]))
  const trips = eventTrips
    .filter((t) => t.companyId === co && (fullIds.has(t.eventId) || (ownIds.has(t.eventId) && t.userId === user.id)))
    .sort(byTripOrder)
    .map((t) => tripView(t, (fullIds.get(t.eventId) ?? ownIds.get(t.eventId))!, user))
  const shipments = eventShipments
    .filter((s) => s.companyId === co && fullIds.has(s.eventId))
    .sort((a, b) => (a.shipDate ?? '9999').localeCompare(b.shipDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))
    .map((s) => shipmentView(s, fullIds.get(s.eventId)!, user))
  const deadlines = eventDeadlines
    .filter((d) => d.companyId === co && fullIds.has(d.eventId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title))
    .map((d) => deadlineView(d, fullIds.get(d.eventId)!, user, today))
  const listed = [...full, ...ownOnly.filter((e) => !fullIds.has(e.id))].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return {
    currency: currencyOf(co),
    trips,
    shipments,
    deadlines,
    events: listed.map((e) => ({ id: e.id, name: e.name, startDate: eventStartDate(e), isOrganizer: e.isOrganizer, canManage: fullIds.has(e.id) && canEditEvent(user, e) })),
    seesAll: ownOnly.every((e) => fullIds.has(e.id)),
    vendors: eventVendors
      .filter((v) => v.companyId === co && v.status !== 'blacklisted')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => ({ id: v.id, name: v.name })),
  }
}

/* ---------------- Reads ---------------- */

/** GET /events/logistics?event_id= — every event the caller sees (not cancelled), plus their own trips anywhere. */
export async function listLogistics(user: User, filter: { eventId?: string } = {}): Promise<LogisticsBundle> {
  const co = tenantOf(user)
  assertModule(co, 'events')
  runLogisticsReminders(co)
  const pick = (e: Tenant<EventRecord>) => e.companyId === co && (!filter.eventId || e.id === filter.eventId)
  const full = events.filter((e) => pick(e) && e.status !== 'cancelled' && canSeeEvent(user, e))
  const own = events.filter((e) => pick(e) && !canSeeEvent(user, e) && eventTrips.some((t) => t.companyId === co && t.eventId === e.id && t.userId === user.id))
  return delay(bundleOf(user, full, own))
}

/** GET /events/:id/logistics — the event's trips, shipments and deadlines; someone off the event only gets their own trips. */
export async function getEventLogistics(user: User, id: string): Promise<LogisticsBundle> {
  const co = tenantOf(user)
  assertModule(co, 'events')
  runLogisticsReminders(co)
  const e = findInTenant(events, user, (x) => x.id === id)
  if (e && !canSeeEvent(user, e) && eventTrips.some((t) => t.companyId === co && t.eventId === e.id && t.userId === user.id)) {
    return delay(bundleOf(user, [], [e]))
  }
  const seen = await eventFor(user, id)
  return delay(bundleOf(user, [seen], []))
}

/* ---------------- Validation ---------------- */

function amountOf(v: unknown, label: string): number | string {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1e10) return `${label} must be 0 or a positive amount.`
  return round2(n)
}

function dateOf(v: unknown, label: string): string | null | Error {
  if (v === undefined || v === null || v === '') return null
  const s = str(v)
  return isRealIsoDate(s) ? s : new Error(`${label} must be a date (yyyy-MM-dd).`)
}

function text(v: unknown, max: number, label: string): string | Error {
  const s = str(v)
  return s.length > max ? new Error(`Keep ${label} under ${max} characters.`) : s
}

/** Visa / document number → its last 4 characters (letters and digits only). Write-only. */
function last4Of(v: unknown): string | Error {
  const raw = str(v).replace(/[\s-]/g, '').toUpperCase()
  if (!raw) return ''
  if (!/^[A-Z0-9]{5,30}$/.test(raw)) return new Error('Enter the visa / document number with 5–30 letters or digits.')
  return raw.slice(-4)
}

function memberOf(companyId: string, id: unknown, label: string): User | null | Error {
  const v = str(id)
  if (!v) return null
  return users.find((x) => x.id === v && x.companyId === companyId && x.active !== false) ?? new Error(`Pick ${label} from your company.`)
}

type TripFields = Omit<TripRecord, 'id' | 'eventId' | 'createdBy' | 'createdAt' | 'updatedAt'>

function cleanTrip(companyId: string, input: Partial<TripInput> | null, existing?: TripRecord): TripFields | string {
  const v = { ...(input ?? {}) }
  const base: Partial<TripRecord> = existing ?? {}
  const pick = <K extends keyof TripInput & keyof TripRecord>(k: K) => (v[k] !== undefined ? v[k] : base[k])
  const person = memberOf(companyId, pick('userId'), 'the traveller')
  if (person instanceof Error) return person.message
  if (!person) return 'Pick who travels.'
  const out: Partial<TripFields> = { userId: person.id }
  for (const [k, max, label] of [['flightFrom', 60, 'the departure'], ['flightTo', 60, 'the destination'], ['airline', 80, 'the airline'], ['bookingRef', 30, 'the booking reference'], ['hotelName', 160, 'the hotel'], ['notes', 2000, 'the notes']] as const) {
    const t = text(pick(k), max, label)
    if (t instanceof Error) return t.message
    out[k] = t
  }
  for (const [k, label] of [['departDate', 'Departure'], ['returnDate', 'Return'], ['checkIn', 'Check-in'], ['checkOut', 'Check-out'], ['visaExpiry', 'Visa expiry']] as const) {
    const d = dateOf(pick(k), label)
    if (d instanceof Error) return d.message
    out[k] = d
  }
  if (out.departDate && out.returnDate && out.returnDate < out.departDate) return 'The return can’t be before the departure.'
  if (out.checkIn && out.checkOut && out.checkOut < out.checkIn) return 'Check-out can’t be before check-in.'
  for (const [k, label] of [['flightCost', 'Flight cost'], ['hotelCost', 'Hotel cost'], ['perDiem', 'Per-diem'], ['otherCosts', 'Other costs']] as const) {
    const n = amountOf(pick(k), label)
    if (typeof n === 'string') return n
    out[k] = n
  }
  const status = (pick('status') ?? 'planned') as TripStatus
  if (!TRIP_STATUSES.includes(status)) return `Status must be one of: ${TRIP_STATUSES.join(', ')}.`
  out.status = status
  const visaRequired = pick('visaRequired') === true
  let visaStatus = (pick('visaStatus') ?? (visaRequired ? 'applied' : 'not_needed')) as VisaStatus
  if (!VISA_STATUSES.includes(visaStatus)) return `Visa status must be one of: ${VISA_STATUSES.join(', ')}.`
  if (!visaRequired) visaStatus = 'not_needed'
  else if (visaStatus === 'not_needed') visaStatus = 'applied'
  out.visaRequired = visaRequired
  out.visaStatus = visaStatus
  if (v.visaNumber !== undefined) {
    const l4 = last4Of(v.visaNumber)
    if (l4 instanceof Error) return l4.message
    out.visaNumberLast4 = l4
  } else out.visaNumberLast4 = base.visaNumberLast4 ?? ''
  if (!visaRequired) {
    out.visaExpiry = null
    out.visaNumberLast4 = ''
  }
  return out as TripFields
}

function cleanShipment(companyId: string, input: Partial<ShipmentInput> | null, existing?: ShipmentRecord): Omit<ShipmentRecord, 'id' | 'eventId' | 'createdBy' | 'createdAt' | 'updatedAt'> | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<ShipmentInput>
  const items = str(v.items)
  if (items.length < 2 || items.length > 500) return 'Describe what’s shipped (2–500 characters).'
  let vendorId: string | null = null
  let vendorName = str(v.vendorName)
  const wanted = str(v.vendorId)
  if (wanted) {
    const vendor = eventVendors.find((x) => x.id === wanted && x.companyId === companyId)
    if (!vendor) return 'That vendor doesn’t exist.'
    vendorId = vendor.id
    vendorName = vendor.name
  }
  if (vendorName.length > 160) return 'Keep the vendor under 160 characters.'
  const trackingNumber = str(v.trackingNumber)
  if (trackingNumber.length > 80) return 'Keep the tracking number under 80 characters.'
  const shipDate = dateOf(v.shipDate, 'Ship date')
  if (shipDate instanceof Error) return shipDate.message
  const arrivalDate = dateOf(v.arrivalDate, 'Arrival date')
  if (arrivalDate instanceof Error) return arrivalDate.message
  if (shipDate && arrivalDate && arrivalDate < shipDate) return 'The arrival can’t be before the ship date.'
  const status = (str(v.status) || 'preparing') as ShipmentStatus
  if (!SHIPMENT_STATUSES.includes(status)) return `Status must be one of: ${SHIPMENT_STATUSES.join(', ')}.`
  const cost = amountOf(v.cost, 'Cost')
  if (typeof cost === 'string') return cost
  const notes = str(v.notes)
  if (notes.length > 2000) return 'Keep the notes under 2,000 characters.'
  return { vendorId, vendorName, trackingNumber, items, shipDate, arrivalDate, status, cost, notes }
}

/** Keeps the event's logistics budget lines (and a linked campaign's cost entries) in step. */
function syncCosts(e: Tenant<EventRecord>): void {
  if (syncLogisticsLines(e)) syncCampaignCosts(e)
}

/* ---------------- Trips ---------------- */

async function tripFor(user: User, e: Tenant<EventRecord>, tripId: string): Promise<Tenant<TripRecord>> {
  const t = findInTenant(eventTrips, user, (x) => x.id === tripId && x.eventId === e.id)
  if (!t) return fail(TRIP_NOT_FOUND, 404)
  return t
}

function assertOneTripPerPerson(e: Tenant<EventRecord>, userId: string, exceptId?: string): void {
  if (eventTrips.some((t) => t.companyId === e.companyId && t.eventId === e.id && t.userId === userId && t.id !== exceptId)) {
    throw new CodedApiError(`${ownerName(userId)} already has a trip for ${e.name}: edit that one.`, 409, 'trip_exists')
  }
}

/** POST /events/:id/trips */
export async function createTrip(user: User, id: string, input: Partial<TripInput> | null): Promise<Trip> {
  const e = await eventFor(user, id, 'edit')
  const clean = cleanTrip(e.companyId, input)
  if (typeof clean === 'string') return fail(clean, 422)
  assertOneTripPerPerson(e, clean.userId)
  const now = nowIso()
  const t: Tenant<TripRecord> = { companyId: e.companyId, id: nextId('ETR'), eventId: e.id, ...clean, createdBy: user.id, createdAt: now, updatedAt: now }
  eventTrips.push(t)
  syncCosts(e)
  log(e, user, `Added a trip for ${ownerName(t.userId)}`)
  return delay(tripView(t, e, user))
}

/** PATCH /events/:id/trips/:tripId */
export async function updateTrip(user: User, id: string, tripId: string, input: Partial<TripInput> | null): Promise<Trip> {
  const e = await eventFor(user, id, 'edit')
  const t = await tripFor(user, e, tripId)
  const clean = cleanTrip(e.companyId, input, t)
  if (typeof clean === 'string') return fail(clean, 422)
  if (clean.userId !== t.userId) assertOneTripPerPerson(e, clean.userId, t.id)
  Object.assign(t, clean, { updatedAt: nowIso() })
  syncCosts(e)
  return delay(tripView(t, e, user))
}

/** DELETE /events/:id/trips/:tripId — its budget line goes too. */
export async function deleteTrip(user: User, id: string, tripId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const t = await tripFor(user, e, tripId)
  eventTrips.splice(eventTrips.indexOf(t), 1)
  syncCosts(e)
  log(e, user, `Removed the trip of ${ownerName(t.userId)}`)
  return delay({ removed: true as const })
}

/* ---------------- Shipments ---------------- */

async function shipmentFor(user: User, e: Tenant<EventRecord>, shipmentId: string): Promise<Tenant<ShipmentRecord>> {
  const s = findInTenant(eventShipments, user, (x) => x.id === shipmentId && x.eventId === e.id)
  if (!s) return fail(SHIPMENT_NOT_FOUND, 404)
  return s
}

/** POST /events/:id/shipments */
export async function createShipment(user: User, id: string, input: Partial<ShipmentInput> | null): Promise<Shipment> {
  const e = await eventFor(user, id, 'edit')
  const clean = cleanShipment(e.companyId, input)
  if (typeof clean === 'string') return fail(clean, 422)
  const now = nowIso()
  const s: Tenant<ShipmentRecord> = { companyId: e.companyId, id: nextId('ESH'), eventId: e.id, ...clean, createdBy: user.id, createdAt: now, updatedAt: now }
  eventShipments.push(s)
  syncCosts(e)
  log(e, user, `Added a shipment (${s.items.slice(0, 60)})`)
  return delay(shipmentView(s, e, user))
}

/** PATCH /events/:id/shipments/:shipmentId */
export async function updateShipment(user: User, id: string, shipmentId: string, input: Partial<ShipmentInput> | null): Promise<Shipment> {
  const e = await eventFor(user, id, 'edit')
  const s = await shipmentFor(user, e, shipmentId)
  const clean = cleanShipment(e.companyId, input, s)
  if (typeof clean === 'string') return fail(clean, 422)
  Object.assign(s, clean, { updatedAt: nowIso() })
  syncCosts(e)
  return delay(shipmentView(s, e, user))
}

/** DELETE /events/:id/shipments/:shipmentId */
export async function deleteShipment(user: User, id: string, shipmentId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const s = await shipmentFor(user, e, shipmentId)
  eventShipments.splice(eventShipments.indexOf(s), 1)
  syncCosts(e)
  log(e, user, 'Removed a shipment')
  return delay({ removed: true as const })
}

/* ---------------- Deadlines ---------------- */

async function deadlineFor(user: User, e: Tenant<EventRecord>, deadlineId: string): Promise<Tenant<DeadlineRecord>> {
  const d = findInTenant(eventDeadlines, user, (x) => x.id === deadlineId && x.eventId === e.id)
  if (!d) return fail(DEADLINE_NOT_FOUND, 404)
  return d
}

function cleanDeadline(e: Tenant<EventRecord>, input: Partial<DeadlineInput> | null, existing?: DeadlineRecord): Pick<DeadlineRecord, 'title' | 'dueDate' | 'ownerId' | 'done' | 'notes'> | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<DeadlineInput>
  const title = str(v.title)
  if (title.length < 2 || title.length > 160) return 'Name the deadline (2–160 characters).'
  const dueDate = str(v.dueDate)
  if (!isRealIsoDate(dueDate)) return 'Due date must be a date (yyyy-MM-dd).'
  let ownerId: string | null = existing ? existing.ownerId : e.ownerId
  if (input?.ownerId !== undefined) {
    const owner = memberOf(e.companyId, input.ownerId, 'the owner')
    if (owner instanceof Error) return owner.message
    ownerId = owner?.id ?? null
  }
  const notes = str(v.notes)
  if (notes.length > 2000) return 'Keep the notes under 2,000 characters.'
  return { title, dueDate, ownerId, done: v.done === true, notes }
}

/** POST /events/:id/deadlines */
export async function createDeadline(user: User, id: string, input: Partial<DeadlineInput> | null): Promise<LogisticsDeadline> {
  const e = await eventFor(user, id, 'edit')
  const clean = cleanDeadline(e, input)
  if (typeof clean === 'string') return fail(clean, 422)
  const now = nowIso()
  const d: Tenant<DeadlineRecord> = { companyId: e.companyId, id: nextId('EDL'), eventId: e.id, ...clean, doneAt: clean.done ? now : null, reminderSentAt: null, createdBy: user.id, createdAt: now, updatedAt: now }
  eventDeadlines.push(d)
  log(e, user, `Added the deadline ${d.title}`)
  return delay(deadlineView(d, e, user, companyDayOf(e.companyId).today))
}

/** PATCH /events/:id/deadlines/:deadlineId — a new due date re-arms the reminder. */
export async function updateDeadline(user: User, id: string, deadlineId: string, input: Partial<DeadlineInput> | null): Promise<LogisticsDeadline> {
  const e = await eventFor(user, id, 'edit')
  const d = await deadlineFor(user, e, deadlineId)
  const clean = cleanDeadline(e, input, d)
  if (typeof clean === 'string') return fail(clean, 422)
  const now = nowIso()
  if (clean.dueDate !== d.dueDate) d.reminderSentAt = null
  if (clean.done && !d.done) d.doneAt = now
  if (!clean.done) d.doneAt = null
  Object.assign(d, clean, { updatedAt: now })
  return delay(deadlineView(d, e, user, companyDayOf(e.companyId).today))
}

/** DELETE /events/:id/deadlines/:deadlineId */
export async function deleteDeadline(user: User, id: string, deadlineId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const d = await deadlineFor(user, e, deadlineId)
  eventDeadlines.splice(eventDeadlines.indexOf(d), 1)
  log(e, user, `Removed the deadline ${d.title}`)
  return delay({ removed: true as const })
}

/* ---------------- Reminders ---------------- */

export interface LogisticsTick {
  reminders: number
}

/**
 * Open deadlines due within DEADLINE_REMINDER_DAYS (0 ≤ days left ≤ 3, company calendar at `at`) → one
 * stored notification to the owner (else the event owner), once per deadline (reminder_sent_at; re-armed
 * when the due date changes). Deadlines of cancelled events never remind.
 */
export function runLogisticsReminders(companyId: string, at: Date = clockNow()): LogisticsTick {
  const today = companyDayOf(companyId, at).today
  const out: LogisticsTick = { reminders: 0 }
  for (const d of eventDeadlines) {
    if (d.companyId !== companyId || d.done || d.reminderSentAt) continue
    const left = daysBetweenIso(today, d.dueDate)
    if (left < 0 || left > DEADLINE_REMINDER_DAYS) continue
    const e = events.find((x) => x.companyId === companyId && x.id === d.eventId)
    const stamp = at.toISOString()
    d.reminderSentAt = stamp
    if (!e || e.status === 'cancelled') continue
    const to = users.find((u) => u.id === (d.ownerId ?? e.ownerId) && u.companyId === companyId && u.active !== false)
    if (!to) continue
    pushNotification({
      companyId,
      userId: to.id,
      type: 'marketing-due',
      title: `${d.title} · ${e.name}`,
      body: left === 0 ? 'Event deadline today' : left === 1 ? 'Event deadline tomorrow' : `Event deadline in ${left} days`,
      link: `/events/${encodeURIComponent(e.id)}?tab=logistics`,
      at: stamp,
    })
    out.reminders++
  }
  return out
}

onLifecycleTick('events.logistics', (companyId, until) => runLogisticsReminders(companyId, new Date(until)))
