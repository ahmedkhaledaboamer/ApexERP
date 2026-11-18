/**
 * Events (Phase 2, plan module `events`): exhibitions, conferences, meetings and webinars the company
 * attends or organizes. Tables `events`, `event_team`, `event_attendees` (DB design §13); the API speaks
 * their snake_case columns (shared/api/eventMappers.ts). Screens and mock services use these camelCase types.
 */

export type EventType = 'exhibition' | 'conference' | 'meeting' | 'webinar' | 'other'
export const EVENT_TYPES: EventType[] = ['exhibition', 'conference', 'meeting', 'webinar', 'other']
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  exhibition: 'Exhibition',
  conference: 'Conference',
  meeting: 'Meeting',
  webinar: 'Webinar',
  other: 'Other',
}

export type EventStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled'
export const EVENT_STATUSES: EventStatus[] = ['planned', 'confirmed', 'completed', 'cancelled']
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  planned: 'Planned',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/** How an attendee got in: typed by a team member, a file import, or the public registration page. */
export type AttendeeSource = 'manual' | 'import' | 'public'
export const ATTENDEE_SOURCE_LABEL: Record<AttendeeSource, string> = {
  manual: 'Added by the team',
  import: 'Imported',
  public: 'Public registration',
}

/** What registration did with the lead: a new lead, an existing one (same email) linked, or none (plan limit). */
export type LeadOutcome = 'created' | 'linked' | 'none'

export interface EventTeamMember {
  userId: string
  name: string
  title: string
  /** The event owner (owner_id) is listed first and is always on the team. */
  isOwner: boolean
}

export interface EventHistoryEntry {
  id: string
  at: string
  userId: string | null
  userName: string
  summary: string
}

/** An event as the API serves it (list rows and the detail share this shape; the detail adds `history`). */
export interface EventRow {
  id: string
  name: string
  type: EventType
  status: EventStatus
  /** We organize it (true) or attend it (false). */
  isOrganizer: boolean
  /** UTC instants (events.starts_at / ends_at). */
  startsAt: string
  endsAt: string | null
  /** The same in the company's timezone: calendar dates (yyyy-MM-dd) and times (HH:mm, null = all day). */
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  location: string
  onlineUrl: string
  budget: number | null
  actualCost: number | null
  /** The company's currency (budgets are in it). */
  currency: string
  description: string
  ownerId: string | null
  ownerName: string
  team: EventTeamMember[]
  /** Public registration page open (the event's link `/e/:token` accepts registrations). */
  registrationOpen: boolean
  /** The public link token; only for people who can edit the event (null otherwise). */
  registrationToken: string | null
  attendeeCount: number
  checkedInCount: number
  leadsCreated: number
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
  /** The caller may change the event, its attendees and tasks (marketing full scope, or on its team). */
  canEdit: boolean
  /** The caller may cancel the event and change its team (marketing full scope, or its owner). */
  canManage: boolean
}

export interface EventDetail extends EventRow {
  history: EventHistoryEntry[]
}

/** POST /events and PATCH /events/:id (dates and times in the company's timezone). */
export interface EventInput {
  name: string
  type: EventType
  status?: EventStatus
  isOrganizer?: boolean
  startDate: string
  startTime?: string | null
  endDate?: string | null
  endTime?: string | null
  location?: string
  onlineUrl?: string
  budget?: number | null
  actualCost?: number | null
  description?: string
  ownerId?: string | null
  /** Team members besides the owner (create only; afterwards POST / DELETE /events/:id/team). */
  teamIds?: string[]
  registrationOpen?: boolean
}
export type EventUpdateInput = Partial<Omit<EventInput, 'teamIds'>>

export interface Attendee {
  id: string
  eventId: string
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
  leadId: string | null
  leadOutcome: LeadOutcome
  /** The lead's company / status when the caller can open it (Sales scope); null otherwise. */
  leadCompany: string | null
  leadStatus: string | null
  canOpenLead: boolean
  source: AttendeeSource
  /** Free text: who added it, the file name, "public page". */
  sourceDetail: string
  registeredAt: string
  checkedInAt: string | null
}

export interface AttendeeInput {
  name: string
  companyName?: string
  email?: string
  mobile?: string
  title?: string
}

/** 402 LIMIT_REACHED details when the attendee was saved without a lead. */
export interface LeadLimitInfo {
  code: 'LIMIT_REACHED'
  limit: string
  current: number
  max: number
  planId: string
}

export interface RegistrationResult {
  attendee: Attendee
  outcome: LeadOutcome
  leadId: string | null
  /** Set when the plan's leads + contacts limit stopped the lead (the attendee is still saved). */
  limitReached: LeadLimitInfo | null
  message: string
}

export interface AttendeeImportRow {
  row: number
  name: string
  companyName?: string
  email?: string
  mobile?: string
  title?: string
}

export interface AttendeeImportResult {
  added: number
  leadsCreated: number
  leadsLinked: number
  withoutLead: number
  failed: { row: number; name: string; reason: string }[]
  limitReached: LeadLimitInfo | null
}

export interface EventStats {
  attendees: number
  checkedIn: number
  leadsCreated: number
  leadsLinked: number
  /** Distinct leads from the event (created + linked). */
  leads: number
  dealsWon: number
  wonValue: number
  /** Open pipeline value of the event's leads that aren't closed. */
  pipelineValue: number
  budget: number | null
  actualCost: number | null
  /** budget / leads created (null without a budget or without new leads). */
  costPerLead: number | null
  currency: string
}

/** GET /public/events/:token: what the public registration page shows (no internal data). */
export interface PublicEventInfo {
  name: string
  type: EventType
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  timezone: string
  location: string
  onlineUrl: string
  description: string
  organizerName: string
  registrationOpen: boolean
  /** Why registration is closed, when it is. */
  closedReason: string | null
  /** The company's country (mobile format hint). */
  country: string
}

export interface PublicRegistrationInput {
  name: string
  companyName?: string
  email: string
  mobile?: string
  title?: string
  /** Honeypot: hidden on the page; bots fill it. */
  website?: string
}

export interface PublicRegistrationResult {
  registered: true
  message: string
}

export interface EventFilter {
  from?: string
  to?: string
}
