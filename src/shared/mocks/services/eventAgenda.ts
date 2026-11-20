import type { User } from '@/shared/types'
import type { EventAgenda, EventSession, EventSpeaker, PublicAgendaSession, SessionInput, SpeakerInput } from '@/modules/events/types'
import { HH_MM, isRealIsoDate, zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { addDaysIso } from '@/shared/lib/companyDay'
import type { EventRecord } from '@/shared/mocks/data/events'
import { eventSessions, eventSpeakers, type EventSessionRecord } from '@/shared/mocks/data/eventExtras'
import { speakerDirectory, type SpeakerRecord } from '@/shared/mocks/data/eventLibrary'
import { scopeOf } from '@/shared/lib/permissions'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, type Tenant } from '@/shared/mocks/tenant'
import { eventFor, localOf, log, tzOf } from '@/shared/mocks/services/events'
import { cleanSpeaker, directorySpeaker, findSameSpeaker } from '@/shared/mocks/services/eventLibraryCore'

/**
 * Agenda & speakers (docs/API.md › Events › Agenda). Sessions are entered in the company's timezone
 * and stored as UTC instants. Rules (decision: REFUSE, not warn):
 *  - a session lies inside the event: its date between the event's start and end dates, and, when the
 *    event has times, between the event's start and end instants → 422 `session_outside_event`;
 *  - two sessions in the same room (case-insensitive, non-empty) can't overlap → 409 `session_overlap`
 *    naming the other session; sessions without a room or in different rooms may run in parallel.
 * Reading: anyone who sees the event; writing: anyone who edits it (team + marketing full). The public
 * registration page shows the agenda (no ids).
 * Speakers come from the company's SPEAKER DIRECTORY (services/eventLibrary.ts): the event keeps a roster
 * (event_speakers: event_id → speaker_id) and sessions reference directory ids (speaker_id). Editors pick
 * directory speakers or add a new one (which creates the directory entry); a session naming a directory
 * speaker puts them on the roster. Changing a speaker's profile changes the directory: marketing full only.
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
let seq = 0
const nextId = (prefix: string) => `${prefix}-${nowMs().toString(36)}${(++seq).toString(36)}`

/** The event's roster links (event_speakers → the speaker directory). */
const rosterOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) => eventSpeakers.filter((l) => l.eventId === e.id && l.companyId === e.companyId)
/** The event's speakers: directory entries on its roster. */
const speakersOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) =>
  rosterOf(e)
    .map((l) => directorySpeaker(e.companyId, l.speakerId))
    .filter((x): x is Tenant<SpeakerRecord> => !!x)
const sessionsOf = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) =>
  eventSessions.filter((s) => s.eventId === e.id && s.companyId === e.companyId).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.room.localeCompare(b.room))

function speakerView(s: Tenant<SpeakerRecord>): EventSpeaker {
  return { id: s.id, name: s.name, title: s.title, company: s.company, bio: s.bio, photoUrl: s.photoUrl }
}

/** Puts directory speakers on the event's roster (idempotent). */
function link(e: Tenant<EventRecord>, speakerIds: string[]): void {
  for (const speakerId of speakerIds) {
    if (rosterOf(e).some((l) => l.speakerId === speakerId)) continue
    eventSpeakers.push({ companyId: e.companyId, id: nextId('ESP'), eventId: e.id, speakerId, createdAt: nowIso() })
  }
}

function sessionView(s: Tenant<EventSessionRecord>): EventSession {
  const tz = tzOf(s.companyId)
  const start = zonedParts(s.startsAt, tz)
  const speakers = s.speakerIds
    .map((id) => directorySpeaker(s.companyId, id))
    .filter((x): x is Tenant<SpeakerRecord> => !!x)
    .map((x) => ({ id: x.id, name: x.name, title: x.title, company: x.company, photoUrl: x.photoUrl }))
  return {
    id: s.id,
    title: s.title,
    date: start.date,
    startTime: start.time,
    endTime: zonedParts(s.endsAt, tz).time,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    room: s.room,
    description: s.description,
    speakerIds: s.speakerIds.filter((id) => speakers.some((x) => x.id === id)),
    speakers,
  }
}

export function agendaOf(e: Tenant<EventRecord>, viewer?: User): EventAgenda {
  return {
    sessions: sessionsOf(e).map(sessionView),
    speakers: speakersOf(e).sort((a, b) => a.name.localeCompare(b.name)).map(speakerView),
    timezone: tzOf(e.companyId),
    canEditSpeakers: !!viewer && scopeOf(viewer.role, 'marketing') === 'full',
  }
}

/** The public page's agenda: sessions in time order with their speakers (no ids; no email, mobile, fee or notes). */
export function publicAgendaOf(e: Tenant<EventRecord>): PublicAgendaSession[] {
  return sessionsOf(e).map((s) => {
    const v = sessionView(s)
    const full = s.speakerIds.map((id) => directorySpeaker(e.companyId, id)).filter((x): x is Tenant<SpeakerRecord> => !!x)
    return { title: v.title, date: v.date, startTime: v.startTime, endTime: v.endTime, room: v.room, description: v.description, speakers: full.map(({ name, title, company, bio, photoUrl }) => ({ name, title, company, bio, photoUrl })) }
  })
}

export async function getAgenda(user: User, id: string): Promise<EventAgenda> {
  const e = await eventFor(user, id)
  return delay(agendaOf(e, user))
}

/* ---------------- Speakers (the event's roster, from the company's speaker directory) ---------------- */

/**
 * POST /events/:id/speakers — editors of the event:
 *  - `{ speaker_id }` picks a directory speaker (another company's id answers like a missing one: 422);
 *  - `{ name, title?, company?, bio?, photo_url?, email? }` adds a NEW speaker: it becomes a directory entry
 *    (the same person — same email, or same name + company — is reused, never duplicated).
 */
export async function addSpeaker(user: User, id: string, input: (Partial<SpeakerInput> & { speakerId?: unknown; email?: string }) | null): Promise<EventSpeaker> {
  const e = await eventFor(user, id, 'edit')
  let s: Tenant<SpeakerRecord> | undefined
  if (input?.speakerId !== undefined && input.speakerId !== null && input.speakerId !== '') {
    s = directorySpeaker(e.companyId, input.speakerId)
    if (!s) return fail('That speaker isn’t in the speaker directory.', 422)
  } else {
    const clean = cleanSpeaker(e.companyId, { name: input?.name ?? '', title: input?.title, company: input?.company, bio: input?.bio, photoUrl: input?.photoUrl, email: input?.email })
    if (typeof clean === 'string') return fail(clean, 422)
    s = findSameSpeaker(e.companyId, clean)
    if (!s) {
      const now = nowIso()
      s = { companyId: e.companyId, id: nextId('SPK'), ...clean, ratings: [], createdBy: user.id, createdAt: now, updatedAt: now }
      speakerDirectory.push(s)
    }
  }
  link(e, [s.id])
  log(e, user, `Added speaker ${s.name}`)
  return delay(speakerView(s))
}

async function speakerFor(user: User, e: Tenant<EventRecord>, speakerId: string): Promise<Tenant<SpeakerRecord>> {
  const s = findInTenant(speakerDirectory, user, (x) => x.id === speakerId)
  if (!s || !rosterOf(e).some((l) => l.speakerId === s.id)) return fail('That speaker doesn’t exist.', 404)
  return s
}

/** PATCH /events/:id/speakers/:speakerId — changes the DIRECTORY entry (shared by every event): marketing full only. */
export async function updateSpeaker(user: User, id: string, speakerId: string, input: Partial<SpeakerInput> | null): Promise<EventSpeaker> {
  const e = await eventFor(user, id, 'edit')
  const s = await speakerFor(user, e, speakerId)
  if (scopeOf(user.role, 'marketing') !== 'full') return fail('Speaker profiles live in the company’s speaker directory; only marketing managers can change them.', 403)
  const clean = cleanSpeaker(e.companyId, input, s)
  if (typeof clean === 'string') return fail(clean, 422)
  Object.assign(s, clean, { updatedAt: nowIso() })
  return delay(speakerView(s))
}

/** Removing a speaker takes them off the event's roster and its sessions (the directory entry stays). */
export async function removeSpeaker(user: User, id: string, speakerId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const s = await speakerFor(user, e, speakerId)
  for (const l of rosterOf(e).filter((x) => x.speakerId === s.id)) eventSpeakers.splice(eventSpeakers.indexOf(l), 1)
  for (const ses of sessionsOf(e)) ses.speakerIds = ses.speakerIds.filter((x) => x !== s.id)
  log(e, user, `Removed speaker ${s.name}`)
  return delay({ removed: true as const })
}

/* ---------------- Sessions ---------------- */

interface CleanSession {
  title: string
  startsAt: string
  endsAt: string
  room: string
  description: string
  speakerIds: string[]
}

/** Validates a session against the event (see the rules above). Throws coded errors for the placement rules. */
function cleanSession(e: Tenant<EventRecord>, input: Partial<SessionInput>, exceptId?: string): CleanSession | string {
  const title = str(input.title)
  if (title.length < 2 || title.length > 255) return 'Give the session a title (2–255 characters).'
  if (!isRealIsoDate(input.date)) return 'Set the session date as yyyy-MM-dd.'
  const startTime = str(input.startTime)
  const endTime = str(input.endTime)
  if (!HH_MM.test(startTime) || !HH_MM.test(endTime)) return 'Set the start and end times as HH:mm.'
  if (endTime <= startTime) return 'A session must end after it starts.'
  const room = str(input.room)
  if (room.length > 120) return 'Keep the room / track under 120 characters.'
  const description = str(input.description)
  if (description.length > 2000) return 'Keep the description under 2,000 characters.'
  const ids = Array.isArray(input.speakerIds) ? [...new Set(input.speakerIds.map(String))] : []
  // Any speaker of the company's directory (they join the event's roster); another company's id = missing.
  if (ids.some((sid) => !directorySpeaker(e.companyId, sid))) return 'Pick speakers from the speaker directory.'
  const tz = tzOf(e.companyId)
  const date = input.date as string
  const local = localOf(e)
  const startsAt = zonedToUtc(date, startTime, tz)
  const endsAt = zonedToUtc(date, endTime, tz)
  const eventEnd = e.allDay || !e.endsAt ? zonedToUtc(addDaysIso(local.endDate, 1), null, tz) : e.endsAt
  if (date < local.startDate || date > local.endDate || startsAt < e.startsAt || endsAt > eventEnd) {
    throw new CodedApiError(
      `The session must be inside the event (${local.startDate}${local.startTime ? ` ${local.startTime}` : ''} – ${local.endDate}${local.endTime ? ` ${local.endTime}` : ''}).`,
      422,
      'session_outside_event',
    )
  }
  if (room) {
    const clash = sessionsOf(e).find((s) => s.id !== exceptId && s.room.trim().toLowerCase() === room.toLowerCase() && s.startsAt < endsAt && startsAt < s.endsAt)
    if (clash) {
      const v = sessionView(clash)
      throw new CodedApiError(`${room} is taken by “${clash.title}” (${v.date} ${v.startTime}–${v.endTime}).`, 409, 'session_overlap', { sessionId: clash.id })
    }
  }
  return { title, startsAt, endsAt, room, description, speakerIds: ids }
}

export async function addSession(user: User, id: string, input: Partial<SessionInput> | null): Promise<EventSession> {
  const e = await eventFor(user, id, 'edit')
  const clean = cleanSession(e, input ?? {})
  if (typeof clean === 'string') return fail(clean, 422)
  const row: Tenant<EventSessionRecord> = { companyId: e.companyId, id: nextId('ESS'), eventId: e.id, ...clean, createdAt: nowIso() }
  eventSessions.push(row)
  link(e, clean.speakerIds)
  log(e, user, `Added session “${clean.title}” to the agenda`)
  return delay(sessionView(row))
}

async function sessionFor(user: User, e: Tenant<EventRecord>, sessionId: string): Promise<Tenant<EventSessionRecord>> {
  const s = findInTenant(eventSessions, user, (x) => x.id === sessionId && x.eventId === e.id)
  if (!s) return fail('That session doesn’t exist.', 404)
  return s
}

export async function updateSession(user: User, id: string, sessionId: string, input: Partial<SessionInput> | null): Promise<EventSession> {
  const e = await eventFor(user, id, 'edit')
  const s = await sessionFor(user, e, sessionId)
  const current = sessionView(s)
  const merged: Partial<SessionInput> = {
    title: current.title,
    date: current.date,
    startTime: current.startTime,
    endTime: current.endTime,
    room: current.room,
    description: current.description,
    speakerIds: current.speakerIds,
    ...(input ?? {}),
  }
  const clean = cleanSession(e, merged, s.id)
  if (typeof clean === 'string') return fail(clean, 422)
  Object.assign(s, clean)
  link(e, clean.speakerIds)
  return delay(sessionView(s))
}

export async function removeSession(user: User, id: string, sessionId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const s = await sessionFor(user, e, sessionId)
  eventSessions.splice(eventSessions.indexOf(s), 1)
  log(e, user, `Removed session “${s.title}” from the agenda`)
  return delay({ removed: true as const })
}
