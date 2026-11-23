/**
 * Events (Phase 2, plan module `events`): exhibitions, conferences, meetings and webinars the company
 * attends or organizes. Tables `events`, `event_team`, `event_attendees` (DB design §13); the API speaks
 * their snake_case columns (shared/api/eventMappers.ts). Screens and mock services use these camelCase types.
 */
import type { Role } from '@/shared/types'
import type { TaskPriority, TaskStatus } from '@/modules/tasks/enums'

export type EventType ='exhibition' | 'conference' | 'meeting' | 'webinar' | 'other'
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
export type AttendeeSource = 'manual' | 'import' | 'public' | 'capture'
export const ATTENDEE_SOURCE_LABEL: Record<AttendeeSource, string> = {
  manual: 'Added by the team',
  import: 'Imported',
  public: 'Public registration',
  capture: 'Booth capture',
}

/** registered (has a seat), waitlisted (waiting for one), cancelled (kept for history). */
export type AttendeeStatus = 'registered' | 'waitlisted' | 'cancelled'
export const ATTENDEE_STATUS_LABEL: Record<AttendeeStatus, string> = { registered: 'Registered', waitlisted: 'Waitlist', cancelled: 'Cancelled' }

export type QuestionType = 'text' | 'single' | 'multi'
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = { text: 'Text', single: 'Single choice', multi: 'Multiple choice' }

/** A custom registration question (the event's questions). */
export interface RegistrationQuestion {
  id: string
  label: string
  type: QuestionType
  /** Choices (single / multi); empty for text. */
  options: string[]
  required: boolean
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
  /** Venue from the company's venue library (null = none; `location` is the free-text fallback / override). */
  venueId: string | null
  venueName: string | null
  venueCapacity: number | null
  /** Venue capacity vs event capacity / registrations: a warning (never a refusal), null when it fits. */
  venueWarning: string | null
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
  /** Registered attendees (with a seat; the waitlist and cancellations aren't counted). */
  attendeeCount: number
  waitlistCount: number
  checkedInCount: number
  leadsCreated: number
  /** Overall capacity (null = unlimited) and seats left. */
  capacity: number | null
  remainingSeats: number | null
  questions: RegistrationQuestion[]
  /** Reminder email this many hours before the start (event setting). */
  reminderHours: number
  /** Post-event follow-up tasks are due this many days after completion. */
  followUpDays: number
  campaignId: string | null
  campaignName: string | null
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
  /** A venue of the venue library (active); an empty `location` is filled from it. null clears it. */
  venueId?: string | null
  onlineUrl?: string
  budget?: number | null
  actualCost?: number | null
  description?: string
  ownerId?: string | null
  /** Team members besides the owner (create only; afterwards POST / DELETE /events/:id/team). */
  teamIds?: string[]
  registrationOpen?: boolean
  capacity?: number | null
  questions?: (Omit<RegistrationQuestion, 'id'> & { id?: string })[]
  reminderHours?: number
  followUpDays?: number
  /** Create only: apply this event template right away (its checklist tasks). */
  templateId?: string | null
}
export type EventUpdateInput = Partial<Omit<EventInput, 'teamIds' | 'templateId'>>

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
  checkedInByName: string
  status: AttendeeStatus
  /** 1-based place on the waitlist (null unless waitlisted). */
  waitlistPosition: number | null
  ticketTypeId: string | null
  ticketTypeName: string
  answers: Record<string, string | string[]>
  /** Ticket code (QR); only for people who can edit the event (null otherwise). */
  ticketCode: string | null
  /** Feedback survey token (link /s/:token); editors only. */
  surveyToken: string | null
}

export interface AttendeeInput {
  name: string
  companyName?: string
  email?: string
  mobile?: string
  title?: string
  ticketTypeId?: string | null
  answers?: Record<string, string | string[]>
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
  /** registered or waitlisted (event / ticket type full). */
  status: AttendeeStatus
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
  /** cost ÷ new leads, cost = actual cost when known else the budget (see costPerLeadBasis); null without either or without new leads. */
  costPerLead: number | null
  /** What cost per lead divides: the actual cost when known (budget lines or the event's actual cost), else the planned budget. */
  costPerLeadBasis: 'actual' | 'budget' | null
  currency: string
  /** Where actual_cost comes from: the budget lines (when the event has any) or the event's own field. */
  actualCostSource: 'budget_lines' | 'event'
  /**
   * Events the company organizes: signed + paid sponsor deals (Sponsors & exhibitors), counted as income in ROI.
   * null for events the company only attends.
   */
  sponsorshipIncome?: number | null
  /**
   * (won value [+ sponsorship income, organized events] − actual cost) / actual cost, as a ratio (1.5 = +150%);
   * null without an actual cost.
   */
  roi: number | null
  /** actual cost / deals won (null without both). */
  costPerWonDeal: number | null
}

/** GET /public/events/:token: what the public registration page shows (no internal data). */
export interface PublicEventInfo {
  name: string
  type: EventType
  /** UTC instants (calendar links). */
  startsAt: string
  endsAt: string | null
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
  /** Sessions in time order (empty without an agenda). */
  agenda: PublicAgendaSession[]
  /** Seats left overall (null = unlimited). */
  remainingSeats: number | null
  tickets: PublicTicketType[]
  questions: RegistrationQuestion[]
}

export interface PublicTicketType {
  id: string
  name: string
  price: number
  currency: string
  /** Seats left for this ticket (null = unlimited); 0 = full → registering joins the waitlist. */
  remaining: number | null
  onSale: boolean
}

export interface PublicRegistrationInput {
  name: string
  companyName?: string
  email: string
  mobile?: string
  title?: string
  ticketTypeId?: string | null
  answers?: Record<string, string | string[]>
  /** Honeypot: hidden on the page; bots fill it. */
  website?: string
}

export interface PublicRegistrationResult {
  registered: true
  message: string
  /** New registrations only (an email already registered gets the generic answer: null). */
  status: AttendeeStatus | null
  waitlistPosition: number | null
  ticketCode: string | null
}

/* ---------------- Tickets ---------------- */

export interface TicketType {
  id: string
  name: string
  /** null = unlimited. */
  capacity: number | null
  /** 0 = free (no payment in the mock). */
  price: number
  currency: string
  /** Company-local dates (inclusive); null = no limit. */
  salesOpen: string | null
  salesClose: string | null
  registered: number
  waitlisted: number
  checkedIn: number
  remaining: number | null
  onSale: boolean
}

export interface TicketTypeInput {
  name: string
  capacity?: number | null
  price?: number
  salesOpen?: string | null
  salesClose?: string | null
}

/* ---------------- Check-in & tickets ---------------- */

export interface CheckInResult {
  attendee: Attendee
  /** The code was already checked in (nothing changed): `attendee.checkedInAt` says when. */
  alreadyCheckedIn: boolean
  message: string
}

export interface CheckInSummary {
  registered: number
  checkedIn: number
  waitlisted: number
  byTicketType: { ticketTypeId: string | null; name: string; registered: number; checkedIn: number }[]
  /** The latest check-ins (newest first, up to 20). */
  recent: Attendee[]
}

/** GET /public/tickets/:code: an attendee's ticket (no internal ids). */
export interface PublicTicket {
  code: string
  status: AttendeeStatus
  waitlistPosition: number | null
  attendeeName: string
  companyName: string
  ticketTypeName: string
  checkedIn: boolean
  event: {
    name: string
    type: EventType
    startDate: string
    endDate: string
    startTime: string | null
    endTime: string | null
    startsAt: string
    endsAt: string | null
    timezone: string
    location: string
    onlineUrl: string
    organizerName: string
    status: EventStatus
  }
}

/* ---------------- Invitations & reminders ---------------- */

/** POST /events/:id/invite: who (a saved audience and / or filters, as a bulk email) and what (a template, or subject + body). */
export interface InviteInput {
  name?: string
  audienceId?: string | null
  industries?: string[]
  statuses?: string[]
  sources?: string[]
  ownerIds?: string[]
  templateId?: string | null
  subject?: string
  body?: string
}

export type EventEmailKind = 'confirmation' | 'waitlisted' | 'promoted' | 'reminder'
export const EVENT_EMAIL_KIND_LABEL: Record<EventEmailKind, string> = {
  confirmation: 'Confirmation',
  waitlisted: 'Waitlist',
  promoted: 'Off the waitlist',
  reminder: 'Reminder',
}

/** The event's transactional email log (GET /events/:id/emails). */
export interface EventEmailLog {
  id: string
  attendeeId: string
  attendeeName: string
  kind: EventEmailKind
  to: string
  subject: string
  status: 'sent' | 'skipped'
  skipReason: 'no_email' | 'limit' | null
  at: string
}

/* ---------------- Booth lead capture ---------------- */

export type CaptureRating = 'hot' | 'warm' | 'cold'
export const CAPTURE_RATINGS: CaptureRating[] = ['hot', 'warm', 'cold']
export const CAPTURE_RATING_LABEL: Record<CaptureRating, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }

export interface CaptureInput {
  name: string
  companyName?: string
  email?: string
  mobile?: string
  title?: string
  rating: CaptureRating
  notes?: string
  /** Photo of the business card (a link; uploads are a later feature). */
  cardPhotoUrl?: string
}

export interface EventCapture {
  id: string
  attendeeId: string
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
  leadId: string | null
  leadOutcome: LeadOutcome
  canOpenLead: boolean
  rating: CaptureRating
  notes: string
  cardPhotoUrl: string
  capturedBy: string
  capturedByName: string
  capturedAt: string
}

export interface CaptureResult {
  capture: EventCapture
  outcome: LeadOutcome
  leadId: string | null
  limitReached: LeadLimitInfo | null
  message: string
}

export interface LeaderboardRow {
  userId: string
  name: string
  captures: number
  hotLeads: number
  warmLeads: number
  /** Leads from their captures now in a won status, and the value. */
  dealsWon: number
  wonValue: number
}

/* ---------------- After the event ---------------- */

export interface FollowUpInput {
  /** Email templates (Settings › Templates); empty = the ready-made thank-you / sorry-we-missed-you texts. */
  attendedTemplateId?: string | null
  noShowTemplateId?: string | null
}

export interface FollowUpResult {
  attended: import('@/modules/marketing/types').BulkEmailDetail
  noShow: import('@/modules/marketing/types').BulkEmailDetail
  attendedAudienceId: string
  noShowAudienceId: string
}

/* ---------------- Feedback survey ---------------- */

/** GET /public/surveys/:token. */
export interface PublicSurvey {
  eventName: string
  organizerName: string
  attendeeFirstName: string
  /** Accepting answers (the event is over and not cancelled, not answered yet). */
  open: boolean
  submitted: boolean
  closedReason: string | null
}

export interface SurveyInput {
  /** 1–5 stars. */
  rating: number
  /** 0–10: how likely to recommend. */
  nps: number
  comment?: string
}

export interface SurveyResults {
  responses: number
  /** Registered attendees (with a seat): the people who got a survey link. */
  invited: number
  responseRate: number | null
  averageRating: number | null
  /** % promoters (9–10) − % detractors (0–6), −100…100; null without answers. */
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  /** Answers with a comment, newest first. */
  comments: { attendeeName: string; rating: number; nps: number; comment: string; submittedAt: string }[]
}

/* ---------------- Budget lines & campaign ---------------- */

export type BudgetCategory = 'venue' | 'travel' | 'logistics' | 'printing' | 'sponsorship' | 'catering' | 'marketing' | 'other'
export const BUDGET_CATEGORIES: BudgetCategory[] = ['venue', 'travel', 'logistics', 'printing', 'sponsorship', 'catering', 'marketing', 'other']
export const BUDGET_CATEGORY_LABEL: Record<BudgetCategory, string> = {
  venue: 'Venue / booth',
  travel: 'Travel',
  logistics: 'Logistics / shipping',
  printing: 'Printing',
  sponsorship: 'Sponsorship',
  catering: 'Catering',
  marketing: 'Marketing',
  other: 'Other',
}

export interface BudgetLine {
  id: string
  category: BudgetCategory
  note: string
  planned: number
  actual: number
  /** Posted to the linked campaign's costs (its amount follows the line's actual). */
  posted: boolean
  /** Kept in step by Travel & logistics (a trip or a shipment): edit it there, not here. */
  source?: { kind: 'trip' | 'shipment'; id: string } | null
  /** The vendor (vendor library) the line is spent with. */
  vendorId?: string | null
  vendorName?: string | null
  /**
   * What posted supplier bills charged to this line (Accounts & finance › Bills, base currency). The line's cost is
   * max(actual, billed): a bill replaces the typed actual, never adds to it.
   */
  billed?: number
  /** The bills (links for users with accounting access; [] otherwise). */
  bills?: { id: string; number: string; amount: number }[]
}

export interface BudgetLineInput {
  category: BudgetCategory
  note?: string
  planned?: number
  actual?: number
  /** A vendor of the library; a blacklisted vendor can't be picked (422 `vendor_blacklisted`). null clears it. */
  vendorId?: string | null
}

export interface EventBudget {
  lines: BudgetLine[]
  plannedTotal: number
  actualTotal: number
  /** The event's budget (events.budget) and what's left of it after the actual costs. */
  budget: number | null
  remaining: number | null
  currency: string
  campaignId: string | null
  campaignName: string | null
  /** Sum of this event's cost entries on the linked campaign. */
  postedTotal: number
  /** Billed through finance on the lines, and on the event without a line (not in the event's cost). */
  billedTotal?: number
  unlinkedBilled?: number
  /** Σ max(actual, billed) per line: the cost the event stats / ROI use (no double counting). */
  costTotal?: number
  /** Organized events: signed + paid sponsor deals (income, not a cost line); null for attended events. */
  sponsorshipIncome?: number | null
  /** Completed events: vendors with lines here and no review for this event yet ("Rate after the event"). */
  vendorsToRate?: { vendorId: string; vendorName: string }[]
  /** The caller may change lines and the campaign link (marketing full or the event owner). */
  canManage: boolean
}

export interface CancelRegistrationResult {
  attendee: Attendee
  /** The waitlisted people who got the seat(s) freed. */
  promoted: Attendee[]
}

export interface EventFilter {
  from?: string
  to?: string
}

/* ---------------- Event templates + prep checklist (docs/API.md › Events › Templates) ---------------- */

/** Who gets a template task: the event owner, or the first event-team member with this CRM role. */
export type TemplateTaskRole = 'owner' | Role
export const TEMPLATE_TASK_ROLES: TemplateTaskRole[] = [
  'owner',
  'Marketing Manager',
  'Sales Manager',
  'Sales Agent',
  'Management',
  'Company Admin',
  'Department Head',
  'Employee',
  'Accountant',
  'HR Manager',
]
export const templateRoleLabel = (r: TemplateTaskRole) => (r === 'owner' ? 'Event owner' : r)

export interface EventTemplateTask {
  id: string
  title: string
  /** Days before (negative) or after (positive) the event's start date. */
  offsetDays: number
  role: TemplateTaskRole
  priority: TaskPriority
}

export interface EventTemplate {
  id: string
  name: string
  eventType: EventType
  /** Days the event usually lasts (prefills the end date). */
  defaultDurationDays: number
  tasks: EventTemplateTask[]
  createdAt: string
  updatedAt: string
}

export interface EventTemplateInput {
  name: string
  eventType: EventType
  defaultDurationDays: number
  tasks: (Omit<EventTemplateTask, 'id'> & { id?: string })[]
}

export interface ChecklistItem {
  taskId: string
  title: string
  dueDate: string | null
  ownerId: string
  ownerName: string
  status: TaskStatus
  priority: TaskPriority
  templateTaskId: string
  templateName: string
  offsetDays: number | null
  done: boolean
}

export interface EventChecklist {
  items: ChecklistItem[]
  done: number
  total: number
  /** Templates already applied (some of their tasks exist). */
  appliedTemplateIds: string[]
}

/* ---------------- Agenda & speakers ---------------- */

export interface EventSpeaker {
  id: string
  name: string
  title: string
  company: string
  bio: string
  photoUrl: string
}
export type SpeakerInput = Omit<EventSpeaker, 'id'>

export interface EventSession {
  id: string
  title: string
  /** Company-local date and times (the event's timezone); `startsAt` / `endsAt` are the UTC instants. */
  date: string
  startTime: string
  endTime: string
  startsAt: string
  endsAt: string
  room: string
  description: string
  speakerIds: string[]
  speakers: Pick<EventSpeaker, 'id' | 'name' | 'title' | 'company' | 'photoUrl'>[]
}

export interface SessionInput {
  title: string
  date: string
  startTime: string
  endTime: string
  room?: string
  description?: string
  speakerIds?: string[]
}

export interface EventAgenda {
  sessions: EventSession[]
  /** The event's roster: speakers from the company's speaker directory (ids are directory ids). */
  speakers: EventSpeaker[]
  timezone: string
  /** The caller may change speaker profiles (they live in the directory): marketing full. */
  canEditSpeakers: boolean
}

/** The agenda on the public registration page (no ids). */
export interface PublicAgendaSession {
  title: string
  date: string
  startTime: string
  endTime: string
  room: string
  description: string
  speakers: Omit<EventSpeaker, 'id'>[]
}

export interface ApplyTemplateResult {
  created: number
  /** Template tasks that already had a task on this event (re-applying never duplicates). */
  skipped: number
  checklist: EventChecklist
}
