import { http, type HttpHandler } from 'msw'
import type {
  AudienceInput,
  AudienceRules,
  KeywordImportRow,
  KeywordInput,
  LandingPageInput,
  LeadFormInput,
  PublicFormSubmitInput,
  SitePageInput,
  UtmLinkInput,
} from '@/modules/marketing/growth/types'
import * as leadGen from '@/shared/mocks/services/leadGen'
import * as aud from '@/shared/mocks/services/audiences'
import * as seo from '@/shared/mocks/services/seo'
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
import { defineMapper } from '@/shared/api/mapping'
import { plainMapper } from '@/shared/api/mappers'
import { API, WORKSPACE_HEADER, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

/** Body or null for an empty / malformed body (the services answer 422). */
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    const raw = (await request.clone().json()) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const rulesBody = defineMapper<{ rules?: Partial<AudienceRules> }>({ nested: { rules: defineMapper({ deep: true }) as never } })
const flag = (v: string | null) => v === 'true' || v === '1'

/**
 * Marketing › growth (docs/API.md › Marketing › Lead generation, Audiences, Website & SEO). /marketing/*
 * is plan-gated centrally (userFrom → enforceRequestPolicy → 403 module_not_in_plan). The /public/*
 * endpoints need no sign-in and check the form's / page's company themselves (404 without Marketing).
 */
export const marketingGrowthHandlers: HttpHandler[] = [
  /* ---- lead capture forms ---- */
  http.get(`${API}/marketing/forms`, ({ request }) => respondAs(leadFormMapper, () => leadGen.listForms(userFrom(request)))),
  http.post(`${API}/marketing/forms`, async ({ request }) => {
    const input = await body<LeadFormInput>(request, leadFormInputMapper)
    return respondAs(leadFormMapper, () => leadGen.createForm(userFrom(request), input as LeadFormInput))
  }),
  http.get<Id>(`${API}/marketing/forms/:id`, ({ request, params }) => respondAs(leadFormMapper, () => leadGen.getForm(userFrom(request), params.id))),
  http.patch<Id>(`${API}/marketing/forms/:id`, async ({ request, params }) => {
    const input = await body<Partial<LeadFormInput>>(request, leadFormInputMapper)
    return respondAs(leadFormMapper, () => leadGen.updateForm(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/marketing/forms/:id`, ({ request, params }) => respondAs(plainMapper, () => leadGen.deleteForm(userFrom(request), params.id))),
  http.get<Id>(`${API}/marketing/forms/:id/submissions`, ({ request, params }) =>
    respondAs(formSubmissionMapper, () => leadGen.listSubmissions(userFrom(request), params.id)),
  ),

  /* ---- landing pages ---- */
  http.get(`${API}/marketing/landing-pages`, ({ request }) => respondAs(landingPageMapper, () => leadGen.listLandingPages(userFrom(request)))),
  http.post(`${API}/marketing/landing-pages`, async ({ request }) => {
    const input = await body<LandingPageInput>(request, landingPageInputMapper)
    return respondAs(landingPageMapper, () => leadGen.createLandingPage(userFrom(request), input as LandingPageInput))
  }),
  http.patch<Id>(`${API}/marketing/landing-pages/:id`, async ({ request, params }) => {
    const input = await body<Partial<LandingPageInput>>(request, landingPageInputMapper)
    return respondAs(landingPageMapper, () => leadGen.updateLandingPage(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/marketing/landing-pages/:id`, ({ request, params }) => respondAs(plainMapper, () => leadGen.deleteLandingPage(userFrom(request), params.id))),

  /* ---- UTM links ---- */
  http.get(`${API}/marketing/utm-links`, ({ request }) => respondAs(utmLinkMapper, () => leadGen.listUtmLinks(userFrom(request)))),
  http.post(`${API}/marketing/utm-links`, async ({ request }) => {
    const input = await body<UtmLinkInput>(request, utmLinkInputMapper)
    return respondAs(utmLinkMapper, () => leadGen.createUtmLink(userFrom(request), input as UtmLinkInput))
  }),
  http.delete<Id>(`${API}/marketing/utm-links/:id`, ({ request, params }) => respondAs(plainMapper, () => leadGen.deleteUtmLink(userFrom(request), params.id))),

  /* ---- public (no auth): hosted form, embed, landing pages ---- */
  http.get<{ key: string }>(`${API}/public/forms/:key`, ({ params }) => respondAs(publicFormMapper, () => leadGen.getPublicForm(params.key))),
  http.post<{ key: string }>(`${API}/public/forms/:key/submit`, async ({ request, params }) => {
    const input = await body<PublicFormSubmitInput>(request, publicSubmitMapper)
    const client = request.headers.get('X-Client-Id')?.trim() || 'anonymous'
    return respondAs(publicSubmitResultMapper, () => leadGen.submitPublicForm(params.key, input, client))
  }),
  // The workspace (company) comes from the host: X-Workspace in the mock (or ?workspace= in dev links).
  http.get<{ slug: string }>(`${API}/public/pages/:slug`, ({ request, params }) => {
    const workspace = request.headers.get(WORKSPACE_HEADER) ?? new URL(request.url).searchParams.get('workspace')
    return respondAs(publicLandingMapper, () => leadGen.getPublicLandingPage(workspace, params.slug))
  }),

  /* ---- audiences ---- */
  http.get(`${API}/marketing/audiences`, ({ request }) => respondAs(audienceListMapper, () => aud.listAudiences(userFrom(request)))),
  http.get(`${API}/marketing/audiences/options`, ({ request }) => respondAs(audienceOptionsMapper, () => aud.getAudienceOptions(userFrom(request)))),
  http.post(`${API}/marketing/audiences/preview`, async ({ request }) => {
    const input = await body<{ rules?: Partial<AudienceRules> }>(request, rulesBody)
    return respondAs(audiencePreviewResultMapper, () => aud.previewRules(userFrom(request), input?.rules))
  }),
  http.post(`${API}/marketing/audiences`, async ({ request }) => {
    const input = await body<AudienceInput>(request, audienceInputMapper)
    return respondAs(audienceMapper, () => aud.createAudience(userFrom(request), input as AudienceInput))
  }),
  http.get<Id>(`${API}/marketing/audiences/:id`, ({ request, params }) => respondAs(audienceMapper, () => aud.getAudience(userFrom(request), params.id))),
  http.patch<Id>(`${API}/marketing/audiences/:id`, async ({ request, params }) => {
    const input = await body<Partial<AudienceInput>>(request, audienceInputMapper)
    return respondAs(audienceMapper, () => aud.updateAudience(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/marketing/audiences/:id`, ({ request, params }) => respondAs(plainMapper, () => aud.deleteAudience(userFrom(request), params.id))),
  http.post<Id>(`${API}/marketing/audiences/:id/freeze`, ({ request, params }) => respondAs(audienceMapper, () => aud.freezeAudience(userFrom(request), params.id))),
  http.get<Id>(`${API}/marketing/audiences/:id/export`, ({ request, params }) => {
    const q = new URL(request.url).searchParams
    const opts = { hashed: flag(q.get(GROWTH_QUERY.hashed)), includeContacts: q.get(GROWTH_QUERY.includeContacts) !== 'false' }
    return respondAs(audienceExportMapper, () => aud.exportAudience(userFrom(request), params.id, opts))
  }),

  /* ---- website & SEO ---- */
  http.get(`${API}/marketing/seo/pages`, ({ request }) => respondAs(sitePagesResultMapper, () => seo.listSitePages(userFrom(request)))),
  http.post(`${API}/marketing/seo/pages`, async ({ request }) => {
    const input = await body<SitePageInput>(request, sitePageInputMapper)
    return respondAs(sitePageMapper, () => seo.createSitePage(userFrom(request), input as SitePageInput))
  }),
  http.patch<Id>(`${API}/marketing/seo/pages/:id`, async ({ request, params }) => {
    const input = await body<Partial<SitePageInput>>(request, sitePageInputMapper)
    return respondAs(sitePageMapper, () => seo.updateSitePage(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/marketing/seo/pages/:id`, ({ request, params }) => respondAs(plainMapper, () => seo.deleteSitePage(userFrom(request), params.id))),
  http.get(`${API}/marketing/seo/keywords`, ({ request }) => respondAs(keywordMapper, () => seo.listKeywords(userFrom(request)))),
  http.post(`${API}/marketing/seo/keywords`, async ({ request }) => {
    const input = await body<KeywordInput>(request, keywordInputMapper)
    return respondAs(keywordMapper, () => seo.createKeyword(userFrom(request), input as KeywordInput))
  }),
  // Before /keywords/:id so "import" isn't read as a keyword id.
  http.post(`${API}/marketing/seo/keywords/import`, async ({ request }) => {
    const input = await body<{ rows?: KeywordImportRow[]; fileName?: string }>(request, keywordImportMapper)
    return respondAs(keywordImportResultMapper, () => seo.importKeywordPositions(userFrom(request), input))
  }),
  http.patch<Id>(`${API}/marketing/seo/keywords/:id`, async ({ request, params }) => {
    const input = await body<Partial<KeywordInput>>(request, keywordInputMapper)
    return respondAs(keywordMapper, () => seo.updateKeyword(userFrom(request), params.id, input ?? {}))
  }),
  http.delete<Id>(`${API}/marketing/seo/keywords/:id`, ({ request, params }) => respondAs(plainMapper, () => seo.deleteKeyword(userFrom(request), params.id))),
  http.post<Id>(`${API}/marketing/seo/keywords/:id/positions`, async ({ request, params }) => {
    const input = await body<{ date?: unknown; position?: unknown }>(request, plainMapper)
    return respondAs(keywordMapper, () => seo.addKeywordPosition(userFrom(request), params.id, input ?? {}))
  }),
  http.get(`${API}/marketing/seo/website-leads`, ({ request }) => {
    const q = new URL(request.url).searchParams
    return respondAs(websiteLeadsMapper, () => seo.getWebsiteLeads(userFrom(request), { from: q.get(GROWTH_QUERY.from) ?? undefined, to: q.get(GROWTH_QUERY.to) ?? undefined }))
  }),
]
