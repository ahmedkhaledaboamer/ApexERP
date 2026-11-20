import type { LeadStatus } from '@/shared/types'
import type { AttendeeSource, AttendeeStatus, CaptureRating, EventStatus, EventType } from '@/modules/events/types'
import type { AnalyticsPreset } from '@/modules/marketing/analyticsTypes'

/**
 * Cross-event sections of the Events area (docs/API.md › Events › Attendees directory, Booth leads,
 * Event analytics). Rows only come from events the caller can see (marketing full / view: every event;
 * everyone else: the events they're on).
 */

/* ---------------- Attendees directory ---------------- */

/** One registration of a person, at one event. */
export interface PersonRegistration {
  attendeeId: string
  eventId: string
  eventName: string
  eventType: EventType
  eventStatus: EventStatus
  /** The event's start date (company calendar). */
  eventDate: string
  status: AttendeeStatus
  ticketTypeName: string
  source: AttendeeSource
  registeredAt: string
  checkedInAt: string | null
  /** The person's feedback survey answer at this event, if any. */
  survey: { rating: number; nps: number; comment: string } | null
  /** Booth captures of the person at this event. */
  captures: { id: string; rating: CaptureRating; notes: string; capturedByName: string; capturedAt: string }[]
}

/** A person across the visible events, de-duplicated by email (else by lead, else the single registration). */
export interface AttendeePerson {
  key: string
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
  /** The person's lead is flagged Do Not Contact (Sales). */
  doNotContact: boolean
  /** Events with a registration that isn't cancelled. */
  eventsRegistered: number
  /** Events the person checked in at. */
  eventsAttended: number
  /** Checked in ÷ seats at events that have started (%, 0 decimals); null when none started yet. */
  checkedInRate: number | null
  lastEventId: string | null
  lastEventName: string
  lastEventDate: string | null
  ticketTypes: string[]
  sources: AttendeeSource[]
  leadId: string | null
  /** Lead details only when the caller's Sales scope reaches the lead. */
  leadStatus: LeadStatus | null
  leadOwnerId: string | null
  leadOwnerName: string | null
  canOpenLead: boolean
  registrations: PersonRegistration[]
}

export interface AttendeeDirectoryEvent {
  id: string
  name: string
  type: EventType
  status: EventStatus
  startDate: string
}

export interface AttendeeDirectory {
  people: AttendeePerson[]
  /** The visible events (filter options). */
  events: AttendeeDirectoryEvent[]
  /** Export is for marketing `full` only. */
  canExport: boolean
}

/** GET /events/attendees/export: one row per person; contact details blank for Do Not Contact people. */
export interface AttendeeExportRow {
  /** The person key of the directory row. */
  key: string
  name: string
  companyName: string
  title: string
  email: string
  mobile: string
  doNotContact: boolean
  eventsRegistered: number
  eventsAttended: number
  checkedInRate: number | null
  lastEventName: string
  lastEventDate: string | null
  ticketTypes: string
  leadStatus: string
  leadOwnerName: string
  sources: string
}

/* ---------------- Booth leads ---------------- */

export type FollowUpState = 'untouched' | 'contacted' | 'meeting' | 'won' | 'lost' | 'no_lead'
export const FOLLOW_UP_STATES: FollowUpState[] = ['untouched', 'contacted', 'meeting', 'won', 'lost', 'no_lead']
export const FOLLOW_UP_STATE_LABEL: Record<FollowUpState, string> = {
  untouched: 'Untouched',
  contacted: 'Contacted',
  meeting: 'Meeting',
  won: 'Won',
  lost: 'Lost',
  no_lead: 'No lead',
}

export interface BoothLead {
  /** The capture id. */
  id: string
  eventId: string
  eventName: string
  eventType: EventType
  capturedAt: string
  capturedBy: string
  capturedByName: string
  rating: CaptureRating
  notes: string
  visitorName: string
  visitorCompany: string
  visitorEmail: string
  leadId: string | null
  /** Lead details only when the caller's Sales scope reaches the lead. */
  leadStatus: LeadStatus | null
  leadOwnerId: string | null
  leadOwnerName: string | null
  leadValue: number | null
  canOpenLead: boolean
  state: FollowUpState
  /** The capture day + the company's eventFollowUpDays (company calendar). */
  followUpDue: string
  overdue: boolean
  daysOverdue: number
}

export interface BoothLeads {
  rows: BoothLead[]
  followUpDays: number
  /** Today in the company's timezone. */
  today: string
  /** Bulk "Assign owner": a Sales scope that can reassign leads (full or team). */
  canAssign: boolean
  currency: string
}

export interface AssignBoothLeadsInput {
  captureIds: string[]
  ownerId: string
}

export interface AssignBoothLeadsResult {
  updated: number
  skipped: { captureId: string; reason: string }[]
}

/* ---------------- Event analytics ---------------- */

export interface EventAnalyticsKpis {
  events: number
  attendees: number
  checkedIn: number
  /** Checked in ÷ attendees (%, 1 decimal). */
  checkInRate: number | null
  leadsCreated: number
  leadsLinked: number
  dealsWon: number
  wonValue: number
  /** Sum of the known actual costs. */
  actualCost: number
  /** Σ cost (actual when known, else budget; the event stats rule) ÷ Σ new leads of those events. */
  costPerLead: number | null
  /** (won value − actual cost) ÷ actual cost over events with a known cost (%, 1 decimal). */
  roi: number | null
  /** The mean of the events' NPS (events with answers). */
  averageNps: number | null
}

export interface EventAnalyticsRow {
  id: string
  name: string
  type: EventType
  status: EventStatus
  startDate: string
  endDate: string
  attendees: number
  checkedIn: number
  checkInRate: number | null
  leads: number
  leadsCreated: number
  leadsLinked: number
  costPerLead: number | null
  costPerLeadBasis: 'actual' | 'budget' | null
  dealsWon: number
  wonValue: number
  actualCost: number | null
  budget: number | null
  /** % (1 decimal), from the event stats ratio. */
  roi: number | null
  nps: number | null
  responses: number
}

export interface EventTypeSummary {
  type: EventType
  events: number
  leadsCreated: number
  cost: number
  costPerLead: number | null
  wonValue: number
  roi: number | null
}

export interface EventTrendPoint {
  month: string
  events: number
  checkInRate: number | null
  nps: number | null
}

export interface EventAnalytics {
  preset: AnalyticsPreset
  from: string
  to: string
  timezone: string
  currency: string
  kpis: EventAnalyticsKpis
  previous: { from: string; to: string } | null
  previousKpis: EventAnalyticsKpis | null
  rows: EventAnalyticsRow[]
  byType: EventTypeSummary[]
  trend: EventTrendPoint[]
}

export interface EventAnalyticsQuery {
  preset: AnalyticsPreset
  from?: string
  to?: string
  compare: boolean
}
