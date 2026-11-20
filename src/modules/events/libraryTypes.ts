/**
 * Cross-event libraries of the Events area (docs/API.md › Events › Speakers / Venues / Vendors): company-wide
 * directories of speakers, venues and vendors. Marketing `full` manages them, marketing `view` reads them, and
 * event team members (any role) read them and pick from them when editing their own events.
 */

export const LIBRARY_CURRENCIES = ['AED', 'SAR', 'USD', 'EUR', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP'] as const

/** What the caller may do with the libraries (server decides; the client mirrors it for buttons). */
export type LibraryAccess = 'manage' | 'read' | 'none'

/* ---------------- Speakers ---------------- */

export type SpeakerKind = 'internal' | 'external'

export interface SpeakerRating {
  eventId: string
  eventName: string
  rating: number
  note: string
  ratedByName: string
  ratedAt: string
}

export interface Speaker {
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
  /** Internal speakers: the employee (company user) they are. */
  userId: string | null
  userName: string
  fee: number | null
  feeCurrency: string
  notes: string
  /** Average of the ratings after talks (1–5, one decimal), null without ratings. */
  rating: number | null
  ratingCount: number
  /** Events the speaker is on (agenda roster), any status. */
  eventCount: number
  createdAt: string
  updatedAt: string
}

export interface SpeakerInput {
  name: string
  title?: string
  company?: string
  bio?: string
  photoUrl?: string
  email?: string
  mobile?: string
  topics?: string[]
  linkedinUrl?: string
  kind?: SpeakerKind
  userId?: string | null
  fee?: number | null
  feeCurrency?: string
  notes?: string
}

export interface SpeakerEventEntry {
  eventId: string
  eventName: string
  startDate: string
  status: string
  sessions: { id: string; title: string; date: string; startTime: string; endTime: string }[]
  /** This event's rating of the speaker (null = not rated). */
  rating: number | null
  /** The caller may rate the speaker for this event (event owner or marketing full; completed events). */
  canRate: boolean
}

export interface SpeakerDetail extends Speaker {
  events: SpeakerEventEntry[]
  /** Events the speaker is on that the caller can't see (counted only). */
  hiddenEvents: number
  ratings: SpeakerRating[]
  canManage: boolean
}

export interface SpeakerRatingInput {
  eventId: string
  rating: number
  note?: string
}

/* ---------------- Venues ---------------- */

export type VenueType = 'exhibition_centre' | 'hotel' | 'conference_hall' | 'office' | 'online_platform' | 'other'
export const VENUE_TYPES: VenueType[] = ['exhibition_centre', 'hotel', 'conference_hall', 'office', 'online_platform', 'other']
export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  exhibition_centre: 'Exhibition centre',
  hotel: 'Hotel',
  conference_hall: 'Conference hall',
  office: 'Office',
  online_platform: 'Online platform',
  other: 'Other',
}

export type VenueStatus = 'active' | 'archived'

export interface VenueRoom {
  id: string
  name: string
  capacity: number | null
}

export interface Venue {
  id: string
  name: string
  type: VenueType
  address: string
  city: string
  /** ISO 3166-1 alpha-2 (AE, SA…). */
  country: string
  mapUrl: string
  lat: number | null
  lng: number | null
  /** Total capacity (null = unknown). */
  capacity: number | null
  rooms: VenueRoom[]
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
  /** Events linked to the venue (any status). */
  eventCount: number
  createdAt: string
  updatedAt: string
}

export interface VenueInput {
  name: string
  type?: VenueType
  address?: string
  city?: string
  country?: string
  mapUrl?: string
  lat?: number | string | null
  lng?: number | string | null
  capacity?: number | null
  rooms?: { id?: string; name: string; capacity?: number | null }[]
  contactName?: string
  contactMobile?: string
  contactEmail?: string
  dayRate?: number | null
  currency?: string
  priceNotes?: string
  amenities?: string[]
  notes?: string
  rating?: number | null
  status?: VenueStatus
}

export interface VenueEventEntry {
  eventId: string
  eventName: string
  startDate: string
  endDate: string
  status: string
  attendeeCount: number
  checkedInCount: number
  capacity: number | null
  upcoming: boolean
}

export interface VenueDetail extends Venue {
  past: VenueEventEntry[]
  upcoming: VenueEventEntry[]
  hiddenEvents: number
  /** Average attendance of past (not cancelled) events there: checked-in people, else registered. Null without past events. */
  averageAttendance: number | null
  canManage: boolean
}

/* ---------------- Vendors ---------------- */

export type VendorCategory = 'booth_builder' | 'printing' | 'catering' | 'giveaways' | 'av_tech' | 'photo_video' | 'logistics' | 'staffing' | 'venue_services' | 'other'
export const VENDOR_CATEGORIES: VendorCategory[] = ['booth_builder', 'printing', 'catering', 'giveaways', 'av_tech', 'photo_video', 'logistics', 'staffing', 'venue_services', 'other']
export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  booth_builder: 'Booth builder',
  printing: 'Printing',
  catering: 'Catering',
  giveaways: 'Giveaways',
  av_tech: 'AV & tech',
  photo_video: 'Photography / video',
  logistics: 'Logistics / shipping',
  staffing: 'Staffing',
  venue_services: 'Venue services',
  other: 'Other',
}

export type VendorStatus = 'preferred' | 'approved' | 'blacklisted'
export const VENDOR_STATUSES: VendorStatus[] = ['preferred', 'approved', 'blacklisted']
export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = { preferred: 'Preferred', approved: 'Approved', blacklisted: 'Blacklisted' }

export interface VendorDocument {
  id: string
  name: string
  url: string
}

export interface VendorReview {
  id: string
  eventId: string
  eventName: string
  rating: number
  notes: string
  ratedByName: string
  ratedAt: string
}

export interface Vendor {
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
  documents: VendorDocument[]
  /** Average of the per-event reviews (1–5, one decimal), null without reviews. */
  rating: number | null
  reviewCount: number
  /** Actual spend over all linked budget lines (company currency) and the events worked. */
  totalActual: number
  eventCount: number
  currency: string
  createdAt: string
  updatedAt: string
}

export interface VendorInput {
  category: VendorCategory
  name: string
  contactName?: string
  mobile?: string
  email?: string
  website?: string
  taxNumber?: string
  paymentTerms?: string
  status?: VendorStatus
  notes?: string
  documents?: { id?: string; name: string; url: string }[]
}

export interface VendorSpendRow {
  eventId: string
  eventName: string
  startDate: string
  status: string
  lines: number
  planned: number
  actual: number
  /** This event's review (null = not rated yet). */
  rating: number | null
  /** Completed event with linked lines and no review yet: "Rate after the event". */
  needsRating: boolean
  canRate: boolean
}

export interface VendorDetail extends Vendor {
  spend: VendorSpendRow[]
  hiddenEvents: number
  totalPlanned: number
  reviews: VendorReview[]
  canManage: boolean
}

export interface VendorReviewInput {
  eventId: string
  rating: number
  notes?: string
}
