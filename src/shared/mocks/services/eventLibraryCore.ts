import type { User } from '@/shared/types'
import type { LibraryAccess, Speaker, SpeakerInput, Vendor, VendorInput, Venue, VenueInput } from '@/modules/events/libraryTypes'
import { LIBRARY_CURRENCIES, VENDOR_CATEGORIES, VENDOR_STATUSES, VENUE_TYPES } from '@/modules/events/libraryTypes'
import { averageRating, libraryAccess, sameSpeaker } from '@/modules/events/lib/library'
import { scopeOf } from '@/shared/lib/permissions'
import { MOBILE_RULES, formatMobile, isMobile, mobileError } from '@/shared/lib/phone'
import type { CountryCode } from '@/modules/tenancy/types'
import { users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventSpeakers } from '@/shared/mocks/data/eventExtras'
import {
  eventVendors,
  eventVenues,
  speakerDirectory,
  type SpeakerRecord,
  type VendorRecord,
  type VenueRecord,
} from '@/shared/mocks/data/eventLibrary'
import '@/shared/mocks/data/eventLibrarySeed'
import { isOnTeam } from '@/shared/mocks/selectors/events'
import { ApiError } from '@/shared/lib/apiError'
import { ownerName } from '@/shared/mocks/server'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertModule } from '@/shared/mocks/services/billing'

/**
 * Core of the event libraries (speakers, venues, vendors): access, validation, views and the lookups other
 * event services use (agenda: directory speakers; budget: vendor pick rule; events: venue pick rule). Kept free
 * of the event services so they can import it without a cycle. Endpoints: services/eventLibrary.ts.
 */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i
/** A photo from Brand Assets is a small data URL (images only). */
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/
const MAX_DATA_URL = 400_000
const round2 = (n: number) => Math.round(n * 100) / 100

export const countryOf = (companyId: string) => companyById(companyId)?.regional.country ?? 'AE'
export const companyCurrency = (companyId: string) => companyById(companyId)?.regional.currency ?? 'AED'

/* ---------------- Access ---------------- */

/** On the team (owner or member) of any event of the company. */
export function onAnyEventTeam(user: User): boolean {
  return events.some((e) => e.companyId === user.companyId && isOnTeam(user, e))
}

export function accessOf(user: User): LibraryAccess {
  return libraryAccess(scopeOf(user.role, 'marketing'), onAnyEventTeam(user))
}

/** Read (list / detail / pick): marketing full / view and event team members. Plan module `events` first. */
export function requireRead(user: User): LibraryAccess {
  assertModule(tenantOf(user), 'events')
  const access = accessOf(user)
  if (access === 'none') throw new ApiError('The speaker, venue and vendor libraries are for marketing and event teams. Ask a marketing manager.', 403)
  return access
}

export function requireManage(user: User): void {
  if (requireRead(user) !== 'manage') throw new ApiError('Only marketing managers can change the speaker, venue and vendor libraries.', 403)
}

/* ---------------- Shared validation ---------------- */

function tags(raw: unknown, label: string): string[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return `${label} must be a list.`
  const out: string[] = []
  for (const t of raw) {
    const v = str(t)
    if (!v) continue
    if (v.length > 40) return `Keep each ${label.toLowerCase()} entry under 40 characters.`
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  if (out.length > 20) return `Keep ${label.toLowerCase()} to 20 entries.`
  return out
}

function money(v: unknown, label: string): number | null | string {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return `${label} must be 0 or a positive amount.`
  return round2(n)
}

function currency(v: unknown, companyId: string): string | null {
  const c = str(v).toUpperCase() || companyCurrency(companyId)
  return (LIBRARY_CURRENCIES as readonly string[]).includes(c) ? c : null
}

function email(v: unknown, label = 'Email'): string | { error: string } {
  const e = str(v).toLowerCase()
  if (e && (!EMAIL_RE.test(e) || e.length > 190)) return { error: `${label}: ${e} isn’t a valid email address.` }
  return e
}

/**
 * Contact mobiles in the libraries. Venues, vendors and speakers are often abroad (an exhibition in Las Vegas,
 * a speaker from London), so: a number for `country` (the venue's own country, else the company's) is checked
 * and normalized by that country's rules; any other number is accepted in international form
 * (+ or 00, country code, 8–15 digits) and stored as +<digits>.
 */
function mobile(v: unknown, companyId: string, country?: string): string | { error: string } {
  const raw = str(v)
  if (!raw) return ''
  const target = (country || countryOf(companyId)).toUpperCase()
  const known = target in MOBILE_RULES ? (target as CountryCode) : null
  if (known && isMobile(raw, known)) return formatMobile(raw, known)
  const intl = raw.replace(/[\s().-]/g, '')
  const digits = intl.startsWith('+') ? intl.slice(1) : intl.startsWith('00') ? intl.slice(2) : null
  // A number in the target country's own dial code must pass that country's rules.
  const ownDial = known ? MOBILE_RULES[known].dialCode : null
  if (digits !== null && /^\d{8,15}$/.test(digits) && !(ownDial && digits.startsWith(ownDial))) return `+${digits}`
  return {
    error: known
      ? `${mobileError(known)} For a number abroad, use the international form (+ country code).`
      : 'Use the international form: + then the country code and number.',
  }
}

function url(v: unknown, label: string): string | { error: string } {
  const u = str(v)
  if (u && (!URL_RE.test(u) || u.length > 500)) return { error: `Enter the ${label} as a full URL (https://…).` }
  return u
}

function rating(v: unknown): number | null | string {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 'A rating is a whole number from 1 to 5.'
}

const isErr = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in (v as object)

/* ---------------- Speakers ---------------- */

export type CleanSpeaker = Omit<SpeakerRecord, 'id' | 'ratings' | 'createdBy' | 'createdAt' | 'updatedAt'>

/** Validates a speaker (create, or the current entry merged with a PATCH). */
export function cleanSpeaker(companyId: string, input: Partial<SpeakerInput> | null, existing?: SpeakerRecord): CleanSpeaker | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<SpeakerInput>
  const name = str(v.name)
  if (name.length < 2 || name.length > 120) return 'Enter the speaker’s name (2–120 characters).'
  const title = str(v.title)
  const company = str(v.company)
  if (title.length > 120 || company.length > 120) return 'Title or company is too long (120 characters).'
  const bio = str(v.bio)
  if (bio.length > 2000) return 'Keep the bio under 2,000 characters.'
  const photoUrl = str(v.photoUrl)
  if (photoUrl && !(URL_RE.test(photoUrl) && photoUrl.length <= 500) && !(DATA_IMAGE_RE.test(photoUrl) && photoUrl.length <= MAX_DATA_URL)) {
    return 'Enter the photo as a full URL (https://…) or pick an image from Brand Assets.'
  }
  const mail = email(v.email)
  if (isErr(mail)) return mail.error
  const mob = mobile(v.mobile, companyId)
  if (isErr(mob)) return mob.error
  const topics = tags(v.topics, 'Topics')
  if (typeof topics === 'string') return topics
  const linkedin = url(v.linkedinUrl, 'LinkedIn link')
  if (isErr(linkedin)) return linkedin.error
  const kind = (v.kind ?? 'external') as SpeakerRecord['kind']
  if (kind !== 'internal' && kind !== 'external') return 'Kind is internal or external.'
  let userId: string | null = null
  if (kind === 'internal' && v.userId) {
    const u = users.find((x) => x.id === String(v.userId) && x.companyId === companyId)
    if (!u) return 'That employee doesn’t exist.'
    userId = u.id
  }
  const fee = money(v.fee, 'Fee')
  if (typeof fee === 'string') return fee
  const feeCurrency = fee === null ? '' : currency(v.feeCurrency, companyId)
  if (feeCurrency === null) return `Currency must be one of: ${LIBRARY_CURRENCIES.join(', ')}.`
  const notes = str(v.notes)
  if (notes.length > 2000) return 'Keep the notes under 2,000 characters.'
  return { name, title, company, bio, photoUrl, email: mail, mobile: mob, topics, linkedinUrl: linkedin, kind, userId, fee, feeCurrency, notes }
}

export function findSameSpeaker(companyId: string, probe: { name: string; company?: string; email?: string }, exceptId?: string): Tenant<SpeakerRecord> | undefined {
  return speakerDirectory.find((s) => s.companyId === companyId && s.id !== exceptId && sameSpeaker(s, probe))
}

/** A directory speaker of the company (another company's id is invisible). */
export function directorySpeaker(companyId: string, id: unknown): Tenant<SpeakerRecord> | undefined {
  return typeof id === 'string' ? speakerDirectory.find((s) => s.id === id && s.companyId === companyId) : undefined
}

export function speakerView(s: Tenant<SpeakerRecord>): Speaker {
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    company: s.company,
    bio: s.bio,
    photoUrl: s.photoUrl,
    email: s.email,
    mobile: s.mobile,
    topics: [...s.topics],
    linkedinUrl: s.linkedinUrl,
    kind: s.kind,
    userId: s.userId,
    userName: s.userId ? ownerName(s.userId) : '',
    fee: s.fee,
    feeCurrency: s.feeCurrency,
    notes: s.notes,
    rating: averageRating(s.ratings.map((r) => r.rating)),
    ratingCount: s.ratings.length,
    eventCount: new Set(eventSpeakers.filter((l) => l.companyId === s.companyId && l.speakerId === s.id).map((l) => l.eventId)).size,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

/* ---------------- Venues ---------------- */

export type CleanVenue = Omit<VenueRecord, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>

function whole(v: unknown, min: number, max: number): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : 'bad'
}

export function cleanVenue(companyId: string, input: Partial<VenueInput> | null, existing?: VenueRecord, newRoomId?: () => string): CleanVenue | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<VenueInput>
  const name = str(v.name)
  if (name.length < 2 || name.length > 160) return 'Give the venue a name (2–160 characters).'
  const type = (v.type ?? 'other') as VenueRecord['type']
  if (!VENUE_TYPES.includes(type)) return `Type must be one of: ${VENUE_TYPES.join(', ')}.`
  const address = str(v.address)
  const city = str(v.city)
  if (address.length > 255 || city.length > 80) return 'Address or city is too long.'
  const country = (str(v.country) || countryOf(companyId)).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return 'Country is a 2-letter code (AE, SA…).'
  const mapUrl = url(v.mapUrl, 'map link')
  if (isErr(mapUrl)) return mapUrl.error
  const hasLat = v.lat !== null && v.lat !== undefined && v.lat !== ''
  const hasLng = v.lng !== null && v.lng !== undefined && v.lng !== ''
  if (hasLat !== hasLng) return 'Give both latitude and longitude, or neither.'
  const lat = hasLat ? Number(v.lat) : null
  const lng = hasLng ? Number(v.lng) : null
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return 'Latitude must be between -90 and 90.'
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return 'Longitude must be between -180 and 180.'
  const capacity = whole(v.capacity, 1, 1_000_000)
  if (capacity === 'bad') return 'Capacity is a whole number of people (1 or more), or empty.'
  if (v.rooms !== undefined && v.rooms !== null && !Array.isArray(v.rooms)) return 'Rooms must be a list.'
  const rawRooms = (v.rooms ?? []) as { id?: string; name?: string; capacity?: unknown }[]
  if (rawRooms.length > 50) return 'Keep the rooms list to 50.'
  const rooms: VenueRecord['rooms'] = []
  for (const [i, r] of rawRooms.entries()) {
    const rn = str(r?.name)
    if (!rn || rn.length > 80) return `Room ${i + 1}: give it a name (up to 80 characters).`
    const rc = whole(r?.capacity, 1, 1_000_000)
    if (rc === 'bad') return `Room ${i + 1}: capacity is a whole number, or empty.`
    const keep = typeof r?.id === 'string' && existing?.rooms.some((x) => x.id === r.id) && !rooms.some((x) => x.id === r.id) ? r.id : null
    rooms.push({ id: keep ?? (newRoomId ? newRoomId() : `R${i + 1}`), name: rn, capacity: rc })
  }
  const contactName = str(v.contactName)
  if (contactName.length > 120) return 'Keep the contact name under 120 characters.'
  const contactMobile = mobile(v.contactMobile, companyId, country)
  if (isErr(contactMobile)) return contactMobile.error
  const contactEmail = email(v.contactEmail, 'Contact email')
  if (isErr(contactEmail)) return contactEmail.error
  const dayRate = money(v.dayRate, 'Day rate')
  if (typeof dayRate === 'string') return dayRate
  const cur = currency(v.currency, companyId)
  if (cur === null) return `Currency must be one of: ${LIBRARY_CURRENCIES.join(', ')}.`
  const priceNotes = str(v.priceNotes)
  if (priceNotes.length > 1000) return 'Keep the price notes under 1,000 characters.'
  const amenities = tags(v.amenities, 'Amenities')
  if (typeof amenities === 'string') return amenities
  const notes = str(v.notes)
  if (notes.length > 2000) return 'Keep the notes under 2,000 characters.'
  const rate = rating(v.rating)
  if (typeof rate === 'string') return rate
  const status = (v.status ?? 'active') as VenueRecord['status']
  if (status !== 'active' && status !== 'archived') return 'Status is active or archived.'
  return {
    name, type, address, city, country, mapUrl, lat, lng, capacity, rooms, contactName, contactMobile, contactEmail,
    dayRate, currency: cur, priceNotes, amenities, notes, rating: rate, status,
  }
}

export function venueOf(companyId: string, id: unknown): Tenant<VenueRecord> | undefined {
  return typeof id === 'string' ? eventVenues.find((v) => v.id === id && v.companyId === companyId) : undefined
}

/**
 * Picking a venue for an event (create / edit): the company's own venue, active — an archived venue stays
 * only on events that already had it. Another company's id answers exactly like a missing one.
 */
export function venuePickProblem(companyId: string, id: string, currentId: string | null | undefined): string | null {
  const v = venueOf(companyId, id)
  if (!v) return 'That venue doesn’t exist.'
  if (v.status === 'archived' && v.id !== currentId) return `${v.name} is archived; pick an active venue.`
  return null
}

export function venueView(v: Tenant<VenueRecord>): Venue {
  return {
    id: v.id, name: v.name, type: v.type, address: v.address, city: v.city, country: v.country, mapUrl: v.mapUrl, lat: v.lat, lng: v.lng,
    capacity: v.capacity, rooms: v.rooms.map((r) => ({ ...r })), contactName: v.contactName, contactMobile: v.contactMobile, contactEmail: v.contactEmail,
    dayRate: v.dayRate, currency: v.currency, priceNotes: v.priceNotes, amenities: [...v.amenities], notes: v.notes, rating: v.rating, status: v.status,
    eventCount: events.filter((e) => e.companyId === v.companyId && e.venueId === v.id).length,
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  }
}

/* ---------------- Vendors ---------------- */

export type CleanVendor = Omit<VendorRecord, 'id' | 'reviews' | 'createdBy' | 'createdAt' | 'updatedAt'>

export function cleanVendor(companyId: string, input: Partial<VendorInput> | null, existing?: VendorRecord, newDocId?: () => string): CleanVendor | string {
  const v = { ...(existing ?? {}), ...(input ?? {}) } as Partial<VendorInput>
  const category = v.category as VendorRecord['category']
  if (!VENDOR_CATEGORIES.includes(category)) return `Category must be one of: ${VENDOR_CATEGORIES.join(', ')}.`
  const name = str(v.name)
  if (name.length < 2 || name.length > 160) return 'Enter the vendor’s company name (2–160 characters).'
  const contactName = str(v.contactName)
  if (contactName.length > 120) return 'Keep the contact name under 120 characters.'
  const mob = mobile(v.mobile, companyId)
  if (isErr(mob)) return mob.error
  const mail = email(v.email)
  if (isErr(mail)) return mail.error
  const website = url(v.website, 'website')
  if (isErr(website)) return website.error
  const taxNumber = str(v.taxNumber)
  if (taxNumber && !/^[A-Za-z0-9 -]{3,50}$/.test(taxNumber)) return 'The VAT / tax number is 3–50 letters or digits.'
  const paymentTerms = str(v.paymentTerms)
  if (paymentTerms.length > 255) return 'Keep the payment terms under 255 characters.'
  const status = (v.status ?? 'approved') as VendorRecord['status']
  if (!VENDOR_STATUSES.includes(status)) return `Status must be one of: ${VENDOR_STATUSES.join(', ')}.`
  const notes = str(v.notes)
  if (notes.length > 2000) return 'Keep the notes under 2,000 characters.'
  if (v.documents !== undefined && v.documents !== null && !Array.isArray(v.documents)) return 'Documents must be a list.'
  const rawDocs = (v.documents ?? []) as { id?: string; name?: string; url?: string }[]
  if (rawDocs.length > 20) return 'Keep documents to 20 links.'
  const documents: VendorRecord['documents'] = []
  for (const [i, d] of rawDocs.entries()) {
    const dn = str(d?.name)
    const du = str(d?.url)
    if (!dn || dn.length > 120) return `Document ${i + 1}: give it a name (up to 120 characters).`
    if (!URL_RE.test(du) || du.length > 500) return `Document ${i + 1}: enter the link as a full URL (https://…).`
    const keep = typeof d?.id === 'string' && existing?.documents.some((x) => x.id === d.id) && !documents.some((x) => x.id === d.id) ? d.id : null
    documents.push({ id: keep ?? (newDocId ? newDocId() : `D${i + 1}`), name: dn, url: du })
  }
  return { category, name, contactName, mobile: mob, email: mail, website, taxNumber, paymentTerms, status, notes, documents }
}

export function vendorOf(companyId: string, id: unknown): Tenant<VendorRecord> | undefined {
  return typeof id === 'string' ? eventVendors.find((v) => v.id === id && v.companyId === companyId) : undefined
}

/**
 * The blacklist rule for budget lines: a line may name the company's own vendor; a BLACKLISTED vendor can't be
 * picked for a new line (nor newly picked on an existing one). A line that already had the vendor keeps it.
 * Throws 422 (`vendor_blacklisted` for the rule; a foreign id answers exactly like a missing one).
 */
export function assertVendorPick(companyId: string, id: string, currentId: string | null | undefined): Tenant<VendorRecord> {
  const v = vendorOf(companyId, id)
  if (!v) throw new ApiError('That vendor doesn’t exist.', 422)
  if (v.status === 'blacklisted' && v.id !== currentId) {
    throw new CodedApiError(`${v.name} is blacklisted and can’t be picked for budget lines. Pick another vendor or ask a marketing manager.`, 422, 'vendor_blacklisted', { vendorId: v.id })
  }
  return v
}

/**
 * The vendor_id of a budget-line write: absent keeps the current one; null / '' clears it; an id goes
 * through the pick rule (assertVendorPick). Throws before anything is changed.
 */
export function lineVendorId(companyId: string, input: { vendorId?: unknown } | null | undefined, currentId?: string | null): string | null {
  if (!input || input.vendorId === undefined) return currentId ?? null
  if (input.vendorId === null || input.vendorId === '') return null
  return assertVendorPick(companyId, String(input.vendorId), currentId).id
}

/** The vendor fields of a budget line as the API serves them. */
export function lineVendorView(companyId: string, vendorId: string | null | undefined): { vendorId: string | null; vendorName: string | null } {
  const v = vendorId ? vendorOf(companyId, vendorId) : undefined
  return { vendorId: v?.id ?? null, vendorName: v?.name ?? null }
}

/** Completed event: vendors with lines on it and no review for it yet ("Rate after the event"). */
export function vendorsToRateOf(e: { id: string; companyId: string; status: string }): { vendorId: string; vendorName: string }[] {
  if (e.status !== 'completed') return []
  const ids = [...new Set(eventBudgetLines.filter((l) => l.companyId === e.companyId && l.eventId === e.id && l.vendorId).map((l) => l.vendorId as string))]
  return ids
    .map((id) => vendorOf(e.companyId, id))
    .filter((v): v is Tenant<VendorRecord> => !!v && !v.reviews.some((r) => r.eventId === e.id))
    .map((v) => ({ vendorId: v.id, vendorName: v.name }))
}

export function vendorLines(v: Pick<Tenant<VendorRecord>, 'id' | 'companyId'>) {
  return eventBudgetLines.filter((l) => l.companyId === v.companyId && l.vendorId === v.id)
}

export function vendorView(v: Tenant<VendorRecord>): Vendor {
  const lines = vendorLines(v)
  return {
    id: v.id, category: v.category, name: v.name, contactName: v.contactName, mobile: v.mobile, email: v.email, website: v.website,
    taxNumber: v.taxNumber, paymentTerms: v.paymentTerms, status: v.status, notes: v.notes, documents: v.documents.map((d) => ({ ...d })),
    rating: averageRating(v.reviews.map((r) => r.rating)),
    reviewCount: v.reviews.length,
    totalActual: round2(lines.reduce((s, l) => s + l.actual, 0)),
    eventCount: new Set(lines.map((l) => l.eventId)).size,
    currency: companyCurrency(v.companyId),
    createdAt: v.createdAt, updatedAt: v.updatedAt,
  }
}
