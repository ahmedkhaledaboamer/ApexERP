import { http } from '@/shared/lib/axios'
import type {
  EventSponsorship,
  SponsorBoard,
  SponsorDeal,
  SponsorDealInput,
  SponsorDealUpdate,
  SponsorDeliverableInput,
  SponsorFilter,
  SponsorOrganization,
  SponsorPackage,
  SponsorPackageInput,
  SponsorStageInput,
} from '@/modules/events/sponsorTypes'
import type { DeadlineInput, LogisticsBundle, LogisticsDeadline, Shipment, ShipmentInput, Trip, TripInput } from '@/modules/events/logisticsTypes'
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

/** Sponsors & exhibitors and Travel & logistics API (docs/API.md › Events). */

const enc = encodeURIComponent
const body = (input: unknown) => sectionsInputMapper.toApi(input as never)

/* ---------------- Sponsors ---------------- */

export async function getSponsorBoard(filter: SponsorFilter = {}): Promise<SponsorBoard> {
  const params = { event_id: filter.eventId || undefined, package_id: filter.packageId || undefined, stage: filter.stage || undefined, owner_id: filter.ownerId || undefined }
  return sponsorBoardMapper.fromApi((await http.get<unknown>('/events/sponsors', { params })).data)
}

export async function searchSponsorOrganizations(q: string): Promise<SponsorOrganization[]> {
  return sponsorOrganizationMapper.fromApiList((await http.get<unknown>('/events/sponsor-organizations', { params: { q } })).data)
}

export async function getSponsorship(eventId: string): Promise<EventSponsorship> {
  return sponsorshipMapper.fromApi((await http.get<unknown>(`/events/${enc(eventId)}/sponsorship`)).data)
}

export async function savePackage(eventId: string, input: Partial<SponsorPackageInput>, packageId?: string): Promise<SponsorPackage> {
  const res = packageId
    ? await http.patch<unknown>(`/events/${enc(eventId)}/sponsor-packages/${enc(packageId)}`, body(input))
    : await http.post<unknown>(`/events/${enc(eventId)}/sponsor-packages`, body(input))
  return sponsorPackageMapper.fromApi(res.data)
}

export async function deletePackage(eventId: string, packageId: string): Promise<void> {
  await http.delete(`/events/${enc(eventId)}/sponsor-packages/${enc(packageId)}`)
}

export async function createSponsor(eventId: string, input: SponsorDealInput): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.post<unknown>(`/events/${enc(eventId)}/sponsors`, body(input))).data)
}

export async function getSponsor(eventId: string, sponsorId: string): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.get<unknown>(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}`)).data)
}

export async function updateSponsor(eventId: string, sponsorId: string, input: SponsorDealUpdate): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.patch<unknown>(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}`, body(input))).data)
}

export async function moveSponsor(eventId: string, sponsorId: string, input: SponsorStageInput): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.post<unknown>(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}/stage`, body(input))).data)
}

export async function deleteSponsor(eventId: string, sponsorId: string): Promise<void> {
  await http.delete(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}`)
}

export async function updateDeliverable(eventId: string, sponsorId: string, deliverableId: string, input: SponsorDeliverableInput): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.patch<unknown>(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}/deliverables/${enc(deliverableId)}`, body(input))).data)
}

export async function createDeliverableTask(eventId: string, sponsorId: string, deliverableId: string): Promise<SponsorDeal> {
  return sponsorDealMapper.fromApi((await http.post<unknown>(`/events/${enc(eventId)}/sponsors/${enc(sponsorId)}/deliverables/${enc(deliverableId)}/task`)).data)
}

/* ---------------- Logistics ---------------- */

export async function getLogistics(eventId?: string): Promise<LogisticsBundle> {
  return logisticsMapper.fromApi((await http.get<unknown>('/events/logistics', { params: { event_id: eventId || undefined } })).data)
}

export async function getEventLogistics(eventId: string): Promise<LogisticsBundle> {
  return logisticsMapper.fromApi((await http.get<unknown>(`/events/${enc(eventId)}/logistics`)).data)
}

export async function saveTrip(eventId: string, input: Partial<TripInput>, tripId?: string): Promise<Trip> {
  const res = tripId ? await http.patch<unknown>(`/events/${enc(eventId)}/trips/${enc(tripId)}`, body(input)) : await http.post<unknown>(`/events/${enc(eventId)}/trips`, body(input))
  return tripMapper.fromApi(res.data)
}

export async function deleteTrip(eventId: string, tripId: string): Promise<void> {
  await http.delete(`/events/${enc(eventId)}/trips/${enc(tripId)}`)
}

export async function saveShipment(eventId: string, input: Partial<ShipmentInput>, shipmentId?: string): Promise<Shipment> {
  const res = shipmentId ? await http.patch<unknown>(`/events/${enc(eventId)}/shipments/${enc(shipmentId)}`, body(input)) : await http.post<unknown>(`/events/${enc(eventId)}/shipments`, body(input))
  return shipmentMapper.fromApi(res.data)
}

export async function deleteShipment(eventId: string, shipmentId: string): Promise<void> {
  await http.delete(`/events/${enc(eventId)}/shipments/${enc(shipmentId)}`)
}

export async function saveDeadline(eventId: string, input: Partial<DeadlineInput>, deadlineId?: string): Promise<LogisticsDeadline> {
  const res = deadlineId ? await http.patch<unknown>(`/events/${enc(eventId)}/deadlines/${enc(deadlineId)}`, body(input)) : await http.post<unknown>(`/events/${enc(eventId)}/deadlines`, body(input))
  return deadlineMapper.fromApi(res.data)
}

export async function deleteDeadline(eventId: string, deadlineId: string): Promise<void> {
  await http.delete(`/events/${enc(eventId)}/deadlines/${enc(deadlineId)}`)
}
