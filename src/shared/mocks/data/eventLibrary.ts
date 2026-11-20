import type { SpeakerKind, VendorCategory, VendorStatus, VenueStatus, VenueType } from '@/modules/events/libraryTypes'
import { registerArray } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Stores of the cross-event libraries (docs/API.md › Events › Speakers, venues & vendors; DB-ALIGNMENT ›
 * Design gaps › Events › Libraries): company-wide speaker directory, venues and vendors. Every row carries its
 * company. Seeded per company (different data) in ./eventLibrarySeed.ts, after the events' own seed.
 */

/** event_speaker_ratings (inline): one rating per event, given after the talk. */
export interface SpeakerRatingRecord {
  eventId: string
  rating: number
  note: string
  ratedBy: string | null
  ratedAt: string
}

/** speakers: the company's speaker directory (sessions reference these ids). */
export interface SpeakerRecord {
  id: string
  name: string
  title: string
  company: string
  bio: string
  photoUrl: string
  email: string
  mobile: string
  topics: string[]
  linkedinUrl: string
  kind: SpeakerKind
  userId: string | null
  fee: number | null
  feeCurrency: string
  notes: string
  ratings: SpeakerRatingRecord[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface VenueRoomRecord {
  id: string
  name: string
  capacity: number | null
}

/** venues: places events happen (events.venue_id). */
export interface VenueRecord {
  id: string
  name: string
  type: VenueType
  address: string
  city: string
  country: string
  mapUrl: string
  lat: number | null
  lng: number | null
  capacity: number | null
  rooms: VenueRoomRecord[]
  contactName: string
  contactMobile: string
  contactEmail: string
  dayRate: number | null
  currency: string
  priceNotes: string
  amenities: string[]
  notes: string
  rating: number | null
  status: VenueStatus
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface VendorDocumentRecord {
  id: string
  name: string
  url: string
}

/** vendor_reviews (inline): one review per event the vendor worked. */
export interface VendorReviewRecord {
  id: string
  eventId: string
  rating: number
  notes: string
  ratedBy: string | null
  ratedAt: string
}

/** vendors: event suppliers (event_budget_lines.vendor_id). */
export interface VendorRecord {
  id: string
  category: VendorCategory
  name: string
  contactName: string
  mobile: string
  email: string
  website: string
  taxNumber: string
  paymentTerms: string
  status: VendorStatus
  notes: string
  documents: VendorDocumentRecord[]
  reviews: VendorReviewRecord[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export const speakerDirectory = registerArray<Tenant<SpeakerRecord>>('speakerDirectory', [])
export const eventVenues = registerArray<Tenant<VenueRecord>>('eventVenues', [])
export const eventVendors = registerArray<Tenant<VendorRecord>>('eventVendors', [])
