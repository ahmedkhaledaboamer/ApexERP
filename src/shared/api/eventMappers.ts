import { defineMapper } from './mapping'
import type {
  ApplyTemplateResult,
  EventBudget,
  PublicSurvey,
  SurveyResults,
  FollowUpResult,
  CaptureResult,
  EventCapture,
  LeaderboardRow,
  EventEmailLog,
  CheckInResult,
  CheckInSummary,
  PublicTicket,
  CancelRegistrationResult,
  TicketType,
  EventAgenda,
  EventSession,
  EventSpeaker,
  EventChecklist,
  EventTemplate,
  EventTemplateInput,
  Attendee,
  AttendeeImportResult,
  AttendeeImportRow,
  AttendeeInput,
  EventDetail,
  EventHistoryEntry,
  EventInput,
  EventRow,
  EventStats,
  EventTeamMember,
  PublicEventInfo,
  PublicRegistrationInput,
  PublicRegistrationResult,
  RegistrationResult,
} from '@/modules/events/types'

/**
 * Events (DB design §13: `events`, `event_team`, `event_attendees`). Every UI key is the column's
 * plain snake_case (owner_id, starts_at, is_organizer, actual_cost, company_name, lead_id…), so the
 * mappers only declare nested resources. Columns the design lacks are listed in docs/DB-ALIGNMENT.md
 * (Design gaps › Events): online_url, currency, registration_open / registration_token, checked_in_at
 * (design: `attended` bool), title, source, source_detail, lead_outcome.
 */
export const eventTeamMapper = defineMapper<EventTeamMember>()
export const eventHistoryMapper = defineMapper<EventHistoryEntry>()

export const eventMapper = defineMapper<EventRow & EventDetail>({
  nested: { team: eventTeamMapper as never, history: eventHistoryMapper as never },
})

/** POST /events, PATCH /events/:id. */
export const eventInputMapper = defineMapper<EventInput>()

export const attendeeMapper = defineMapper<Attendee>()
export const attendeeInputMapper = defineMapper<AttendeeInput>()

/** POST /events/:id/attendees: the attendee plus what happened to the lead (`limit_reached` keeps the 402 envelope's shape). */
export const registrationMapper = defineMapper<RegistrationResult>({ nested: { attendee: attendeeMapper as never }, opaque: ['limitReached'] })

export const attendeeImportRowMapper = defineMapper<AttendeeImportRow>()
export const attendeeImportMapper = defineMapper<{ rows: AttendeeImportRow[]; fileName?: string }>({ nested: { rows: attendeeImportRowMapper as never } })
export const attendeeImportResultMapper = defineMapper<AttendeeImportResult>({ nested: { failed: defineMapper() as never }, opaque: ['limitReached'] })

export const eventStatsMapper = defineMapper<EventStats>()

export const publicEventMapper = defineMapper<PublicEventInfo>({ deep: true })
export const publicRegistrationMapper = defineMapper<PublicRegistrationInput & PublicRegistrationResult>()

/**
 * Advanced features (templates, agenda, tickets, check-in, captures, survey, budget): plain snake_case
 * at any depth (`deep`). `answers` (keyed by question id) keeps its keys and values.
 */
const deepMapper = <T>() => defineMapper<T>({ deep: true, opaque: ['answers'] })

export const eventTemplateMapper = deepMapper<EventTemplate>()
export const eventTemplateInputMapper = deepMapper<EventTemplateInput>()
export const checklistMapper = deepMapper<EventChecklist>()
export const agendaMapper = deepMapper<EventAgenda>()
export const sessionMapper = deepMapper<EventSession>()
export const speakerMapper = deepMapper<EventSpeaker>()
export const ticketTypeMapper = deepMapper<TicketType>()
export const cancelRegistrationMapper = deepMapper<CancelRegistrationResult>()
export const checkInResultMapper = deepMapper<CheckInResult>()
export const checkInSummaryMapper = deepMapper<CheckInSummary>()
export const publicTicketMapper = deepMapper<PublicTicket>()
export const eventEmailLogMapper = deepMapper<EventEmailLog>()
export const captureMapper = deepMapper<EventCapture>()
export const captureResultMapper = deepMapper<CaptureResult>()
export const leaderboardMapper = deepMapper<LeaderboardRow>()
export const followUpResultMapper = deepMapper<FollowUpResult>()
export const publicSurveyMapper = deepMapper<PublicSurvey>()
export const surveyResultsMapper = deepMapper<SurveyResults>()
export const budgetMapper = deepMapper<EventBudget>()
export const applyTemplateMapper = deepMapper<ApplyTemplateResult>()
/** Any advanced-feature payload (request or answer). */
export const eventDeepMapper = deepMapper<unknown>()

/** GET /events query (company-local dates). */
export const EVENT_QUERY = { from: 'from', to: 'to' } as const
