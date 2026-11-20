import type { User } from '@/shared/types'
import type {
  Keyword,
  KeywordImportResult,
  KeywordImportRow,
  KeywordInput,
  KeywordPosition,
  KeywordUpdateInput,
  PageType,
  SitePage,
  SitePageInput,
  SitePagesResult,
  SitePageStatus,
  SitePageUpdateInput,
  WebsiteLeadRow,
  WebsiteLeads,
} from '@/modules/marketing/growth/types'
import { PAGE_TYPES, SITE_PAGE_STATUSES } from '@/modules/marketing/growth/types'
import { pathOf, seoChecks, seoScore, seoSummary } from '@/modules/marketing/growth/seoChecks'
import { isRealIsoDate, zonedParts } from '@/shared/lib/zonedTime'
import { leads } from '@/shared/mocks/db'
import { landingPages, leadForms, nextGrowthId, seoKeywords, sitePages, type KeywordRecord, type SitePageRecord } from '@/shared/mocks/data/marketingGrowth'
import { isWonStatus, lookupsFor } from '@/shared/mocks/data/lookups'
import { companyById } from '@/shared/mocks/data/tenancy'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, type Tenant } from '@/shared/mocks/tenant'
import { formLeadOrigins, requireMarketingEdit, requireMarketingView } from '@/shared/mocks/services/leadGen'

/* ------------------------------------------------------------------------------------------
 * Marketing › Website & SEO (plan module `marketing`; docs/API.md › Marketing › Website & SEO):
 * the company's site pages with automatic on-page checks (modules/marketing/growth/seoChecks.ts,
 * recomputed for every page on any save: duplicates span pages), a keyword tracker with manual or
 * imported positions, and the leads the website brought. No crawling, no Google APIs.
 * ---------------------------------------------------------------------------------------- */

const PAGE_NOT_FOUND = 'That page doesn’t exist.'
const KEYWORD_NOT_FOUND = 'That keyword doesn’t exist.'
export const MAX_KEYWORD_IMPORT_ROWS = 5000

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const tzOf = (co: string) => companyById(co)?.regional.timezone ?? 'Asia/Dubai'
const countryOf = (co: string) => companyById(co)?.regional.country ?? 'AE'
const untenant = <T extends { companyId: string }>(row: T): Omit<T, 'companyId'> => {
  const { companyId: _c, ...rest } = row
  return rest
}

/* ---------------- Site pages ---------------- */

/** Recomputes the checks and score of every page of the company (a save can create or clear a duplicate elsewhere). */
function recheck(co: string): void {
  const own = sitePages.filter((p) => p.companyId === co)
  for (const p of own) {
    p.checks = seoChecks(p, own)
    p.score = seoScore(p.checks)
  }
}

const pageView = (p: Tenant<SitePageRecord>): SitePage => ({ ...untenant(p), checks: p.checks.map((c) => ({ ...c })) })

export async function listSitePages(user: User): Promise<SitePagesResult> {
  await requireMarketingView(user)
  const pages = scoped(sitePages, user).sort((a, b) => a.score - b.score || pathOf(a.url).localeCompare(pathOf(b.url)))
  return delay({ pages: pages.map(pageView), summary: seoSummary(pages) })
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()

function pageFields(co: string, input: SitePageUpdateInput, existing?: SitePageRecord): Partial<SitePageRecord> | string {
  const out: Partial<SitePageRecord> = {}
  if (input.url !== undefined || !existing) {
    const url = str(input.url)
    if (!url || !(/^https?:\/\/[^\s]+$/i.test(url) || /^\/[^\s]*$/.test(url))) return 'Enter the page URL (https://… or a path starting with /).'
    if (url.length > 500) return 'Keep the URL under 500 characters.'
    if (sitePages.some((p) => p.companyId === co && p.id !== existing?.id && sameUrl(p.url, url))) return 'That page is already in the list.'
    out.url = url
  }
  const text = (key: 'title' | 'metaDescription' | 'h1' | 'targetKeyword', max: number, label: string): string | null => {
    const v = input[key]
    if (v === undefined) return existing ? null : ((out[key] = ''), null)
    const s = str(v)
    if (s.length > max) return `Keep the ${label} under ${max} characters.`
    out[key] = s
    return null
  }
  const problem = text('title', 300, 'title') ?? text('metaDescription', 500, 'meta description') ?? text('h1', 300, 'H1') ?? text('targetKeyword', 120, 'keyword')
  if (problem) return problem
  if (input.pageType !== undefined) {
    if (!PAGE_TYPES.includes(input.pageType as PageType)) return 'Pick a page type.'
    out.pageType = input.pageType
  }
  if (input.status !== undefined) {
    if (!SITE_PAGE_STATUSES.includes(input.status as SitePageStatus)) return 'The status is published, draft or needs update.'
    out.status = input.status
  }
  return out
}

export async function createSitePage(user: User, input: SitePageInput): Promise<SitePage> {
  const co = await requireMarketingEdit(user)
  const fields = pageFields(co, input ?? ({} as SitePageInput))
  if (typeof fields === 'string') return fail(fields, 422)
  const at = nowIso()
  const row: Tenant<SitePageRecord> = stamp(
    {
      id: nextGrowthId('SP'),
      url: fields.url!,
      title: fields.title ?? '',
      metaDescription: fields.metaDescription ?? '',
      h1: fields.h1 ?? '',
      targetKeyword: fields.targetKeyword ?? '',
      pageType: fields.pageType ?? 'other',
      status: fields.status ?? 'published',
      checks: [],
      score: 0,
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  sitePages.push(row)
  recheck(co)
  return delay(pageView(row))
}

async function sitePageFor(user: User, id: string): Promise<Tenant<SitePageRecord>> {
  const p = findInTenant(sitePages, user, (x) => x.id === id)
  if (!p) return fail(PAGE_NOT_FOUND, 404)
  return p
}

export async function updateSitePage(user: User, id: string, input: SitePageUpdateInput): Promise<SitePage> {
  const co = await requireMarketingView(user)
  const p = await sitePageFor(user, id)
  await requireMarketingEdit(user)
  const fields = pageFields(co, input ?? {}, p)
  if (typeof fields === 'string') return fail(fields, 422)
  Object.assign(p, fields, { updatedAt: nowIso() })
  recheck(co)
  return delay(pageView(p))
}

export async function deleteSitePage(user: User, id: string): Promise<{ deleted: true }> {
  const co = await requireMarketingView(user)
  const p = await sitePageFor(user, id)
  await requireMarketingEdit(user)
  sitePages.splice(sitePages.indexOf(p), 1)
  recheck(co)
  return delay({ deleted: true as const })
}

/* ---------------- Keywords ---------------- */

function keywordView(k: Tenant<KeywordRecord>): Keyword {
  const positions = [...k.positions].sort((a, b) => a.date.localeCompare(b.date))
  const current = positions.length ? positions[positions.length - 1].position : null
  const previous = positions.length > 1 ? positions[positions.length - 2].position : null
  const ranked = positions.map((p) => p.position).filter((x): x is number => x !== null)
  return {
    ...untenant(k),
    positions: positions.map((p) => ({ ...p })),
    currentPosition: current,
    previousPosition: previous,
    change: current !== null && previous !== null ? Math.round((previous - current) * 10) / 10 : null,
    bestPosition: ranked.length ? Math.min(...ranked) : null,
  }
}

export async function listKeywords(user: User): Promise<Keyword[]> {
  await requireMarketingView(user)
  return delay(scoped(seoKeywords, user).sort((a, b) => a.keyword.localeCompare(b.keyword)).map(keywordView))
}

const normKw = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

function keywordFields(co: string, input: KeywordUpdateInput, existing?: KeywordRecord): Partial<KeywordRecord> | string {
  const out: Partial<KeywordRecord> = {}
  if (input.keyword !== undefined || !existing) {
    const keyword = normKw(str(input.keyword))
    if (!keyword) return 'Enter the keyword.'
    if (keyword.length > 120) return 'Keep the keyword under 120 characters.'
    out.keyword = keyword
  }
  const country = input.country !== undefined ? str(input.country).toUpperCase() : existing ? existing.country : countryOf(co)
  if (!/^[A-Z]{2}$/.test(country)) return 'The country is a two-letter code (e.g. AE, SA).'
  out.country = country
  const kw = out.keyword ?? existing!.keyword
  if (seoKeywords.some((k) => k.companyId === co && k.id !== existing?.id && k.keyword === kw && k.country === country)) return `“${kw}” is already tracked for ${country}.`
  if (input.targetUrl !== undefined) {
    const u = str(input.targetUrl)
    if (u && !(/^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s]*$/.test(u))) return 'The target URL starts with https:// or /.'
    out.targetUrl = u.slice(0, 500)
  }
  if (input.searchVolume !== undefined) {
    const v = input.searchVolume
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0)) return 'Search volume is a whole number.'
    out.searchVolume = v
  }
  if (input.difficulty !== undefined) {
    const d = input.difficulty
    if (d !== null && (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 100)) return 'Difficulty is 0–100.'
    out.difficulty = d === null ? null : Math.round(d)
  }
  return out
}

export async function createKeyword(user: User, input: KeywordInput): Promise<Keyword> {
  const co = await requireMarketingEdit(user)
  const fields = keywordFields(co, input ?? ({} as KeywordInput))
  if (typeof fields === 'string') return fail(fields, 422)
  const at = nowIso()
  const row: Tenant<KeywordRecord> = stamp(
    {
      id: nextGrowthId('KW'),
      keyword: fields.keyword!,
      targetUrl: fields.targetUrl ?? '',
      searchVolume: fields.searchVolume ?? null,
      difficulty: fields.difficulty ?? null,
      country: fields.country!,
      positions: [],
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  seoKeywords.push(row)
  return delay(keywordView(row))
}

async function keywordFor(user: User, id: string): Promise<Tenant<KeywordRecord>> {
  const k = findInTenant(seoKeywords, user, (x) => x.id === id)
  if (!k) return fail(KEYWORD_NOT_FOUND, 404)
  return k
}

export async function updateKeyword(user: User, id: string, input: KeywordUpdateInput): Promise<Keyword> {
  const co = await requireMarketingView(user)
  const k = await keywordFor(user, id)
  await requireMarketingEdit(user)
  const fields = keywordFields(co, input ?? {}, k)
  if (typeof fields === 'string') return fail(fields, 422)
  Object.assign(k, fields, { updatedAt: nowIso() })
  return delay(keywordView(k))
}

export async function deleteKeyword(user: User, id: string): Promise<{ deleted: true }> {
  await requireMarketingView(user)
  const k = await keywordFor(user, id)
  await requireMarketingEdit(user)
  seoKeywords.splice(seoKeywords.indexOf(k), 1)
  return delay({ deleted: true as const })
}

/** A position value: empty / "-" = not ranking (null); else a number 1–1000, one decimal. */
function positionOf(v: unknown): number | null | false {
  if (v === null || v === undefined) return null
  const s = String(v).trim().replace(',', '.')
  if (s === '' || s === '-' || /^not ranking$/i.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 1 || n > 1000) return false
  return Math.round(n * 10) / 10
}

/** Saves one position; the same date replaces the earlier entry. */
function setPosition(k: Tenant<KeywordRecord>, p: KeywordPosition): void {
  const i = k.positions.findIndex((x) => x.date === p.date)
  if (i >= 0) k.positions[i] = p
  else k.positions.push(p)
  k.positions.sort((a, b) => a.date.localeCompare(b.date))
  k.updatedAt = nowIso()
}

const today = (co: string) => zonedParts(nowMs(), tzOf(co)).date

/** POST /marketing/seo/keywords/:id/positions { date, position } — a manual entry (date ≤ today, company time). */
export async function addKeywordPosition(user: User, id: string, input: { date?: unknown; position?: unknown }): Promise<Keyword> {
  const co = await requireMarketingView(user)
  const k = await keywordFor(user, id)
  await requireMarketingEdit(user)
  const date = str(input?.date)
  if (!isRealIsoDate(date)) return fail('Pick the date of the position (YYYY-MM-DD).', 422)
  if (date > today(co)) return fail('The date can’t be in the future.', 422)
  const position = positionOf(input?.position)
  if (position === false) return fail('The position is a number from 1 to 1000 (empty = not ranking).', 422)
  setPosition(k, { date, position })
  return delay(keywordView(k))
}

/**
 * POST /marketing/seo/keywords/import { rows: [{ row, keyword, date, position }], file_name } — rows of a
 * "keyword,date,position" CSV (like a Search Console export), parsed by the client. Unknown keywords
 * are added (company country); a date already stored for the keyword is replaced. Bad rows are listed.
 */
export async function importKeywordPositions(user: User, input: { rows?: KeywordImportRow[]; fileName?: string } | null): Promise<KeywordImportResult> {
  const co = await requireMarketingEdit(user)
  const rows = Array.isArray(input?.rows) ? input!.rows : null
  if (!rows || !rows.length) return fail('The file has no rows.', 422)
  if (rows.length > MAX_KEYWORD_IMPORT_ROWS) return fail(`Import up to ${MAX_KEYWORD_IMPORT_ROWS.toLocaleString('en-US')} rows at a time.`, 422)
  const out: KeywordImportResult = { imported: 0, keywordsCreated: 0, failed: [] }
  const max = today(co)
  rows.forEach((r, i) => {
    const row = Number(r?.row) || i + 2
    const keyword = normKw(str(r?.keyword))
    const date = str(r?.date)
    if (!keyword || keyword.length > 120) return void out.failed.push({ row, keyword, reason: 'No keyword.' })
    if (!isRealIsoDate(date)) return void out.failed.push({ row, keyword, reason: 'The date must be YYYY-MM-DD.' })
    if (date > max) return void out.failed.push({ row, keyword, reason: 'The date is in the future.' })
    const position = positionOf(r?.position)
    if (position === false) return void out.failed.push({ row, keyword, reason: 'The position must be a number from 1 to 1000.' })
    const country = countryOf(co)
    let k = seoKeywords.find((x) => x.companyId === co && x.keyword === keyword && x.country === country) ?? seoKeywords.find((x) => x.companyId === co && x.keyword === keyword)
    if (!k) {
      const at = nowIso()
      k = stamp({ id: nextGrowthId('KW'), keyword, targetUrl: '', searchVolume: null, difficulty: null, country, positions: [], createdAt: at, updatedAt: at }, user)
      seoKeywords.push(k)
      out.keywordsCreated++
    }
    setPosition(k, { date, position })
    out.imported++
  })
  return delay(out)
}

/* ---------------- Website leads ---------------- */

/** The company's "Website" lead source key, if any (Settings › Fixed lists). */
export function websiteSourceKey(co: string): string | null {
  return lookupsFor(co).sources.find((s) => s.key.toLowerCase() === 'website' || s.label.toLowerCase() === 'website')?.key ?? null
}

/**
 * GET /marketing/seo/website-leads?from=&to= — leads created in the period (company time) that came
 * from the website: through a lead capture form or a landing page (the submission that created them),
 * or with the company's Website lead source. Each lead counts once (form / landing page first).
 */
export async function getWebsiteLeads(user: User, q: { from?: string; to?: string }): Promise<WebsiteLeads> {
  const co = await requireMarketingView(user)
  if (!isRealIsoDate(q.from) || !isRealIsoDate(q.to)) return fail('Pick a valid date range (from and to).', 400)
  if (q.from > q.to) return fail('The start date must be on or before the end date.', 400)
  const tz = tzOf(co)
  const dayOf = (iso: string) => zonedParts(iso, tz).date
  const origins = formLeadOrigins(co)
  const web = websiteSourceKey(co)
  const formName = (id: string) => leadForms.find((f) => f.companyId === co && f.id === id)?.name ?? 'Deleted form'
  const pageName = (id: string) => {
    const p = landingPages.find((x) => x.companyId === co && x.id === id)
    return p ? `/p/${p.slug}` : 'Deleted landing page'
  }
  const rows: (WebsiteLeadRow & { key: string })[] = []
  for (const l of leads) {
    if (l.companyId !== co) continue
    const d = dayOf(l.createdAt)
    if (d < q.from || d > q.to) continue
    const origin = origins.get(l.id)
    const base = { leadId: l.id, company: l.company, name: l.contactName, createdAt: l.createdAt, status: l.status, won: isWonStatus(co, l.status) }
    if (origin?.landingPageId) rows.push({ ...base, via: 'landing', viaName: pageName(origin.landingPageId), key: `landing:${origin.landingPageId}` })
    else if (origin) rows.push({ ...base, via: 'form', viaName: formName(origin.formId), key: `form:${origin.formId}` })
    else if (web && l.sourceType === web) rows.push({ ...base, via: 'website_source', viaName: 'Website (lead source)', key: 'website_source' })
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const months = new Map<string, { month: string; forms: number; landing: number; websiteSource: number; total: number }>()
  for (let m = q.from.slice(0, 7), i = 0; m <= q.to.slice(0, 7) && i < 60; i++) {
    months.set(m, { month: m, forms: 0, landing: 0, websiteSource: 0, total: 0 })
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  const groups = new Map<string, WebsiteLeads['bySource'][number]>()
  for (const r of rows) {
    const b = months.get(dayOf(r.createdAt).slice(0, 7))
    if (b) {
      if (r.via === 'form') b.forms++
      else if (r.via === 'landing') b.landing++
      else b.websiteSource++
      b.total++
    }
    const g = groups.get(r.key) ?? { kind: r.via, id: r.key.includes(':') ? r.key.split(':')[1] : null, name: r.viaName, leads: 0, won: 0 }
    g.leads++
    if (r.won) g.won++
    groups.set(r.key, g)
  }
  return delay({
    from: q.from,
    to: q.to,
    total: rows.length,
    months: [...months.values()],
    bySource: [...groups.values()].sort((a, b) => b.leads - a.leads),
    leads: rows.slice(0, 100).map(({ key: _k, ...r }) => r),
  })
}
