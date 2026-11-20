import { http, type HttpHandler } from 'msw'
import * as svc from '@/shared/mocks/services/eventSections'
import {
  assignBoothLeadsInputMapper,
  assignBoothLeadsResultMapper,
  attendeeDirectoryMapper,
  attendeeExportMapper,
  boothLeadsMapper,
  eventAnalyticsMapper,
} from '@/shared/api/eventSectionMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/**
 * Cross-event sections of the Events area (docs/API.md › Events › Attendees directory, Booth leads,
 * Event analytics). Under /events (plan module `events` through the request policy). Registered BEFORE
 * the per-event handlers (handlers/index.ts) so `/events/attendees` isn't read as `/events/:id`.
 */
export const eventSectionsHandlers: HttpHandler[] = [
  http.get(`${API}/events/attendees`, ({ request }) => respondAs(attendeeDirectoryMapper, () => svc.getAttendeeDirectory(userFrom(request)))),
  http.get(`${API}/events/attendees/export`, ({ request }) => respondAs(attendeeExportMapper, () => svc.exportAttendeeDirectory(userFrom(request)))),
  http.get(`${API}/events/booth-leads`, ({ request }) => respondAs(boothLeadsMapper, () => svc.getBoothLeads(userFrom(request)))),
  http.post(`${API}/events/booth-leads/assign`, async ({ request }) => {
    const input = await body<{ captureIds?: unknown; ownerId?: unknown }>(request, assignBoothLeadsInputMapper)
    return respondAs(assignBoothLeadsResultMapper, () => svc.assignBoothLeads(userFrom(request), input))
  }),
  http.get(`${API}/events/analytics`, ({ request }) => {
    const q = new URL(request.url).searchParams
    return respondAs(eventAnalyticsMapper, () =>
      svc.getEventAnalytics(userFrom(request), {
        preset: q.get('preset') ?? undefined,
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
        compare: q.get('compare') ?? undefined,
      }),
    )
  }),
]
