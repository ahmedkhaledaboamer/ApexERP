import type { Task } from '@/modules/tasks/types'
import type { CaptureRating, EventTemplateTask, EventType, RegistrationQuestion } from '@/modules/events/types'
import { planChecklist } from '@/modules/events/lib/checklistPlan'
import { contacts, leads, users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { eventAttendees, eventBudgetLines, events, eventTeam, eventTicketTypes, type BudgetCategory, seedSurveyToken, seedTicketCode, type AttendeeRecord } from '@/shared/mocks/data/events'
import { tasks } from '@/shared/mocks/data/tasks'
import { registerArray } from '@/shared/mocks/persist/registry'
import { zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { addDaysIso } from '@/shared/lib/companyDay'
import type { Tenant } from '@/shared/mocks/tenant'
import { speakerDirectory } from '@/shared/mocks/data/eventLibrary'
import { migrateLegacySpeakers, type LegacySpeakerRow } from '@/shared/mocks/services/speakerMigration'

/**
 * Stores of the advanced Events features (docs/API.md › Events; DB-ALIGNMENT › Design gaps › Events):
 * event_templates (+ their tasks). Every row carries its company. Seeded per company (different data).
 */

export interface EventTemplateRecord {
  id: string
  name: string
  eventType: EventType
  defaultDurationDays: number
  tasks: EventTemplateTask[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export const eventTemplates = registerArray<Tenant<EventTemplateRecord>>('eventTemplates', [])

/**
 * event_speakers: the event's speaker roster — a link (event_id, speaker_id) to the company's speaker
 * directory (data/eventLibrary.ts `speakerDirectory`). Before the directory these rows held the person
 * per event; the seed migrates them (services/speakerMigration.ts).
 */
export interface EventSpeakerRecord {
  id: string
  eventId: string
  speakerId: string
  createdAt: string
}

/** event_sessions: agenda items (UTC instants; shown in the company's timezone). */
export interface EventSessionRecord {
  id: string
  eventId: string
  title: string
  startsAt: string
  endsAt: string
  room: string
  description: string
  speakerIds: string[]
  createdAt: string
}

/** event_captures: booth lead captures (the attendee + lead they made or linked, the interest rating). */
export interface EventCaptureRecord {
  id: string
  eventId: string
  attendeeId: string
  leadId: string | null
  rating: CaptureRating
  notes: string
  cardPhotoUrl: string
  capturedBy: string
  capturedAt: string
}

export const eventCaptures = registerArray<Tenant<EventCaptureRecord>>('eventCaptures', [])

/** event_survey_responses: one feedback answer per attendee (rating 1–5, NPS 0–10, comment). */
export interface SurveyResponseRecord {
  id: string
  eventId: string
  attendeeId: string
  rating: number
  nps: number
  comment: string
  submittedAt: string
}

export const eventSurveyResponses = registerArray<Tenant<SurveyResponseRecord>>('eventSurveyResponses', [])
export const eventSpeakers = registerArray<Tenant<EventSpeakerRecord>>('eventSpeakers', [])
export const eventSessions = registerArray<Tenant<EventSessionRecord>>('eventSessions', [])

/* ---------------- Seed ---------------- */

const SEED_AT = '2026-01-15T08:00:00.000Z'

type T = [title: string, offsetDays: number, role: EventTemplateTask['role'], priority: EventTemplateTask['priority']]
const tpl = (companyId: string, id: string, name: string, eventType: EventType, days: number, list: T[]): Tenant<EventTemplateRecord> => ({
  companyId,
  id,
  name,
  eventType,
  defaultDurationDays: days,
  tasks: list.map(([title, offsetDays, role, priority], i) => ({ id: `${id}-T${i + 1}`, title, offsetDays, role, priority })),
  createdBy: null,
  createdAt: SEED_AT,
  updatedAt: SEED_AT,
})

eventTemplates.push(
  tpl(APEX_ID, 'ETP-1001', 'Exhibition stand', 'exhibition', 3, [
    ['Book the stand and confirm the floor plan', -60, 'owner', 'high'],
    ['Order banners, brochures and giveaways', -21, 'Marketing Manager', 'medium'],
    ['Book demo laptops and screens', -10, 'owner', 'medium'],
    ['Schedule meetings with key prospects', -7, 'Sales Agent', 'high'],
    ['Brief the stand team', -2, 'owner', 'medium'],
    ['Import the badge scans and captured leads', 1, 'Sales Agent', 'urgent'],
  ]),
  tpl(APEX_ID, 'ETP-1002', 'Breakfast briefing', 'meeting', 1, [
    ['Confirm venue, menu and AV', -14, 'owner', 'high'],
    ['Send invitations to the guest list', -10, 'Marketing Manager', 'high'],
    ['Print name badges and agenda cards', -1, 'owner', 'medium'],
    ['Send the thank-you email with the slides', 1, 'Marketing Manager', 'medium'],
  ]),
  tpl(CREST_ID, 'ETP-5001', 'Trade show booth', 'exhibition', 3, [
    ['Reserve the booth and shipping slot', -45, 'owner', 'high'],
    ['Prepare cold-chain demo kit', -14, 'Sales Manager', 'medium'],
    ['Set up meetings with procurement heads', -7, 'Sales Agent', 'high'],
    ['Distribute captured leads to account managers', 2, 'Sales Manager', 'urgent'],
  ]),
  tpl(CREST_ID, 'ETP-5002', 'Conference panel', 'conference', 2, [
    ['Send the panel bio and headshot', -21, 'owner', 'medium'],
    ['Draft talking points', -7, 'owner', 'high'],
    ['Post the session recap on LinkedIn', 1, 'Marketing Manager', 'low'],
  ]),
)

/**
 * The seed applies one template to an upcoming event per company (the Checklist tab has content).
 * Task ids are their own block (TK-E…) so the shared task counter (and other seed ids) don't shift.
 */
function seedChecklist(eventId: string, templateId: string, doneCount: number): void {
  const e = events.find((x) => x.id === eventId)
  const t = eventTemplates.find((x) => x.id === templateId)
  if (!e || !t || !e.ownerId) return
  const ownerId = e.ownerId
  const co = companyById(e.companyId)
  const team = eventTeam
    .filter((m) => m.eventId === e.id && m.companyId === e.companyId)
    .map((m) => users.find((u) => u.id === m.userId && u.companyId === e.companyId))
    .filter((u): u is NonNullable<typeof u> => !!u)
  const plan = planChecklist(t, {
    startDate: zonedParts(e.startsAt, co?.regional.timezone ?? 'Asia/Dubai').date,
    weekend: co?.regional.weekend ?? [0, 6],
    ownerId: e.ownerId,
    team,
  })
  plan.forEach((p, i) => {
    const done = i < doneCount
    const task: Tenant<Task> = {
      companyId: e.companyId,
      id: `TK-E${e.id.slice(3)}-${i + 1}`,
      title: p.title,
      description: `Prep checklist · from the “${t.name}” event template`,
      ownerId: p.ownerId,
      followerIds: [],
      priority: p.priority,
      dueDate: p.dueDate,
      status: done ? 'done' : 'todo',
      link: { type: 'event', id: e.id },
      projectId: null,
      parentTaskId: null,
      estimatedHours: 0,
      templateTaskId: p.templateTaskId,
      dayOffset: p.offsetDays,
      sortOrder: i + 1,
      blockedAt: null,
      blockedReason: null,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      attachments: [],
      comments: [],
      history: [{ id: `TK-E${e.id.slice(3)}-${i + 1}-h0`, kind: 'created', userId: ownerId, at: e.createdAt, summary: `Created from the “${t.name}” event template` }],
      createdBy: ownerId,
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
      completedAt: done ? e.createdAt : null,
    }
    tasks.push(task)
  })
}

seedChecklist('EV-1003', 'ETP-1002', 2)
seedChecklist('EV-5002', 'ETP-5002', 1)

/* ---- Agenda seed: speakers + sessions on an upcoming event per company (different content). ---- */

type SeedSession = [title: string, dayIndex: number, start: string, end: string, room: string, speakers: number[], description: string]
/**
 * The agenda seed is written the old way (a speaker copy per event) and then migrated into the speaker
 * directory exactly like saved data would be (dedupe by email / name + company; sessions re-pointed).
 */
const legacySpeakers: LegacySpeakerRow[] = []
const directorySeq: Record<string, number> = {}
const directoryId = (companyId: string) => {
  directorySeq[companyId] = (directorySeq[companyId] ?? 0) + 1
  return `SPK-${companyId === CREST_ID ? 5000 + directorySeq[companyId] : 1000 + directorySeq[companyId]}`
}
function seedAgenda(eventId: string, speakers: [name: string, title: string, company: string, bio: string, email?: string][], sessions: SeedSession[]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e) return
  const tz = companyById(e.companyId)?.regional.timezone ?? 'Asia/Dubai'
  const startDate = zonedParts(e.startsAt, tz).date
  const ids = speakers.map(([name, title, company, bio, email], i) => {
    const id = `ESP-${e.id.slice(3)}-${i + 1}`
    legacySpeakers.push({ companyId: e.companyId, id, eventId: e.id, name, title, company, bio, photoUrl: '', email, createdAt: e.createdAt })
    return id
  })
  sessions.forEach(([title, day, start, end, room, who, description], i) => {
    const date = addDaysIso(startDate, day)
    eventSessions.push({
      companyId: e.companyId,
      id: `ESS-${e.id.slice(3)}-${i + 1}`,
      eventId: e.id,
      title,
      startsAt: zonedToUtc(date, start, tz),
      endsAt: zonedToUtc(date, end, tz),
      room,
      description,
      speakerIds: who.map((k) => ids[k]),
      createdAt: e.createdAt,
    })
  })
}

seedAgenda(
  'EV-1003',
  [
    ['Rania Haddad', 'Head of Guest Experience', 'Marina Bay Hotels', 'Runs guest experience for 12 hotels across the UAE.'],
    ['Omar Farouk', 'Solutions Lead', 'Apex Aora', 'Builds AI assistants for hospitality and real estate.'],
  ],
  [
    ['Welcome breakfast', 0, '08:00', '08:30', 'Ballroom B', [], 'Coffee and networking.'],
    ['AI concierge in practice', 0, '08:30', '09:15', 'Ballroom B', [0, 1], 'How Marina Bay cut response times with a guest chatbot.'],
    ['Live demo and Q&A', 0, '09:20', '10:15', 'Ballroom B', [1], 'The OCR and chatbot products, live.'],
  ],
)
seedAgenda(
  'EV-5002',
  [
    ['Faisal Al Harbi', 'VP Supply Chain', 'Najd Retail Group', 'Leads distribution for 140 stores in the Kingdom.'],
    ['Lina Al Saud', 'Head of Operations', 'Crest Logistics', 'Runs Crest’s cold-chain network.'],
    ['Daniel Brooks', 'Analyst', 'Gulf Freight Insights', 'Writes the quarterly GCC freight outlook.'],
  ],
  [
    ['Opening keynote: the 2027 freight outlook', 0, '09:00', '09:45', 'Main hall', [2], 'Rates, capacity and what changes next year.'],
    ['Panel: last-mile logistics in Riyadh', 0, '10:00', '11:00', 'Main hall', [0, 1], 'Crest’s panel slot with retail distributors.'],
    ['Workshop: cold-chain compliance', 0, '10:00', '11:30', 'Room 2', [1], 'SFDA rules for temperature-controlled storage.'],
    ['Buyer meetings', 1, '09:30', '12:30', 'Meeting lounge', [], 'Pre-booked meetings with procurement heads.'],
  ],
)
// The same people on other events (written per event, as before the directory): the migration dedupes them.
seedAgenda(
  'EV-1001',
  [['Omar Farouk', 'Solutions Lead', 'Apex Aora', '', 'omar.farouk@apex-speakers.example']],
  [['Stand talk: OCR in practice', 1, '11:00', '11:30', 'Stand B12', [0], 'Fifteen-minute demo on the stand, twice a day.']],
)
seedAgenda(
  'EV-1004',
  [
    ['OMAR  FAROUK', 'Solutions Lead', 'apex aora', 'Builds AI assistants for hospitality and real estate.'],
    ['Marco Bellini', 'General Manager', 'Palm Shore Resort', 'Runs a 300-key resort on the Palm.'],
  ],
  [['Live demo: the guest chatbot', 0, '14:00', '14:40', '', [0, 1], 'A live guest conversation, then questions.']],
)
seedAgenda(
  'EV-5001',
  [['Lina Al Saud', 'Head of Operations', 'Crest Logistics', '']],
  [['Booth briefing: cold-chain tour', 1, '10:00', '10:30', 'Booth 21', [0], 'Walk-through of the reefer demo unit.']],
)
{
  const migrated = migrateLegacySpeakers(legacySpeakers, speakerDirectory, directoryId)
  speakerDirectory.push(...migrated.added)
  migrated.links.forEach((l, i) => eventSpeakers.push({ ...l, id: `ESP-${l.eventId.slice(3)}-L${i + 1}` }))
  for (const s of eventSessions) s.speakerIds = s.speakerIds.map((id) => migrated.idMap.get(id) ?? id)
}
/* ---- Tickets, capacity, questions, registrations and a waitlist (upcoming events; different per company). ---- */

type SeedTicket = [name: string, capacity: number | null, price: number]
type SeedReg = [ticket: number, status: AttendeeRecord['status'], answers: Record<string, string | string[]>]
function seedRegistrations(eventId: string, capacity: number | null, questions: RegistrationQuestion[], ticketsIn: SeedTicket[], regs: SeedReg[]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e) return
  e.capacity = capacity
  e.questions = questions
  const ticketIds = ticketsIn.map(([name, cap, price], i) => {
    const id = `ETK-${e.id.slice(3)}-${i + 1}`
    eventTicketTypes.push({ companyId: e.companyId, id, eventId: e.id, name, capacity: cap, price, salesOpen: null, salesClose: null, sortOrder: i + 1, createdAt: e.createdAt })
    return id
  })
  // Registrations link existing leads of the company (open leads with an email), oldest first.
  const pool = leads.filter((l) => l.companyId === e.companyId && l.contactEmail && !l.doNotContact && !eventAttendees.some((a) => a.leadId === l.id)).slice(12, 12 + regs.length)
  regs.forEach(([ticket, status, answers], i) => {
    const lead = pool[i]
    if (!lead) return
    const primary = contacts.find((x) => x.leadId === lead.id)
    const id = `EA-${e.id.slice(3)}-R${i + 1}`
    const at = new Date(Date.parse(e.createdAt) + (i + 1) * 3_600_000).toISOString()
    eventAttendees.push({
      companyId: e.companyId,
      id,
      eventId: e.id,
      name: primary?.name || lead.contactName || lead.company,
      companyName: lead.company,
      email: (primary?.email || lead.contactEmail).toLowerCase(),
      mobile: primary?.mobile || lead.mobile || '',
      title: primary?.title ?? '',
      leadId: lead.id,
      leadOutcome: 'linked',
      source: i % 2 ? 'manual' : 'public',
      sourceDetail: i % 2 ? 'Added by the team' : 'Public registration page',
      registeredAt: at,
      checkedInAt: null,
      checkedInBy: null,
      createdBy: i % 2 ? e.ownerId : null,
      status,
      ticketTypeId: ticketIds[ticket] ?? null,
      answers,
      waitlistedAt: status === 'waitlisted' ? at : null,
      cancelledAt: null,
      ticketCode: seedTicketCode(id),
      surveyToken: seedSurveyToken(id),
      reminderSentAt: null,
    })
  })
}

seedRegistrations(
  'EV-1004',
  50,
  [
    { id: 'q-role', label: 'Your role', type: 'single', options: ['Owner / GM', 'Operations', 'IT', 'Other'], required: true },
    { id: 'q-topics', label: 'Topics you’d like covered', type: 'multi', options: ['Guest chatbot', 'OCR for invoices', 'Analytics'], required: false },
  ],
  [
    ['Live seat', 45, 0],
    ['Live + workshop', 2, 250],
  ],
  [
    [0, 'registered', { 'q-role': 'Owner / GM', 'q-topics': ['Guest chatbot'] }],
    [0, 'registered', { 'q-role': 'Operations' }],
    [1, 'registered', { 'q-role': 'IT', 'q-topics': ['Analytics'] }],
    [1, 'registered', { 'q-role': 'Operations' }],
    [1, 'waitlisted', { 'q-role': 'Other' }],
  ],
)
seedRegistrations(
  'EV-5002',
  120,
  [{ id: 'q-size', label: 'Company size', type: 'single', options: ['1–50', '51–250', '251–1000', '1000+'], required: true }],
  [
    ['Delegate', 100, 1500],
    ['Exhibitor pass', 1, 0],
  ],
  [
    [0, 'registered', { 'q-size': '251–1000' }],
    [0, 'registered', { 'q-size': '1000+' }],
    [1, 'registered', { 'q-size': '51–250' }],
    [1, 'waitlisted', { 'q-size': '1–50' }],
  ],
)
/* ---- Booth captures with ratings on the completed exhibitions (stand leads), per company. ---- */

function seedCaptures(eventId: string, ratings: CaptureRating[], notes: string[]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e) return
  const team = eventTeam.filter((m) => m.eventId === e.id && m.companyId === e.companyId).map((m) => m.userId)
  eventAttendees
    .filter((a) => a.eventId === e.id && a.companyId === e.companyId)
    .forEach((a, i) => {
      eventCaptures.push({
        companyId: e.companyId,
        id: `ECP-${e.id.slice(3)}-${i + 1}`,
        eventId: e.id,
        attendeeId: a.id,
        leadId: a.leadId,
        rating: ratings[i % ratings.length],
        notes: notes[i % notes.length],
        cardPhotoUrl: '',
        capturedBy: team[i % team.length] ?? e.ownerId ?? '',
        capturedAt: a.registeredAt,
      })
    })
}

seedCaptures('EV-1001', ['hot', 'warm', 'cold', 'hot'], ['Wants a demo next week.', 'Comparing vendors.', '', 'Budget approved for Q1.'])
seedCaptures('EV-5001', ['warm', 'hot', 'cold'], ['Needs cold-chain capacity in Jeddah.', 'Asked for a quote.', 'Just browsing.'])
/* ---- Survey answers on the completed exhibitions (different per company). ---- */

function seedSurvey(eventId: string, answers: [rating: number, nps: number, comment: string][]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e) return
  const atts = eventAttendees.filter((a) => a.eventId === e.id && a.companyId === e.companyId && a.status === 'registered')
  answers.forEach(([rating, nps, comment], i) => {
    const a = atts[i]
    if (!a) return
    eventSurveyResponses.push({ companyId: e.companyId, id: `ESR-${e.id.slice(3)}-${i + 1}`, eventId: e.id, attendeeId: a.id, rating, nps, comment, submittedAt: e.endsAt ?? e.startsAt })
  })
}

seedSurvey('EV-1001', [
  [5, 10, 'The OCR demo was exactly what we needed.'],
  [4, 9, ''],
  [3, 6, 'Stand was too crowded to talk.'],
])
seedSurvey('EV-5001', [
  [4, 8, 'Good cold-chain overview.'],
  [5, 10, 'Very helpful team.'],
])
/* ---- Budget lines on the completed exhibitions: their actuals add up to the event's actual cost. ---- */

function seedBudget(eventId: string, lines: [category: BudgetCategory, planned: number, actual: number, note: string][]): void {
  const e = events.find((x) => x.id === eventId)
  if (!e) return
  lines.forEach(([category, planned, actual, note], i) => {
    eventBudgetLines.push({ companyId: e.companyId, id: `EBL-${e.id.slice(3)}-${i + 1}`, eventId: e.id, category, note, planned, actual, createdAt: e.createdAt, updatedAt: e.createdAt })
  })
}

seedBudget('EV-1001', [
  ['venue', 50000, 52000, 'Stand B12, 36 m²'],
  ['travel', 8000, 6800, ''],
  ['printing', 5000, 4450, 'Brochures and roll-ups'],
  ['marketing', 12000, 9000, 'Pre-show LinkedIn ads'],
  ['catering', 10000, 7000, 'Coffee bar on the stand'],
])
seedBudget('EV-5001', [
  ['venue', 80000, 78000, 'Booth 21 + build'],
  ['sponsorship', 20000, 20000, 'Lanyard sponsor'],
  ['travel', 12000, 12500, 'Team of 6 from Jeddah'],
  ['printing', 8000, 6000, ''],
])