import { http } from '@/shared/lib/axios'
import { globalStorage } from '@/shared/lib/storage'
import type {
  Attendee,
  AttendeeImportResult,
  AttendeeImportRow,
  AttendeeInput,
  EventDetail,
  EventFilter,
  EventInput,
  EventRow,
  EventStats,
  EventUpdateInput,
  PublicEventInfo,
  PublicRegistrationInput,
  PublicRegistrationResult,
  RegistrationResult,
} from '@/modules/events/types'
import {
  attendeeImportMapper,
  attendeeImportResultMapper,
  attendeeInputMapper,
  attendeeMapper,
  EVENT_QUERY,
  eventInputMapper,
  eventMapper,
  eventStatsMapper,
  publicEventMapper,
  publicRegistrationMapper,
  registrationMapper,
} from '@/shared/api/eventMappers'

/** Events API (snake_case on the wire, shared/api/eventMappers.ts). Access is decided by the server. */

const enc = encodeURIComponent

export async function getEvents(filter: EventFilter = {}): Promise<EventRow[]> {
  const params: Record<string, string> = {}
  if (filter.from) params[EVENT_QUERY.from] = filter.from
  if (filter.to) params[EVENT_QUERY.to] = filter.to
  return eventMapper.fromApiList((await http.get<unknown>('/events', { params })).data)
}

export async function getEvent(id: string): Promise<EventDetail> {
  return eventMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}`)).data)
}

export async function createEvent(input: EventInput): Promise<EventDetail> {
  return eventMapper.fromApi((await http.post<unknown>('/events', eventInputMapper.toApi(input))).data)
}

export async function updateEvent(id: string, input: EventUpdateInput): Promise<EventDetail> {
  return eventMapper.fromApi((await http.patch<unknown>(`/events/${enc(id)}`, eventInputMapper.toApi(input))).data)
}

/** Soft delete: cancels the event. */
export async function cancelEvent(id: string): Promise<EventDetail> {
  return eventMapper.fromApi((await http.delete<unknown>(`/events/${enc(id)}`)).data)
}

export async function addTeamMember(id: string, userId: string): Promise<EventDetail> {
  return eventMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/team`, { user_id: userId })).data)
}

export async function removeTeamMember(id: string, userId: string): Promise<EventDetail> {
  return eventMapper.fromApi((await http.delete<unknown>(`/events/${enc(id)}/team/${enc(userId)}`)).data)
}

export async function getEventStats(id: string): Promise<EventStats> {
  return eventStatsMapper.fromApi((await http.get<unknown>(`/events/${enc(id)}/stats`)).data)
}

export async function getAttendees(id: string): Promise<Attendee[]> {
  return attendeeMapper.fromApiList((await http.get<unknown>(`/events/${enc(id)}/attendees`)).data)
}

export async function addAttendee(id: string, input: AttendeeInput): Promise<RegistrationResult> {
  return registrationMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/attendees`, attendeeInputMapper.toApi(input))).data)
}

export async function updateAttendee(id: string, attendeeId: string, input: Partial<AttendeeInput>): Promise<Attendee> {
  return attendeeMapper.fromApi((await http.patch<unknown>(`/events/${enc(id)}/attendees/${enc(attendeeId)}`, attendeeInputMapper.toApi(input))).data)
}

export async function removeAttendee(id: string, attendeeId: string): Promise<void> {
  await http.delete(`/events/${enc(id)}/attendees/${enc(attendeeId)}`)
}

export async function checkInAttendee(id: string, attendeeId: string, undo = false): Promise<Attendee> {
  return attendeeMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/attendees/${enc(attendeeId)}/check-in`, { undo })).data)
}

export async function importAttendees(id: string, rows: AttendeeImportRow[], fileName: string): Promise<AttendeeImportResult> {
  return attendeeImportResultMapper.fromApi((await http.post<unknown>(`/events/${enc(id)}/attendees/import`, attendeeImportMapper.toApi({ rows, fileName }))).data)
}

/* ---------------- Public registration (no sign-in) ---------------- */

/** The browser's random client id (shared with sign-up), sent as X-Client-Id for the mock rate limiter. */
function clientId(): string {
  let id = globalStorage.get('client-id')
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    globalStorage.set('client-id', id)
  }
  return id
}

export async function getPublicEvent(token: string): Promise<PublicEventInfo> {
  return publicEventMapper.fromApi((await http.get<unknown>(`/public/events/${enc(token)}`)).data)
}

export async function registerPublic(token: string, input: PublicRegistrationInput): Promise<PublicRegistrationResult> {
  const res = await http.post<unknown>(`/public/events/${enc(token)}/register`, publicRegistrationMapper.toApi(input), { headers: { 'X-Client-Id': clientId() } })
  return publicRegistrationMapper.fromApi(res.data) as PublicRegistrationResult
}
