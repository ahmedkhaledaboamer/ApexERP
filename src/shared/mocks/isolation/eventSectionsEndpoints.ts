import { users } from '@/shared/mocks/db'
import { eventAttendees } from '@/shared/mocks/data/events'
import { eventCaptures } from '@/shared/mocks/data/eventExtras'
import { personKeyOf } from '@/shared/mocks/services/eventSections'
import type { Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of the cross-event Events sections (handlers/eventSections.ts: attendees
 * directory, booth leads, event analytics), spread into ENDPOINTS (endpoints.ts). Samples run as the
 * company admin (marketing full: every event of the company).
 */

function capture(co: Co) {
  const c = eventCaptures.find((x) => x.companyId === co && x.leadId)
  if (!c) throw new Error(`Isolation table: no booth capture with a lead in ${co}`)
  return c
}
function agent(co: Co) {
  const u = users.find((x) => x.companyId === co && x.active && x.role === 'Sales Agent')
  if (!u) throw new Error(`Isolation table: no Sales Agent in ${co}`)
  return u
}
const people = (co: Co) => new Set(eventAttendees.filter((a) => a.companyId === co).map(personKeyOf)).size
const rowsOf = (key: string) => (b: unknown) => {
  const list = b && typeof b === 'object' ? (b as Record<string, unknown>)[key] : null
  return Array.isArray(list) ? list.length : -1
}

export const EVENT_SECTIONS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/events/attendees', kind: 'company-list', module: 'events', sample: () => ({}), count: { of: rowsOf('people'), expected: people } },
  { method: 'GET', path: '/events/attendees/export', kind: 'company-export', module: 'events', sample: () => ({}), count: { of: (b) => (Array.isArray(b) ? b.length : -1), expected: people } },
  {
    method: 'GET', path: '/events/booth-leads', kind: 'company-list', module: 'events', sample: () => ({}),
    count: { of: rowsOf('rows'), expected: (co) => eventCaptures.filter((c) => c.companyId === co).length },
    note: 'Also runs the overdue follow-up notices of the caller’s company only.',
  },
  { method: 'POST', path: '/events/booth-leads/assign', kind: 'company-write', module: 'events', sample: (co) => ({ body: { capture_ids: [capture(co).id], owner_id: agent(co).id } }) },
  { method: 'GET', path: '/events/analytics', kind: 'company-export', module: 'events', sample: () => ({ query: { preset: 'ytd', compare: 'true' } }) },
]
