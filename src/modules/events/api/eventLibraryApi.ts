import { http } from '@/shared/lib/axios'
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

/** Speakers directory, venues and vendors (docs/API.md › Events › Speakers, venues & vendors). */

const enc = encodeURIComponent

/* ---- speakers ---- */

export async function getSpeakers(): Promise<Speaker[]> {
  return speakerMapper.fromApiList((await http.get<unknown>('/event-speakers')).data)
}
export async function getSpeaker(id: string): Promise<SpeakerDetail> {
  return speakerDetailMapper.fromApi((await http.get<unknown>(`/event-speakers/${enc(id)}`)).data)
}
export async function saveSpeaker(input: Partial<SpeakerInput>, id?: string): Promise<Speaker> {
  const body = speakerInputMapper.toApi(input as SpeakerInput)
  const res = id ? await http.patch<unknown>(`/event-speakers/${enc(id)}`, body) : await http.post<unknown>('/event-speakers', body)
  return speakerMapper.fromApi(res.data)
}
export async function deleteSpeaker(id: string): Promise<void> {
  await http.delete(`/event-speakers/${enc(id)}`)
}
export async function rateSpeaker(id: string, input: SpeakerRatingInput): Promise<SpeakerDetail> {
  return speakerDetailMapper.fromApi((await http.post<unknown>(`/event-speakers/${enc(id)}/ratings`, speakerRatingInputMapper.toApi(input))).data)
}

/* ---- venues ---- */

export async function getVenues(): Promise<Venue[]> {
  return venueMapper.fromApiList((await http.get<unknown>('/event-venues')).data)
}
export async function getVenue(id: string): Promise<VenueDetail> {
  return venueDetailMapper.fromApi((await http.get<unknown>(`/event-venues/${enc(id)}`)).data)
}
export async function saveVenue(input: Partial<VenueInput>, id?: string): Promise<Venue> {
  const body = venueInputMapper.toApi(input as VenueInput)
  const res = id ? await http.patch<unknown>(`/event-venues/${enc(id)}`, body) : await http.post<unknown>('/event-venues', body)
  return venueMapper.fromApi(res.data)
}
export async function deleteVenue(id: string): Promise<void> {
  await http.delete(`/event-venues/${enc(id)}`)
}

/* ---- vendors ---- */

export async function getVendors(): Promise<Vendor[]> {
  return vendorMapper.fromApiList((await http.get<unknown>('/event-vendors')).data)
}
export async function getVendor(id: string): Promise<VendorDetail> {
  return vendorDetailMapper.fromApi((await http.get<unknown>(`/event-vendors/${enc(id)}`)).data)
}
export async function saveVendor(input: Partial<VendorInput>, id?: string): Promise<Vendor> {
  const body = vendorInputMapper.toApi(input as VendorInput)
  const res = id ? await http.patch<unknown>(`/event-vendors/${enc(id)}`, body) : await http.post<unknown>('/event-vendors', body)
  return vendorMapper.fromApi(res.data)
}
export async function deleteVendor(id: string): Promise<void> {
  await http.delete(`/event-vendors/${enc(id)}`)
}
export async function reviewVendor(id: string, input: VendorReviewInput): Promise<VendorDetail> {
  return vendorDetailMapper.fromApi((await http.post<unknown>(`/event-vendors/${enc(id)}/reviews`, vendorReviewInputMapper.toApi(input))).data)
}
