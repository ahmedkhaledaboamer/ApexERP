import type { Activity, User } from '@/shared/types'
import type {
  Attendee,
  AttendeeImportResult,
  AttendeeImportRow,
  AttendeeInput,
  AttendeeSource,
  EventDetail,
  EventFilter,
  EventInput,
  EventRow,
  EventStats,
  EventStatus,
  EventUpdateInput,
  LeadLimitInfo,
  LeadOutcome,
  PublicEventInfo,
  PublicRegistrationInput,
  PublicRegistrationResult,
  RegistrationResult,
} from '@/modules/events/types'
import { EVENT_STATUSES, EVENT_TYPES, EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { isMobile, normalizeMobile } from '@/shared/lib/phone'
import { HH_MM, isRealIsoDate, zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { lookupsFor, isWonStatus, isClosedStatus } from '@/shared/mocks/data/lookups'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import {
  eventAttendees,
  eventHistory,
  events,
  eventTeam,
  newRegistrationToken,
  registrationHits,
  type AttendeeRecord,
  type EventRecord,
} from '@/shared/mocks/data/events'
import {
  canCreateEvents,
  canEditEvent,
  canManageEvent,
  canSeeEvent,
  eventsEnabledIn,
  eventsVisibleTo,
  teamIdsOf,
} from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, assertModule, isReadOnly, LimitReachedError, noteUsage } from '@/shared/mocks/services/billing'
import { insertLead, mobileHint, visibleLeads } from '@/shared/mocks/services/leads'
import { hitRateLimit as sharedRateLimit } from '@/shared/mocks/services/rateLimit'

/**
 * Events module (Phase 2, plan module `events`; docs/API.md › Events). Exhibitions, conferences,
 * meetings and webinars with a team, attendees and a public registration page. Every attendee
 * becomes a lead with the company's "Event" source (or links the existing lead with the same email);
 * leads and won deals per event are counted (stats, cost per lead) and feed the "Events attended" target.
 * Access: selectors/events.ts (marketing column + event team membership).
 */

const EVENT_NOT_FOUND = 'That event doesn’t exist.'
const ATTENDEE_NOT_FOUND = 'That attendee doesn’t exist.'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Rows per import call (a bigger file is split by the client). */
export const MAX_IMPORT_ROWS = 1000
/** Public registration rate limit: per client and per email, in a sliding window. */
export const PUBLIC_REGISTER_LIMIT = 5
export const PUBLIC_REGISTER_WINDOW_MINUTES = 10

const tzOf = (companyId: string) => companyById(companyId)?.regional.timezone ?? 'Asia/Dubai'
const currencyOf = (companyId: string) => companyById(companyId)?.regional.currency ?? 'AED'
const userName = (id: string | null | undefined) => (id ? ownerName(id) : '')

let seq = 0
const nextSeq = () => `${nowMs().toString(36)}${(++seq).toString(36)}`

function nextEventId(): string {
  let n = 1001 + events.filter((e) => Number(e.id.slice(3)) < 5000).length
  while (events.some((e) => e.id === `EV-${n}`)) n++
  return `EV-${n}`
}

function nextAttendeeId(): string {
  return `EA-${nextSeq()}`
}

function log(e: Tenant<EventRecord>, actor: User | null, summary: string): void {
  eventHistory.push({ companyId: e.companyId, id: `EH-${nextSeq()}`, eventId: e.id, at: nowIso(), userId: actor?.id ?? null, summary })
}

/* ---------------- Views ---------------- */

function localOf(e: Tenant<EventRecord>) {
  const tz = tzOf(e.companyId)
  const start = zonedParts(e.startsAt, tz)
  const end = e.endsAt ? zonedParts(e.endsAt, tz) : start
  return {
    startDate: start.date,
    endDate: end.date,
    startTime: e.allDay ? null : start.time,
    endTime: e.allDay || !e.endsAt ? null : end.time,
  }
}

function attendeesOf(e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>): Tenant<AttendeeRecord>[] {
  return eventAttendees.filter((a) => a.eventId === e.id && a.companyId === e.companyId)
}

function toRow(e: Tenant<EventRecord>, viewer: User): EventRow {
  const atts = attendeesOf(e)
  const canEdit = canEditEvent(viewer, e)
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    status: e.status,
    isOrganizer: e.isOrganizer,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    ...localOf(e),
    location: e.location,
    onlineUrl: e.onlineUrl,
    budget: e.budget,
    actualCost: e.actualCost,
    currency: currencyOf(e.companyId),
    description: e.description,
    ownerId: e.ownerId,
    ownerName: userName(e.ownerId),
    team: teamIdsOf(e).map((id) => {
      const u = users.find((x) => x.id === id && x.companyId === e.companyId)
      return { userId: id, name: u?.name ?? id, title: u?.title ?? '', isOwner: id === e.ownerId }
    }),
    registrationOpen: e.registrationOpen,
    registrationToken: canEdit ? e.registrationToken : null,
    attendeeCount: atts.length,
    checkedInCount: atts.filter((a) => a.checkedInAt).length,
    leadsCreated: atts.filter((a) => a.leadOutcome === 'created').length,
    createdBy: e.createdBy,
    createdByName: userName(e.createdBy),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    canEdit,
    canManage: canManageEvent(viewer, e),
  }
}

function toDetail(e: Tenant<EventRecord>, viewer: User): EventDetail {
  const history = eventHistory
    .filter((h) => h.eventId === e.id && h.companyId === e.companyId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((h) => ({ id: h.id, at: h.at, userId: h.userId, userName: h.userId ? userName(h.userId) : 'Public registration', summary: h.summary }))
  return { ...toRow(e, viewer), history }
}

function toAttendee(a: Tenant<AttendeeRecord>, viewer: User): Attendee {
  const lead = a.leadId ? leads.find((l) => l.id === a.leadId && l.companyId === a.companyId) : undefined
  const canOpen = !!lead && scopeOf(viewer.role, 'sales') !== 'hidden' && visibleLeads(viewer).some((l) => l.id === lead.id)
  return {
    id: a.id,
    eventId: a.eventId,
    name: a.name,
    companyName: a.companyName,
    email: a.email,
    mobile: a.mobile,
    title: a.title,
    leadId: a.leadId,
    leadOutcome: a.leadOutcome,
    leadCompany: canOpen ? lead.company : null,
    leadStatus: canOpen ? lead.status : null,
    canOpenLead: canOpen,
    source: a.source,
    sourceDetail: a.sourceDetail,
    registeredAt: a.registeredAt,
    checkedInAt: a.checkedInAt,
  }
}

/* ---------------- Access ---------------- */

/** The event if the user may see it. Another company's event (or a missing one) → 404; out of reach in the own company → 403. */
async function eventFor(user: User, id: string, need: 'view' | 'edit' | 'manage' = 'view'): Promise<Tenant<EventRecord>> {
  assertModule(tenantOf(user), 'events')
  const e = findInTenant(events, user, (x) => x.id === id)
  if (!e) return fail(EVENT_NOT_FOUND, 404)
  if (!canSeeEvent(user, e)) return fail('This event is outside your access. Ask the event owner to add you to its team.', 403)
  if (need === 'edit' && !canEditEvent(user, e)) return fail('You can view this event but not change it. Event team members and marketing managers can.', 403)
  if (need === 'manage' && !canManageEvent(user, e)) return fail('Only the event owner or a marketing manager can do this.', 403)
  return e
}

async function attendeeFor(user: User, e: Tenant<EventRecord>, attendeeId: string): Promise<Tenant<AttendeeRecord>> {
  const a = findInTenant(eventAttendees, user, (x) => x.id === attendeeId && x.eventId === e.id)
  if (!a) return fail(ATTENDEE_NOT_FOUND, 404)
  return a
}

/* ---------------- Validation ---------------- */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function money(v: unknown, label: string): number | null | string {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return `${label} must be a positive amount.`
  if (n > 1e12) return `${label} is too large.`
  return Math.round(n * 100) / 100
}

interface Clean {
  name: string
  type: EventRecord['type']
  status: EventStatus
  isOrganizer: boolean
  startsAt: string
  endsAt: string | null
  allDay: boolean
  location: string
  onlineUrl: string
  budget: number | null
  actualCost: number | null
  description: string
  registrationOpen: boolean
}

/** Validates a full set of event fields (create, or the current event merged with a PATCH). */
function cleanEvent(companyId: string, v: Record<string, unknown>): Clean | string {
  const name = str(v.name)
  if (name.length < 2 || name.length > 255) return 'Give the event a name (2–255 characters).'
  const type = v.type as EventRecord['type']
  if (!EVENT_TYPES.includes(type)) return `Type must be one of: ${EVENT_TYPES.join(', ')}.`
  const status = (v.status ?? 'planned') as EventStatus
  if (!EVENT_STATUSES.includes(status)) return `Status must be one of: ${EVENT_STATUSES.join(', ')}.`
  const startDate = v.startDate
  if (!isRealIsoDate(startDate)) return 'Set the start date as yyyy-MM-dd.'
  const endDate = v.endDate === null || v.endDate === undefined || v.endDate === '' ? startDate : v.endDate
  if (!isRealIsoDate(endDate)) return 'Set the end date as yyyy-MM-dd.'
  const startTime = v.startTime ? String(v.startTime) : null
  const endTime = v.endTime ? String(v.endTime) : null
  if (startTime && !HH_MM.test(startTime)) return 'Set the start time as HH:mm.'
  if (endTime && !HH_MM.test(endTime)) return 'Set the end time as HH:mm.'
  if (endTime && !startTime) return 'Set a start time before the end time.'
  const tz = tzOf(companyId)
  const allDay = !startTime
  const startsAt = zonedToUtc(startDate, startTime, tz)
  const endsAt = zonedToUtc(endDate, allDay ? null : (endTime ?? startTime), tz)
  if (endsAt < startsAt) return 'The event can’t end before it starts.'
  const onlineUrl = str(v.onlineUrl)
  if (onlineUrl && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(onlineUrl)) return 'Enter the online link as a full URL (https://…).'
  const budget = money(v.budget, 'Budget')
  if (typeof budget === 'string') return budget
  const actualCost = money(v.actualCost, 'Actual cost')
  if (typeof actualCost === 'string') return actualCost
  const location = str(v.location)
  if (location.length > 255) return 'Keep the location under 255 characters.'
  const description = str(v.description)
  if (description.length > 5000) return 'Keep the description under 5,000 characters.'
  return {
    name,
    type,
    status,
    isOrganizer: v.isOrganizer === undefined ? false : !!v.isOrganizer,
    startsAt,
    endsAt,
    allDay,
    location,
    onlineUrl,
    budget,
    actualCost,
    description,
    registrationOpen: !!v.registrationOpen,
  }
}

/** An active user of the company, or an error message. */
function memberProblem(companyId: string, id: unknown): string | null {
  const u = users.find((x) => x.id === id && x.companyId === companyId)
  if (!u) return 'That user doesn’t exist.'
  if (u.active === false) return `${u.name} is deactivated and can’t join an event team.`
  return null
}

/* ---------------- Events ---------------- */

/** GET /events?from=&to= (company-local dates; events overlapping the range). */
export async function listEvents(user: User, filter: EventFilter = {}): Promise<EventRow[]> {
  assertModule(tenantOf(user), 'events')
  if ((filter.from && !isRealIsoDate(filter.from)) || (filter.to && !isRealIsoDate(filter.to))) return fail('Use yyyy-MM-dd for from / to.', 422)
  const rows = eventsVisibleTo(user)
    .map((e) => toRow(e, user))
    .filter((r) => (!filter.from || r.endDate >= filter.from) && (!filter.to || r.startDate <= filter.to))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return delay(rows)
}

export async function getEvent(user: User, id: string): Promise<EventDetail> {
  const e = await eventFor(user, id)
  return delay(toDetail(e, user))
}

/** POST /events — marketing create right (Company Admin, Management, Marketing Manager). */
export async function createEvent(user: User, input: EventInput): Promise<EventDetail> {
  const co = tenantOf(user)
  assertModule(co, 'events')
  if (!canCreateEvents(user)) return fail('Only marketing managers and admins can create events.', 403)
  const body = (input ?? {}) as unknown as Record<string, unknown>
  const clean = cleanEvent(co, body)
  if (typeof clean === 'string') return fail(clean, 422)
  if (clean.status === 'cancelled') return fail('A new event can’t start cancelled.', 422)
  const ownerId = body.ownerId ? String(body.ownerId) : user.id
  const ownerErr = memberProblem(co, ownerId)
  if (ownerErr) return fail(ownerErr.replace('join an event team', 'own an event'), 422)
  const teamIds = Array.isArray(body.teamIds) ? [...new Set(body.teamIds.map(String))].filter((id) => id !== ownerId) : []
  for (const id of teamIds) {
    const p = memberProblem(co, id)
    if (p) return fail(p, 422)
  }
  const now = nowIso()
  const e: Tenant<EventRecord> = stamp(
    {
      id: nextEventId(),
      ...clean,
      ownerId,
      registrationToken: newRegistrationToken(),
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    },
    user,
  )
  events.push(e)
  for (const id of [ownerId, ...teamIds]) eventTeam.push({ companyId: co, eventId: e.id, userId: id, createdAt: now })
  log(e, user, 'Created the event')
  return delay(toDetail(e, user))
}

const FIELD_LABEL: Partial<Record<keyof Clean | 'ownerId', string>> = {
  name: 'Name',
  type: 'Type',
  status: 'Status',
  isOrganizer: 'Organizer',
  location: 'Location',
  onlineUrl: 'Online link',
  budget: 'Budget',
  actualCost: 'Actual cost',
  description: 'Description',
  registrationOpen: 'Registration',
  ownerId: 'Owner',
}

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (key === 'type') return EVENT_TYPE_LABEL[v as EventRecord['type']] ?? String(v)
  if (key === 'status') return EVENT_STATUS_LABEL[v as EventStatus] ?? String(v)
  if (key === 'registrationOpen') return v ? 'open' : 'closed'
  if (key === 'isOrganizer') return v ? 'we organize' : 'we attend'
  if (key === 'ownerId') return userName(String(v))
  if (key === 'description') return 'updated'
  return String(v)
}

/** PATCH /events/:id — team members and marketing managers. Owner changes and reopening a cancelled event: owner or marketing full. */
export async function updateEvent(user: User, id: string, input: EventUpdateInput): Promise<EventDetail> {
  const e = await eventFor(user, id, 'edit')
  const body = (input ?? {}) as Record<string, unknown>
  const local = localOf(e)
  const merged: Record<string, unknown> = {
    name: e.name,
    type: e.type,
    status: e.status,
    isOrganizer: e.isOrganizer,
    startDate: local.startDate,
    endDate: local.endDate,
    startTime: local.startTime,
    endTime: local.endTime,
    location: e.location,
    onlineUrl: e.onlineUrl,
    budget: e.budget,
    actualCost: e.actualCost,
    description: e.description,
    registrationOpen: e.registrationOpen,
  }
  for (const k of Object.keys(merged)) if (k in body) merged[k] = body[k]
  const clean = cleanEvent(e.companyId, merged)
  if (typeof clean === 'string') return fail(clean, 422)
  if (clean.status !== e.status && (clean.status === 'cancelled' || e.status === 'cancelled') && !canManageEvent(user, e)) {
    return fail('Only the event owner or a marketing manager can cancel or reopen an event.', 403)
  }
  if (clean.status === 'cancelled') clean.registrationOpen = false
  let ownerId = e.ownerId
  if ('ownerId' in body && body.ownerId !== e.ownerId) {
    if (!canManageEvent(user, e)) return fail('Only the event owner or a marketing manager can change the owner.', 403)
    const p = memberProblem(e.companyId, body.ownerId)
    if (p) return fail(p.replace('join an event team', 'own an event'), 422)
    ownerId = String(body.ownerId)
  }
  const changes: string[] = []
  for (const k of Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]) {
    const before = k === 'ownerId' ? e.ownerId : e[k as keyof EventRecord]
    const after = k === 'ownerId' ? ownerId : clean[k as keyof Clean]
    if (before !== after) changes.push(`${FIELD_LABEL[k]}: ${show(k, before)} → ${show(k, after)}`)
  }
  if (clean.startsAt !== e.startsAt || clean.endsAt !== e.endsAt || clean.allDay !== e.allDay) changes.push('Dates changed')
  Object.assign(e, clean, { ownerId, updatedAt: nowIso() })
  if (ownerId && !eventTeam.some((t) => t.eventId === e.id && t.companyId === e.companyId && t.userId === ownerId)) {
    eventTeam.push({ companyId: e.companyId, eventId: e.id, userId: ownerId, createdAt: nowIso() })
  }
  if (changes.length) log(e, user, changes.join(' · '))
  return delay(toDetail(e, user))
}

/** DELETE /events/:id — soft delete: the event is cancelled (kept with its attendees and leads). */
export async function cancelEvent(user: User, id: string): Promise<EventDetail> {
  const e = await eventFor(user, id, 'manage')
  // A completed event happened: cancelling it would rewrite history (stats, the Events attended target).
  if (e.status === 'completed') throw new CodedApiError('A completed event can’t be cancelled.', 409, 'event_completed')
  if (e.status !== 'cancelled') {
    e.status = 'cancelled'
    e.registrationOpen = false
    e.updatedAt = nowIso()
    log(e, user, 'Cancelled the event')
  }
  return delay(toDetail(e, user))
}

/** POST /events/:id/team { user_id } */
export async function addTeamMember(user: User, id: string, input: { userId?: unknown }): Promise<EventDetail> {
  const e = await eventFor(user, id, 'manage')
  const userId = String(input?.userId ?? '')
  const p = memberProblem(e.companyId, userId)
  if (p) return fail(p, p.startsWith('That user') ? 404 : 422)
  if (teamIdsOf(e).includes(userId)) return fail(`${userName(userId)} is already on the team.`, 409)
  eventTeam.push({ companyId: e.companyId, eventId: e.id, userId, createdAt: nowIso() })
  e.updatedAt = nowIso()
  log(e, user, `Added ${userName(userId)} to the team`)
  return delay(toDetail(e, user))
}

/** DELETE /events/:id/team/:userId */
export async function removeTeamMember(user: User, id: string, userId: string): Promise<EventDetail> {
  const e = await eventFor(user, id, 'manage')
  const i = eventTeam.findIndex((t) => t.eventId === e.id && t.companyId === e.companyId && t.userId === userId)
  if (i < 0) return fail('That person isn’t on the team.', 404)
  if (userId === e.ownerId) return fail('The owner stays on the team. Change the owner first.', 422)
  eventTeam.splice(i, 1)
  e.updatedAt = nowIso()
  log(e, user, `Removed ${userName(userId)} from the team`)
  return delay(toDetail(e, user))
}

/* ---------------- Registration (the core rule) ---------------- */

/** The company's "Event" lead source key (Settings › Fixed lists), if active. */
export function eventSourceKey(companyId: string): string | null {
  const s = lookupsFor(companyId).sources.find((x) => x.active && (x.key.toLowerCase() === 'event' || x.label.toLowerCase() === 'event'))
  return s?.key ?? null
}

export const EVENT_SOURCE_MISSING =
  'Your lead sources have no active “Event” source, so attendees can’t become leads. Add (or reactivate) an “Event” source in Settings › Fixed lists › Lead sources.'

/** The lead with this email (lead email or a contact's), in the company. */
function leadByEmail(companyId: string, email: string): string | null {
  if (!email) return null
  const direct = leads.find((l) => l.companyId === companyId && l.contactEmail.trim().toLowerCase() === email)
  if (direct) return direct.id
  const c = contacts.find((x) => x.companyId === companyId && x.leadId && x.email.trim().toLowerCase() === email)
  return c?.leadId ?? null
}

/** People who can own leads: active, with a Sales & CRM scope that owns records (not view / hidden). */
const canOwnLeads = (u: User) => u.active !== false && ['full', 'team', 'own'].includes(scopeOf(u.role, 'sales'))

/**
 * Owner of a lead from an event: the event owner and team members in turn (round-robin by the
 * number of leads the event already created), keeping only people who can own leads. Nobody →
 * the company's first active Sales Agent, then the event owner.
 */
function eventLeadOwner(e: Tenant<EventRecord>): User {
  const co = e.companyId
  const pool = teamIdsOf(e)
    .map((id) => users.find((u) => u.id === id && u.companyId === co))
    .filter((u): u is User => !!u && canOwnLeads(u))
  if (pool.length) {
    const n = attendeesOf(e).filter((a) => a.leadOutcome === 'created').length
    return pool[n % pool.length]
  }
  const agent = users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Sales Agent').sort((a, b) => a.id.localeCompare(b.id))[0]
  const fallback = agent ?? users.find((u) => u.id === e.ownerId && u.companyId === co) ?? users.find((u) => u.companyId === co && u.role === 'Company Admin')
  if (!fallback) throw new ApiError('This workspace has no one who can own leads.', 422)
  return fallback
}

interface CleanAttendee {
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
}

function cleanAttendee(companyId: string, input: Partial<AttendeeInput> | null | undefined, requireEmail = false): CleanAttendee | string {
  const v = input ?? {}
  const name = str(v.name)
  if (name.length < 2 || name.length > 255) return 'Enter the attendee’s name (2–255 characters).'
  const email = str(v.email).toLowerCase()
  if (requireEmail && !email) return 'Enter an email address.'
  if (email && (!EMAIL_RE.test(email) || email.length > 190)) return `${email} isn’t a valid email address.`
  const country = companyById(companyId)?.regional.country ?? 'AE'
  const rawMobile = str(v.mobile)
  let mobile = ''
  if (rawMobile) {
    if (!isMobile(rawMobile, country)) return `${rawMobile} isn’t a ${mobileHint(country)}.`
    mobile = normalizeMobile(rawMobile, country) ?? rawMobile
  }
  if (!email && !mobile) return 'Add an email or a mobile number so the team can follow up.'
  const companyName = str(v.companyName)
  const title = str(v.title)
  if (companyName.length > 255 || title.length > 120) return 'Company or title is too long.'
  return { name, companyName, email, mobile, title }
}

interface Registered {
  attendee: Tenant<AttendeeRecord>
  outcome: LeadOutcome
  limitReached: LeadLimitInfo | null
}

/**
 * Saves an attendee and applies the lead rule:
 *  - an existing lead of the company with the same email → linked (no duplicate), an activity is logged on it;
 *  - otherwise a new lead: source = the company's Event source, source detail = event name, event_id,
 *    owner = event owner / team round-robin;
 *  - the plan's leads + contacts limit (402 LIMIT_REACHED) → the attendee is still saved, without a lead.
 * `actor` is the team member who added it (null for the public page).
 */
function register(e: Tenant<EventRecord>, a: CleanAttendee, actor: User | null, source: AttendeeSource, sourceDetail: string): Registered {
  const co = e.companyId
  if (a.email && attendeesOf(e).some((x) => x.email === a.email)) {
    throw new CodedApiError(`${a.email} is already registered for ${e.name}.`, 409, 'already_registered')
  }
  const now = nowIso()
  let leadId = leadByEmail(co, a.email)
  let outcome: LeadOutcome = leadId ? 'linked' : 'created'
  let limitReached: LeadLimitInfo | null = null
  const owner = leadId ? null : eventLeadOwner(e)
  if (!leadId) {
    const sourceKey = eventSourceKey(co)
    if (!sourceKey) throw new CodedApiError(EVENT_SOURCE_MISSING, 422, 'event_source_missing')
    try {
      // The lead plus its one contact count toward leads + contacts.
      assertCapacity(co, 'leadsContacts', 2)
      const lead = insertLead(owner!, {
        company: a.companyName || a.name,
        sourceType: sourceKey,
        sourceDetail: e.name,
        industry: '',
        contacts: [{ name: a.name, title: a.title, mobile: a.mobile, email: a.email, isDecisionMaker: false }],
        ownerId: owner!.id,
        nextFollowUpDate: null,
        note: `Registered at ${e.name}${source === 'public' ? ' (public registration page)' : ''}.`,
      })
      ;(lead as { eventId?: string | null }).eventId = e.id
      leadId = lead.id
      noteUsage(co)
    } catch (err) {
      if (!(err instanceof LimitReachedError)) throw err
      outcome = 'none'
      leadId = null
      limitReached = { code: 'LIMIT_REACHED', ...(err.details as Omit<LeadLimitInfo, 'code'>) }
    }
  } else {
    const lead = leads.find((l) => l.id === leadId && l.companyId === co)!
    const activity: Tenant<Activity> = {
      companyId: co,
      id: `A-EV-${nextSeq()}`,
      leadId: lead.id,
      type: 'system',
      summary: `${a.name} registered at ${e.name} (${EVENT_TYPE_LABEL[e.type].toLowerCase()}).`,
      userId: actor?.id ?? e.ownerId ?? lead.ownerId,
      at: now,
    }
    activities.push(activity)
  }
  const attendee: Tenant<AttendeeRecord> = {
    companyId: co,
    id: nextAttendeeId(),
    eventId: e.id,
    ...a,
    leadId,
    leadOutcome: outcome,
    source,
    sourceDetail,
    registeredAt: now,
    checkedInAt: null,
    createdBy: actor?.id ?? null,
  }
  eventAttendees.push(attendee)
  return { attendee, outcome, limitReached }
}

function outcomeMessage(r: Registered, e: Tenant<EventRecord>): string {
  if (r.outcome === 'created') return `${r.attendee.name} is registered for ${e.name} and added as a new lead (source Event).`
  if (r.outcome === 'linked') return `${r.attendee.name} is registered for ${e.name} and linked to the existing lead with the same email.`
  return `${r.attendee.name} is registered for ${e.name}, but no lead was created: your plan’s leads and contacts limit is reached.`
}

function registrationResult(r: Registered, e: Tenant<EventRecord>, viewer: User): RegistrationResult {
  return { attendee: toAttendee(r.attendee, viewer), outcome: r.outcome, leadId: r.attendee.leadId, limitReached: r.limitReached, message: outcomeMessage(r, e) }
}

function assertOpenForAttendees(e: Tenant<EventRecord>): void {
  if (e.status === 'cancelled') throw new CodedApiError('This event is cancelled; reopen it to add attendees.', 409, 'event_cancelled')
}

/* ---------------- Attendees ---------------- */

export async function listAttendees(user: User, id: string): Promise<Attendee[]> {
  const e = await eventFor(user, id)
  return delay(attendeesOf(e).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).map((a) => toAttendee(a, user)))
}

/** POST /events/:id/attendees — a team member registers someone. */
export async function addAttendee(user: User, id: string, input: AttendeeInput): Promise<RegistrationResult> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const a = cleanAttendee(e.companyId, input)
  if (typeof a === 'string') return fail(a, 422)
  const r = register(e, a, user, 'manual', `Added by ${user.name}`)
  log(e, user, `Registered ${a.name}${r.outcome === 'created' ? ' (new lead)' : r.outcome === 'linked' ? ' (existing lead)' : ' (no lead: plan limit)'}`)
  return delay(registrationResult(r, e, user))
}

/** PATCH /events/:id/attendees/:attendeeId — details only (the lead keeps its own data). */
export async function updateAttendee(user: User, id: string, attendeeId: string, input: Partial<AttendeeInput>): Promise<Attendee> {
  const e = await eventFor(user, id, 'edit')
  const a = await attendeeFor(user, e, attendeeId)
  const merged = { name: a.name, companyName: a.companyName, email: a.email, mobile: a.mobile, title: a.title, ...(input ?? {}) }
  const clean = cleanAttendee(e.companyId, merged)
  if (typeof clean === 'string') return fail(clean, 422)
  if (clean.email && clean.email !== a.email && attendeesOf(e).some((x) => x.id !== a.id && x.email === clean.email)) {
    return fail(`${clean.email} is already registered for ${e.name}.`, 409)
  }
  Object.assign(a, clean)
  return delay(toAttendee(a, user))
}

/** DELETE /events/:id/attendees/:attendeeId — removes the registration; a lead it created stays. */
export async function removeAttendee(user: User, id: string, attendeeId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const a = await attendeeFor(user, e, attendeeId)
  eventAttendees.splice(eventAttendees.indexOf(a), 1)
  log(e, user, `Removed ${a.name} from the attendees${a.leadId ? ' (the lead stays)' : ''}`)
  return delay({ removed: true as const })
}

/** POST /events/:id/attendees/:attendeeId/check-in { undo? } */
export async function checkIn(user: User, id: string, attendeeId: string, input: { undo?: unknown } | null): Promise<Attendee> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const a = await attendeeFor(user, e, attendeeId)
  if (input?.undo) {
    if (a.checkedInAt) log(e, user, `Undid the check-in of ${a.name}`)
    a.checkedInAt = null
  } else if (!a.checkedInAt) {
    a.checkedInAt = nowIso()
    log(e, user, `Checked in ${a.name}`)
  }
  return delay(toAttendee(a, user))
}

/**
 * POST /events/:id/attendees/import { rows, file_name } — CSV / Excel rows mapped by the client.
 * Each row registers like a manual add; rows stop creating leads once the plan's leads + contacts
 * limit is reached (they are still saved as attendees: `without_lead`), invalid rows are reported.
 */
export async function importAttendees(user: User, id: string, input: { rows?: AttendeeImportRow[]; fileName?: string } | null): Promise<AttendeeImportResult> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const rows = Array.isArray(input?.rows) ? input!.rows : null
  if (!rows || rows.length === 0) return fail('The file has no attendee rows.', 422)
  if (rows.length > MAX_IMPORT_ROWS) return fail(`Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} attendees at a time.`, 422)
  const fileName = str(input?.fileName) || 'file import'
  const out: AttendeeImportResult = { added: 0, leadsCreated: 0, leadsLinked: 0, withoutLead: 0, failed: [], limitReached: null }
  rows.forEach((row, i) => {
    const n = Number(row?.row) || i + 2
    const a = cleanAttendee(e.companyId, row)
    if (typeof a === 'string') {
      out.failed.push({ row: n, name: str(row?.name), reason: a })
      return
    }
    try {
      const r = register(e, a, user, 'import', fileName)
      out.added++
      if (r.outcome === 'created') out.leadsCreated++
      else if (r.outcome === 'linked') out.leadsLinked++
      else {
        out.withoutLead++
        out.limitReached = r.limitReached
      }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      out.failed.push({ row: n, name: a.name, reason: err.message })
    }
  })
  if (out.added) log(e, user, `Imported ${out.added} attendee${out.added === 1 ? '' : 's'} from ${fileName}`)
  return delay(out)
}

/* ---------------- Stats ---------------- */

/** GET /events/:id/stats — attendees, leads created / linked, deals won and their value, cost per lead. */
export function statsOf(e: Tenant<EventRecord>): EventStats {
  const co = e.companyId
  const atts = attendeesOf(e)
  const leadIds = [...new Set(atts.map((a) => a.leadId).filter((x): x is string => !!x))]
  const eventLeads = leadIds.map((id) => leads.find((l) => l.id === id && l.companyId === co)).filter((l) => !!l)
  const won = eventLeads.filter((l) => isWonStatus(co, l.status))
  const leadsCreated = atts.filter((a) => a.leadOutcome === 'created').length
  return {
    attendees: atts.length,
    checkedIn: atts.filter((a) => a.checkedInAt).length,
    leadsCreated,
    leadsLinked: atts.filter((a) => a.leadOutcome === 'linked').length,
    leads: leadIds.length,
    dealsWon: won.length,
    wonValue: won.reduce((s, l) => s + l.value, 0),
    pipelineValue: eventLeads.filter((l) => !isClosedStatus(co, l.status)).reduce((s, l) => s + l.value, 0),
    budget: e.budget,
    actualCost: e.actualCost,
    costPerLead: e.budget !== null && leadsCreated > 0 ? Math.round((e.budget / leadsCreated) * 100) / 100 : null,
    currency: currencyOf(co),
  }
}

export async function getEventStats(user: User, id: string): Promise<EventStats> {
  const e = await eventFor(user, id)
  return delay(statsOf(e))
}

/* ---------------- Public registration (no auth) ---------------- */

/**
 * The event behind a public token. Unknown token, a company without the Events module (plan or
 * platform override) or a deleted workspace → 404, the same answer, so tokens can't be probed.
 */
function publicEvent(token: string): Tenant<EventRecord> {
  const e = token ? events.find((x) => x.registrationToken === token) : undefined
  const sub = e ? subscriptionOf(e.companyId) : undefined
  if (!e || !eventsEnabledIn(e.companyId) || !sub || sub.status === 'deleted' || companyById(e.companyId)?.status === 'suspended') {
    throw new CodedApiError('This registration link isn’t valid.', 404, 'event_not_found')
  }
  return e
}

function closedReason(e: Tenant<EventRecord>): string | null {
  if (e.status === 'cancelled') return 'This event was cancelled.'
  if (e.status === 'completed') return 'This event has ended.'
  if (!e.registrationOpen) return 'Registration for this event is closed.'
  const sub = subscriptionOf(e.companyId)
  if (sub && isReadOnly(sub.status)) return 'Registration for this event is closed.'
  return null
}

export async function getPublicEvent(token: string): Promise<PublicEventInfo> {
  const e = publicEvent(token)
  const reason = closedReason(e)
  const c = companyById(e.companyId)
  return delay({
    name: e.name,
    type: e.type,
    ...localOf(e),
    timezone: tzOf(e.companyId),
    location: e.location,
    onlineUrl: e.onlineUrl,
    description: e.description,
    organizerName: c?.branding.displayName ?? c?.name ?? '',
    registrationOpen: reason === null,
    closedReason: reason,
    country: c?.regional.country ?? 'AE',
  })
}

/** Sliding-window rate limit for the public page (like sign-up): per client and per email. */
function hitRateLimit(keys: string[]): void {
  sharedRateLimit(registrationHits, keys, { limit: PUBLIC_REGISTER_LIMIT, windowMs: PUBLIC_REGISTER_WINDOW_MINUTES * 60_000, what: 'registration' })
}

const PUBLIC_DONE = 'You’re registered. See you there!'

/**
 * POST /public/events/:token/register — the public page. Honeypot (`website` filled) → a fake success,
 * nothing stored. Rate limited per client (X-Client-Id) and per email. Closed registration → 409
 * `registration_closed`. The answer never says whether a lead was created or linked.
 */
export async function publicRegister(token: string, input: PublicRegistrationInput | null, clientKey = 'anonymous'): Promise<PublicRegistrationResult> {
  await delay(null)
  const body = input ?? ({} as PublicRegistrationInput)
  const e = publicEvent(token)
  if (str(body.website)) return { registered: true, message: PUBLIC_DONE }
  const email = str(body.email).toLowerCase()
  hitRateLimit([`client:${e.id}:${clientKey || 'anonymous'}`, ...(EMAIL_RE.test(email) ? [`email:${e.id}:${email}`] : [])])
  const reason = closedReason(e)
  if (reason) throw new CodedApiError(reason, 409, 'registration_closed')
  const a = cleanAttendee(e.companyId, body, true)
  if (typeof a === 'string') throw new CodedApiError(a, 422, 'invalid_registration')
  // Already registered: the same success answer (the page never reveals who is registered).
  if (attendeesOf(e).some((x) => x.email === a.email)) return { registered: true, message: PUBLIC_DONE }
  const r = register(e, a, null, 'public', 'Public registration page')
  log(e, null, `${a.name} registered on the public page${r.outcome === 'none' ? ' (no lead: plan limit)' : ''}`)
  return { registered: true, message: PUBLIC_DONE }
}

/** Tests: the event behind an id, regardless of access. */
export function eventRecord(id: string): Tenant<EventRecord> | undefined {
  return events.find((e) => e.id === id)
}

