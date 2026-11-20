import { defineMapper } from './mapping'
import type { EventSponsorship, SponsorBoard, SponsorDeal, SponsorOrganization, SponsorPackage } from '@/modules/events/sponsorTypes'
import type { LogisticsBundle, LogisticsDeadline, Shipment, Trip } from '@/modules/events/logisticsTypes'

/** Wire mappers of Sponsors & exhibitors and Travel & logistics (snake_case at every depth). */
const deep = <T>() => defineMapper<T>({ deep: true })

export const sponsorBoardMapper = deep<SponsorBoard>()
export const sponsorshipMapper = deep<EventSponsorship>()
export const sponsorPackageMapper = deep<SponsorPackage>()
export const sponsorDealMapper = deep<SponsorDeal>()
export const sponsorOrganizationMapper = deep<SponsorOrganization>()
export const logisticsMapper = deep<LogisticsBundle>()
export const tripMapper = deep<Trip>()
export const shipmentMapper = deep<Shipment>()
export const deadlineMapper = deep<LogisticsDeadline>()
/** Any request body of these sections. */
export const sectionsInputMapper = deep<unknown>()
