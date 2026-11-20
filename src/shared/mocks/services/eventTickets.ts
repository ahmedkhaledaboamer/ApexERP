import type { User } from '@/shared/types'
import type { TicketType, TicketTypeInput } from '@/modules/events/types'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { eventTicketTypes, type EventRecord, type TicketTypeRecord } from '@/shared/mocks/data/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, type Tenant } from '@/shared/mocks/tenant'
import { attendeesOf, currencyOf, eventFor, log, onSale, promoteWaitlist, remainingFor, ticketTypesOf } from '@/shared/mocks/services/events'

/**
 * Ticket types (docs/API.md › Events › Tickets, capacity & waitlist). Each event may have ticket types
 * (name, capacity or unlimited, price in the company currency or free — the mock takes no payment —,
 * sales window). Registration picks one; a full ticket type (or a full event) puts people on the
 * waitlist. Raising a capacity promotes waitlisted people. Edit right on the event (team + marketing full).
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
let seq = 0
const nextId = () => `ETK-${nowMs().toString(36)}${(++seq).toString(36)}`

export function ticketView(e: Tenant<EventRecord>, t: Tenant<TicketTypeRecord>): TicketType {
  const atts = attendeesOf(e).filter((a) => a.ticketTypeId === t.id)
  return {
    id: t.id,
    name: t.name,
    capacity: t.capacity,
    price: t.price,
    currency: currencyOf(e.companyId),
    salesOpen: t.salesOpen,
    salesClose: t.salesClose,
    registered: atts.filter((a) => a.status === 'registered').length,
    waitlisted: atts.filter((a) => a.status === 'waitlisted').length,
    checkedIn: atts.filter((a) => a.status === 'registered' && a.checkedInAt).length,
    remaining: remainingFor(e, t),
    onSale: onSale(t, e.companyId),
  }
}

function cleanTicket(input: Partial<TicketTypeInput> | null, existing?: TicketTypeRecord): Omit<TicketTypeRecord, 'id' | 'eventId' | 'sortOrder' | 'createdAt'> | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<TicketTypeInput>
  const name = str(v.name)
  if (name.length < 2 || name.length > 120) return 'Give the ticket a name (2–120 characters).'
  let capacity: number | null = null
  if (v.capacity !== null && v.capacity !== undefined && (v.capacity as unknown) !== '') {
    const n = Number(v.capacity)
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return 'Capacity is a whole number of seats (1 or more), or empty for unlimited.'
    capacity = n
  }
  const price = v.price === undefined || v.price === null || (v.price as unknown) === '' ? 0 : Number(v.price)
  if (!Number.isFinite(price) || price < 0 || price > 1e9) return 'Price must be 0 (free) or a positive amount.'
  const salesOpen = v.salesOpen || null
  const salesClose = v.salesClose || null
  if ((salesOpen && !isRealIsoDate(salesOpen)) || (salesClose && !isRealIsoDate(salesClose))) return 'Sales dates use yyyy-MM-dd.'
  if (salesOpen && salesClose && salesClose < salesOpen) return 'Sales can’t close before they open.'
  return { name, capacity, price: Math.round(price * 100) / 100, salesOpen, salesClose }
}

export async function listTicketTypes(user: User, id: string): Promise<TicketType[]> {
  const e = await eventFor(user, id)
  return delay(ticketTypesOf(e).map((t) => ticketView(e, t)))
}

export async function createTicketType(user: User, id: string, input: Partial<TicketTypeInput> | null): Promise<TicketType> {
  const e = await eventFor(user, id, 'edit')
  const clean = cleanTicket(input)
  if (typeof clean === 'string') return fail(clean, 422)
  const types = ticketTypesOf(e)
  if (types.some((t) => t.name.toLowerCase() === clean.name.toLowerCase())) return fail(`There’s already a “${clean.name}” ticket.`, 409)
  if (types.length >= 20) return fail('An event can have up to 20 ticket types.', 422)
  const row: Tenant<TicketTypeRecord> = { companyId: e.companyId, id: nextId(), eventId: e.id, ...clean, sortOrder: types.length + 1, createdAt: nowIso() }
  eventTicketTypes.push(row)
  log(e, user, `Added the “${clean.name}” ticket`)
  return delay(ticketView(e, row))
}

async function ticketFor(user: User, e: Tenant<EventRecord>, ticketTypeId: string): Promise<Tenant<TicketTypeRecord>> {
  const t = findInTenant(eventTicketTypes, user, (x) => x.id === ticketTypeId && x.eventId === e.id)
  if (!t) return fail('That ticket type doesn’t exist.', 404)
  return t
}

/** PATCH: a capacity below the seats already taken is refused (cancel registrations first). Raising it promotes the waitlist. */
export async function updateTicketType(user: User, id: string, ticketTypeId: string, input: Partial<TicketTypeInput> | null): Promise<TicketType> {
  const e = await eventFor(user, id, 'edit')
  const t = await ticketFor(user, e, ticketTypeId)
  const clean = cleanTicket(input, t)
  if (typeof clean === 'string') return fail(clean, 422)
  if (ticketTypesOf(e).some((x) => x.id !== t.id && x.name.toLowerCase() === clean.name.toLowerCase())) return fail(`There’s already a “${clean.name}” ticket.`, 409)
  const taken = attendeesOf(e).filter((a) => a.ticketTypeId === t.id && a.status === 'registered').length
  if (clean.capacity !== null && clean.capacity < taken) return fail(`${taken} people already hold this ticket: the capacity can’t go below that.`, 422)
  Object.assign(t, clean)
  promoteWaitlist(e, user)
  return delay(ticketView(e, t))
}

/** DELETE: only a ticket type nobody holds (registered or waitlisted). */
export async function deleteTicketType(user: User, id: string, ticketTypeId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const t = await ticketFor(user, e, ticketTypeId)
  if (attendeesOf(e).some((a) => a.ticketTypeId === t.id && a.status !== 'cancelled')) return fail('People hold this ticket. Cancel their registrations first.', 409)
  eventTicketTypes.splice(eventTicketTypes.indexOf(t), 1)
  log(e, user, `Removed the “${t.name}” ticket`)
  return delay({ removed: true as const })
}
