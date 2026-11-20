import type { AttendeeSource, AttendeeStatus, EventStatus, EventType, LeadOutcome, RegistrationQuestion } from '@/modules/events/types'
import { contacts, leads } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { registerArray } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { zonedToUtc } from '@/shared/lib/zonedTime'

/**
 * Events module stores (DB design §13): `events`, `event_team`, `event_attendees`, plus the event's
 * activity history and the public registration rate-limit hits. Every row carries its company.
 */

export interface EventRecord {
  id: string
  name: string
  type: EventType
  status: EventStatus
  isOrganizer: boolean
  /** UTC instants; `allDay` = entered without times (local midnight). */
  startsAt: string
  endsAt: string | null
  allDay: boolean
  location: string
  /** The venue from the company's venue library (optional); `location` stays the free-text fallback / override. */
  venueId?: string | null
  onlineUrl: string
  budget: number | null
  actualCost: number | null
  description: string
  ownerId: string | null
  registrationOpen: boolean
  /** Public registration link token (/e/:token); letters only, globally unique. */
  registrationToken: string
  /** Overall capacity (registered attendees); null = unlimited. Full → new registrations join the waitlist. */
  capacity: number | null
  /** Custom registration questions (answers are stored on the attendee). */
  questions: RegistrationQuestion[]
  /** Reminder email to registered attendees this many hours before the start. */
  reminderHours: number
  /** Follow-up tasks after completion are due this many days later. */
  followUpDays: number
  /** Linked Marketing campaign (budget lines' actual costs post to it). */
  campaignId: string | null
  /** When the post-event follow-up tasks were created (once only). */
  followUpTasksAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** event_team: (event_id, user_id) pairs. The owner is a member too. */
export interface EventTeamRecord {
  eventId: string
  userId: string
  createdAt: string
}

export interface AttendeeRecord {
  id: string
  eventId: string
  name: string
  companyName: string
  email: string
  mobile: string
  title: string
  leadId: string | null
  leadOutcome: LeadOutcome
  source: AttendeeSource
  sourceDetail: string
  registeredAt: string
  checkedInAt: string | null
  checkedInBy: string | null
  createdBy: string | null
  /** registered (has a seat), waitlisted (waiting for one) or cancelled (kept for history). */
  status: AttendeeStatus
  ticketTypeId: string | null
  /** Answers to the event's custom questions, keyed by question id. */
  answers: Record<string, string | string[]>
  waitlistedAt: string | null
  cancelledAt: string | null
  /** Unguessable ticket code (QR, check-in, public ticket page); not the registration token. */
  ticketCode: string
  /** Unguessable token of the attendee's feedback survey link. */
  surveyToken: string
  /** The reminder email before the event was handled (sent or skipped), once only. */
  reminderSentAt: string | null
}

export interface EventHistoryRecord {
  id: string
  eventId: string
  at: string
  userId: string | null
  summary: string
}

/** Public registration attempts (rate limit), keyed by client / email; not company data. */
export interface RegistrationHit {
  key: string
  at: number
}

/** event_ticket_types: kinds of ticket per event (capacity, price in the company currency, sales window). */
export interface TicketTypeRecord {
  id: string
  eventId: string
  name: string
  capacity: number | null
  price: number
  salesOpen: string | null
  salesClose: string | null
  sortOrder: number
  createdAt: string
}

/** Transactional emails of the Events module (confirmation, waitlist, promotion, reminder): a log, counted against emailsPerMonth. */
export type EventEmailKind = 'confirmation' | 'waitlisted' | 'promoted' | 'reminder'
export interface EventEmailRecord {
  id: string
  eventId: string
  attendeeId: string
  kind: EventEmailKind
  to: string
  subject: string
  /** sent, or skipped (no email address, or the plan's monthly email allowance is used up). */
  status: 'sent' | 'skipped'
  skipReason: 'no_email' | 'limit' | null
  at: string
}

export type BudgetCategory = 'venue' | 'travel' | 'logistics' | 'printing' | 'sponsorship' | 'catering' | 'marketing' | 'other'

/** event_budget_lines: planned vs actual cost per category. */
export interface BudgetLineRecord {
  id: string
  eventId: string
  category: BudgetCategory
  note: string
  planned: number
  actual: number
  /** The vendor (company vendor library) the line is spent with; optional. */
  vendorId?: string | null
  createdAt: string
  updatedAt: string
}

/** A budget line's actual cost posted to a Marketing campaign (campaign_costs row), once per line and campaign. */
export interface EventCostLinkRecord {
  eventId: string
  lineId: string
  campaignId: string
  costId: string
}

export const events = registerArray<Tenant<EventRecord>>('events', [])
export const eventBudgetLines = registerArray<Tenant<BudgetLineRecord>>('eventBudgetLines', [])
export const eventCostLinks = registerArray<Tenant<EventCostLinkRecord>>('eventCostLinks', [])
export const eventTicketTypes = registerArray<Tenant<TicketTypeRecord>>('eventTicketTypes', [])
export const eventEmails = registerArray<Tenant<EventEmailRecord>>('eventEmails', [])
export const eventTeam = registerArray<Tenant<EventTeamRecord>>('eventTeam', [])
export const eventAttendees = registerArray<Tenant<AttendeeRecord>>('eventAttendees', [])
export const eventHistory = registerArray<Tenant<EventHistoryRecord>>('eventHistory', [])
export const registrationHits = registerArray<RegistrationHit>('eventRegistrationHits', [])

const LETTERS = 'abcdefghijkmnpqrstuvwxyz'

/**
 * Stable token for a seeded demo event, derived from its id (FNV-1a → 20 letters), so a copied public link
 * keeps working after the seed is rebuilt. Real tokens come from newRegistrationToken (unguessable).
 */
function seedRegistrationToken(id: string): string {
  let h = 0x811c9dc5
  let t = ''
  for (let i = 0; t.length < 20; i++) {
    h ^= (id.charCodeAt(i % id.length) + i) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
    t += LETTERS[h % LETTERS.length]
  }
  return t
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** FNV-1a over the whole text first (every character counts), then one output character per further round. */
function fnv(text: string, length: number, alphabet: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  let t = ''
  for (let i = 0; t.length < length; i++) {
    h = Math.imul(h ^ ((i * 31 + 7) & 0xff), 0x01000193) >>> 0
    h = (h ^ (h >>> 13)) >>> 0
    t += alphabet[h % alphabet.length]
  }
  return t
}

const groupCode = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`

/** Stable ticket code of a seeded attendee (same after every seed rebuild). */
export function seedTicketCode(attendeeId: string): string {
  return groupCode(fnv(`ticket:${attendeeId}`, 12, CODE_CHARS))
}

/** Stable survey token of a seeded attendee. */
export function seedSurveyToken(attendeeId: string): string {
  return fnv(`survey:${attendeeId}`, 24, LETTERS)
}

/** A ticket code: 12 characters (no 0/O/1/I), grouped XXXX-XXXX-XXXX, unique across companies. */
export function newTicketCode(): string {
  for (;;) {
    let t = ''
    for (let i = 0; i < 12; i++) t += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    const code = groupCode(t)
    if (!eventAttendees.some((a) => a.ticketCode === code)) return code
  }
}

/** A survey token: 24 letters, unique across companies. */
export function newSurveyToken(): string {
  for (;;) {
    let t = ''
    for (let i = 0; i < 24; i++) t += LETTERS[Math.floor(Math.random() * LETTERS.length)]
    if (!eventAttendees.some((a) => a.surveyToken === t)) return t
  }
}

/** A public link token: 20 letters (no digits, so it never looks like a number), unique across companies. */
export function newRegistrationToken(): string {
  for (;;) {
    let t = ''
    for (let i = 0; i < 20; i++) t += LETTERS[Math.floor(Math.random() * LETTERS.length)]
    if (!events.some((e) => e.registrationToken === t)) return t
  }
}

/* ---------------- Seed ---------------- */

interface SeedEvent {
  id: string
  companyId: string
  name: string
  type: EventType
  status: EventStatus
  isOrganizer: boolean
  /** Days from today (company time) and optional local times. */
  startIn: number
  days: number
  startTime?: string
  endTime?: string
  location: string
  onlineUrl?: string
  budget: number | null
  actualCost?: number | null
  description: string
  ownerId: string
  team: string[]
  registrationOpen: boolean
  /** Seeded leads whose source detail is this event name become its attendees (and get its event_id). */
  linkLeadsBySourceDetail?: boolean
}

const SEED: SeedEvent[] = [
  {
    id: 'EV-1001', companyId: APEX_ID, name: 'GITEX Global 2026', type: 'exhibition', status: 'completed', isOrganizer: false,
    startIn: -34, days: 4, location: 'Dubai World Trade Centre, Hall 7', budget: 85000, actualCost: 79250,
    description: 'Stand in the AI & automation hall. Demos of the chatbot and OCR products; lead capture on the stand.',
    ownerId: 'u7', team: ['u4', 'u5'], registrationOpen: false, linkLeadsBySourceDetail: true,
  },
  {
    id: 'EV-1002', companyId: APEX_ID, name: 'Arab Health 2026', type: 'exhibition', status: 'completed', isOrganizer: false,
    startIn: -300, days: 3, location: 'Dubai World Trade Centre', budget: 40000, actualCost: 42800,
    description: 'Visitor passes for the healthcare vertical; meetings with clinic groups.',
    ownerId: 'u7', team: ['u5', 'u10'], registrationOpen: false, linkLeadsBySourceDetail: true,
  },
  {
    id: 'EV-1003', companyId: APEX_ID, name: 'Dubai Business Breakfast', type: 'meeting', status: 'confirmed', isOrganizer: true,
    startIn: 6, days: 1, startTime: '08:00', endTime: '10:30', location: 'Jumeirah Emirates Towers, Ballroom B', budget: 12000,
    description: 'Breakfast briefing for hospitality and real-estate decision makers.',
    ownerId: 'u3', team: ['u6'], registrationOpen: true,
  },
  {
    id: 'EV-1004', companyId: APEX_ID, name: 'AI for Hotels Webinar', type: 'webinar', status: 'planned', isOrganizer: true,
    startIn: 21, days: 1, startTime: '14:00', endTime: '15:00', location: '', onlineUrl: 'https://meet.apexaora.example/ai-hotels', budget: 3000,
    description: 'Live demo of the guest chatbot with two hotel customers.',
    ownerId: 'u7', team: ['u12'], registrationOpen: true,
  },
  {
    id: 'EV-5001', companyId: CREST_ID, name: 'Saudi Logistics Expo 2026', type: 'exhibition', status: 'completed', isOrganizer: false,
    startIn: -45, days: 3, location: 'Riyadh Front Exhibition Center', budget: 120000, actualCost: 116500,
    description: 'Crest stand with the cold-chain and warehousing teams.',
    ownerId: 'u102', team: ['u104', 'u105'], registrationOpen: false, linkLeadsBySourceDetail: true,
  },
  {
    id: 'EV-5002', companyId: CREST_ID, name: 'Riyadh Supply Chain Forum 2026', type: 'conference', status: 'confirmed', isOrganizer: false,
    startIn: 12, days: 2, startTime: '09:00', endTime: '17:00', location: 'Hilton Riyadh Hotel & Residences', budget: 35000,
    description: 'Panel slot on last-mile logistics; meetings booked with retail distributors.',
    ownerId: 'u103', team: ['u104'], registrationOpen: true,
  },
  // Cross-event sections seed (data/eventSections.ts adds their attendees, captures, surveys, tickets, budget lines).
  {
    id: 'EV-1005', companyId: APEX_ID, name: 'Hospitality Leaders Roundtable', type: 'meeting', status: 'completed', isOrganizer: true,
    startIn: -75, days: 1, startTime: '09:00', endTime: '12:00', location: 'Address Downtown, Meeting Room 3', budget: 9000, actualCost: 8200,
    description: 'Invite-only roundtable for hotel GMs on guest messaging and AI concierge pilots.',
    ownerId: 'u7', team: ['u6', 'u5'], registrationOpen: false,
  },
  {
    id: 'EV-1006', companyId: APEX_ID, name: 'Smart Property AI Webinar', type: 'webinar', status: 'completed', isOrganizer: true,
    startIn: -1, days: 1, startTime: '16:00', endTime: '17:00', location: '', onlineUrl: 'https://meet.apexaora.example/smart-property', budget: 2500,
    description: 'Live session for brokers and developers: lead qualification bots and document OCR.',
    ownerId: 'u7', team: ['u4'], registrationOpen: false,
  },
  {
    id: 'EV-5003', companyId: CREST_ID, name: 'Jeddah Cold Chain Summit', type: 'conference', status: 'completed', isOrganizer: true,
    startIn: -90, days: 2, startTime: '09:00', endTime: '17:00', location: 'Jeddah Hilton, Al Bahr Ballroom', budget: 45000, actualCost: 47250,
    description: 'Exhibitor table and a talk on SFDA-compliant cold storage for pharma distributors.',
    ownerId: 'u103', team: ['u105'], registrationOpen: false,
  },
  {
    id: 'EV-5004', companyId: CREST_ID, name: 'Warehouse Automation Webinar', type: 'webinar', status: 'completed', isOrganizer: true,
    startIn: -1, days: 1, startTime: '11:00', endTime: '12:00', location: '', onlineUrl: 'https://meet.crestlogistics.example/automation', budget: 4000,
    description: 'Crest’s operations team on pick-to-light, WMS integration and slotting.',
    ownerId: 'u102', team: ['u104'], registrationOpen: false,
  },
  // Sponsors & exhibitors / Travel & logistics demo events (data/eventSponsors.ts, data/eventLogistics.ts).
  {
    id: 'EV-1101', companyId: APEX_ID, name: 'CES 2027', type: 'exhibition', status: 'confirmed', isOrganizer: false,
    startIn: 47, days: 4, location: 'Las Vegas Convention Center, North Hall', budget: 150000,
    description: 'Shared stand in the AI pavilion: chatbot and OCR demos for hotel and retail groups.',
    ownerId: 'u7', team: ['u4', 'u5'], registrationOpen: false,
  },
  {
    id: 'EV-5101', companyId: CREST_ID, name: 'Crest Cold-Chain Partner Day 2027', type: 'conference', status: 'planned', isOrganizer: true,
    startIn: 60, days: 1, startTime: '09:00', endTime: '17:00', location: 'Crest Logistics Park, Riyadh', budget: 90000,
    description: 'Crest’s own partner day: cold-chain roadmap, customer panels and an exhibitor area for partners.',
    ownerId: 'u102', team: ['u104'], registrationOpen: false,
  },
]

function seed(): void {
  let attendeeSeq = 0
  for (const s of SEED) {
    const tz = companyById(s.companyId)?.regional.timezone ?? 'Asia/Dubai'
    const today = todayIsoIn(tz)
    const startDate = addDaysIso(today, s.startIn)
    const endDate = addDaysIso(startDate, s.days - 1)
    const allDay = !s.startTime
    const startsAt = zonedToUtc(startDate, s.startTime ?? null, tz)
    const endsAt = zonedToUtc(endDate, s.endTime ?? null, tz)
    const createdAt = zonedToUtc(addDaysIso(startDate, -40), '10:00', tz)
    events.push({
      companyId: s.companyId,
      id: s.id,
      name: s.name,
      type: s.type,
      status: s.status,
      isOrganizer: s.isOrganizer,
      startsAt,
      endsAt,
      allDay,
      location: s.location,
      onlineUrl: s.onlineUrl ?? '',
      budget: s.budget,
      actualCost: s.actualCost ?? null,
      description: s.description,
      ownerId: s.ownerId,
      registrationOpen: s.registrationOpen,
      // Demo events get a stable token (same link after every reload of the seed); new events get a random one.
      registrationToken: seedRegistrationToken(s.id),
      capacity: null,
      questions: [],
      reminderHours: 24,
      followUpDays: 2,
      campaignId: null,
      followUpTasksAt: s.status === 'completed' ? endsAt : null,
      createdBy: s.ownerId,
      createdAt,
      updatedAt: createdAt,
    })
    for (const userId of [s.ownerId, ...s.team]) eventTeam.push({ companyId: s.companyId, eventId: s.id, userId, createdAt })
    eventHistory.push({ companyId: s.companyId, id: `EH-${s.id}-1`, eventId: s.id, at: createdAt, userId: s.ownerId, summary: 'Created the event' })
    if (!s.linkLeadsBySourceDetail) continue
    // Leads captured at the event (seed source detail = event name) become its attendees.
    for (const lead of leads.filter((l) => l.companyId === s.companyId && l.sourceDetail === s.name)) {
      ;(lead as { eventId?: string | null }).eventId = s.id
      const primary = contacts.find((c) => c.leadId === lead.id)
      const registeredAt = startsAt
      const attendeeId = `EA-${s.id.slice(3)}-${++attendeeSeq}`
      eventAttendees.push({
        companyId: s.companyId,
        id: attendeeId,
        eventId: s.id,
        name: primary?.name || lead.contactName || lead.company,
        companyName: lead.company,
        email: (primary?.email || lead.contactEmail || '').toLowerCase(),
        mobile: primary?.mobile || lead.mobile || '',
        title: primary?.title ?? '',
        leadId: lead.id,
        leadOutcome: 'created',
        source: 'manual',
        sourceDetail: 'Captured on the stand',
        registeredAt,
        checkedInAt: s.status === 'completed' ? registeredAt : null,
        checkedInBy: s.status === 'completed' ? s.ownerId : null,
        createdBy: s.ownerId,
        status: 'registered',
        ticketTypeId: null,
        answers: {},
        waitlistedAt: null,
        cancelledAt: null,
        ticketCode: seedTicketCode(attendeeId),
        surveyToken: seedSurveyToken(attendeeId),
        reminderSentAt: s.status === 'completed' ? registeredAt : null,
      })
    }
  }
}

seed()
