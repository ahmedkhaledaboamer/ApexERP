import type { Activity, Lead } from '@/shared/types'
import type { CaptureRating } from '@/modules/events/types'
import { activities, contacts, leads } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { isLostStatus, isWonStatus } from '@/shared/mocks/data/lookups'
import { eventAttendees, eventBudgetLines, events, eventTeam, eventTicketTypes, seedSurveyToken, seedTicketCode, type AttendeeRecord, type BudgetCategory } from '@/shared/mocks/data/events'
import { eventCaptures, eventSurveyResponses } from '@/shared/mocks/data/eventExtras'
import { registerArray } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Cross-event sections (Attendees directory, Booth leads, Event analytics; docs/API.md › Events).
 *
 * Store: `event_capture_follow_up_notices` — the overdue booth follow-up notice sent to the lead owner,
 * ONCE per capture (like tasks.overdue_notified_at). A separate table so the capture row keeps its shape.
 *
 * Seed (synthetic, different per company): data/events.ts adds two more completed events per company
 * (EV-1005 / EV-1006, EV-5003 / EV-5004: a meeting or conference and a webinar held yesterday); this
 * module gives them repeat attendees from the company's first exhibition, new people, no-shows, a Do Not
 * Contact person, ticket types, survey answers, budget lines and booth captures whose leads were followed
 * up in different ways (a call → contacted, a meeting → meeting, won, lost, untouched: overdue for the
 * older event, still within the follow-up window for yesterday's webinar).
 */

export interface CaptureFollowUpNotice {
  captureId: string
  /** When the notice was handled (sent to the owner, or skipped: no active owner). */
  notifiedAt: string
  userId: string | null
}

export const captureFollowUpNotices = registerArray<Tenant<CaptureFollowUpNotice>>('eventCaptureFollowUpNotices', [])

/* ---------------- Seed ---------------- */

type Who = 'repeat' | 'won' | 'lost' | 'dnc' | 'open'
interface SeedPerson {
  who: Who
  checkedIn: boolean
  capture?: { rating: CaptureRating; notes: string; afterHours: number; follow?: { type: Activity['type']; afterDays: number; summary: string } }
  survey?: [rating: number, nps: number, comment: string]
}
interface SeedSection {
  eventId: string
  ticket: [name: string, price: number]
  lines?: [category: BudgetCategory, planned: number, actual: number][]
  people: SeedPerson[]
}

const SEED: SeedSection[] = [
  {
    eventId: 'EV-1005',
    ticket: ['Guest', 0],
    people: [
      { who: 'repeat', checkedIn: true, capture: { rating: 'hot', notes: 'Wants the concierge pilot for two hotels.', afterHours: 1, follow: { type: 'meeting', afterDays: 3, summary: 'Pilot scoping meeting with the GM.' } }, survey: [5, 10, 'Great format, very practical.'] },
      { who: 'repeat', checkedIn: true, survey: [4, 8, ''] },
      { who: 'won', checkedIn: true, capture: { rating: 'hot', notes: 'Ready to sign after the demo.', afterHours: 2 }, survey: [5, 9, 'Signed up the same week.'] },
      { who: 'lost', checkedIn: true, capture: { rating: 'cold', notes: 'Locked into another vendor until 2027.', afterHours: 2 } },
      { who: 'open', checkedIn: true, capture: { rating: 'warm', notes: 'Asked for case studies.', afterHours: 1, follow: { type: 'call', afterDays: 1, summary: 'Called to share two case studies.' } }, survey: [3, 6, 'Too short for questions.'] },
      { who: 'open', checkedIn: true, capture: { rating: 'warm', notes: 'Follow up about Arabic support.', afterHours: 3 } },
      { who: 'dnc', checkedIn: true },
      { who: 'open', checkedIn: false },
    ],
  },
  {
    eventId: 'EV-1006',
    ticket: ['Live seat', 0],
    people: [
      { who: 'repeat', checkedIn: true, survey: [4, 9, 'Useful follow-on from the roundtable.'] },
      { who: 'open', checkedIn: true, capture: { rating: 'hot', notes: 'Asked for a proposal for 3 sales offices.', afterHours: 1 } },
      { who: 'open', checkedIn: true, capture: { rating: 'warm', notes: 'Send the OCR pricing.', afterHours: 1, follow: { type: 'email', afterDays: 0, summary: 'Sent the OCR pricing sheet.' } }, survey: [4, 7, ''] },
      { who: 'open', checkedIn: false },
      { who: 'open', checkedIn: true },
    ],
  },
  {
    eventId: 'EV-5003',
    ticket: ['Delegate', 900],
    lines: [
      ['venue', 25000, 26500],
      ['travel', 9000, 10250],
      ['printing', 4000, 3500],
      ['catering', 7000, 7000],
    ],
    people: [
      { who: 'repeat', checkedIn: true, capture: { rating: 'warm', notes: 'Needs reefer trucks for Q2.', afterHours: 4, follow: { type: 'call', afterDays: 2, summary: 'Call: confirmed Q2 volumes.' } }, survey: [4, 9, 'Strong pharma content.'] },
      { who: 'won', checkedIn: true, capture: { rating: 'hot', notes: 'Tender coming next month.', afterHours: 3 }, survey: [5, 10, ''] },
      { who: 'lost', checkedIn: true, capture: { rating: 'cold', notes: 'Prefers in-house fleet.', afterHours: 5 } },
      { who: 'open', checkedIn: true, capture: { rating: 'hot', notes: 'Wants a warehouse visit in Jeddah.', afterHours: 2, follow: { type: 'meeting', afterDays: 5, summary: 'Site visit at the Jeddah warehouse.' } }, survey: [3, 5, 'Hard to find the stand.'] },
      { who: 'open', checkedIn: true, capture: { rating: 'warm', notes: 'Call back after Ramadan.', afterHours: 6 } },
      { who: 'open', checkedIn: false },
    ],
  },
  {
    eventId: 'EV-5004',
    ticket: ['Attendee', 0],
    people: [
      { who: 'repeat', checkedIn: true, survey: [5, 9, 'Clear and practical.'] },
      { who: 'repeat', checkedIn: false },
      { who: 'open', checkedIn: true, capture: { rating: 'hot', notes: 'Wants a WMS integration estimate.', afterHours: 1 } },
      { who: 'open', checkedIn: true, capture: { rating: 'cold', notes: 'Student, no buying role.', afterHours: 1, follow: { type: 'whatsapp', afterDays: 0, summary: 'WhatsApp: shared the recording.' } } },
    ],
  },
]

/** Early, open statuses: the seeded follow-up activity decides the state. */
const EARLY = new Set(['New', 'Contacted', 'No response', 'Call later', 'Interested', 'Cold'])
const firstExhibition: Record<string, string> = { [APEX_ID]: 'EV-1001', [CREST_ID]: 'EV-5001' }

function seedSections(): void {
  let activitySeq = 0
  for (const s of SEED) {
    const e = events.find((x) => x.id === s.eventId)
    if (!e || eventTicketTypes.some((t) => t.eventId === e.id && t.companyId === e.companyId)) continue
    const co = e.companyId
    const startsAt = e.startsAt
    const endsAt = e.endsAt ?? e.startsAt
    const ticketId = `ETK-${e.id.slice(3)}-1`
    eventTicketTypes.push({ companyId: co, id: ticketId, eventId: e.id, name: s.ticket[0], capacity: null, price: s.ticket[1], salesOpen: null, salesClose: null, sortOrder: 1, createdAt: e.createdAt })
    ;(s.lines ?? []).forEach(([category, planned, actual], i) =>
      eventBudgetLines.push({ companyId: co, id: `EBL-${e.id.slice(3)}-${i + 1}`, eventId: e.id, category, note: '', planned, actual, createdAt: e.createdAt, updatedAt: e.createdAt }),
    )
    const team = eventTeam.filter((m) => m.eventId === e.id && m.companyId === co).map((m) => m.userId)

    // People: repeats come from the first exhibition (same email → same person), the rest are company leads
    // not yet at any event (a won one, a lost one, one flagged Do Not Contact, early open ones).
    const taken = new Set(eventAttendees.filter((a) => a.companyId === co && a.leadId).map((a) => a.leadId as string))
    const repeats = eventAttendees.filter((a) => a.companyId === co && a.eventId === firstExhibition[co] && a.leadId && a.email)
    let repeatIdx = 0
    const free = (pred: (l: Tenant<Lead>) => boolean) => leads.find((l) => l.companyId === co && l.contactEmail && !taken.has(l.id) && pred(l))
    const quiet = (l: Tenant<Lead>) => !activities.some((a) => a.companyId === co && a.leadId === l.id && a.at > startsAt)
    s.people.forEach((p, i) => {
      let lead: Tenant<Lead> | undefined
      let prev: Tenant<AttendeeRecord> | undefined
      let outcome: AttendeeRecord['leadOutcome'] = 'created'
      if (p.who === 'repeat') {
        prev = repeats[repeatIdx++]
        lead = prev ? leads.find((l) => l.id === prev!.leadId && l.companyId === co) : undefined
        outcome = 'linked'
      } else if (p.who === 'won') lead = free((l) => isWonStatus(co, l.status) && !l.doNotContact)
      else if (p.who === 'lost') lead = free((l) => isLostStatus(co, l.status) && !l.doNotContact)
      else if (p.who === 'dnc') lead = free((l) => l.doNotContact) ?? free((l) => EARLY.has(l.status))
      else lead = free((l) => !l.doNotContact && EARLY.has(l.status) && quiet(l))
      if (!lead) return
      if (p.who !== 'repeat') taken.add(lead.id)
      const primary = contacts.find((c) => c.leadId === lead.id)
      if (outcome === 'created' && !(lead as { eventId?: string | null }).eventId) (lead as { eventId?: string | null }).eventId = e.id
      const id = `EA-${e.id.slice(3)}-S${i + 1}`
      const capturedAt = p.capture ? new Date(Date.parse(startsAt) + p.capture.afterHours * 3_600_000).toISOString() : null
      const registeredAt = capturedAt ?? new Date(Date.parse(startsAt) - (10 - i) * 86_400_000).toISOString()
      const checkedInAt = capturedAt ?? (p.checkedIn ? new Date(Date.parse(startsAt) + (i + 1) * 300_000).toISOString() : null)
      eventAttendees.push({
        companyId: co,
        id,
        eventId: e.id,
        name: prev?.name || primary?.name || lead.contactName || lead.company,
        companyName: lead.company,
        email: (prev?.email || primary?.email || lead.contactEmail || '').toLowerCase(),
        mobile: prev?.mobile || primary?.mobile || lead.mobile || '',
        title: prev?.title || primary?.title || '',
        leadId: lead.id,
        leadOutcome: outcome,
        source: p.capture ? 'capture' : i % 2 ? 'public' : 'manual',
        sourceDetail: p.capture ? 'Captured at the event' : i % 2 ? 'Public registration page' : 'Added by the team',
        registeredAt,
        checkedInAt,
        checkedInBy: checkedInAt ? e.ownerId : null,
        createdBy: e.ownerId,
        status: 'registered',
        ticketTypeId: ticketId,
        answers: {},
        waitlistedAt: null,
        cancelledAt: null,
        ticketCode: seedTicketCode(id),
        surveyToken: seedSurveyToken(id),
        reminderSentAt: registeredAt,
      })
      if (p.survey) {
        const [rating, nps, comment] = p.survey
        eventSurveyResponses.push({ companyId: co, id: `ESR-${e.id.slice(3)}-S${i + 1}`, eventId: e.id, attendeeId: id, rating, nps, comment, submittedAt: endsAt })
      }
      if (p.capture && capturedAt) {
        eventCaptures.push({
          companyId: co,
          id: `ECP-${e.id.slice(3)}-S${i + 1}`,
          eventId: e.id,
          attendeeId: id,
          leadId: lead.id,
          rating: p.capture.rating,
          notes: p.capture.notes,
          cardPhotoUrl: '',
          capturedBy: team[i % team.length] ?? e.ownerId ?? '',
          capturedAt,
        })
        if (p.capture.follow) {
          const at = Date.parse(capturedAt) + Math.max(1, p.capture.follow.afterDays * 24) * 3_600_000
          activities.push({
            companyId: co,
            id: `A-EVS-${e.id.slice(3)}-${++activitySeq}`,
            leadId: lead.id,
            type: p.capture.follow.type,
            summary: p.capture.follow.summary,
            userId: lead.ownerId,
            at: new Date(Math.min(at, Date.now() - 60_000)).toISOString(),
          })
        }
      }
    })
  }
}

seedSections()
