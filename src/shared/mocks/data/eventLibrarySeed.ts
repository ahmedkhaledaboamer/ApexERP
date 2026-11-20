import { normalizeMobile } from '@/shared/lib/phone'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { eventSpeakers } from '@/shared/mocks/data/eventExtras'
import { eventVendors, eventVenues, speakerDirectory, type SpeakerRecord, type VendorRecord, type VenueRecord } from '@/shared/mocks/data/eventLibrary'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Seed of the event libraries, per company (different data): Dubai venues and UAE vendors for Apex, Riyadh
 * venues and Saudi vendors for Crest. Runs after the events' own seed (data/eventExtras.ts, which migrates
 * the per-event speakers into the directory): enriches the migrated speakers, adds directory-only ones,
 * links seeded events to venues and budget lines to vendors, and adds ratings / reviews after past events.
 */

const AT = '2026-01-20T08:00:00.000Z'
const ae = (m: string) => normalizeMobile(m, 'AE') ?? m
const sa = (m: string) => normalizeMobile(m, 'SA') ?? m

/* ---------------- Speakers ---------------- */

function enrich(companyId: string, name: string, patch: Partial<SpeakerRecord>): Tenant<SpeakerRecord> | undefined {
  const s = speakerDirectory.find((x) => x.companyId === companyId && x.name.toLowerCase() === name.toLowerCase())
  if (s) Object.assign(s, patch)
  return s
}

const speaker = (companyId: string, id: string, v: Partial<SpeakerRecord> & Pick<SpeakerRecord, 'name'>): Tenant<SpeakerRecord> => ({
  companyId,
  id,
  title: '',
  company: '',
  bio: '',
  photoUrl: '',
  email: '',
  mobile: '',
  topics: [],
  linkedinUrl: '',
  kind: 'external',
  userId: null,
  fee: null,
  feeCurrency: '',
  notes: '',
  ratings: [],
  createdBy: null,
  createdAt: AT,
  updatedAt: AT,
  ...v,
})

enrich(APEX_ID, 'Omar Farouk', {
  topics: ['AI assistants', 'Hospitality tech'],
  linkedinUrl: 'https://www.linkedin.com/in/omar-farouk-demo',
  notes: 'Our go-to demo speaker; needs a lapel mic.',
  ratings: [{ eventId: 'EV-1001', rating: 5, note: 'Packed stand both times.', ratedBy: 'u7', ratedAt: '2026-10-20T10:00:00.000Z' }],
})
enrich(APEX_ID, 'Rania Haddad', { topics: ['Guest experience'], email: 'rania.haddad@marinabay-hotels.example', mobile: ae('0504127788'), fee: 4000, feeCurrency: 'AED' })
enrich(APEX_ID, 'Marco Bellini', { topics: ['Resort operations'], notes: 'Customer reference; prefers afternoon slots.' })
speakerDirectory.push(
  speaker(APEX_ID, 'SPK-1101', {
    name: 'Sara Khoury', title: 'Marketing Manager', company: 'Apex Aora', kind: 'internal', userId: 'u7', email: 'sara@apexaora.ae',
    topics: ['Marketing automation', 'Events ROI'], bio: 'Runs Apex Aora’s events and campaigns.',
  }),
  speaker(APEX_ID, 'SPK-1102', {
    name: 'Dr. Hessa Al Marri', title: 'Professor of Information Systems', company: 'Gulf Business School', fee: 15000, feeCurrency: 'AED',
    topics: ['AI governance', 'Digital government'], email: 'hessa.almarri@gbs-faculty.example', bio: 'Keynote speaker on AI policy in the GCC.',
  }),
)

enrich(CREST_ID, 'Lina Al Saud', {
  topics: ['Cold chain', 'Warehousing'],
  ratings: [{ eventId: 'EV-5001', rating: 4, note: 'Clear briefing; ran 10 minutes over.', ratedBy: 'u102', ratedAt: '2026-10-08T09:00:00.000Z' }],
})
enrich(CREST_ID, 'Daniel Brooks', { topics: ['Freight markets'], fee: 6000, feeCurrency: 'USD', email: 'dbrooks@gulffreight-insights.example' })
speakerDirectory.push(
  speaker(CREST_ID, 'SPK-5101', {
    name: 'Majed Al Dossari', title: 'Sales Manager', company: 'Crest Logistics', kind: 'internal', userId: 'u103', email: 'majed@crestlogistics.sa',
    topics: ['Contract logistics'], bio: 'Leads Crest’s key-account sales team.',
  }),
  speaker(CREST_ID, 'SPK-5102', {
    name: 'Abdulrahman Al Qasim', title: 'Director, Port Operations', company: 'Eastern Gateway Ports', fee: 8000, feeCurrency: 'SAR',
    topics: ['Ports', 'Customs clearance'], mobile: sa('0551239876'),
  }),
)

/* ---------------- Venues ---------------- */

const venue = (companyId: string, id: string, v: Partial<VenueRecord> & Pick<VenueRecord, 'name' | 'type' | 'city' | 'country'>): Tenant<VenueRecord> => ({
  companyId,
  id,
  address: '',
  mapUrl: '',
  lat: null,
  lng: null,
  capacity: null,
  rooms: [],
  contactName: '',
  contactMobile: '',
  contactEmail: '',
  dayRate: null,
  currency: companyId === CREST_ID ? 'SAR' : 'AED',
  priceNotes: '',
  amenities: [],
  notes: '',
  rating: null,
  status: 'active',
  createdBy: null,
  createdAt: AT,
  updatedAt: AT,
  ...v,
})

eventVenues.push(
  venue(APEX_ID, 'VEN-1001', {
    name: 'Dubai World Trade Centre', type: 'exhibition_centre', address: 'Sheikh Zayed Road, Trade Centre 2', city: 'Dubai', country: 'AE',
    lat: 25.2285, lng: 55.2867, capacity: 12000,
    rooms: [{ id: 'VEN-1001-R1', name: 'Hall 7', capacity: 6000 }, { id: 'VEN-1001-R2', name: 'Sheikh Rashid Hall', capacity: 4000 }, { id: 'VEN-1001-R3', name: 'Meeting room 4', capacity: 40 }],
    contactName: 'Aisha Rahimi', contactMobile: ae('0558812240'), contactEmail: 'events.sales@dwtc-venue.example',
    priceNotes: 'Space-only stands per m²; shell scheme extra.', amenities: ['Parking', 'Loading bays', 'Wi-Fi', 'Prayer rooms'], rating: 4,
    notes: 'Book stand space 6 months ahead for GITEX.',
  }),
  venue(APEX_ID, 'VEN-1002', {
    name: 'Jumeirah Emirates Towers', type: 'hotel', address: 'Sheikh Zayed Road', city: 'Dubai', country: 'AE',
    mapUrl: 'https://maps.google.com/?q=Jumeirah+Emirates+Towers', capacity: 450,
    rooms: [{ id: 'VEN-1002-R1', name: 'Ballroom B', capacity: 120 }, { id: 'VEN-1002-R2', name: 'Godolphin Ballroom', capacity: 330 }],
    contactName: 'Julien Moreau', contactMobile: ae('0501234590'), contactEmail: 'banqueting@jet-hotel.example', dayRate: 18000,
    priceNotes: 'Breakfast package AED 145 per person, AV included.', amenities: ['AV included', 'Valet', 'Breakfast'], rating: 5,
  }),
  venue(APEX_ID, 'VEN-1003', {
    name: 'Zoom Webinars (Apex account)', type: 'online_platform', city: 'Online', country: 'AE', capacity: 500,
    priceNotes: 'Annual licence, 500 attendees.', amenities: ['Recording', 'Q&A', 'Polls'],
  }),
  venue(APEX_ID, 'VEN-1004', {
    name: 'Al Bustan Rotana', type: 'hotel', city: 'Dubai', country: 'AE', capacity: 200, status: 'archived',
    notes: 'Archived: renovation until 2027.',
  }),
  venue(CREST_ID, 'VEN-5001', {
    name: 'Riyadh Front Exhibition & Conference Center', type: 'exhibition_centre', address: 'Airport Road, Riyadh Front', city: 'Riyadh', country: 'SA',
    lat: 24.8302, lng: 46.7307, capacity: 20000,
    rooms: [{ id: 'VEN-5001-R1', name: 'Hall 1', capacity: 8000 }, { id: 'VEN-5001-R2', name: 'Hall 2', capacity: 8000 }],
    contactName: 'Saad Al Otaibi', contactMobile: sa('0503344556'), contactEmail: 'exhibitors@rfecc-venue.example', amenities: ['Loading bays', 'Parking', 'Cold storage'],
    rating: 4,
  }),
  venue(CREST_ID, 'VEN-5002', {
    name: 'Hilton Riyadh Hotel & Residences', type: 'hotel', address: 'Eastern Ring Road', city: 'Riyadh', country: 'SA', capacity: 100,
    rooms: [{ id: 'VEN-5002-R1', name: 'Main hall', capacity: 100 }, { id: 'VEN-5002-R2', name: 'Room 2', capacity: 40 }, { id: 'VEN-5002-R3', name: 'Meeting lounge', capacity: 20 }],
    contactName: 'Nasser Al Shehri', contactMobile: sa('0567788990'), contactEmail: 'meetings@hilton-riyadh-venue.example', dayRate: 22000,
    amenities: ['AV included', 'Parking'], notes: 'The forum organiser books the main hall; capacity is theatre style.',
  }),
  venue(CREST_ID, 'VEN-5003', {
    name: 'Crest HQ Training Room', type: 'office', address: 'Olaya Street', city: 'Riyadh', country: 'SA', capacity: 30, amenities: ['Screen', 'Coffee'],
  }),
)

const linkVenue = (eventId: string, venueId: string) => {
  const e = events.find((x) => x.id === eventId)
  if (e) e.venueId = venueId
}
linkVenue('EV-1001', 'VEN-1001')
linkVenue('EV-1002', 'VEN-1001')
linkVenue('EV-1003', 'VEN-1002')
linkVenue('EV-1004', 'VEN-1003')
linkVenue('EV-5001', 'VEN-5001')
linkVenue('EV-5002', 'VEN-5002')

/* ---------------- Vendors ---------------- */

const vendor = (companyId: string, id: string, v: Partial<VendorRecord> & Pick<VendorRecord, 'name' | 'category'>): Tenant<VendorRecord> => ({
  companyId,
  id,
  contactName: '',
  mobile: '',
  email: '',
  website: '',
  taxNumber: '',
  paymentTerms: '',
  status: 'approved',
  notes: '',
  documents: [],
  reviews: [],
  createdBy: null,
  createdAt: AT,
  updatedAt: AT,
  ...v,
})

eventVendors.push(
  vendor(APEX_ID, 'VND-1001', {
    name: 'Expo Craft Stands LLC', category: 'booth_builder', status: 'preferred', contactName: 'Vikram Shetty', mobile: ae('0526671234'),
    email: 'projects@expocraft-stands.example', website: 'https://expocraft-stands.example', taxNumber: '100234567800003', paymentTerms: '50% on order, 50% on handover',
    documents: [{ id: 'VND-1001-D1', name: 'Trade licence 2026', url: 'https://files.expocraft-stands.example/licence-2026.pdf' }],
    reviews: [{ id: 'VND-1001-RV1', eventId: 'EV-1001', rating: 4, notes: 'Stand ready a day early; one screen mount replaced on day 1.', ratedBy: 'u7', ratedAt: '2026-10-22T09:00:00.000Z' }],
  }),
  vendor(APEX_ID, 'VND-1002', { name: 'Emirates Print House', category: 'printing', contactName: 'Rohit Menon', mobile: ae('0559087766'), email: 'orders@emiratesprinthouse.example', paymentTerms: '30 days' }),
  vendor(APEX_ID, 'VND-1003', { name: 'Saffron Events Catering', category: 'catering', contactName: 'Nadia Karam', email: 'events@saffron-catering.example', paymentTerms: '100% before the event' }),
  vendor(APEX_ID, 'VND-1004', {
    name: 'Gulf Giveaways Trading', category: 'giveaways', status: 'blacklisted', contactName: 'Imran Qadir', email: 'sales@gulfgiveaways.example',
    notes: 'Blacklisted: Arab Health order arrived after the show and was not refunded.',
  }),
  vendor(APEX_ID, 'VND-1005', { name: 'Pixel Frame Studio', category: 'photo_video', contactName: 'Lea Novak', website: 'https://pixelframe-studio.example', paymentTerms: '15 days' }),
  vendor(CREST_ID, 'VND-5001', {
    name: 'Najd Booth Builders', category: 'booth_builder', status: 'preferred', contactName: 'Khalid Al Anazi', mobile: sa('0541122334'),
    email: 'build@najdbooths.example', taxNumber: '310987654300003', paymentTerms: '40% advance, balance on completion',
    reviews: [{ id: 'VND-5001-RV1', eventId: 'EV-5001', rating: 5, notes: 'Excellent build quality; reefer demo unit integrated well.', ratedBy: 'u102', ratedAt: '2026-10-10T09:00:00.000Z' }],
  }),
  vendor(CREST_ID, 'VND-5002', { name: 'Al Yamamah Printing Press', category: 'printing', contactName: 'Fahad Al Rashed', email: 'print@alyamamah-press.example', paymentTerms: '30 days' }),
  vendor(CREST_ID, 'VND-5003', { name: 'Riyadh AV Solutions', category: 'av_tech', contactName: 'Omar Bashir', website: 'https://riyadh-av.example' }),
  vendor(CREST_ID, 'VND-5004', {
    name: 'Desert Cargo Express', category: 'logistics', status: 'blacklisted', contactName: 'Hamza Saleh',
    notes: 'Blacklisted: damaged the cold-chain demo unit in transit (2025).',
  }),
)

const linkVendor = (lineId: string, vendorId: string) => {
  const l = eventBudgetLines.find((x) => x.id === lineId)
  if (l) l.vendorId = vendorId
}
linkVendor('EBL-1001-1', 'VND-1001')
linkVendor('EBL-1001-3', 'VND-1002')
linkVendor('EBL-1001-5', 'VND-1003')
linkVendor('EBL-5001-1', 'VND-5001')
linkVendor('EBL-5001-4', 'VND-5002')

/** Loaded for its side effects (imported by services/eventLibrary.ts); the roster size is exported for tests. */
export const seededRosterLinks = () => eventSpeakers.length
