/**
 * Marketing › growth (plan module `marketing`): lead generation (lead capture forms, landing pages, UTM
 * links), audiences (saved lead segments) and website & SEO (site pages, keyword tracker, website leads).
 * Wire names: src/shared/api/marketingGrowthMappers.ts; contract: docs/API.md › Marketing › Lead generation,
 * Audiences, Website & SEO. Nothing here crawls a website or calls Google: every number is entered or
 * imported by the team (or counted by the app's own hosted pages).
 */

/* ---------------- Lead capture forms ---------------- */

/** Lead fields a form can ask for. `message` and `custom` answers go to the lead's first note. */
export type FormFieldType = 'company_name' | 'contact_name' | 'email' | 'mobile' | 'industry' | 'source_detail' | 'message' | 'custom'
export const FORM_FIELD_TYPES: FormFieldType[] = ['contact_name', 'email', 'mobile', 'company_name', 'industry', 'source_detail', 'message', 'custom']
export const FORM_FIELD_LABEL: Record<FormFieldType, string> = {
  company_name: 'Company name',
  contact_name: 'Contact name',
  email: 'Email',
  mobile: 'Mobile',
  industry: 'Industry',
  source_detail: 'How did you hear about us?',
  message: 'Message',
  custom: 'Custom question',
}
/** Custom questions per form. */
export const MAX_CUSTOM_FIELDS = 5

export interface FormField {
  /** Stable within the form (answers are keyed by it). */
  key: string
  type: FormFieldType
  label: string
  required: boolean
}

export type FormStatus = 'active' | 'paused'
export const FORM_STATUS_LABEL: Record<FormStatus, string> = { active: 'Active', paused: 'Paused' }

export interface FormStats {
  /** Hosted page, embed and landing page loads (counted by the public GET). */
  views: number
  /** Every stored submission except spam. */
  submissions: number
  /** submissions ÷ views (0–100, one decimal); null without views. */
  conversionRate: number | null
  leadsCreated: number
  leadsLinked: number
  /** Stored but no lead: the plan's leads + contacts limit was reached. */
  limitReached: number
  spam: number
  /** Leads created by the form that are now in a Won-type status. */
  wonDeals: number
}

export interface LeadForm {
  id: string
  name: string
  /** Public link key: hosted page /f/:publicKey and the embed. */
  publicKey: string
  status: FormStatus
  fields: FormField[]
  successMessage: string
  /** After submitting, the visitor goes here instead of seeing the success message. */
  redirectUrl: string | null
  /** Default owners: new leads go to them in turn (round-robin). Empty = the company's usual auto-assignment. */
  ownerIds: string[]
  ownerNames: string[]
  campaignId: string | null
  campaignName: string | null
  /** Lead source key (Settings › Fixed lists › Lead sources). */
  source: string
  /** Consent checkbox text; empty = no checkbox. When set, the visitor must tick it. */
  consentText: string
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
  stats: FormStats
}

export interface LeadFormInput {
  name: string
  status?: FormStatus
  fields: FormField[]
  successMessage?: string
  redirectUrl?: string | null
  ownerIds?: string[]
  campaignId?: string | null
  source: string
  consentText?: string
}
export type LeadFormUpdateInput = Partial<LeadFormInput>

export type SubmissionOutcome = 'created' | 'linked' | 'limit' | 'spam'
export const SUBMISSION_OUTCOME_LABEL: Record<SubmissionOutcome, string> = {
  created: 'Lead created',
  linked: 'Linked to existing',
  limit: 'Not created (plan limit)',
  spam: 'Spam',
}
export type SubmissionChannel = 'hosted' | 'embed' | 'landing'

export interface FormSubmission {
  id: string
  formId: string
  landingPageId: string | null
  channel: SubmissionChannel
  submittedAt: string
  name: string
  email: string
  mobile: string
  companyName: string
  /** Every answer, in the form's order (label + value). */
  answers: { label: string; value: string }[]
  consent: boolean
  outcome: SubmissionOutcome
  leadId: string | null
  /** The linked lead is Do Not Contact: no outreach, the flag stays. */
  doNotContact: boolean
}

/** GET /public/forms/:key — what the hosted page, the embed and landing pages render. */
export interface PublicForm {
  publicKey: string
  name: string
  fields: (FormField & { options?: { value: string; label: string }[] })[]
  successMessage: string
  redirectUrl: string | null
  consentText: string
  accepting: boolean
  closedReason: string | null
  organizerName: string
  /** ISO country of the company (mobile numbers are checked against it). */
  country: string
}

export interface PublicFormSubmitInput {
  /** Answers keyed by field key. */
  values: Record<string, string>
  consent?: boolean
  /** Honeypot: people never see it; bots fill it. */
  website?: string
  channel?: SubmissionChannel
  /** The landing page the form was submitted from (its slug). */
  landingPage?: string
}

export interface PublicFormSubmitResult {
  ok: true
  message: string
  redirectUrl: string | null
}

/* ---------------- Landing pages ---------------- */

export interface LandingPage {
  id: string
  slug: string
  title: string
  headline: string
  body: string
  /** An image URL (e.g. from Brand Assets); null = no hero image. */
  heroImageUrl: string | null
  formId: string | null
  formName: string | null
  published: boolean
  views: number
  submissions: number
  createdAt: string
  updatedAt: string
}

export interface LandingPageInput {
  slug: string
  title: string
  headline?: string
  body?: string
  heroImageUrl?: string | null
  formId?: string | null
  published?: boolean
}
export type LandingPageUpdateInput = Partial<LandingPageInput>

/** GET /public/pages/:slug (the workspace comes from the host). */
export interface PublicLandingPage {
  title: string
  headline: string
  body: string
  heroImageUrl: string | null
  organizerName: string
  form: PublicForm | null
}

/* ---------------- UTM links ---------------- */

export interface UtmLink {
  id: string
  name: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  campaignId: string | null
  campaignName: string | null
  /** The full tagged URL. */
  url: string
  createdBy: string
  createdByName: string
  createdAt: string
}

export interface UtmLinkInput {
  name?: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  campaignId?: string | null
}

/** Builds the tagged URL (the server applies the same rule). Existing query and #hash are kept. */
export function buildUtmUrl(base: string, p: Pick<UtmLinkInput, 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent'>): string {
  const trimmed = base.trim()
  const [beforeHash, hash = ''] = trimmed.split('#', 2)
  const [path, query = ''] = beforeHash.split('?', 2)
  const params = new URLSearchParams(query)
  const pairs: [string, string | undefined][] = [
    ['utm_source', p.utmSource],
    ['utm_medium', p.utmMedium],
    ['utm_campaign', p.utmCampaign],
    ['utm_term', p.utmTerm],
    ['utm_content', p.utmContent],
  ]
  for (const [k, v] of pairs) {
    const value = (v ?? '').trim()
    if (value) params.set(k, value)
    else params.delete(k)
  }
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

/** utm_campaign value of a campaign name: lower case, words joined by hyphens. */
export const utmSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')

/* ---------------- Audiences ---------------- */

export type StatusType = 'open' | 'cold' | 'won' | 'lost'
export const STATUS_TYPES: StatusType[] = ['open', 'cold', 'won', 'lost']
export const STATUS_TYPE_LABEL: Record<StatusType, string> = { open: 'Open', cold: 'Cold', won: 'Won', lost: 'Lost' }

/** Every list empty / null = no filter. Do Not Contact leads are ALWAYS excluded (not a rule). */
export interface AudienceRules {
  industries: string[]
  statuses: string[]
  /** Status types (open, cold, won, lost): any status of that type. */
  statusTypes: StatusType[]
  sources: string[]
  campaignIds: string[]
  /** Events the lead registered at / attended (Events module). */
  eventIds: string[]
  /**
   * With eventIds: "any" registration (default), "attended" (checked in at one of them) or "no_show"
   * (registered with a seat, never checked in at any of them).
   */
  eventPresence?: EventPresence
  ownerIds: string[]
  /** Company-local dates (YYYY-MM-DD), inclusive. */
  createdFrom: string | null
  createdTo: string | null
  /** Last activity (or creation) before / on or after these dates. */
  lastActivityBefore: string | null
  lastActivityAfter: string | null
  /** true = only leads with a valid email. */
  hasEmail: boolean
}

export type EventPresence = 'any' | 'attended' | 'no_show'
export const EVENT_PRESENCE: EventPresence[] = ['any', 'attended', 'no_show']

export const EMPTY_RULES: AudienceRules = {
  eventPresence: 'any',
  industries: [],
  statuses: [],
  statusTypes: [],
  sources: [],
  campaignIds: [],
  eventIds: [],
  ownerIds: [],
  createdFrom: null,
  createdTo: null,
  lastActivityBefore: null,
  lastActivityAfter: null,
  hasEmail: false,
}

/** dynamic: the rules are applied every time; static: the members frozen at `frozenAt`. */
export type AudienceKind = 'dynamic' | 'static'

export interface AudienceMember {
  leadId: string
  company: string
  name: string
  email: string
  status: string
  ownerName: string
  /** Contacts of the lead with an email (besides the primary). */
  contacts: number
}

export interface AudienceCounts {
  /** Leads in the audience (Do Not Contact already removed). */
  leads: number
  /** Distinct email addresses: the leads' and their contacts'. */
  emails: number
  /** Leads that matched but are Do Not Contact (never included). */
  excludedDnc: number
}

export interface Audience {
  id: string
  name: string
  description: string
  rules: AudienceRules
  kind: AudienceKind
  frozenAt: string | null
  counts: AudienceCounts
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface AudienceDetail extends Audience {
  /** First members (preview list). */
  members: AudienceMember[]
}

export interface AudienceInput {
  name: string
  description?: string
  rules?: Partial<AudienceRules>
  kind?: AudienceKind
}
export type AudienceUpdateInput = Partial<AudienceInput>

export interface AudiencePreviewResult {
  counts: AudienceCounts
  members: AudienceMember[]
}

export interface AudienceOptions {
  owners: { id: string; name: string }[]
  campaigns: { id: string; name: string }[]
  events: { id: string; name: string }[]
}

/** GET /marketing/audiences/:id/export — a CSV ready to upload to an ads platform. */
export interface AudienceExport {
  fileName: string
  /** CSV text: `email` (plain, lower case) or `email_sha256` (SHA-256 hex of the trimmed, lower-cased address). */
  content: string
  rows: number
  hashed: boolean
}

/* ---------------- Website & SEO ---------------- */

export type PageType = 'home' | 'service' | 'product' | 'blog' | 'landing' | 'about' | 'contact' | 'other'
export const PAGE_TYPES: PageType[] = ['home', 'service', 'product', 'blog', 'landing', 'about', 'contact', 'other']
export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  home: 'Home',
  service: 'Service',
  product: 'Product',
  blog: 'Blog post',
  landing: 'Landing page',
  about: 'About',
  contact: 'Contact',
  other: 'Other',
}
export type SitePageStatus = 'draft' | 'published' | 'needs_update'
export const SITE_PAGE_STATUSES: SitePageStatus[] = ['published', 'draft', 'needs_update']
export const SITE_PAGE_STATUS_LABEL: Record<SitePageStatus, string> = { draft: 'Draft', published: 'Published', needs_update: 'Needs update' }

export type SeoCheckKey =
  | 'title_length'
  | 'meta_length'
  | 'h1_present'
  | 'h1_differs'
  | 'keyword_set'
  | 'keyword_in_title'
  | 'keyword_in_h1'
  | 'keyword_in_meta'
  | 'keyword_in_url'
  | 'url_readable'
  | 'duplicate_title'
  | 'duplicate_meta'
export type SeoCheckStatus = 'pass' | 'warn' | 'fail'

export interface SeoCheck {
  key: SeoCheckKey
  label: string
  status: SeoCheckStatus
  detail: string
}

export interface SitePage {
  id: string
  url: string
  title: string
  metaDescription: string
  h1: string
  targetKeyword: string
  pageType: PageType
  status: SitePageStatus
  /** Computed on every save (of any page: duplicates span pages). */
  checks: SeoCheck[]
  /** 0–100: pass = 1, warning = ½, fail = 0, every check weighs the same. */
  score: number
  updatedAt: string
  createdAt: string
}

export interface SitePageInput {
  url: string
  title?: string
  metaDescription?: string
  h1?: string
  targetKeyword?: string
  pageType?: PageType
  status?: SitePageStatus
}
export type SitePageUpdateInput = Partial<SitePageInput>

export interface SeoSummary {
  pages: number
  averageScore: number | null
  /** Pages with at least one failing check. */
  pagesWithIssues: number
  failing: number
  warnings: number
  /** How many pages fail / warn each check. */
  byCheck: { key: SeoCheckKey; label: string; fail: number; warn: number }[]
}

export interface SitePagesResult {
  pages: SitePage[]
  summary: SeoSummary
}

export interface KeywordPosition {
  /** Company-local date (YYYY-MM-DD); one entry per day. */
  date: string
  /** Average position (1 = top), one decimal; null = not ranking that day. */
  position: number | null
}

export interface Keyword {
  id: string
  keyword: string
  targetUrl: string
  searchVolume: number | null
  /** 0–100. */
  difficulty: number | null
  /** ISO country code. */
  country: string
  positions: KeywordPosition[]
  currentPosition: number | null
  previousPosition: number | null
  /** previous − current (positive = moved up); null without two positions. */
  change: number | null
  bestPosition: number | null
  createdAt: string
  updatedAt: string
}

export interface KeywordInput {
  keyword: string
  targetUrl?: string
  searchVolume?: number | null
  difficulty?: number | null
  country?: string
}
export type KeywordUpdateInput = Partial<KeywordInput>

export interface KeywordImportRow {
  /** File row number (for error messages). */
  row: number
  keyword: string
  date: string
  position: string | number | null
}

export interface KeywordImportResult {
  /** Positions saved (new or replaced). */
  imported: number
  /** Keywords that didn't exist and were added. */
  keywordsCreated: number
  failed: { row: number; keyword: string; reason: string }[]
}

export interface WebsiteLeadRow {
  leadId: string
  company: string
  name: string
  createdAt: string
  /** Where it came from: a form, a landing page, or the Website lead source. */
  via: 'form' | 'landing' | 'website_source'
  viaName: string
  status: string
  won: boolean
}

export interface WebsiteLeads {
  from: string
  to: string
  total: number
  /** Per month (YYYY-MM, company time). */
  months: { month: string; forms: number; landing: number; websiteSource: number; total: number }[]
  /** Per form / landing page / the Website source. */
  bySource: { kind: 'form' | 'landing' | 'website_source'; id: string | null; name: string; leads: number; won: number }[]
  /** Latest leads first (up to 100). */
  leads: WebsiteLeadRow[]
}
