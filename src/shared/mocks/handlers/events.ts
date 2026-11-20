import { http, type HttpHandler } from 'msw'
import type { AttendeeImportRow, AttendeeInput, EventInput, EventUpdateInput, PublicRegistrationInput } from '@/modules/events/types'
import * as svc from '@/shared/mocks/services/events'
import { createEventWithTemplate } from '@/shared/mocks/services/eventTemplates'
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
import { plainMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }
type Att = { id: string; attendeeId: string }

/** Body or null for an empty / malformed body (the service answers 422). */
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/**
 * Events (plan module `events`; docs/API.md › Events). Authenticated paths are under /events, so the
 * request policy (userFrom → enforceRequestPolicy) answers 403 module_not_in_plan for plans without
 * the module. The public registration endpoints check the event's company themselves.
 */
export const eventsHandlers: HttpHandler[] = [
  http.get(`${API}/events`, ({ request }) => {
    const q = new URL(request.url).searchParams
    return respondAs(eventMapper, () =>
      svc.listEvents(userFrom(request), { from: q.get(EVENT_QUERY.from) ?? undefined, to: q.get(EVENT_QUERY.to) ?? undefined }),
    )
  }),
  http.post(`${API}/events`, async ({ request }) => {
    const input = await body<EventInput>(request, eventInputMapper)
    // An optional template_id applies an event template right away (services/eventTemplates.ts).
    return respondAs(eventMapper, () => createEventWithTemplate(userFrom(request), input))
  }),
  http.get<Id>(`${API}/events/:id`, ({ request, params }) => respondAs(eventMapper, () => svc.getEvent(userFrom(request), params.id))),
  http.patch<Id>(`${API}/events/:id`, async ({ request, params }) => {
    const input = await body<EventUpdateInput>(request, eventInputMapper)
    return respondAs(eventMapper, () => svc.updateEvent(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/events/:id`, ({ request, params }) => respondAs(eventMapper, () => svc.cancelEvent(userFrom(request), params.id))),

  http.post<Id>(`${API}/events/:id/team`, async ({ request, params }) => {
    const input = await body<{ userId?: unknown }>(request, plainMapper)
    return respondAs(eventMapper, () => svc.addTeamMember(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<{ id: string; userId: string }>(`${API}/events/:id/team/:userId`, ({ request, params }) =>
    respondAs(eventMapper, () => svc.removeTeamMember(userFrom(request), params.id, params.userId)),
  ),

  http.get<Id>(`${API}/events/:id/stats`, ({ request, params }) => respondAs(eventStatsMapper, () => svc.getEventStats(userFrom(request), params.id))),

  http.get<Id>(`${API}/events/:id/attendees`, ({ request, params }) => respondAs(attendeeMapper, () => svc.listAttendees(userFrom(request), params.id))),
  // Before /attendees/:attendeeId so "import" isn't read as an attendee id.
  http.post<Id>(`${API}/events/:id/attendees/import`, async ({ request, params }) => {
    const input = await body<{ rows?: AttendeeImportRow[]; fileName?: string }>(request, attendeeImportMapper)
    return respondAs(attendeeImportResultMapper, () => svc.importAttendees(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/events/:id/attendees`, async ({ request, params }) => {
    const input = await body<AttendeeInput>(request, attendeeInputMapper)
    return respondAs(registrationMapper, () => svc.addAttendee(userFrom(request), params.id, input as AttendeeInput))
  }),
  http.patch<Att>(`${API}/events/:id/attendees/:attendeeId`, async ({ request, params }) => {
    const input = await body<Partial<AttendeeInput>>(request, attendeeInputMapper)
    return respondAs(attendeeMapper, () => svc.updateAttendee(userFrom(request), params.id, params.attendeeId, input ?? {}))
  }),
  http.delete<Att>(`${API}/events/:id/attendees/:attendeeId`, ({ request, params }) =>
    respondAs(plainMapper, () => svc.removeAttendee(userFrom(request), params.id, params.attendeeId)),
  ),
  http.post<Att>(`${API}/events/:id/attendees/:attendeeId/check-in`, async ({ request, params }) => {
    const input = await body<{ undo?: unknown }>(request, plainMapper)
    return respondAs(attendeeMapper, () => svc.checkIn(userFrom(request), params.id, params.attendeeId, input))
  }),

  // Public registration (no auth): the event page and the form.
  http.get<{ token: string }>(`${API}/public/events/:token`, ({ params }) => respondAs(publicEventMapper, () => svc.getPublicEvent(params.token))),
  http.post<{ token: string }>(`${API}/public/events/:token/register`, async ({ request, params }) => {
    const input = await body<PublicRegistrationInput>(request, publicRegistrationMapper)
    const client = request.headers.get('X-Client-Id')?.trim() || 'anonymous'
    return respondAs(publicRegistrationMapper, () => svc.publicRegister(params.token, input, client))
  }),
]
