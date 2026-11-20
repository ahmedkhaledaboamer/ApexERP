import type { User } from '@/shared/types'
import { can, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { eventAttendees, eventBudgetLines, events, eventTeam, type EventRecord } from '@/shared/mocks/data/events'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { planAt } from '@/shared/mocks/data/plans'
import { effectiveModules } from '@/shared/mocks/data/platform'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyById } from '@/shared/mocks/data/tenancy'
import { zonedParts } from '@/shared/lib/zonedTime'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Event access rules, shared by the events API, task links and targets ("Events attended").
 *
 * There is no Events column in PERMISSION_MATRIX: events follow the MARKETING column, plus
 * membership. Decision (docs/API.md › Events › Permissions):
 *   - marketing `full`  → every event of the company; create, edit, cancel, manage teams.
 *   - marketing `view`  → every event, read-only — except events they are on (owner or team): edit.
 *   - marketing `team` / `own` (not used by the matrix today) → events they are on, plus (team) events
 *     owned by their team; may create events.
 *   - marketing `hidden` → only events they are on (owner or team member), with edit rights.
 * Cancel (DELETE) and team changes: marketing `full` or the event's owner.
 */

/** Does the company's plan (version ± platform overrides) include the Events module? */
export function eventsEnabledIn(companyId: string): boolean {
  const sub = subscriptionOf(companyId)
  if (!sub) return false
  return effectiveModules(companyId, planAt(sub.planId, sub.planVersion).modules).includes('events')
}

/** Team member ids of an event, owner first. */
export function teamIdsOf(e: Pick<Tenant<EventRecord>, 'id' | 'companyId' | 'ownerId'>): string[] {
  const ids = eventTeam.filter((t) => t.eventId === e.id && t.companyId === e.companyId).map((t) => t.userId)
  return e.ownerId ? [e.ownerId, ...ids.filter((id) => id !== e.ownerId)] : ids
}

export function isOnTeam(user: Pick<User, 'id'>, e: Tenant<EventRecord>): boolean {
  return e.ownerId === user.id || eventTeam.some((t) => t.eventId === e.id && t.companyId === e.companyId && t.userId === user.id)
}

function myTeam(user: User): string[] {
  return teamIdsFor(
    user,
    users.filter((u) => u.companyId === user.companyId),
    departments.filter((d) => d.companyId === user.companyId),
  )
}

export function canSeeEvent(user: User, e: Tenant<EventRecord>): boolean {
  if (e.companyId !== user.companyId) return false
  const scope = scopeOf(user.role, 'marketing')
  if (scope === 'full' || scope === 'view') return true
  if (isOnTeam(user, e)) return true
  return scope === 'team' && !!e.ownerId && myTeam(user).includes(e.ownerId)
}

export function canEditEvent(user: User, e: Tenant<EventRecord>): boolean {
  if (e.companyId !== user.companyId) return false
  const scope = scopeOf(user.role, 'marketing')
  if (scope === 'full') return true
  if (isOnTeam(user, e)) return true
  return scope === 'team' && !!e.ownerId && myTeam(user).includes(e.ownerId)
}

export function canManageEvent(user: User, e: Tenant<EventRecord>): boolean {
  return e.companyId === user.companyId && (scopeOf(user.role, 'marketing') === 'full' || e.ownerId === user.id)
}

export function canCreateEvents(user: User): boolean {
  return can(user.role, 'marketing', 'create')
}

/** Events the user may see (own company only). */
export function eventsVisibleTo(user: User): Tenant<EventRecord>[] {
  return events.filter((e) => e.companyId === user.companyId && canSeeEvent(user, e))
}

/** The event's start date in the company's timezone (yyyy-MM-dd). */
export function eventLocalDate(e: Pick<Tenant<EventRecord>, 'startsAt' | 'companyId'>): string {
  return zonedParts(e.startsAt, companyById(e.companyId)?.regional.timezone ?? 'Asia/Dubai').date
}

/**
 * "Events attended" (targets): an event counts for each of its team members (owner included) in the
 * month of its start date (company time) once it took place: status `completed`, or not cancelled,
 * already started (company today) and at least one attendee checked in.
 */
export function attendedEvent(e: Tenant<EventRecord>): boolean {
  if (e.status === 'cancelled') return false
  if (e.status === 'completed') return true
  const started = eventLocalDate(e) <= companyDayOf(e.companyId).today
  return started && eventAttendees.some((a) => a.eventId === e.id && a.companyId === e.companyId && a.checkedInAt)
}

/** Events attended by `userId` in the month `yyyy-MM` (0 when the plan has no Events module). */
export function eventsAttendedBy(companyId: string, userId: string, month: string): number {
  if (!eventsEnabledIn(companyId)) return 0
  return events.filter(
    (e) => e.companyId === companyId && eventLocalDate(e).slice(0, 7) === month && attendedEvent(e) && teamIdsOf(e).includes(userId),
  ).length
}

/**
 * The event's actual cost: the sum of its budget lines' actual amounts when it has lines, else the
 * event's own `actual_cost` (null = unknown). Used by the event stats (ROI) and Marketing Analytics.
 */
export function eventActualCost(e: Pick<Tenant<EventRecord>, 'id' | 'companyId' | 'actualCost'>): number | null {
  const lines = eventBudgetLines.filter((l) => l.eventId === e.id && l.companyId === e.companyId)
  if (lines.length) return Math.round(lines.reduce((s, l) => s + l.actual, 0) * 100) / 100
  return e.actualCost
}