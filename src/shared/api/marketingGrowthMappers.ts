import { defineMapper } from './mapping'
import type {
  Audience,
  AudienceDetail,
  AudienceExport,
  AudienceInput,
  AudienceOptions,
  AudiencePreviewResult,
  FormSubmission,
  Keyword,
  KeywordImportResult,
  KeywordImportRow,
  KeywordInput,
  LandingPage,
  LandingPageInput,
  LeadForm,
  LeadFormInput,
  PublicForm,
  PublicFormSubmitInput,
  PublicFormSubmitResult,
  PublicLandingPage,
  SitePage,
  SitePageInput,
  SitePagesResult,
  UtmLink,
  UtmLinkInput,
  WebsiteLeads,
} from '@/modules/marketing/growth/types'

/**
 * Marketing › growth on the wire (lead capture forms = the design's `web_form_endpoints` extended,
 * plus landing pages, UTM links, audiences, SEO pages and keywords — tables the design doesn't have
 * yet: docs/DB-ALIGNMENT.md › Design gaps › Marketing (growth)). Same rules as shared/api/mapping.ts.
 */

/** web_form_endpoints: public_key, default_source_id, default_owner_ids (round-robin), field_map (json), is_active ↔ status. */
const FORM_FIELDS = { source: 'default_source_id', ownerIds: 'default_owner_ids', fields: 'field_map' }
export const leadFormMapper = defineMapper<LeadForm>({ fields: FORM_FIELDS, nested: { stats: defineMapper({ deep: true }) as never } })
export const leadFormInputMapper = defineMapper<LeadFormInput>({ fields: FORM_FIELDS })
export const formSubmissionMapper = defineMapper<FormSubmission>()

/** Public form (no auth): answers are keyed by field id, so `values` is left as is. */
export const publicFormMapper = defineMapper<PublicForm>({ deep: true })
export const publicSubmitMapper = defineMapper<PublicFormSubmitInput>({ opaque: ['values'] })
export const publicSubmitResultMapper = defineMapper<PublicFormSubmitResult>()

export const landingPageMapper = defineMapper<LandingPage>()
export const landingPageInputMapper = defineMapper<LandingPageInput>()
export const publicLandingMapper = defineMapper<PublicLandingPage>({ nested: { form: publicFormMapper as never } })

export const utmLinkMapper = defineMapper<UtmLink>()
export const utmLinkInputMapper = defineMapper<UtmLinkInput>()

/** audiences.rules (json): industries, statuses, status_types, sources, campaign_ids, event_ids, owner_ids, created_from… */
const rulesMapper = defineMapper({ deep: true })
export const audienceMapper = defineMapper<AudienceDetail>({
  nested: { rules: rulesMapper as never, counts: defineMapper({ deep: true }) as never, members: defineMapper() as never },
})
export const audienceListMapper = defineMapper<Audience>({ nested: { rules: rulesMapper as never, counts: defineMapper({ deep: true }) as never } })
export const audienceInputMapper = defineMapper<AudienceInput>({ nested: { rules: rulesMapper as never } })
export const audiencePreviewResultMapper = defineMapper<AudiencePreviewResult>({ deep: true })
export const audienceOptionsMapper = defineMapper<AudienceOptions>({ deep: true })
export const audienceExportMapper = defineMapper<AudienceExport>()

/** seo_pages: meta_description, target_keyword, page_type; checks (derived, json). */
export const sitePageMapper = defineMapper<SitePage>({ nested: { checks: defineMapper() as never } })
export const sitePageInputMapper = defineMapper<SitePageInput>()
export const sitePagesResultMapper = defineMapper<SitePagesResult>({ nested: { pages: sitePageMapper as never, summary: defineMapper({ deep: true }) as never } })

/** seo_keywords + seo_keyword_positions (date, position). */
export const keywordMapper = defineMapper<Keyword>({ nested: { positions: defineMapper() as never } })
export const keywordInputMapper = defineMapper<KeywordInput>()
export const keywordImportMapper = defineMapper<{ rows?: KeywordImportRow[]; fileName?: string }>({ nested: { rows: defineMapper() as never } })
export const keywordImportResultMapper = defineMapper<KeywordImportResult>({ deep: true })

export const websiteLeadsMapper = defineMapper<WebsiteLeads>({ deep: true })

/** Query parameter names. */
export const GROWTH_QUERY = { hashed: 'hashed', includeContacts: 'include_contacts', channel: 'channel', from: 'from', to: 'to', formId: 'form_id' } as const
