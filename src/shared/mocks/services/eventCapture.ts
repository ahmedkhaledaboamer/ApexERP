import type { Activity, User } from '@/shared/types'
import type { CaptureInput, CaptureResult, EventCapture, LeaderboardRow, LeadOutcome } from '@/modules/events/types'
import { CAPTURE_RATINGS, CAPTURE_RATING_LABEL } from '@/modules/events/types'
import { scopeOf } from '@/shared/lib/permissions'
import { activities, leads, users } from '@/shared/mocks/db'
import { isWonStatus } from '@/shared/mocks/data/lookups'
import { eventAttendees, type EventRecord } from '@/shared/mocks/data/events'
import { eventCaptures, type EventCaptureRecord } from '@/shared/mocks/data/eventExtras'
import { teamIdsOf } from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { assertOpenForAttendees, attendeesOf, canOwnLeads, cleanAttendee, eventFor, log, register } from '@/shared/mocks/services/events'

/**
 * Booth lead capture + leaderboard (docs/API.md › Events › Booth capture). A team member (or marketing
 * full: the event's edit right) captures a visitor on a phone: the lead is created or linked AT ONCE
 * (source Event, event_id, the plan's lead limit keeps the person without a lead), the visitor becomes
 * an attendee (source `capture`, checked in, no seat check: they're at the stand). Owner of a new lead:
 * the capturer when they can own leads (Sales scope full / team / own), else the event's round-robin.
 * The interest rating (hot / warm / cold) is stored on the capture (leads have no tags column: decision)
 * and written into a `meeting` activity on the lead with the notes.
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+/i
let seq = 0
const nextId = () => `ECP-${nowMs().toString(36)}${(++seq).toString(36)}`

function captureView(c: Tenant<EventCaptureRecord>, viewer: User): EventCapture {
  const a = eventAttendees.find((x) => x.id === c.attendeeId && x.companyId === c.companyId)
  const lead = c.leadId ? leads.find((l) => l.id === c.leadId && l.companyId === c.companyId) : undefined
  const canOpen = !!lead && scopeOf(viewer.role, 'sales') !== 'hidden' && visibleLeads(viewer).some((l) => l.id === lead.id)
  return {
    id: c.id,
    attendeeId: c.attendeeId,
    name: a?.name ?? '',
    companyName: a?.companyName ?? '',
    email: a?.email ?? '',
    mobile: a?.mobile ?? '',
    title: a?.title ?? '',
    leadId: c.leadId,
    leadOutcome: (a?.leadOutcome ?? 'none') as LeadOutcome,
    canOpenLead: canOpen,
    rating: c.rating,
    notes: c.notes,
    cardPhotoUrl: c.cardPhotoUrl,
    capturedBy: c.capturedBy,
    capturedByName: ownerName(c.capturedBy),
    capturedAt: c.capturedAt,
  }
}

const capturesOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) => eventCaptures.filter((c) => c.eventId === e.id && c.companyId === e.companyId)

/** POST /events/:id/captures */
export async function createCapture(user: User, id: string, input: Partial<CaptureInput> | null): Promise<CaptureResult> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const v = input ?? {}
  const rating = v.rating as CaptureInput['rating']
  if (!CAPTURE_RATINGS.includes(rating)) return fail('Rate the interest: hot, warm or cold.', 422)
  const notes = str(v.notes)
  if (notes.length > 2000) return fail('Keep the notes under 2,000 characters.', 422)
  const cardPhotoUrl = str(v.cardPhotoUrl)
  if (cardPhotoUrl && !URL_RE.test(cardPhotoUrl)) return fail('Enter the card photo as a full URL (https://…).', 422)
  const a = cleanAttendee(e.companyId, v)
  if (typeof a === 'string') return fail(a, 422)
  const now = nowIso()

  // Already registered here (same email): the capture links that attendee and checks them in.
  let attendee = a.email ? attendeesOf(e).find((x) => x.status !== 'cancelled' && x.email === a.email) : undefined
  let outcome: LeadOutcome
  let limitReached: CaptureResult['limitReached'] = null
  if (attendee) {
    outcome = attendee.leadId ? 'linked' : 'none'
    if (!attendee.checkedInAt && attendee.status === 'registered') {
      attendee.checkedInAt = now
      attendee.checkedInBy = user.id
    }
  } else {
    const r = register(e, a, user, 'capture', `Captured by ${user.name}`, {}, {
      capture: true,
      leadOwner: canOwnLeads(user) ? user : null,
      note: `Captured at the ${e.name} booth by ${user.name}.`,
    })
    attendee = r.attendee
    outcome = r.outcome
    limitReached = r.limitReached
  }
  const row: Tenant<EventCaptureRecord> = {
    companyId: e.companyId,
    id: nextId(),
    eventId: e.id,
    attendeeId: attendee.id,
    leadId: attendee.leadId,
    rating,
    notes,
    cardPhotoUrl,
    capturedBy: user.id,
    capturedAt: now,
  }
  eventCaptures.push(row)
  if (attendee.leadId) {
    const activity: Tenant<Activity> = {
      companyId: e.companyId,
      id: `A-ECP-${row.id}`,
      leadId: attendee.leadId,
      type: 'meeting',
      summary: `Booth capture at ${e.name} by ${user.name}: ${CAPTURE_RATING_LABEL[rating]} lead.${notes ? ` ${notes}` : ''}`,
      userId: user.id,
      at: now,
    }
    activities.push(activity)
  }
  log(e, user, `Captured ${a.name} at the booth (${CAPTURE_RATING_LABEL[rating].toLowerCase()})`)
  const message =
    outcome === 'created'
      ? `${a.name} captured: new ${CAPTURE_RATING_LABEL[rating].toLowerCase()} lead.`
      : outcome === 'linked'
        ? `${a.name} captured and linked to the existing lead.`
        : `${a.name} captured, but no lead was created: your plan’s leads and contacts limit is reached.`
  return delay({ capture: captureView(row, user), outcome, leadId: attendee.leadId, limitReached, message })
}

/** GET /events/:id/captures — newest first. */
export async function listCaptures(user: User, id: string): Promise<EventCapture[]> {
  const e = await eventFor(user, id)
  return delay(capturesOf(e).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).map((c) => captureView(c, user)))
}

export function leaderboardOf(e: Tenant<EventRecord>): LeaderboardRow[] {
  const caps = capturesOf(e)
  const ids = [...new Set([...teamIdsOf(e), ...caps.map((c) => c.capturedBy)])]
  return ids
    .map((uid) => {
      const mine = caps.filter((c) => c.capturedBy === uid)
      const leadIds = [...new Set(mine.map((c) => c.leadId).filter((x): x is string => !!x))]
      const won = leadIds.map((lid) => leads.find((l) => l.id === lid && l.companyId === e.companyId)).filter((l) => !!l && isWonStatus(e.companyId, l.status))
      return {
        userId: uid,
        name: users.find((u) => u.id === uid && u.companyId === e.companyId)?.name ?? ownerName(uid),
        captures: mine.length,
        hotLeads: mine.filter((c) => c.rating === 'hot').length,
        warmLeads: mine.filter((c) => c.rating === 'warm').length,
        dealsWon: won.length,
        wonValue: won.reduce((s, l) => s + (l?.value ?? 0), 0),
      }
    })
    .sort((a, b) => b.captures - a.captures || b.hotLeads - a.hotLeads || b.dealsWon - a.dealsWon || a.name.localeCompare(b.name))
}

/** GET /events/:id/leaderboard — per team member (and anyone who captured). */
export async function getLeaderboard(user: User, id: string): Promise<LeaderboardRow[]> {
  const e = await eventFor(user, id)
  return delay(leaderboardOf(e))
}
