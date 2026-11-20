import { defineMapper } from './mapping'
import type {
  Speaker,
  SpeakerDetail,
  SpeakerInput,
  SpeakerRatingInput,
  Vendor,
  VendorDetail,
  VendorInput,
  VendorReviewInput,
  Venue,
  VenueDetail,
  VenueInput,
} from '@/modules/events/libraryTypes'

/**
 * Wire names of the event libraries (speakers, venues, vendors): plain snake_case at any depth
 * (photo_url, linkedin_url, fee_currency, user_id, contact_mobile, day_rate, price_notes, tax_number,
 * payment_terms, hidden_events, average_attendance, needs_rating…). docs/API.md › Events › Speakers, venues & vendors.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const speakerMapper = deep<Speaker>()
export const speakerDetailMapper = deep<SpeakerDetail>()
export const speakerInputMapper = deep<SpeakerInput>()
export const speakerRatingInputMapper = deep<SpeakerRatingInput>()
export const venueMapper = deep<Venue>()
export const venueDetailMapper = deep<VenueDetail>()
export const venueInputMapper = deep<VenueInput>()
export const vendorMapper = deep<Vendor>()
export const vendorDetailMapper = deep<VendorDetail>()
export const vendorInputMapper = deep<VendorInput>()
export const vendorReviewInputMapper = deep<VendorReviewInput>()
