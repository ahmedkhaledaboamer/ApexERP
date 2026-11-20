import { format, subDays } from 'date-fns'
import type {
  AudienceKind,
  AudienceRules,
  FormField,
  FormStatus,
  FormSubmission,
  KeywordPosition,
  PageType,
  SeoCheck,
  SitePageStatus,
} from '@/modules/marketing/growth/types'
import { EMPTY_RULES } from '@/modules/marketing/growth/types'
import { seoChecks, seoScore } from '@/modules/marketing/growth/seoChecks'
import { contacts, leads } from '@/shared/mocks/db'
// Seed order: the events seed sets leads.eventId (the frozen GITEX audience reads it).
import '@/shared/mocks/data/events'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Marketing › growth stores: lead capture forms (the design's web_form_endpoints, extended), their
 * submissions, landing pages, UTM links, audiences, SEO site pages and keywords. Every row carries
 * companyId. Seed ids live in per-company blocks (Apex 1xxx, Crest 5xxx); new rows take ids from a
 * shared counter. The public form rate limit (`formSubmitHits`) is not company data.
 */

export interface LeadFormRecord {
  id: string
  name: string
  publicKey: string
  status: FormStatus
  fields: FormField[]
  successMessage: string
  redirectUrl: string | null
  ownerIds: string[]
  campaignId: string | null
  source: string
  consentText: string
  /** Public GET loads (hosted page, embed, landing pages). */
  views: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type SubmissionRecord = FormSubmission

export interface LandingPageRecord {
  id: string
  slug: string
  title: string
  headline: string
  body: string
  heroImageUrl: string | null
  formId: string | null
  published: boolean
  views: number
  createdAt: string
  updatedAt: string
}

export interface UtmLinkRecord {
  id: string
  name: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  campaignId: string | null
  url: string
  createdBy: string
  createdAt: string
}

export interface AudienceRecord {
  id: string
  name: string
  description: string
  rules: AudienceRules
  kind: AudienceKind
  frozenAt: string | null
  /** Static audiences: the lead ids frozen at `frozenAt` (Do Not Contact is still removed when used). */
  memberLeadIds: string[]
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface SitePageRecord {
  id: string
  url: string
  title: string
  metaDescription: string
  h1: string
  targetKeyword: string
  pageType: PageType
  status: SitePageStatus
  checks: SeoCheck[]
  score: number
  createdAt: string
  updatedAt: string
}

export interface KeywordRecord {
  id: string
  keyword: string
  targetUrl: string
  searchVolume: number | null
  difficulty: number | null
  country: string
  positions: KeywordPosition[]
  createdAt: string
  updatedAt: string
}

export interface FormHit {
  key: string
  at: number
}

export const leadForms = registerArray<Tenant<LeadFormRecord>>('leadForms', [])
export const formSubmissions = registerArray<Tenant<SubmissionRecord>>('formSubmissions', [])
export const landingPages = registerArray<Tenant<LandingPageRecord>>('landingPages', [])
export const utmLinks = registerArray<Tenant<UtmLinkRecord>>('utmLinks', [])
export const audiences = registerArray<Tenant<AudienceRecord>>('audiences', [])
export const sitePages = registerArray<Tenant<SitePageRecord>>('seoPages', [])
export const seoKeywords = registerArray<Tenant<KeywordRecord>>('seoKeywords', [])
export const formSubmitHits = registerArray<FormHit>('formSubmitHits', [])

/** Shared id counter for new growth rows. */
let nextSeq = 1
registerValue('marketingGrowth.seq', () => nextSeq, (v) => {
  nextSeq = Number(v) || 1
})
export function nextGrowthId(prefix: 'LF' | 'FS' | 'LP' | 'UTM' | 'AUD' | 'SP' | 'KW'): string {
  return `${prefix}-${9000 + nextSeq++}`
}

const LETTERS = 'abcdefghijkmnpqrstuvwxyz'

/** Stable public key for a seeded form (FNV-1a over its id → 20 letters), so a copied link survives a reseed. */
function seedKey(id: string): string {
  let h = 0x811c9dc5
  let t = ''
  for (let i = 0; t.length < 20; i++) {
    h ^= (id.charCodeAt(i % id.length) + i * 7) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
    t += LETTERS[h % LETTERS.length]
  }
  return t
}

/** A new public form key: 20 letters, unique across companies, unguessable. */
export function newFormKey(): string {
  for (;;) {
    let t = ''
    for (let i = 0; i < 20; i++) t += LETTERS[Math.floor(Math.random() * LETTERS.length)]
    if (!leadForms.some((f) => f.publicKey === t)) return t
  }
}

/* ---------------- Seed ---------------- */

const NOW = new Date()
const ago = (n: number) => subDays(NOW, n).toISOString()
const day = (n: number) => format(subDays(NOW, n), 'yyyy-MM-dd')

const f = (key: string, type: FormField['type'], label: string, required: boolean): FormField => ({ key, type, label, required })

function form(companyId: string, id: string, v: Omit<LeadFormRecord, 'id' | 'publicKey' | 'createdAt' | 'updatedAt'> & { age: number }): Tenant<LeadFormRecord> {
  const { age, ...rest } = v
  return { companyId, id, publicKey: seedKey(id), ...rest, createdAt: ago(age), updatedAt: ago(Math.max(0, age - 10)) }
}

leadForms.push(
  form('co_apex', 'LF-1001', {
    name: 'Website contact form',
    status: 'active',
    fields: [
      f('contact_name', 'contact_name', 'Your name', true),
      f('email', 'email', 'Work email', true),
      f('mobile', 'mobile', 'Mobile', false),
      f('company_name', 'company_name', 'Company', true),
      f('industry', 'industry', 'Industry', false),
      f('message', 'message', 'How can we help?', false),
    ],
    successMessage: 'Thanks! Our team will get back to you within one business day.',
    redirectUrl: null,
    ownerIds: ['u4', 'u5', 'u6'],
    campaignId: null,
    source: 'Website',
    consentText: 'I agree that Apex Aora may contact me about my request.',
    views: 412,
    createdBy: 'u7',
    age: 160,
  }),
  form('co_apex', 'LF-1002', {
    name: 'AI chatbot demo request',
    status: 'active',
    fields: [
      f('contact_name', 'contact_name', 'Full name', true),
      f('email', 'email', 'Email', true),
      f('company_name', 'company_name', 'Hotel or company', true),
      f('custom_1', 'custom', 'How many guest messages do you get per day?', false),
      f('source_detail', 'source_detail', 'Where did you hear about us?', false),
    ],
    successMessage: 'Your demo request is in. We’ll send you a calendar link shortly.',
    redirectUrl: null,
    ownerIds: ['u5', 'u12'],
    campaignId: 'CMP-1001',
    source: 'LinkedIn',
    consentText: '',
    views: 188,
    createdBy: 'u7',
    age: 70,
  }),
  form('co_crest', 'LF-5001', {
    name: 'Request a logistics quote',
    status: 'active',
    fields: [
      f('company_name', 'company_name', 'Company', true),
      f('contact_name', 'contact_name', 'Contact person', true),
      f('mobile', 'mobile', 'Mobile', true),
      f('email', 'email', 'Email', false),
      f('custom_1', 'custom', 'Pallets per month', false),
      f('message', 'message', 'Route and cargo details', false),
    ],
    successMessage: 'Thank you. A Crest account manager will call you with a quote.',
    redirectUrl: null,
    ownerIds: ['u104', 'u105'],
    campaignId: 'CMP-5002',
    source: 'Website',
    consentText: 'I agree to be contacted about this quote.',
    views: 236,
    createdBy: 'u102',
    age: 120,
  }),
  form('co_crest', 'LF-5002', {
    name: 'Cold-chain brochure download',
    status: 'paused',
    fields: [f('contact_name', 'contact_name', 'Name', true), f('email', 'email', 'Email', true), f('industry', 'industry', 'Industry', false)],
    successMessage: 'Check your inbox for the brochure.',
    redirectUrl: 'https://crestlogistics.sa/thank-you',
    ownerIds: [],
    campaignId: null,
    source: 'Website',
    consentText: '',
    views: 57,
    createdBy: 'u102',
    age: 200,
  }),
)

/** Seed submissions: the company's Website-source leads came in through its first form. */
function seedSubmissions(companyId: string, formId: string, prefix: string): void {
  const fromWebsite = leads.filter((l) => l.companyId === companyId && l.sourceType === 'Website').slice(0, 12)
  fromWebsite.forEach((l, i) => {
    const c = contacts.find((x) => x.companyId === companyId && x.leadId === l.id)
    formSubmissions.push({
      companyId,
      id: `FS-${prefix}${String(i + 1).padStart(2, '0')}`,
      formId,
      landingPageId: null,
      channel: i % 3 === 0 ? 'embed' : 'hosted',
      submittedAt: l.createdAt,
      name: c?.name || l.contactName,
      email: (c?.email || l.contactEmail || '').toLowerCase(),
      mobile: c?.mobile || l.mobile || '',
      companyName: l.company,
      answers: [],
      consent: true,
      outcome: 'created',
      leadId: l.id,
      doNotContact: false,
    })
  })
}
seedSubmissions('co_apex', 'LF-1001', '10')
seedSubmissions('co_crest', 'LF-5001', '50')
formSubmissions.push(
  {
    companyId: 'co_apex', id: 'FS-1090', formId: 'LF-1001', landingPageId: null, channel: 'hosted', submittedAt: ago(3),
    name: 'Promo Bot', email: 'offers@cheap-seo-links.example', mobile: '', companyName: 'Cheap SEO Links', answers: [{ label: 'How can we help?', value: 'Buy backlinks now!!!' }],
    consent: false, outcome: 'spam', leadId: null, doNotContact: false,
  },
  {
    companyId: 'co_crest', id: 'FS-5090', formId: 'LF-5001', landingPageId: null, channel: 'hosted', submittedAt: ago(5),
    name: 'Bulk Mailer', email: 'deals@mass-mailer.example', mobile: '', companyName: 'Mass Mailer', answers: [],
    consent: false, outcome: 'spam', leadId: null, doNotContact: false,
  },
)

landingPages.push(
  {
    companyId: 'co_apex', id: 'LP-1001', slug: 'ai-chatbot-demo', title: 'AI chatbot for hotels | Book a demo',
    headline: 'Answer every guest in seconds, in Arabic and English',
    body: 'Our AI concierge handles bookings, late check-outs and FAQs on WhatsApp and your website.\n\nSee it live with your own hotel data in a 20-minute demo.',
    heroImageUrl: null, formId: 'LF-1002', published: true, views: 164, createdAt: ago(65), updatedAt: ago(20),
  },
  {
    companyId: 'co_apex', id: 'LP-1002', slug: 'ocr-invoices', title: 'Invoice OCR for finance teams',
    headline: 'Stop typing invoices', body: 'Draft page for the Q1 OCR campaign.', heroImageUrl: null, formId: 'LF-1001', published: false, views: 0, createdAt: ago(9), updatedAt: ago(9),
  },
  {
    companyId: 'co_crest', id: 'LP-5001', slug: 'cold-chain-quote', title: 'Cold-chain trucking across the Kingdom',
    headline: 'Temperature-controlled delivery from Riyadh to every region',
    body: 'Reefer trucks, GPS temperature logs and next-day delivery to Jeddah and Dammam.\n\nTell us about your cargo and get a quote today.',
    heroImageUrl: null, formId: 'LF-5001', published: true, views: 98, createdAt: ago(50), updatedAt: ago(15),
  },
)

utmLinks.push(
  {
    companyId: 'co_apex', id: 'UTM-1001', name: 'LinkedIn InMail – chatbot demo', baseUrl: 'https://apexaora.ae/p/ai-chatbot-demo',
    utmSource: 'linkedin', utmMedium: 'inmail', utmCampaign: 'q4-outreach', utmTerm: '', utmContent: 'hotel-gm',
    campaignId: 'CMP-1001', url: 'https://apexaora.ae/p/ai-chatbot-demo?utm_source=linkedin&utm_medium=inmail&utm_campaign=q4-outreach&utm_content=hotel-gm',
    createdBy: 'u7', createdAt: ago(60),
  },
  {
    companyId: 'co_apex', id: 'UTM-1002', name: 'Newsletter footer', baseUrl: 'https://apexaora.ae/contact',
    utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'year-end', utmTerm: '', utmContent: 'footer',
    campaignId: 'CMP-1003', url: 'https://apexaora.ae/contact?utm_source=newsletter&utm_medium=email&utm_campaign=year-end&utm_content=footer',
    createdBy: 'u7', createdAt: ago(12),
  },
  {
    companyId: 'co_crest', id: 'UTM-5001', name: 'Sponsored post – cold chain', baseUrl: 'https://crestlogistics.sa/cold-chain',
    utmSource: 'linkedin', utmMedium: 'paid', utmCampaign: 'linkedin-sponsored-content-q4', utmTerm: 'reefer', utmContent: '',
    campaignId: 'CMP-5002', url: 'https://crestlogistics.sa/cold-chain?utm_source=linkedin&utm_medium=paid&utm_campaign=linkedin-sponsored-content-q4&utm_term=reefer',
    createdBy: 'u102', createdAt: ago(40),
  },
)

const rules = (r: Partial<AudienceRules>): AudienceRules => ({ ...EMPTY_RULES, ...r })

audiences.push(
  {
    companyId: 'co_apex', id: 'AUD-1001', name: 'Healthcare & real estate, open', description: 'Open leads in our two main verticals, with an email.',
    rules: rules({ industries: ['Healthcare', 'Real Estate'], statusTypes: ['open'], hasEmail: true }), kind: 'dynamic', frozenAt: null, memberLeadIds: [],
    createdBy: 'u7', createdAt: ago(30), updatedAt: ago(30),
  },
  {
    companyId: 'co_apex', id: 'AUD-1002', name: 'GITEX visitors (frozen)', description: 'Everyone captured on the GITEX stand, frozen after the show.',
    rules: rules({ eventIds: ['EV-1001'] }), kind: 'static', frozenAt: ago(28),
    memberLeadIds: leads.filter((l) => l.companyId === 'co_apex' && (l as { eventId?: string | null }).eventId === 'EV-1001').map((l) => l.id),
    createdBy: 'u7', createdAt: ago(28), updatedAt: ago(28),
  },
  {
    companyId: 'co_crest', id: 'AUD-5001', name: 'Cold leads to re-engage', description: 'Cold or no-response leads with an email.',
    rules: rules({ statuses: ['No response'], statusTypes: ['cold'], hasEmail: true }), kind: 'dynamic', frozenAt: null, memberLeadIds: [],
    createdBy: 'u102', createdAt: ago(18), updatedAt: ago(18),
  },
)

type SeedPage = Omit<SitePageRecord, 'checks' | 'score' | 'createdAt' | 'updatedAt'> & { age: number }

function seedPages(companyId: string, list: SeedPage[]): void {
  const rows = list.map(({ age, ...p }) => ({ companyId, ...p, checks: [] as SeoCheck[], score: 0, createdAt: ago(age + 30), updatedAt: ago(age) }))
  for (const p of rows) {
    p.checks = seoChecks(p, rows)
    p.score = seoScore(p.checks)
  }
  sitePages.push(...rows)
}

seedPages('co_apex', [
  { id: 'SP-1001', url: 'https://apexaora.ae/', title: 'Apex Aora | AI chatbots, OCR and CRM automation in the UAE', metaDescription: 'Apex Aora builds AI chatbots, OCR and CRM automation for hotels, clinics and real-estate teams across the UAE. Book a free consultation.', h1: 'AI that answers, reads and follows up for you', targetKeyword: 'ai chatbot uae', pageType: 'home', status: 'published', age: 20 },
  { id: 'SP-1002', url: 'https://apexaora.ae/services/ai-chatbot-dubai', title: 'AI chatbot Dubai for hotels and clinics | Apex Aora', metaDescription: 'A bilingual AI chatbot for Dubai hotels and clinics: bookings, FAQs and WhatsApp replies in seconds, connected to your CRM.', h1: 'AI chatbot for Dubai hotels and clinics', targetKeyword: 'ai chatbot dubai', pageType: 'service', status: 'published', age: 14 },
  { id: 'SP-1003', url: 'https://apexaora.ae/services/OCR_Invoices', title: 'OCR', metaDescription: 'Read invoices automatically.', h1: 'OCR', targetKeyword: 'invoice ocr', pageType: 'service', status: 'needs_update', age: 90 },
  { id: 'SP-1004', url: 'https://apexaora.ae/blog/crm-automation-checklist', title: 'CRM automation checklist for UAE sales teams', metaDescription: 'Twelve CRM automations that save a UAE sales team hours every week, from follow-up reminders to lead scoring.', h1: '', targetKeyword: 'crm automation', pageType: 'blog', status: 'published', age: 45 },
  { id: 'SP-1005', url: 'https://apexaora.ae/contact', title: 'Apex Aora | AI chatbots, OCR and CRM automation in the UAE', metaDescription: 'Talk to Apex Aora about AI chatbots, OCR and CRM automation. Call, email or visit our Dubai office.', h1: 'Contact us', targetKeyword: '', pageType: 'contact', status: 'published', age: 60 },
])
seedPages('co_crest', [
  { id: 'SP-5001', url: 'https://crestlogistics.sa/', title: 'Crest Logistics | Freight, warehousing and cold chain in KSA', metaDescription: 'Crest Logistics moves freight across Saudi Arabia: cold-chain trucking, bonded warehousing and last-mile delivery from Riyadh.', h1: 'Logistics that keeps Saudi business moving', targetKeyword: 'logistics company riyadh', pageType: 'home', status: 'published', age: 10 },
  { id: 'SP-5002', url: 'https://crestlogistics.sa/cold-chain', title: 'Cold chain logistics in Riyadh and Jeddah', metaDescription: 'Temperature-controlled trucking with live GPS temperature logs, next-day delivery to Jeddah and Dammam.', h1: 'Cold chain logistics', targetKeyword: 'cold chain logistics', pageType: 'service', status: 'published', age: 25 },
  { id: 'SP-5003', url: 'https://crestlogistics.sa/warehousing?ref=menu', title: 'Warehousing', metaDescription: '', h1: 'Warehousing', targetKeyword: 'warehousing saudi arabia', pageType: 'service', status: 'draft', age: 5 },
  { id: 'SP-5004', url: 'https://crestlogistics.sa/about', title: 'About Crest Logistics: twenty years of Saudi freight', metaDescription: 'Founded in Riyadh, Crest Logistics runs a fleet of 180 trucks and three warehouses serving retailers and manufacturers.', h1: 'About us', targetKeyword: '', pageType: 'about', status: 'published', age: 120 },
])

/** Weekly positions, oldest first (`series` = positions from 7 weeks ago to this week). */
function history(series: (number | null)[]): KeywordPosition[] {
  return series.map((position, i) => ({ date: day((series.length - 1 - i) * 7), position }))
}

function kw(companyId: string, id: string, keyword: string, targetUrl: string, searchVolume: number | null, difficulty: number | null, country: string, series: (number | null)[], age: number): Tenant<KeywordRecord> {
  return { companyId, id, keyword, targetUrl, searchVolume, difficulty, country, positions: history(series), createdAt: ago(age), updatedAt: ago(0) }
}

seoKeywords.push(
  kw('co_apex', 'KW-1001', 'ai chatbot dubai', 'https://apexaora.ae/services/ai-chatbot-dubai', 880, 42, 'AE', [24, 19, 17, 15, 12, 11, 9, 8], 60),
  kw('co_apex', 'KW-1002', 'crm automation uae', 'https://apexaora.ae/blog/crm-automation-checklist', 320, 35, 'AE', [null, 48, 41, 37, 33, 35, 29, 27], 55),
  kw('co_apex', 'KW-1003', 'invoice ocr', 'https://apexaora.ae/services/OCR_Invoices', 1300, 61, 'AE', [38, 36, 40, 44, 47, 52, 55, 58], 80),
  kw('co_crest', 'KW-5001', 'cold chain logistics riyadh', 'https://crestlogistics.sa/cold-chain', 590, 38, 'SA', [14, 12, 10, 9, 7, 6, 6, 5], 70),
  kw('co_crest', 'KW-5002', 'warehousing saudi arabia', 'https://crestlogistics.sa/warehousing', 1900, 57, 'SA', [62, 58, 55, 51, 49, 46, 44, 41], 45),
)
