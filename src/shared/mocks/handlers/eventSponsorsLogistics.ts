import { http, type HttpHandler } from 'msw'
import type { SponsorDealInput, SponsorDealUpdate, SponsorDeliverableInput, SponsorPackageInput, SponsorStageInput } from '@/modules/events/sponsorTypes'
import type { DeadlineInput, ShipmentInput, TripInput } from '@/modules/events/logisticsTypes'
import * as sponsors from '@/shared/mocks/services/eventSponsors'
import * as logistics from '@/shared/mocks/services/eventLogistics'
import {
  deadlineMapper,
  logisticsMapper,
  sectionsInputMapper,
  shipmentMapper,
  sponsorBoardMapper,
  sponsorDealMapper,
  sponsorOrganizationMapper,
  sponsorPackageMapper,
  sponsorshipMapper,
  tripMapper,
} from '@/shared/api/eventSectionsMappers'
import { plainMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }
type Pkg = { id: string; packageId: string }
type Deal = { id: string; sponsorId: string }
type Dlv = { id: string; sponsorId: string; deliverableId: string }
type TripP = { id: string; tripId: string }
type ShipP = { id: string; shipmentId: string }
type DlP = { id: string; deadlineId: string }

async function body<T>(request: Request): Promise<T | null> {
  try {
    return await bodyAs<T>(request, sectionsInputMapper)
  } catch {
    return null
  }
}

const q = (request: Request, key: string) => new URL(request.url).searchParams.get(key)?.trim() || undefined

/**
 * Sponsors & exhibitors and Travel & logistics (docs/API.md › Events). Paths are under /events (plan module
 * `events` through the request policy); registered before the events handlers so `/events/sponsors` and
 * `/events/logistics` aren't read as `/events/:id`.
 */
export const eventSponsorsLogisticsHandlers: HttpHandler[] = [
  /* ---- sponsors: cross-event ---- */
  http.get(`${API}/events/sponsors`, ({ request }) =>
    respondAs(sponsorBoardMapper, () =>
      sponsors.listSponsors(userFrom(request), { eventId: q(request, 'event_id'), packageId: q(request, 'package_id'), stage: q(request, 'stage') as never, ownerId: q(request, 'owner_id') }),
    ),
  ),
  http.get(`${API}/events/sponsor-organizations`, ({ request }) => respondAs(sponsorOrganizationMapper, () => sponsors.searchOrganizations(userFrom(request), q(request, 'q') ?? ''))),
  /* ---- sponsors: per event ---- */
  http.get<Id>(`${API}/events/:id/sponsorship`, ({ request, params }) => respondAs(sponsorshipMapper, () => sponsors.getSponsorship(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/sponsor-packages`, async ({ request, params }) => {
    const input = await body<SponsorPackageInput>(request)
    return respondAs(sponsorPackageMapper, () => sponsors.createPackage(userFrom(request), params.id, input))
  }),
  http.patch<Pkg>(`${API}/events/:id/sponsor-packages/:packageId`, async ({ request, params }) => {
    const input = await body<Partial<SponsorPackageInput>>(request)
    return respondAs(sponsorPackageMapper, () => sponsors.updatePackage(userFrom(request), params.id, params.packageId, input))
  }),
  http.delete<Pkg>(`${API}/events/:id/sponsor-packages/:packageId`, ({ request, params }) => respondAs(plainMapper, () => sponsors.deletePackage(userFrom(request), params.id, params.packageId))),
  http.post<Id>(`${API}/events/:id/sponsors`, async ({ request, params }) => {
    const input = await body<SponsorDealInput>(request)
    return respondAs(sponsorDealMapper, () => sponsors.createDeal(userFrom(request), params.id, input))
  }),
  http.get<Deal>(`${API}/events/:id/sponsors/:sponsorId`, ({ request, params }) => respondAs(sponsorDealMapper, () => sponsors.getDeal(userFrom(request), params.id, params.sponsorId))),
  http.patch<Deal>(`${API}/events/:id/sponsors/:sponsorId`, async ({ request, params }) => {
    const input = await body<SponsorDealUpdate>(request)
    return respondAs(sponsorDealMapper, () => sponsors.updateDeal(userFrom(request), params.id, params.sponsorId, input))
  }),
  http.delete<Deal>(`${API}/events/:id/sponsors/:sponsorId`, ({ request, params }) => respondAs(plainMapper, () => sponsors.deleteDeal(userFrom(request), params.id, params.sponsorId))),
  http.post<Deal>(`${API}/events/:id/sponsors/:sponsorId/stage`, async ({ request, params }) => {
    const input = await body<SponsorStageInput>(request)
    return respondAs(sponsorDealMapper, () => sponsors.moveDeal(userFrom(request), params.id, params.sponsorId, input))
  }),
  http.patch<Dlv>(`${API}/events/:id/sponsors/:sponsorId/deliverables/:deliverableId`, async ({ request, params }) => {
    const input = await body<SponsorDeliverableInput>(request)
    return respondAs(sponsorDealMapper, () => sponsors.updateDeliverable(userFrom(request), params.id, params.sponsorId, params.deliverableId, input))
  }),
  http.post<Dlv>(`${API}/events/:id/sponsors/:sponsorId/deliverables/:deliverableId/task`, ({ request, params }) =>
    respondAs(sponsorDealMapper, () => sponsors.createDeliverableTask(userFrom(request), params.id, params.sponsorId, params.deliverableId)),
  ),

  /* ---- logistics ---- */
  http.get(`${API}/events/logistics`, ({ request }) => respondAs(logisticsMapper, () => logistics.listLogistics(userFrom(request), { eventId: q(request, 'event_id') }))),
  http.get<Id>(`${API}/events/:id/logistics`, ({ request, params }) => respondAs(logisticsMapper, () => logistics.getEventLogistics(userFrom(request), params.id))),
  http.post<Id>(`${API}/events/:id/trips`, async ({ request, params }) => {
    const input = await body<TripInput>(request)
    return respondAs(tripMapper, () => logistics.createTrip(userFrom(request), params.id, input))
  }),
  http.patch<TripP>(`${API}/events/:id/trips/:tripId`, async ({ request, params }) => {
    const input = await body<Partial<TripInput>>(request)
    return respondAs(tripMapper, () => logistics.updateTrip(userFrom(request), params.id, params.tripId, input))
  }),
  http.delete<TripP>(`${API}/events/:id/trips/:tripId`, ({ request, params }) => respondAs(plainMapper, () => logistics.deleteTrip(userFrom(request), params.id, params.tripId))),
  http.post<Id>(`${API}/events/:id/shipments`, async ({ request, params }) => {
    const input = await body<ShipmentInput>(request)
    return respondAs(shipmentMapper, () => logistics.createShipment(userFrom(request), params.id, input))
  }),
  http.patch<ShipP>(`${API}/events/:id/shipments/:shipmentId`, async ({ request, params }) => {
    const input = await body<Partial<ShipmentInput>>(request)
    return respondAs(shipmentMapper, () => logistics.updateShipment(userFrom(request), params.id, params.shipmentId, input))
  }),
  http.delete<ShipP>(`${API}/events/:id/shipments/:shipmentId`, ({ request, params }) => respondAs(plainMapper, () => logistics.deleteShipment(userFrom(request), params.id, params.shipmentId))),
  http.post<Id>(`${API}/events/:id/deadlines`, async ({ request, params }) => {
    const input = await body<DeadlineInput>(request)
    return respondAs(deadlineMapper, () => logistics.createDeadline(userFrom(request), params.id, input))
  }),
  http.patch<DlP>(`${API}/events/:id/deadlines/:deadlineId`, async ({ request, params }) => {
    const input = await body<Partial<DeadlineInput>>(request)
    return respondAs(deadlineMapper, () => logistics.updateDeadline(userFrom(request), params.id, params.deadlineId, input))
  }),
  http.delete<DlP>(`${API}/events/:id/deadlines/:deadlineId`, ({ request, params }) => respondAs(plainMapper, () => logistics.deleteDeadline(userFrom(request), params.id, params.deadlineId))),
]
