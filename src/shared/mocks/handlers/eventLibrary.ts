import { http, type HttpHandler } from 'msw'
import type { SpeakerInput, SpeakerRatingInput, VendorInput, VendorReviewInput, VenueInput } from '@/modules/events/libraryTypes'
import * as lib from '@/shared/mocks/services/eventLibrary'
import {
  speakerDetailMapper,
  speakerInputMapper,
  speakerMapper,
  speakerRatingInputMapper,
  vendorDetailMapper,
  vendorInputMapper,
  vendorMapper,
  vendorReviewInputMapper,
  venueDetailMapper,
  venueInputMapper,
  venueMapper,
} from '@/shared/api/eventLibraryMappers'
import { plainMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}

/**
 * Cross-event libraries (docs/API.md › Events › Speakers, venues & vendors): the speaker directory, venues
 * and vendors. Company paths `/event-speakers`, `/event-venues`, `/event-vendors` (plan module `events`
 * through the request policy).
 */
export const eventLibraryHandlers: HttpHandler[] = [
  /* ---- speakers ---- */
  http.get(`${API}/event-speakers`, ({ request }) => respondAs(speakerMapper, () => lib.listSpeakers(userFrom(request)))),
  http.post(`${API}/event-speakers`, async ({ request }) => {
    const input = await body<SpeakerInput>(request, speakerInputMapper)
    return respondAs(speakerMapper, () => lib.createSpeaker(userFrom(request), input))
  }),
  http.get<Id>(`${API}/event-speakers/:id`, ({ request, params }) => respondAs(speakerDetailMapper, () => lib.getSpeaker(userFrom(request), params.id))),
  http.patch<Id>(`${API}/event-speakers/:id`, async ({ request, params }) => {
    const input = await body<Partial<SpeakerInput>>(request, speakerInputMapper)
    return respondAs(speakerMapper, () => lib.updateSpeaker(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/event-speakers/:id`, ({ request, params }) => respondAs(plainMapper, () => lib.deleteSpeaker(userFrom(request), params.id))),
  http.post<Id>(`${API}/event-speakers/:id/ratings`, async ({ request, params }) => {
    const input = await body<SpeakerRatingInput>(request, speakerRatingInputMapper)
    return respondAs(speakerDetailMapper, () => lib.rateSpeaker(userFrom(request), params.id, input))
  }),

  /* ---- venues ---- */
  http.get(`${API}/event-venues`, ({ request }) => respondAs(venueMapper, () => lib.listVenues(userFrom(request)))),
  http.post(`${API}/event-venues`, async ({ request }) => {
    const input = await body<VenueInput>(request, venueInputMapper)
    return respondAs(venueMapper, () => lib.createVenue(userFrom(request), input))
  }),
  http.get<Id>(`${API}/event-venues/:id`, ({ request, params }) => respondAs(venueDetailMapper, () => lib.getVenue(userFrom(request), params.id))),
  http.patch<Id>(`${API}/event-venues/:id`, async ({ request, params }) => {
    const input = await body<Partial<VenueInput>>(request, venueInputMapper)
    return respondAs(venueMapper, () => lib.updateVenue(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/event-venues/:id`, ({ request, params }) => respondAs(plainMapper, () => lib.deleteVenue(userFrom(request), params.id))),

  /* ---- vendors ---- */
  http.get(`${API}/event-vendors`, ({ request }) => respondAs(vendorMapper, () => lib.listVendors(userFrom(request)))),
  http.post(`${API}/event-vendors`, async ({ request }) => {
    const input = await body<VendorInput>(request, vendorInputMapper)
    return respondAs(vendorMapper, () => lib.createVendor(userFrom(request), input))
  }),
  http.get<Id>(`${API}/event-vendors/:id`, ({ request, params }) => respondAs(vendorDetailMapper, () => lib.getVendor(userFrom(request), params.id))),
  http.patch<Id>(`${API}/event-vendors/:id`, async ({ request, params }) => {
    const input = await body<Partial<VendorInput>>(request, vendorInputMapper)
    return respondAs(vendorMapper, () => lib.updateVendor(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/event-vendors/:id`, ({ request, params }) => respondAs(plainMapper, () => lib.deleteVendor(userFrom(request), params.id))),
  http.post<Id>(`${API}/event-vendors/:id/reviews`, async ({ request, params }) => {
    const input = await body<VendorReviewInput>(request, vendorReviewInputMapper)
    return respondAs(vendorDetailMapper, () => lib.reviewVendor(userFrom(request), params.id, input))
  }),
]
