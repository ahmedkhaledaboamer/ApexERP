import type { ShipmentStatus, TripStatus, VisaStatus } from '@/modules/events/logisticsTypes'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { eventBudgetLines, events, type BudgetLineRecord, type EventRecord } from '@/shared/mocks/data/events'
import { registerArray } from '@/shared/mocks/persist/registry'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Travel & logistics stores (docs/API.md › Events › Travel & logistics; DB-ALIGNMENT › Design gaps › Events):
 * event_trips (one per person per trip), event_shipments, event_deadlines, and event_logistics_lines — the
 * budget line each trip / shipment keeps in step (idempotent, like event_cost_links). Every row carries its
 * company and event. Visa document numbers are never stored in full: only the last 4 characters.
 */

export interface TripRecord {
  id: string
  eventId: string
  userId: string
  flightFrom: string
  flightTo: string
  departDate: string | null
  returnDate: string | null
  airline: string
  bookingRef: string
  flightCost: number
  hotelName: string
  checkIn: string | null
  checkOut: string | null
  hotelCost: number
  visaRequired: boolean
  visaStatus: VisaStatus
  visaExpiry: string | null
  /** The last 4 characters of the visa / document number ('' = none). The full number is never kept. */
  visaNumberLast4: string
  perDiem: number
  otherCosts: number
  status: TripStatus
  notes: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ShipmentRecord {
  id: string
  eventId: string
  vendorId: string | null
  vendorName: string
  trackingNumber: string
  items: string
  shipDate: string | null
  arrivalDate: string | null
  status: ShipmentStatus
  cost: number
  notes: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface DeadlineRecord {
  id: string
  eventId: string
  title: string
  dueDate: string
  ownerId: string | null
  done: boolean
  doneAt: string | null
  notes: string
  /** The reminder before the due date was sent (once only; cleared when the due date changes). */
  reminderSentAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** A budget line kept in step by a trip (category travel) or a shipment (category logistics). */
export interface LogisticsLineRecord {
  eventId: string
  lineId: string
  kind: 'trip' | 'shipment'
  sourceId: string
}

export const eventTrips = registerArray<Tenant<TripRecord>>('eventTrips', [])
export const eventShipments = registerArray<Tenant<ShipmentRecord>>('eventShipments', [])
export const eventDeadlines = registerArray<Tenant<DeadlineRecord>>('eventDeadlines', [])
export const eventLogisticsLines = registerArray<Tenant<LogisticsLineRecord>>('eventLogisticsLines', [])

const round2 = (n: number) => Math.round(n * 100) / 100
export const tripTotal = (t: Pick<TripRecord, 'flightCost' | 'hotelCost' | 'perDiem' | 'otherCosts'>) => round2(t.flightCost + t.hotelCost + t.perDiem + t.otherCosts)
export const maskLast4 = (last4: string) => (last4 ? `•••• ${last4}` : null)

/** The trip / shipment a budget line belongs to (such lines are edited from Travel & logistics only). */
export function logisticsSourceOf(companyId: string, lineId: string): { kind: 'trip' | 'shipment'; id: string } | null {
  const k = eventLogisticsLines.find((x) => x.companyId === companyId && x.lineId === lineId)
  return k ? { kind: k.kind, id: k.sourceId } : null
}

const userName = (companyId: string, id: string | null) => users.find((u) => u.id === id && u.companyId === companyId)?.name ?? 'Unknown'
let lseq = 0
const nextLineId = () => `EBL-L${Date.now().toString(36)}${(++lseq).toString(36)}`

/**
 * Keeps the budget lines of the event's trips and shipments in step (idempotent): one line per trip
 * (travel) / shipment (logistics) with planned = actual = its cost; a cost of 0 or a deleted source removes
 * the line. Returns true when something changed (the caller re-syncs the linked campaign's costs).
 */
export function syncLogisticsLines(e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>): boolean {
  const co = e.companyId
  let changed = false
  const sources: { kind: 'trip' | 'shipment'; id: string; cost: number; note: string; category: BudgetLineRecord['category']; vendorId: string | null }[] = [
    ...eventTrips
      .filter((t) => t.companyId === co && t.eventId === e.id)
      .map((t) => ({ kind: 'trip' as const, id: t.id, cost: tripTotal(t), category: 'travel' as const, vendorId: null, note: `Trip · ${userName(co, t.userId)}${t.flightFrom || t.flightTo ? ` (${t.flightFrom || '?'} → ${t.flightTo || '?'})` : ''}` })),
    ...eventShipments
      .filter((s) => s.companyId === co && s.eventId === e.id)
      .map((s) => ({ kind: 'shipment' as const, id: s.id, cost: s.cost, category: 'logistics' as const, vendorId: s.vendorId, note: `Shipment · ${s.items}${s.vendorName ? ` (${s.vendorName})` : ''}` })),
  ]
  // Links whose source is gone or costs nothing: drop the line and the link.
  for (let i = eventLogisticsLines.length - 1; i >= 0; i--) {
    const k = eventLogisticsLines[i]
    if (k.companyId !== co || k.eventId !== e.id) continue
    const src = sources.find((s) => s.kind === k.kind && s.id === k.sourceId)
    const line = eventBudgetLines.find((l) => l.companyId === co && l.id === k.lineId)
    if (src && src.cost > 0 && line) continue
    if (line) eventBudgetLines.splice(eventBudgetLines.indexOf(line), 1)
    eventLogisticsLines.splice(i, 1)
    changed = true
  }
  const now = new Date().toISOString()
  for (const s of sources) {
    if (s.cost <= 0) continue
    const note = s.note.slice(0, 255)
    const link = eventLogisticsLines.find((k) => k.companyId === co && k.kind === s.kind && k.sourceId === s.id)
    const line = link ? eventBudgetLines.find((l) => l.companyId === co && l.id === link.lineId) : undefined
    if (line) {
      if (line.actual !== s.cost || line.planned !== s.cost || line.note !== note || line.category !== s.category || (line.vendorId ?? null) !== s.vendorId) {
        Object.assign(line, { actual: s.cost, planned: s.cost, note, category: s.category, vendorId: s.vendorId, updatedAt: now })
        changed = true
      }
      continue
    }
    const lineId = nextLineId()
    eventBudgetLines.push({ companyId: co, id: lineId, eventId: e.id, category: s.category, note, planned: s.cost, actual: s.cost, vendorId: s.vendorId, createdAt: now, updatedAt: now })
    eventLogisticsLines.push({ companyId: co, eventId: e.id, lineId, kind: s.kind, sourceId: s.id })
    changed = true
  }
  return changed
}

/* ---------------- Seed ---------------- */


type SeedTrip = Partial<TripRecord> & { userId: string }

function seedLogistics(eventId: string, trips: SeedTrip[], shipments: Partial<ShipmentRecord>[], deadlines: [title: string, inDays: number, done: boolean][]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e || eventTrips.some((t) => t.eventId === eventId)) return
  const co = e.companyId
  const tz = companyById(co)?.regional.timezone ?? 'Asia/Dubai'
  const today = todayIsoIn(tz)
  const seedAt = new Date().toISOString()
  trips.forEach((t, i) => {
    eventTrips.push({
      companyId: co, id: `ETR-${eventId.slice(3)}-${i + 1}`, eventId,
      flightFrom: '', flightTo: '', departDate: null, returnDate: null, airline: '', bookingRef: '', flightCost: 0,
      hotelName: '', checkIn: null, checkOut: null, hotelCost: 0,
      visaRequired: false, visaStatus: 'not_needed', visaExpiry: null, visaNumberLast4: '',
      perDiem: 0, otherCosts: 0, status: 'planned', notes: '',
      createdBy: e.ownerId, createdAt: e.createdAt, updatedAt: e.createdAt,
      ...t,
    })
  })
  shipments.forEach((s, i) => {
    eventShipments.push({
      companyId: co, id: `ESH-${eventId.slice(3)}-${i + 1}`, eventId,
      vendorId: null, vendorName: '', trackingNumber: '', items: 'Booth materials', shipDate: null, arrivalDate: null, status: 'preparing', cost: 0, notes: '',
      createdBy: e.ownerId, createdAt: e.createdAt, updatedAt: e.createdAt,
      ...s,
    })
  })
  deadlines.forEach(([title, inDays, done], i) => {
    const dueDate = addDaysIso(today, inDays)
    eventDeadlines.push({
      companyId: co, id: `EDL-${eventId.slice(3)}-${i + 1}`, eventId, title, dueDate, ownerId: e.ownerId, done, doneAt: done ? seedAt : null, notes: '',
      // Seeded deadlines already inside the reminder window count as reminded (no burst on the first visit).
      reminderSentAt: !done && inDays <= 3 ? seedAt : null,
      createdBy: e.ownerId, createdAt: e.createdAt, updatedAt: e.createdAt,
    })
  })
  syncLogisticsLines(e)
}


{
  const tz = companyById(APEX_ID)?.regional.timezone ?? 'Asia/Dubai'
  const d = (n: number) => addDaysIso(todayIsoIn(tz), n)
  seedLogistics(
    'EV-1101',
    [
      { userId: 'u7', flightFrom: 'DXB', flightTo: 'LAS', departDate: d(45), returnDate: d(52), airline: 'Emirates', bookingRef: 'EK7Q2M', flightCost: 9800, hotelName: 'Westgate Las Vegas', checkIn: d(45), checkOut: d(52), hotelCost: 6300, visaRequired: true, visaStatus: 'approved', visaExpiry: d(400), visaNumberLast4: '4821', perDiem: 2100, status: 'booked' },
      { userId: 'u4', flightFrom: 'DXB', flightTo: 'LAS', departDate: d(45), returnDate: d(51), airline: 'Emirates', bookingRef: 'EK7Q2N', flightCost: 9800, hotelName: 'Westgate Las Vegas', checkIn: d(45), checkOut: d(51), hotelCost: 5400, visaRequired: true, visaStatus: 'applied', perDiem: 1800, status: 'planned', notes: 'Visa interview booked.' },
      { userId: 'u5', flightFrom: 'DXB', flightTo: 'LAS', departDate: d(46), returnDate: d(51), airline: 'Emirates', bookingRef: 'EK7R1P', flightCost: 8900, hotelName: 'Westgate Las Vegas', checkIn: d(46), checkOut: d(51), hotelCost: 4500, visaRequired: true, visaStatus: 'approved', visaExpiry: d(700), visaNumberLast4: '0937', perDiem: 1500, otherCosts: 350, status: 'booked' },
    ],
    [{ vendorName: 'DHL Global Forwarding', trackingNumber: 'DHL-1Z88410', items: 'Booth graphics, 2 demo kiosks, brochures', shipDate: d(20), arrivalDate: d(40), status: 'preparing', cost: 12400 }],
    [
      ['Exhibitor manual forms', 5, false],
      ['Badge registration', 12, false],
      ['Power & internet order', 20, false],
      ['Freight at the advance warehouse', 38, false],
      ['Stand design approval', -3, true],
    ],
  )
}

{
  const d = (n: number) => addDaysIso(todayIsoIn(companyById(CREST_ID)?.regional.timezone ?? 'Asia/Riyadh'), n)
  seedLogistics(
    'EV-5002',
    [
      { userId: 'u103', flightFrom: 'JED', flightTo: 'RUH', departDate: d(11), returnDate: d(14), airline: 'Saudia', bookingRef: 'SV4KD2', flightCost: 1450, hotelName: 'Hilton Riyadh Hotel & Residences', checkIn: d(11), checkOut: d(14), hotelCost: 2400, perDiem: 600, status: 'booked' },
      { userId: 'u104', flightFrom: 'JED', flightTo: 'RUH', departDate: d(11), returnDate: d(13), airline: 'flynas', bookingRef: 'XY81LQ', flightCost: 980, hotelName: 'Hilton Riyadh Hotel & Residences', checkIn: d(11), checkOut: d(13), hotelCost: 1600, perDiem: 400, status: 'planned' },
    ],
    [{ vendorName: 'SMSA Express', trackingNumber: 'SMSA-290377114', items: 'Roll-ups and panel brochures', shipDate: d(6), arrivalDate: d(9), status: 'preparing', cost: 850 }],
    [
      ['Speaker bio and panel slides', 4, false],
      ['Badge registration for the team', 7, false],
      ['Hotel rooming list', -1, true],
    ],
  )
}
