import { defineMapper } from './mapping'
import type {
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

export const publicEventMapper = defineMapper<PublicEventInfo>()
export const publicRegistrationMapper = defineMapper<PublicRegistrationInput & PublicRegistrationResult>()

/** GET /events query (company-local dates). */
export const EVENT_QUERY = { from: 'from', to: 'to' } as const
