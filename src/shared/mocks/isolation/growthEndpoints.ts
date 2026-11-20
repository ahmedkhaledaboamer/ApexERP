import { addDays, format } from 'date-fns'
import { users } from '@/shared/mocks/db'
import { campaigns } from '@/shared/mocks/data/marketing'
import { audiences, landingPages, leadForms, seoKeywords, sitePages, utmLinks } from '@/shared/mocks/data/marketingGrowth'
import { ADMIN, adminToken, api, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Marketing › growth (handlers/marketingGrowth.ts: lead capture forms,
 * landing pages, UTM links, audiences, website & SEO), spread into ENDPOINTS (endpoints.ts). Samples
 * name the company's own seed rows or create fresh ones through the API (as the company admin).
 */

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const ownCount = <T extends { companyId: string }>(rows: readonly T[]) => (co: Co) => rows.filter((r) => r.companyId === co).length
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}

const form = (co: Co) => first(leadForms, co, 'lead form', (f) => f.status === 'active').id
const page = (co: Co) => first(landingPages, co, 'landing page').id
const link = (co: Co) => first(utmLinks, co, 'UTM link').id
const audience = (co: Co) => first(audiences, co, 'audience').id
const sitePage = (co: Co) => first(sitePages, co, 'site page').id
const keyword = (co: Co) => first(seoKeywords, co, 'keyword').id
const campaign = (co: Co) => first(campaigns, co, 'campaign').id
const agent = (co: Co) => first(users, co, 'sales agent', (u) => u.role === 'Sales Agent' && u.active !== false).id

async function created(co: Co, path: string, body: unknown): Promise<string> {
  const r = await api(adminToken(co), 'POST', path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: POST ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id
}

/** A valid form body in the API's names (web_form_endpoints + field_map). */
const formBody = (co: Co) => ({
  name: `Isolation form ${uniq()}`,
  default_source_id: 'Website',
  campaign_id: campaign(co),
  default_owner_ids: [agent(co)],
  field_map: [
    { key: 'contact_name', type: 'contact_name', label: 'Name', required: true },
    { key: 'email', type: 'email', label: 'Email', required: true },
  ],
})

const PUBLIC_FORM =
  'Public lead capture form (no sign-in by design): the unguessable form key names the form and its company. Unknown key, a company without the Marketing module, a deleted or suspended workspace → the same 404.'

export const GROWTH_ENDPOINTS: Endpoint[] = [
  /* ---- lead capture forms ---- */
  { method: 'GET', path: '/marketing/forms', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(leadForms) } },
  { method: 'POST', path: '/marketing/forms', kind: 'company-write', module: 'marketing', sample: (co) => ({ body: formBody(co) }) },
  { method: 'GET', path: '/marketing/forms/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: form(co) } }) },
  { method: 'PATCH', path: '/marketing/forms/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: form(co) }, body: { success_message: 'Isolation thanks' } }) },
  {
    method: 'DELETE', path: '/marketing/forms/:id', kind: 'company-item', module: 'marketing',
    sample: async (co) => ({ params: { id: await created(co, '/marketing/forms', formBody(co)) } }),
    note: 'Only a form without submissions can be deleted (else 409); the sample creates a fresh one.',
  },
  { method: 'GET', path: '/marketing/forms/:id/submissions', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: form(co) } }) },
  { method: 'GET', path: '/public/forms/:key', kind: 'public', module: 'marketing', reason: PUBLIC_FORM + ' Counts one view of the form.' },
  {
    method: 'POST', path: '/public/forms/:key/submit', kind: 'public', module: 'marketing',
    reason: PUBLIC_FORM + ' Honeypot and rate limit (per client and email); the submission and its lead land in the form’s company only.',
  },

  /* ---- landing pages ---- */
  { method: 'GET', path: '/marketing/landing-pages', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(landingPages) } },
  {
    method: 'POST', path: '/marketing/landing-pages', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { slug: `iso-${uniq()}`, title: 'Isolation page', form_id: form(co), published: true } }),
  },
  { method: 'PATCH', path: '/marketing/landing-pages/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: page(co) }, body: { headline: 'Isolation headline' } }) },
  { method: 'DELETE', path: '/marketing/landing-pages/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: page(co) } }) },
  {
    method: 'GET', path: '/public/pages/:slug', kind: 'public', module: 'marketing',
    reason: 'Public landing page (no sign-in by design). Slugs are unique per company: the workspace the page is opened on (Host; X-Workspace in the mock) names the company, so a slug never resolves in another company. Unpublished / unknown / no Marketing module → 404.',
  },

  /* ---- UTM links ---- */
  { method: 'GET', path: '/marketing/utm-links', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(utmLinks) } },
  {
    method: 'POST', path: '/marketing/utm-links', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { base_url: 'https://example.org/iso', utm_source: 'iso', utm_medium: 'email', campaign_id: campaign(co) } }),
  },
  { method: 'DELETE', path: '/marketing/utm-links/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: link(co) } }) },

  /* ---- audiences ---- */
  { method: 'GET', path: '/marketing/audiences', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(audiences) } },
  { method: 'GET', path: '/marketing/audiences/options', kind: 'company-list', module: 'marketing', sample: () => ({}) },
  {
    method: 'POST', path: '/marketing/audiences/preview', kind: 'company-search', module: 'marketing',
    sample: (co) => ({ body: { rules: { owner_ids: [agent(co)], status_types: ['open'], has_email: true } } }),
  },
  {
    method: 'POST', path: '/marketing/audiences', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { name: `Isolation audience ${uniq()}`, kind: 'static', rules: { campaign_ids: [campaign(co)], owner_ids: [ADMIN[co]] } } }),
  },
  { method: 'GET', path: '/marketing/audiences/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: audience(co) } }) },
  { method: 'PATCH', path: '/marketing/audiences/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: audience(co) }, body: { description: 'Isolation description' } }) },
  { method: 'DELETE', path: '/marketing/audiences/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: audience(co) } }) },
  { method: 'POST', path: '/marketing/audiences/:id/freeze', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: audience(co) } }) },
  { method: 'GET', path: '/marketing/audiences/:id/export', kind: 'company-export', module: 'marketing', sample: (co) => ({ params: { id: audience(co) }, query: { include_contacts: 'true' } }) },

  /* ---- website & SEO ---- */
  { method: 'GET', path: '/marketing/seo/pages', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: (b) => len((b as { pages?: unknown })?.pages), expected: ownCount(sitePages) } },
  {
    method: 'POST', path: '/marketing/seo/pages', kind: 'company-write', module: 'marketing',
    sample: () => ({ body: { url: `/iso-${uniq()}`, title: 'Isolation page title for the SEO checks', meta_description: '', h1: 'Isolation', target_keyword: 'isolation', page_type: 'other' } }),
  },
  { method: 'PATCH', path: '/marketing/seo/pages/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: sitePage(co) }, body: { status: 'needs_update' } }) },
  { method: 'DELETE', path: '/marketing/seo/pages/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: sitePage(co) } }) },
  { method: 'GET', path: '/marketing/seo/keywords', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(seoKeywords) } },
  { method: 'POST', path: '/marketing/seo/keywords', kind: 'company-write', module: 'marketing', sample: () => ({ body: { keyword: `iso keyword ${uniq()}`, search_volume: 100, difficulty: 20 } }) },
  {
    method: 'POST', path: '/marketing/seo/keywords/import', kind: 'company-write', module: 'marketing',
    sample: () => ({ body: { file_name: 'iso.csv', rows: [{ row: 2, keyword: `iso import ${uniq()}`, date: day(-1), position: '12.5' }] } }),
  },
  { method: 'PATCH', path: '/marketing/seo/keywords/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: keyword(co) }, body: { search_volume: 999 } }) },
  { method: 'DELETE', path: '/marketing/seo/keywords/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: keyword(co) } }) },
  { method: 'POST', path: '/marketing/seo/keywords/:id/positions', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: keyword(co) }, body: { date: day(-1), position: 7 } }) },
  { method: 'GET', path: '/marketing/seo/website-leads', kind: 'company-export', module: 'marketing', sample: () => ({ query: { from: day(-365), to: day(0) } }) },
]
