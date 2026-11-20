import { http } from '@/shared/lib/axios'
import { globalStorage } from '@/shared/lib/storage'
import type {
  Audience,
  AudienceDetail,
  AudienceExport,
  AudienceInput,
  AudienceOptions,
  AudiencePreviewResult,
  AudienceRules,
  AudienceUpdateInput,
  FormSubmission,
  Keyword,
  KeywordImportResult,
  KeywordImportRow,
  KeywordInput,
  KeywordUpdateInput,
  LandingPage,
  LandingPageInput,
  LandingPageUpdateInput,
  LeadForm,
  LeadFormInput,
  LeadFormUpdateInput,
  PublicForm,
  PublicFormSubmitInput,
  PublicFormSubmitResult,
  PublicLandingPage,
  SitePage,
  SitePageInput,
  SitePagesResult,
  SitePageUpdateInput,
  UtmLink,
  UtmLinkInput,
  WebsiteLeads,
} from './types'
import {
  GROWTH_QUERY,
  audienceExportMapper,
  audienceInputMapper,
  audienceListMapper,
  audienceMapper,
  audienceOptionsMapper,
  audiencePreviewResultMapper,
  formSubmissionMapper,
  keywordImportMapper,
  keywordImportResultMapper,
  keywordInputMapper,
  keywordMapper,
  landingPageInputMapper,
  landingPageMapper,
  leadFormInputMapper,
  leadFormMapper,
  publicFormMapper,
  publicLandingMapper,
  publicSubmitMapper,
  publicSubmitResultMapper,
  sitePageInputMapper,
  sitePageMapper,
  sitePagesResultMapper,
  utmLinkInputMapper,
  utmLinkMapper,
  websiteLeadsMapper,
} from '@/shared/api/marketingGrowthMappers'

/**
 * Marketing › growth API (lead generation, audiences, website & SEO). The server decides company and
 * rights from the token; bodies and answers use the API names (shared/api/marketingGrowthMappers.ts).
 */

const enc = encodeURIComponent

/* ---------------- Forms ---------------- */

export async function getForms(): Promise<LeadForm[]> {
  return leadFormMapper.fromApiList((await http.get<unknown>('/marketing/forms')).data)
}
export async function getForm(id: string): Promise<LeadForm> {
  return leadFormMapper.fromApi((await http.get<unknown>(`/marketing/forms/${enc(id)}`)).data)
}
export async function createForm(input: LeadFormInput): Promise<LeadForm> {
  return leadFormMapper.fromApi((await http.post<unknown>('/marketing/forms', leadFormInputMapper.toApi(input))).data)
}
export async function updateForm(id: string, input: LeadFormUpdateInput): Promise<LeadForm> {
  return leadFormMapper.fromApi((await http.patch<unknown>(`/marketing/forms/${enc(id)}`, leadFormInputMapper.toApi(input))).data)
}
export async function deleteForm(id: string): Promise<void> {
  await http.delete(`/marketing/forms/${enc(id)}`)
}
export async function getSubmissions(id: string): Promise<FormSubmission[]> {
  return formSubmissionMapper.fromApiList((await http.get<unknown>(`/marketing/forms/${enc(id)}/submissions`)).data)
}

/* ---------------- Landing pages & UTM links ---------------- */

export async function getLandingPages(): Promise<LandingPage[]> {
  return landingPageMapper.fromApiList((await http.get<unknown>('/marketing/landing-pages')).data)
}
export async function createLandingPage(input: LandingPageInput): Promise<LandingPage> {
  return landingPageMapper.fromApi((await http.post<unknown>('/marketing/landing-pages', landingPageInputMapper.toApi(input))).data)
}
export async function updateLandingPage(id: string, input: LandingPageUpdateInput): Promise<LandingPage> {
  return landingPageMapper.fromApi((await http.patch<unknown>(`/marketing/landing-pages/${enc(id)}`, landingPageInputMapper.toApi(input))).data)
}
export async function deleteLandingPage(id: string): Promise<void> {
  await http.delete(`/marketing/landing-pages/${enc(id)}`)
}
export async function getUtmLinks(): Promise<UtmLink[]> {
  return utmLinkMapper.fromApiList((await http.get<unknown>('/marketing/utm-links')).data)
}
export async function createUtmLink(input: UtmLinkInput): Promise<UtmLink> {
  return utmLinkMapper.fromApi((await http.post<unknown>('/marketing/utm-links', utmLinkInputMapper.toApi(input))).data)
}
export async function deleteUtmLink(id: string): Promise<void> {
  await http.delete(`/marketing/utm-links/${enc(id)}`)
}

/* ---------------- Public (no sign-in) ---------------- */

/** The browser's random client id (shared with sign-up and event registration), sent as X-Client-Id for the rate limiter. */
function clientId(): string {
  let id = globalStorage.get('client-id')
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    globalStorage.set('client-id', id)
  }
  return id
}

export async function getPublicForm(key: string): Promise<PublicForm> {
  return publicFormMapper.fromApi((await http.get<unknown>(`/public/forms/${enc(key)}`)).data)
}
export async function submitPublicForm(key: string, input: PublicFormSubmitInput): Promise<PublicFormSubmitResult> {
  const res = await http.post<unknown>(`/public/forms/${enc(key)}/submit`, publicSubmitMapper.toApi(input), { headers: { 'X-Client-Id': clientId() } })
  return publicSubmitResultMapper.fromApi(res.data) as PublicFormSubmitResult
}
/** The workspace (company) comes from the host the page was opened on (X-Workspace in the mock, added by axios). */
export async function getPublicLandingPage(slug: string): Promise<PublicLandingPage> {
  return publicLandingMapper.fromApi((await http.get<unknown>(`/public/pages/${enc(slug)}`)).data)
}

/* ---------------- Audiences ---------------- */

export async function getAudiences(): Promise<Audience[]> {
  return audienceListMapper.fromApiList((await http.get<unknown>('/marketing/audiences')).data)
}
export async function getAudience(id: string): Promise<AudienceDetail> {
  return audienceMapper.fromApi((await http.get<unknown>(`/marketing/audiences/${enc(id)}`)).data)
}
export async function getAudienceOptions(): Promise<AudienceOptions> {
  return audienceOptionsMapper.fromApi((await http.get<unknown>('/marketing/audiences/options')).data)
}
export async function previewAudienceRules(rules: AudienceRules): Promise<AudiencePreviewResult> {
  return audiencePreviewResultMapper.fromApi((await http.post<unknown>('/marketing/audiences/preview', audienceInputMapper.toApi({ name: '', rules }))).data)
}
export async function createAudience(input: AudienceInput): Promise<AudienceDetail> {
  return audienceMapper.fromApi((await http.post<unknown>('/marketing/audiences', audienceInputMapper.toApi(input))).data)
}
export async function updateAudience(id: string, input: AudienceUpdateInput): Promise<AudienceDetail> {
  return audienceMapper.fromApi((await http.patch<unknown>(`/marketing/audiences/${enc(id)}`, audienceInputMapper.toApi(input))).data)
}
export async function deleteAudience(id: string): Promise<void> {
  await http.delete(`/marketing/audiences/${enc(id)}`)
}
export async function freezeAudience(id: string): Promise<AudienceDetail> {
  return audienceMapper.fromApi((await http.post<unknown>(`/marketing/audiences/${enc(id)}/freeze`)).data)
}
export async function exportAudience(id: string, opts: { hashed: boolean; includeContacts: boolean }): Promise<AudienceExport> {
  const params = { [GROWTH_QUERY.hashed]: String(opts.hashed), [GROWTH_QUERY.includeContacts]: String(opts.includeContacts) }
  return audienceExportMapper.fromApi((await http.get<unknown>(`/marketing/audiences/${enc(id)}/export`, { params })).data)
}

/* ---------------- Website & SEO ---------------- */

export async function getSitePages(): Promise<SitePagesResult> {
  return sitePagesResultMapper.fromApi((await http.get<unknown>('/marketing/seo/pages')).data)
}
export async function createSitePage(input: SitePageInput): Promise<SitePage> {
  return sitePageMapper.fromApi((await http.post<unknown>('/marketing/seo/pages', sitePageInputMapper.toApi(input))).data)
}
export async function updateSitePage(id: string, input: SitePageUpdateInput): Promise<SitePage> {
  return sitePageMapper.fromApi((await http.patch<unknown>(`/marketing/seo/pages/${enc(id)}`, sitePageInputMapper.toApi(input))).data)
}
export async function deleteSitePage(id: string): Promise<void> {
  await http.delete(`/marketing/seo/pages/${enc(id)}`)
}
export async function getKeywords(): Promise<Keyword[]> {
  return keywordMapper.fromApiList((await http.get<unknown>('/marketing/seo/keywords')).data)
}
export async function createKeyword(input: KeywordInput): Promise<Keyword> {
  return keywordMapper.fromApi((await http.post<unknown>('/marketing/seo/keywords', keywordInputMapper.toApi(input))).data)
}
export async function updateKeyword(id: string, input: KeywordUpdateInput): Promise<Keyword> {
  return keywordMapper.fromApi((await http.patch<unknown>(`/marketing/seo/keywords/${enc(id)}`, keywordInputMapper.toApi(input))).data)
}
export async function deleteKeyword(id: string): Promise<void> {
  await http.delete(`/marketing/seo/keywords/${enc(id)}`)
}
export async function addKeywordPosition(id: string, date: string, position: number | null): Promise<Keyword> {
  return keywordMapper.fromApi((await http.post<unknown>(`/marketing/seo/keywords/${enc(id)}/positions`, { date, position })).data)
}
export async function importKeywordPositions(rows: KeywordImportRow[], fileName: string): Promise<KeywordImportResult> {
  return keywordImportResultMapper.fromApi((await http.post<unknown>('/marketing/seo/keywords/import', keywordImportMapper.toApi({ rows, fileName }))).data)
}
export async function getWebsiteLeads(from: string, to: string): Promise<WebsiteLeads> {
  const params = { [GROWTH_QUERY.from]: from, [GROWTH_QUERY.to]: to }
  return websiteLeadsMapper.fromApi((await http.get<unknown>('/marketing/seo/website-leads', { params })).data)
}
