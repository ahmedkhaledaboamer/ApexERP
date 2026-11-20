import type { Scope } from '@/shared/types'
import type { LibraryAccess } from '@/modules/events/libraryTypes'

/**
 * Pure rules of the event libraries (speakers, venues, vendors), shared by the mock API and the UI.
 * docs/API.md › Events › Speakers, venues & vendors.
 */

/**
 * Library access from the MARKETING column plus event-team membership:
 *  - marketing `full` → manage (create, edit, archive / delete, blacklist);
 *  - marketing `view` → read;
 *  - anyone on an event's team (owner or member, any role) → read (and pick from the libraries in their events);
 *  - everyone else → none (the API answers 403; the sidebar hides the sections for roles without marketing view).
 */
export function libraryAccess(marketingScope: Scope, onAnyEventTeam: boolean): LibraryAccess {
  if (marketingScope === 'full') return 'manage'
  if (marketingScope === 'view' || onAnyEventTeam) return 'read'
  return 'none'
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Dedupe rule of the speaker directory (migration and "add new speaker"): the same person when the
 * emails match (case-insensitive), or — when either has no email — the name AND company match
 * (case- and whitespace-insensitive). Two different emails are two people even with the same name.
 */
export function sameSpeaker(a: { email?: string; name: string; company?: string }, b: { email?: string; name: string; company?: string }): boolean {
  const ea = norm(a.email)
  const eb = norm(b.email)
  if (ea && eb) return ea === eb
  return norm(a.name) !== '' && norm(a.name) === norm(b.name) && norm(a.company) === norm(b.company)
}

/**
 * Venue capacity vs event capacity. Decision: WARN, not refuse — a venue's capacity depends on the layout
 * (theatre, standing, banquet) and the event's capacity is a registration cap the team may set on purpose.
 * Returns the warning, or null when there's nothing to say (no venue capacity, or it fits).
 */
export function venueCapacityWarning(eventCapacity: number | null, venueCapacity: number | null, registered = 0): string | null {
  if (venueCapacity === null || venueCapacity <= 0) return null
  if (eventCapacity !== null && eventCapacity > venueCapacity) {
    return `The event’s capacity (${eventCapacity}) is above the venue’s capacity (${venueCapacity}).`
  }
  if (registered > venueCapacity) return `${registered} people are registered; the venue holds ${venueCapacity}.`
  return null
}

/** Average of 1–5 ratings with one decimal; null for none. */
export function averageRating(ratings: readonly number[]): number | null {
  if (!ratings.length) return null
  return Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
}

/** The text an event's location gets when a venue is picked (the free text stays editable as an override). */
export function venueLocation(v: { name: string; city: string }): string {
  return [v.name, v.city].filter((s) => s && s.trim()).join(', ')
}

/** Vendor spend from budget lines: per event (planned / actual, lines) and the totals. */
export function vendorSpend<L extends { eventId: string; planned: number; actual: number }>(lines: readonly L[]): {
  perEvent: Map<string, { lines: number; planned: number; actual: number }>
  totalPlanned: number
  totalActual: number
} {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const perEvent = new Map<string, { lines: number; planned: number; actual: number }>()
  for (const l of lines) {
    const row = perEvent.get(l.eventId) ?? { lines: 0, planned: 0, actual: 0 }
    row.lines += 1
    row.planned = r2(row.planned + l.planned)
    row.actual = r2(row.actual + l.actual)
    perEvent.set(l.eventId, row)
  }
  return {
    perEvent,
    totalPlanned: r2(lines.reduce((s, l) => s + l.planned, 0)),
    totalActual: r2(lines.reduce((s, l) => s + l.actual, 0)),
  }
}
