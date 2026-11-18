import type { AttendeeSource, EventStatus, EventType, LeadOutcome } from '@/modules/events/types'
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
  onlineUrl: string
  budget: number | null
  actualCost: number | null
  description: string
  ownerId: string | null
  registrationOpen: boolean
  /** Public registration link token (/e/:token); letters only, globally unique. */
  registrationToken: string
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
  createdBy: string | null
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

export const events = registerArray<Tenant<EventRecord>>('events', [])
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
      eventAttendees.push({
        companyId: s.companyId,
        id: `EA-${s.id.slice(3)}-${++attendeeSeq}`,
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
        createdBy: s.ownerId,
      })
    }
  }
}

seed()
