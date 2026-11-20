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
  QuestionType,
  RegistrationQuestion,
  RegistrationResult,
  AttendeeStatus,
  CancelRegistrationResult,
} from '@/modules/events/types'
import { EVENT_STATUSES, EVENT_TYPES, EVENT_STATUS_LABEL, EVENT_TYPE_LABEL } from '@/modules/events/types'
import { ApiError } from '@/shared/lib/apiError'
import { scopeOf } from '@/shared/lib/permissions'
import { isMobile, normalizeMobile } from '@/shared/lib/phone'
import { HH_MM, isRealIsoDate, zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { automationRulesFor, lookupsFor, isWonStatus, isClosedStatus } from '@/shared/mocks/data/lookups'
import { DEFAULT_AUTOMATION_RULES, type AutomationRules } from '@/modules/settings/types'
import { campaigns } from '@/shared/mocks/data/marketing'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import {
  eventAttendees,
  eventBudgetLines,
  eventEmails,
  eventHistory,
  events,
  eventTeam,
  eventTicketTypes,
  newRegistrationToken,
  newSurveyToken,
  newTicketCode,
  registrationHits,
  type AttendeeRecord,
  type EventEmailKind,
  type EventRecord,
  type TicketTypeRecord,
} from '@/shared/mocks/data/events'
import {
  canCreateEvents,
  canEditEvent,
  canManageEvent,
  canSeeEvent,
  eventActualCost,
  eventsEnabledIn,
  eventsVisibleTo,
  teamIdsOf,
} from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, assertModule, isReadOnly, LimitReachedError, noteUsage, recordUsage, remainingCapacity } from '@/shared/mocks/services/billing'
import { insertLead, mobileHint, visibleLeads } from '@/shared/mocks/services/leads'
import { hitRateLimit as sharedRateLimit } from '@/shared/mocks/services/rateLimit'
import { publicAgendaOf } from '@/shared/mocks/services/eventAgenda'
import { venueOf, venuePickProblem } from '@/shared/mocks/services/eventLibraryCore'
import { eventVenues } from '@/shared/mocks/data/eventLibrary'
import { venueCapacityWarning, venueLocation } from '@/modules/events/lib/library'
import { sponsorshipIncomeOf } from '@/shared/mocks/data/eventSponsors'

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

export const tzOf = (companyId: string) => companyById(companyId)?.regional.timezone ?? 'Asia/Dubai'
export const currencyOf = (companyId: string) => companyById(companyId)?.regional.currency ?? 'AED'
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

export function log(e: Tenant<EventRecord>, actor: User | null, summary: string): void {
  eventHistory.push({ companyId: e.companyId, id: `EH-${nextSeq()}`, eventId: e.id, at: nowIso(), userId: actor?.id ?? null, summary })
}

/* ---------------- Views ---------------- */

export function localOf(e: Tenant<EventRecord>) {
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

export function attendeesOf(e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>): Tenant<AttendeeRecord>[] {
  return eventAttendees.filter((a) => a.eventId === e.id && a.companyId === e.companyId)
}

/** Attendees with a seat (not waitlisted, not cancelled). */
export const seated = (e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>) => attendeesOf(e).filter((a) => a.status === 'registered')

export function ticketTypesOf(e: Pick<Tenant<EventRecord>, 'id' | 'companyId'>): Tenant<TicketTypeRecord>[] {
  return eventTicketTypes.filter((t) => t.eventId === e.id && t.companyId === e.companyId).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

/** Seats left overall (null = unlimited). */
export function remainingSeats(e: Tenant<EventRecord>): number | null {
  return e.capacity === null ? null : Math.max(0, e.capacity - seated(e).length)
}

/** Seats left for a ticket type, also bounded by the event's capacity (null = unlimited). */
export function remainingFor(e: Tenant<EventRecord>, t: TicketTypeRecord | null): number | null {
  const overall = remainingSeats(e)
  const own = t && t.capacity !== null ? Math.max(0, t.capacity - seated(e).filter((a) => a.ticketTypeId === t.id).length) : null
  if (overall === null) return own
  if (own === null) return overall
  return Math.min(overall, own)
}

/** A ticket type is on sale between its sales dates (company calendar, inclusive). */
export function onSale(t: TicketTypeRecord, companyId: string): boolean {
  const today = companyDayOf(companyId).today
  return (!t.salesOpen || today >= t.salesOpen) && (!t.salesClose || today <= t.salesClose)
}

/** 1-based place on the event's waitlist (first come, first served). */
export function waitlistPositionOf(a: Tenant<AttendeeRecord>): number | null {
  if (a.status !== 'waitlisted') return null
  const queue = eventAttendees
    .filter((x) => x.eventId === a.eventId && x.companyId === a.companyId && x.status === 'waitlisted')
    .sort((x, y) => (x.waitlistedAt ?? '').localeCompare(y.waitlistedAt ?? '') || x.id.localeCompare(y.id))
  return queue.findIndex((x) => x.id === a.id) + 1
}

function toRow(e: Tenant<EventRecord>, viewer: User): EventRow {
  const atts = attendeesOf(e)
  const seats = atts.filter((a) => a.status === 'registered')
  const canEdit = canEditEvent(viewer, e)
  const campaign = e.campaignId ? campaigns.find((c) => c.id === e.campaignId && c.companyId === e.companyId) : undefined
  const venue = e.venueId ? venueOf(e.companyId, e.venueId) : undefined
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
    venueId: venue?.id ?? null,
    venueName: venue?.name ?? null,
    venueCapacity: venue?.capacity ?? null,
    venueWarning: venue ? venueCapacityWarning(e.capacity, venue.capacity, seats.length) : null,
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
    attendeeCount: seats.length,
    waitlistCount: atts.filter((a) => a.status === 'waitlisted').length,
    checkedInCount: seats.filter((a) => a.checkedInAt).length,
    leadsCreated: atts.filter((a) => a.leadOutcome === 'created').length,
    capacity: e.capacity,
    remainingSeats: remainingSeats(e),
    questions: e.questions.map((q) => ({ ...q, options: [...q.options] })),
    reminderHours: e.reminderHours,
    followUpDays: e.followUpDays,
    campaignId: campaign ? campaign.id : null,
    campaignName: campaign ? campaign.name : null,
    createdBy: e.createdBy,
    createdByName: userName(e.createdBy),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    canEdit,
    canManage: canManageEvent(viewer, e),
  }
}

export function toDetail(e: Tenant<EventRecord>, viewer: User): EventDetail {
  const history = eventHistory
    .filter((h) => h.eventId === e.id && h.companyId === e.companyId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((h) => ({ id: h.id, at: h.at, userId: h.userId, userName: h.userId ? userName(h.userId) : 'Public registration', summary: h.summary }))
  return { ...toRow(e, viewer), history }
}

export function toAttendee(a: Tenant<AttendeeRecord>, viewer: User): Attendee {
  const lead = a.leadId ? leads.find((l) => l.id === a.leadId && l.companyId === a.companyId) : undefined
  const canOpen = !!lead && scopeOf(viewer.role, 'sales') !== 'hidden' && visibleLeads(viewer).some((l) => l.id === lead.id)
  const event = events.find((x) => x.id === a.eventId && x.companyId === a.companyId)
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
    checkedInByName: a.checkedInBy ? userName(a.checkedInBy) : '',
    status: a.status,
    waitlistPosition: waitlistPositionOf(a),
    ticketTypeId: a.ticketTypeId,
    ticketTypeName: a.ticketTypeId ? (eventTicketTypes.find((t) => t.id === a.ticketTypeId && t.companyId === a.companyId)?.name ?? '') : '',
    answers: structuredClone(a.answers ?? {}),
    ticketCode: event && canEditEvent(viewer, event) ? a.ticketCode : null,
    surveyToken: event && canEditEvent(viewer, event) ? a.surveyToken : null,
  }
}

/* ---------------- Access ---------------- */

/** The event if the user may see it. Another company's event (or a missing one) → 404; out of reach in the own company → 403. */
export async function eventFor(user: User, id: string, need: 'view' | 'edit' | 'manage' = 'view'): Promise<Tenant<EventRecord>> {
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
  venueId: string | null
  onlineUrl: string
  budget: number | null
  actualCost: number | null
  description: string
  registrationOpen: boolean
  capacity: number | null
  questions: RegistrationQuestion[]
  reminderHours: number
  followUpDays: number
}

/** A new event's reminder / follow-up settings: the company's Settings › Automation defaults. */
export function eventDefaultsOf(companyId: string): { reminderHours: number; followUpDays: number } {
  const r = automationRulesFor(companyId) as Partial<AutomationRules>
  return { reminderHours: r.eventReminderHours ?? DEFAULT_AUTOMATION_RULES.eventReminderHours, followUpDays: r.eventFollowUpDays ?? DEFAULT_AUTOMATION_RULES.eventFollowUpDays }
}

const QUESTION_TYPES: QuestionType[] = ['text', 'single', 'multi']
export const MAX_QUESTIONS = 20

/** Custom registration questions: ids kept (answers are keyed by them), new ones get an id. */
function cleanQuestions(raw: unknown, existing: RegistrationQuestion[]): RegistrationQuestion[] | string {
  if (raw === undefined || raw === null) return existing
  if (!Array.isArray(raw)) return 'Questions must be a list.'
  if (raw.length > MAX_QUESTIONS) return `Keep registration questions under ${MAX_QUESTIONS}.`
  const out: RegistrationQuestion[] = []
  for (const [i, q] of raw.entries()) {
    const v = (q ?? {}) as Partial<RegistrationQuestion>
    const label = str(v.label)
    if (label.length < 2 || label.length > 255) return `Question ${i + 1}: write the question (2–255 characters).`
    const type = (v.type ?? 'text') as QuestionType
    if (!QUESTION_TYPES.includes(type)) return `Question ${i + 1}: type is text, single or multi.`
    const options = Array.isArray(v.options) ? [...new Set(v.options.map((o) => str(o)).filter(Boolean))] : []
    if (type !== 'text' && (options.length < 2 || options.length > 20)) return `Question ${i + 1}: give 2–20 choices.`
    if (options.some((o) => o.length > 120)) return `Question ${i + 1}: keep choices under 120 characters.`
    const keep = typeof v.id === 'string' && /^q-[a-z0-9]{1,24}$/.test(v.id) && !out.some((x) => x.id === v.id) ? v.id : null
    out.push({ id: keep ?? `q-${nextSeq()}`, label, type, options: type === 'text' ? [] : options, required: !!v.required })
  }
  return out
}

function wholeIn(v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** Validates a full set of event fields (create, or the current event merged with a PATCH). */
function cleanEvent(companyId: string, v: Record<string, unknown>, currentVenueId: string | null = null): Clean | string {
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
  // Venue (venue library, optional): the company's active venue; an empty location is filled from it.
  const venueId = v.venueId === null || v.venueId === undefined || v.venueId === '' ? null : String(v.venueId)
  if (venueId) {
    const problem = venuePickProblem(companyId, venueId, currentVenueId)
    if (problem) return problem
  }
  const venue = venueId ? venueOf(companyId, venueId) : undefined
  const location = str(v.location) || (venue ? venueLocation(venue) : '')
  if (location.length > 255) return 'Keep the location under 255 characters.'
  const description = str(v.description)
  if (description.length > 5000) return 'Keep the description under 5,000 characters.'
  let capacity: number | null = null
  if (v.capacity !== null && v.capacity !== undefined && v.capacity !== '') {
    capacity = wholeIn(v.capacity, 1, 1_000_000)
    if (capacity === null) return 'Capacity is a whole number of seats (1 or more), or empty for unlimited.'
  }
  const questions = cleanQuestions(v.questions, [])
  if (typeof questions === 'string') return questions
  const reminderHours = v.reminderHours === undefined || v.reminderHours === null ? eventDefaultsOf(companyId).reminderHours : wholeIn(v.reminderHours, 0, 336)
  if (reminderHours === null) return 'Send the reminder 0–336 hours before the start (0 = no reminder).'
  const followUpDays = v.followUpDays === undefined || v.followUpDays === null ? eventDefaultsOf(companyId).followUpDays : wholeIn(v.followUpDays, 0, 60)
  if (followUpDays === null) return 'Follow-up tasks are due 0–60 days after the event.'
  return {
    capacity,
    questions,
    reminderHours,
    followUpDays,
    name,
    type,
    status,
    isOrganizer: v.isOrganizer === undefined ? false : !!v.isOrganizer,
    startsAt,
    endsAt,
    allDay,
    location,
    venueId,
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
      campaignId: null,
      followUpTasksAt: null,
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
  venueId: 'Venue',
  onlineUrl: 'Online link',
  budget: 'Budget',
  actualCost: 'Actual cost',
  description: 'Description',
  registrationOpen: 'Registration',
  capacity: 'Capacity',
  reminderHours: 'Reminder (hours before)',
  followUpDays: 'Follow-up tasks (days after)',
  ownerId: 'Owner',
}

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (key === 'type') return EVENT_TYPE_LABEL[v as EventRecord['type']] ?? String(v)
  if (key === 'status') return EVENT_STATUS_LABEL[v as EventStatus] ?? String(v)
  if (key === 'registrationOpen') return v ? 'open' : 'closed'
  if (key === 'isOrganizer') return v ? 'we organize' : 'we attend'
  if (key === 'ownerId') return userName(String(v))
  if (key === 'venueId') return eventVenues.find((x) => x.id === v)?.name ?? String(v)
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
    venueId: e.venueId ?? null,
    onlineUrl: e.onlineUrl,
    budget: e.budget,
    actualCost: e.actualCost,
    description: e.description,
    registrationOpen: e.registrationOpen,
    capacity: e.capacity,
    questions: e.questions,
    reminderHours: e.reminderHours,
    followUpDays: e.followUpDays,
  }
  for (const k of Object.keys(merged)) if (k in body) merged[k] = body[k]
  // Question ids are kept when the client sends them back (answers are keyed by them).
  if (Array.isArray(body.questions)) {
    merged.questions = (body.questions as Partial<RegistrationQuestion>[]).map((q) => ({ ...q, id: e.questions.some((x) => x.id === q?.id) ? q.id : undefined }))
  }
  const clean = cleanEvent(e.companyId, merged, e.venueId ?? null)
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
  if (JSON.stringify(clean.questions) !== JSON.stringify(e.questions)) changes.push('Registration questions updated')
  const wasCompleted = e.status === 'completed'
  Object.assign(e, clean, { ownerId, updatedAt: nowIso() })
  if (ownerId && !eventTeam.some((t) => t.eventId === e.id && t.companyId === e.companyId && t.userId === ownerId)) {
    eventTeam.push({ companyId: e.companyId, eventId: e.id, userId: ownerId, createdAt: nowIso() })
  }
  if (changes.length) log(e, user, changes.join(' · '))
  // More seats (capacity raised) → the waitlist moves up.
  promoteWaitlist(e, user)
  // Completed → the post-event automation runs once (follow-up tasks; services/eventFollowUp.ts).
  if (!wasCompleted && e.status === 'completed') for (const hook of completedHooks) hook(e, user)
  return delay(toDetail(e, user))
}

/** Called when an event becomes completed (registered by services/eventFollowUp.ts; avoids an import cycle). */
const completedHooks: ((e: Tenant<EventRecord>, actor: User) => void)[] = []
export function onEventCompleted(hook: (e: Tenant<EventRecord>, actor: User) => void): void {
  if (!completedHooks.includes(hook)) completedHooks.push(hook)
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
export const canOwnLeads = (u: User) => u.active !== false && ['full', 'team', 'own'].includes(scopeOf(u.role, 'sales'))

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

export interface CleanAttendee {
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
}

export function cleanAttendee(companyId: string, input: Partial<AttendeeInput> | null | undefined, requireEmail = false): CleanAttendee | string {
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

export interface SeatRequest {
  ticketTypeId?: unknown
  answers?: unknown
}

interface RegisterOptions {
  /** Public page: a ticket must be picked (when the event has ticket types), on sale, and required questions answered. */
  strict?: boolean
  /** Booth capture: no seat check (the person is at the stand), checked in at once. */
  capture?: boolean
  /** Owner of a new lead (booth capture: the capturer when they can own leads). */
  leadOwner?: User | null
  note?: string
}

interface Seat {
  ticket: Tenant<TicketTypeRecord> | null
  answers: Record<string, string | string[]>
}

/**
 * The ticket type and answers of a registration. Strict (public page): a ticket must be picked when
 * the event has ticket types and be on sale (409 `ticket_not_on_sale`); required questions answered.
 * Team adds / imports: the ticket defaults to the first type, the sales window and required answers
 * aren't enforced (the team may not know them). Choice answers must be one of the options; unknown
 * question ids are dropped.
 */
function seatOf(e: Tenant<EventRecord>, req: SeatRequest, strict: boolean): Seat {
  const types = ticketTypesOf(e)
  let ticket: Tenant<TicketTypeRecord> | null = null
  const wanted = typeof req.ticketTypeId === 'string' ? req.ticketTypeId.trim() : ''
  if (wanted) {
    ticket = types.find((t) => t.id === wanted) ?? null
    if (!ticket) throw new CodedApiError('That ticket type doesn’t exist for this event.', 422, 'invalid_ticket')
  } else if (types.length) {
    if (strict) throw new CodedApiError('Pick a ticket.', 422, 'invalid_registration')
    ticket = types[0]
  }
  if (strict && ticket && !onSale(ticket, e.companyId)) throw new CodedApiError(`${ticket.name} tickets aren’t on sale right now.`, 409, 'ticket_not_on_sale')
  const raw = req.answers && typeof req.answers === 'object' && !Array.isArray(req.answers) ? (req.answers as Record<string, unknown>) : {}
  const answers: Record<string, string | string[]> = {}
  for (const q of e.questions) {
    const v = raw[q.id]
    if (q.type === 'multi') {
      const list = Array.isArray(v) ? [...new Set(v.map((x) => str(x)).filter(Boolean))] : str(v) ? [str(v)] : []
      if (list.some((x) => !q.options.includes(x))) throw new CodedApiError(`“${q.label}”: pick from the listed choices.`, 422, 'invalid_registration')
      if (list.length) answers[q.id] = list
    } else {
      const text = str(v)
      if (text.length > 1000) throw new CodedApiError(`“${q.label}”: keep the answer under 1,000 characters.`, 422, 'invalid_registration')
      if (q.type === 'single' && text && !q.options.includes(text)) throw new CodedApiError(`“${q.label}”: pick one of the listed choices.`, 422, 'invalid_registration')
      if (text) answers[q.id] = text
    }
    if (strict && q.required && !answers[q.id]) throw new CodedApiError(`Answer “${q.label}”.`, 422, 'invalid_registration')
  }
  return { ticket, answers }
}

/** Is there a seat for this ticket type now (event capacity and the ticket's own)? */
function hasSeat(e: Tenant<EventRecord>, ticket: TicketTypeRecord | null): boolean {
  const left = remainingFor(e, ticket)
  return left === null || left > 0
}

/**
 * Saves an attendee and applies the lead rule:
 *  - an existing lead of the company with the same email → linked (no duplicate), an activity is logged on it;
 *  - otherwise a new lead: source = the company's Event source, source detail = event name, event_id,
 *    owner = event owner / team round-robin;
 *  - the plan's leads + contacts limit (402 LIMIT_REACHED) → the attendee is still saved, without a lead.
 * Seats: the event's capacity and the ticket type's; full → the attendee joins the WAITLIST (still a lead).
 * Each attendee gets an unguessable ticket code and survey token; a confirmation (or waitlist) email is logged.
 * `actor` is the team member who added it (null for the public page).
 */
export function register(e: Tenant<EventRecord>, a: CleanAttendee, actor: User | null, source: AttendeeSource, sourceDetail: string, req: SeatRequest = {}, opts: RegisterOptions = {}): Registered {
  const co = e.companyId
  if (a.email && attendeesOf(e).some((x) => x.status !== 'cancelled' && x.email === a.email)) {
    throw new CodedApiError(`${a.email} is already registered for ${e.name}.`, 409, 'already_registered')
  }
  const seat = opts.capture ? { ticket: null, answers: {} } : seatOf(e, req, !!opts.strict)
  const status: AttendeeStatus = opts.capture || hasSeat(e, seat.ticket) ? 'registered' : 'waitlisted'
  const now = nowIso()
  let leadId = leadByEmail(co, a.email)
  let outcome: LeadOutcome = leadId ? 'linked' : 'created'
  let limitReached: LeadLimitInfo | null = null
  const owner = leadId ? null : (opts.leadOwner ?? eventLeadOwner(e))
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
        note: opts.note ?? `Registered at ${e.name}${source === 'public' ? ' (public registration page)' : ''}.`,
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
      summary: opts.capture ? `${a.name} was captured at the ${e.name} booth.` : `${a.name} registered at ${e.name} (${EVENT_TYPE_LABEL[e.type].toLowerCase()}).`,
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
    checkedInAt: opts.capture ? now : null,
    checkedInBy: opts.capture ? (actor?.id ?? null) : null,
    createdBy: actor?.id ?? null,
    status,
    ticketTypeId: seat.ticket?.id ?? null,
    answers: seat.answers,
    waitlistedAt: status === 'waitlisted' ? now : null,
    cancelledAt: null,
    ticketCode: newTicketCode(),
    surveyToken: newSurveyToken(),
    reminderSentAt: null,
  }
  eventAttendees.push(attendee)
  if (!opts.capture) {
    sendEventEmail(
      e,
      attendee,
      status === 'waitlisted' ? 'waitlisted' : 'confirmation',
      status === 'waitlisted' ? `You’re on the waitlist for ${e.name} (#${waitlistPositionOf(attendee)})` : `Your ticket for ${e.name}`,
    )
  }
  return { attendee, outcome, limitReached }
}

/**
 * Logs a transactional email of the Events module (the mock sends nothing). It counts against the
 * plan's emailsPerMonth like any send; no address or no allowance left → logged as skipped.
 */
export function sendEventEmail(e: Tenant<EventRecord>, a: Tenant<AttendeeRecord>, kind: EventEmailKind, subject: string): 'sent' | 'skipped' {
  const co = e.companyId
  const skipReason = !a.email ? 'no_email' : remainingCapacity(co, 'emailsPerMonth') <= 0 ? 'limit' : null
  if (!skipReason) recordUsage(co, 'emailsPerMonth')
  eventEmails.push({ companyId: co, id: `EEM-${nextSeq()}`, eventId: e.id, attendeeId: a.id, kind, to: a.email, subject, status: skipReason ? 'skipped' : 'sent', skipReason, at: nowIso() })
  return skipReason ? 'skipped' : 'sent'
}

/**
 * Moves waitlisted people up while there are seats (first come, first served; a person whose ticket type
 * is still full waits while others with room move up). Each promotion: an email to the attendee and a
 * notification to the event owner. Returns the promoted attendees.
 */
export function promoteWaitlist(e: Tenant<EventRecord>, actor: User | null): Tenant<AttendeeRecord>[] {
  if (e.status === 'cancelled' || e.status === 'completed') return []
  const promoted: Tenant<AttendeeRecord>[] = []
  const queue = attendeesOf(e)
    .filter((a) => a.status === 'waitlisted')
    .sort((x, y) => (x.waitlistedAt ?? '').localeCompare(y.waitlistedAt ?? '') || x.id.localeCompare(y.id))
  for (const a of queue) {
    const ticket = a.ticketTypeId ? (ticketTypesOf(e).find((t) => t.id === a.ticketTypeId) ?? null) : null
    if (!hasSeat(e, ticket)) continue
    a.status = 'registered'
    promoted.push(a)
    sendEventEmail(e, a, 'promoted', `A seat opened up: you’re registered for ${e.name}`)
    if (e.ownerId) {
      pushNotification({ companyId: e.companyId, userId: e.ownerId, type: 'assignment', title: `${a.name} moved off the waitlist`, body: e.name, link: `/events/${encodeURIComponent(e.id)}?tab=attendees` })
    }
    log(e, actor, `${a.name} moved from the waitlist to registered`)
  }
  return promoted
}

function outcomeMessage(r: Registered, e: Tenant<EventRecord>): string {
  const where = r.attendee.status === 'waitlisted' ? `is on the waitlist for ${e.name} (#${waitlistPositionOf(r.attendee)})` : `is registered for ${e.name}`
  if (r.outcome === 'created') return `${r.attendee.name} ${where} and added as a new lead (source Event).`
  if (r.outcome === 'linked') return `${r.attendee.name} ${where} and linked to the existing lead with the same email.`
  return `${r.attendee.name} ${where}, but no lead was created: your plan’s leads and contacts limit is reached.`
}

function registrationResult(r: Registered, e: Tenant<EventRecord>, viewer: User): RegistrationResult {
  return { attendee: toAttendee(r.attendee, viewer), status: r.attendee.status, outcome: r.outcome, leadId: r.attendee.leadId, limitReached: r.limitReached, message: outcomeMessage(r, e) }
}

export function assertOpenForAttendees(e: Tenant<EventRecord>): void {
  if (e.status === 'cancelled') throw new CodedApiError('This event is cancelled; reopen it to add attendees.', 409, 'event_cancelled')
}

/* ---------------- Attendees ---------------- */

export async function listAttendees(user: User, id: string): Promise<Attendee[]> {
  const e = await eventFor(user, id)
  return delay(attendeesOf(e).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).map((a) => toAttendee(a, user)))
}

/** POST /events/:id/attendees — a team member registers someone (full → waitlist). */
export async function addAttendee(user: User, id: string, input: AttendeeInput): Promise<RegistrationResult> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const a = cleanAttendee(e.companyId, input)
  if (typeof a === 'string') return fail(a, 422)
  const r = register(e, a, user, 'manual', `Added by ${user.name}`, input ?? {})
  log(e, user, `Registered ${a.name}${r.attendee.status === 'waitlisted' ? ' on the waitlist' : ''}${r.outcome === 'created' ? ' (new lead)' : r.outcome === 'linked' ? ' (existing lead)' : ' (no lead: plan limit)'}`)
  return delay(registrationResult(r, e, user))
}

/** PATCH /events/:id/attendees/:attendeeId — details and answers (the lead keeps its own data; the ticket type is fixed). */
export async function updateAttendee(user: User, id: string, attendeeId: string, input: Partial<AttendeeInput>): Promise<Attendee> {
  const e = await eventFor(user, id, 'edit')
  const a = await attendeeFor(user, e, attendeeId)
  const merged = { name: a.name, companyName: a.companyName, email: a.email, mobile: a.mobile, title: a.title, ...(input ?? {}) }
  const clean = cleanAttendee(e.companyId, merged)
  if (typeof clean === 'string') return fail(clean, 422)
  if (clean.email && clean.email !== a.email && attendeesOf(e).some((x) => x.id !== a.id && x.status !== 'cancelled' && x.email === clean.email)) {
    return fail(`${clean.email} is already registered for ${e.name}.`, 409)
  }
  const answers = input?.answers !== undefined ? seatOf(e, { ticketTypeId: a.ticketTypeId, answers: input.answers }, false).answers : a.answers
  Object.assign(a, clean, { answers })
  return delay(toAttendee(a, user))
}

/** DELETE /events/:id/attendees/:attendeeId — removes the registration (a lead it created stays); a freed seat goes to the waitlist. */
export async function removeAttendee(user: User, id: string, attendeeId: string): Promise<{ removed: true }> {
  const e = await eventFor(user, id, 'edit')
  const a = await attendeeFor(user, e, attendeeId)
  eventAttendees.splice(eventAttendees.indexOf(a), 1)
  log(e, user, `Removed ${a.name} from the attendees${a.leadId ? ' (the lead stays)' : ''}`)
  if (a.status === 'registered') promoteWaitlist(e, user)
  return delay({ removed: true as const })
}

/**
 * POST /events/:id/attendees/:attendeeId/cancel — cancels a registration (kept, status cancelled, the lead
 * stays). A freed seat promotes the first waitlisted person automatically (email + owner notification).
 */
export async function cancelRegistration(user: User, id: string, attendeeId: string): Promise<CancelRegistrationResult> {
  const e = await eventFor(user, id, 'edit')
  const a = await attendeeFor(user, e, attendeeId)
  if (a.status === 'cancelled') return fail(`${a.name}’s registration is already cancelled.`, 409)
  const hadSeat = a.status === 'registered'
  a.status = 'cancelled'
  a.cancelledAt = nowIso()
  a.checkedInAt = null
  a.checkedInBy = null
  log(e, user, `Cancelled ${a.name}’s registration`)
  const promoted = hadSeat ? promoteWaitlist(e, user) : []
  return delay({ attendee: toAttendee(a, user), promoted: promoted.map((p) => toAttendee(p, user)) })
}

export function assertSeated(a: Tenant<AttendeeRecord>): void {
  if (a.status === 'waitlisted') throw new CodedApiError(`${a.name} is on the waitlist, not registered yet.`, 409, 'not_registered')
  if (a.status === 'cancelled') throw new CodedApiError(`${a.name}’s registration was cancelled.`, 409, 'not_registered')
}

/** POST /events/:id/attendees/:attendeeId/check-in { undo? } */
export async function checkIn(user: User, id: string, attendeeId: string, input: { undo?: unknown } | null): Promise<Attendee> {
  const e = await eventFor(user, id, 'edit')
  assertOpenForAttendees(e)
  const a = await attendeeFor(user, e, attendeeId)
  if (input?.undo) {
    if (a.checkedInAt) log(e, user, `Undid the check-in of ${a.name}`)
    a.checkedInAt = null
    a.checkedInBy = null
  } else if (!a.checkedInAt) {
    assertSeated(a)
    a.checkedInAt = nowIso()
    a.checkedInBy = user.id
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

/**
 * GET /events/:id/stats — attendees, leads created / linked, deals won and their value, cost per lead.
 * THE event stats / ROI function: ROI = (won value + sponsorship income − actual cost) / actual cost, where
 * sponsorship income (signed + paid sponsor deals) only exists for events the company organizes.
 */
export function statsOf(e: Tenant<EventRecord>): EventStats {
  const co = e.companyId
  const atts = attendeesOf(e)
  const leadIds = [...new Set(atts.map((a) => a.leadId).filter((x): x is string => !!x))]
  const eventLeads = leadIds.map((id) => leads.find((l) => l.id === id && l.companyId === co)).filter((l) => !!l)
  const won = eventLeads.filter((l) => isWonStatus(co, l.status))
  const leadsCreated = atts.filter((a) => a.leadOutcome === 'created').length
  const actual = eventActualCost(e)
  const hasLines = eventBudgetLines.some((l) => l.eventId === e.id && l.companyId === co)
  const wonValue = won.reduce((s, l) => s + l.value, 0)
  // Organized events: signed + paid sponsor deals are income next to the won deals (attended events: none).
  const sponsorshipIncome = e.isOrganizer ? sponsorshipIncomeOf(e).total : null
  const cplCost = actual ?? e.budget
  return {
    attendees: atts.filter((a) => a.status === 'registered').length,
    checkedIn: atts.filter((a) => a.status === 'registered' && a.checkedInAt).length,
    leadsCreated,
    leadsLinked: atts.filter((a) => a.leadOutcome === 'linked').length,
    leads: leadIds.length,
    dealsWon: won.length,
    wonValue,
    pipelineValue: eventLeads.filter((l) => !isClosedStatus(co, l.status)).reduce((s, l) => s + l.value, 0),
    budget: e.budget,
    actualCost: actual,
    // Same cost as ROI and cost per won deal: the actual cost once known, else the planned budget.
    costPerLead: cplCost !== null && leadsCreated > 0 ? Math.round((cplCost / leadsCreated) * 100) / 100 : null,
    costPerLeadBasis: cplCost === null ? null : actual !== null ? 'actual' : 'budget',
    currency: currencyOf(co),
    actualCostSource: hasLines ? 'budget_lines' : 'event',
    sponsorshipIncome,
    roi: actual ? Math.round(((wonValue + (sponsorshipIncome ?? 0) - actual) / actual) * 1000) / 1000 : null,
    costPerWonDeal: actual !== null && won.length ? Math.round((actual / won.length) * 100) / 100 : null,
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
export function publicEventByToken(token: string): Tenant<EventRecord> {
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
  const e = publicEventByToken(token)
  const reason = closedReason(e)
  const c = companyById(e.companyId)
  return delay({
    name: e.name,
    type: e.type,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    ...localOf(e),
    timezone: tzOf(e.companyId),
    location: e.location,
    onlineUrl: e.onlineUrl,
    description: e.description,
    organizerName: c?.branding.displayName ?? c?.name ?? '',
    registrationOpen: reason === null,
    closedReason: reason,
    country: c?.regional.country ?? 'AE',
    agenda: publicAgendaOf(e),
    remainingSeats: remainingSeats(e),
    tickets: ticketTypesOf(e).map((t) => ({ id: t.id, name: t.name, price: t.price, currency: currencyOf(e.companyId), remaining: remainingFor(e, t), onSale: onSale(t, e.companyId) })),
    questions: e.questions.map((q) => ({ ...q, options: [...q.options] })),
  })
}

/** Sliding-window rate limit for the public page (like sign-up): per client and per email. */
function hitRateLimit(keys: string[]): void {
  sharedRateLimit(registrationHits, keys, { limit: PUBLIC_REGISTER_LIMIT, windowMs: PUBLIC_REGISTER_WINDOW_MINUTES * 60_000, what: 'registration' })
}

const PUBLIC_DONE = 'You’re registered. See you there!'
const PUBLIC_WAITLIST = 'The event is full, so you’re on the waitlist. We’ll email you if a seat opens up.'
/** Honeypot and already-registered emails get this answer (it never reveals who is registered). */
const GENERIC: PublicRegistrationResult = { registered: true, message: PUBLIC_DONE + ' Your confirmation is on its way by email.', status: null, waitlistPosition: null, ticketCode: null }

/**
 * POST /public/events/:token/register — the public page. Honeypot (`website` filled) → a fake success,
 * nothing stored. Rate limited per client (X-Client-Id) and per email. Closed registration → 409
 * `registration_closed`. The answer never says whether a lead was created or linked.
 */
export async function publicRegister(token: string, input: PublicRegistrationInput | null, clientKey = 'anonymous'): Promise<PublicRegistrationResult> {
  await delay(null)
  const body = input ?? ({} as PublicRegistrationInput)
  const e = publicEventByToken(token)
  if (str(body.website)) return { ...GENERIC }
  const email = str(body.email).toLowerCase()
  hitRateLimit([`client:${e.id}:${clientKey || 'anonymous'}`, ...(EMAIL_RE.test(email) ? [`email:${e.id}:${email}`] : [])])
  const reason = closedReason(e)
  if (reason) throw new CodedApiError(reason, 409, 'registration_closed')
  const a = cleanAttendee(e.companyId, body, true)
  if (typeof a === 'string') throw new CodedApiError(a, 422, 'invalid_registration')
  // Already registered: the same success answer (the page never reveals who is registered).
  if (attendeesOf(e).some((x) => x.status !== 'cancelled' && x.email === a.email)) return { ...GENERIC }
  const r = register(e, a, null, 'public', 'Public registration page', { ticketTypeId: body.ticketTypeId, answers: body.answers }, { strict: true })
  const waitlisted = r.attendee.status === 'waitlisted'
  log(e, null, `${a.name} registered on the public page${waitlisted ? ' (waitlist)' : ''}${r.outcome === 'none' ? ' (no lead: plan limit)' : ''}`)
  return { registered: true, message: waitlisted ? PUBLIC_WAITLIST : PUBLIC_DONE, status: r.attendee.status, waitlistPosition: waitlistPositionOf(r.attendee), ticketCode: r.attendee.ticketCode }
}

/** Tests: the event behind an id, regardless of access. */
export function eventRecord(id: string): Tenant<EventRecord> | undefined {
  return events.find((e) => e.id === id)
}

