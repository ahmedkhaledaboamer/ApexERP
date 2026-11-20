import type { SeoCheck, SeoCheckKey, SeoCheckStatus, SeoSummary, SitePage } from './types'

/**
 * Automatic on-page SEO checks, run by the server on every save (and by the form for a live hint).
 * Pure and deterministic: they read only what the team typed (URL, title, meta description, H1,
 * target keyword). Nothing is crawled.
 */

export const TITLE_MIN = 30
export const TITLE_MAX = 60
export const META_MIN = 70
export const META_MAX = 160
export const URL_MAX = 75

export const SEO_CHECK_LABEL: Record<SeoCheckKey, string> = {
  title_length: `Title ${TITLE_MIN}–${TITLE_MAX} characters`,
  meta_length: `Meta description ${META_MIN}–${META_MAX} characters`,
  h1_present: 'H1 present',
  h1_differs: 'H1 differs from the title',
  keyword_set: 'Target keyword set',
  keyword_in_title: 'Keyword in the title',
  keyword_in_h1: 'Keyword in the H1',
  keyword_in_meta: 'Keyword in the meta description',
  keyword_in_url: 'Keyword in the URL',
  url_readable: 'Readable URL slug',
  duplicate_title: 'Unique title',
  duplicate_meta: 'Unique meta description',
}

type CheckInput = Pick<SitePage, 'url' | 'title' | 'metaDescription' | 'h1' | 'targetKeyword'> & { id?: string }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
/** "AI Chatbot Dubai" → "ai-chatbot-dubai" (for the URL check). */
const slugOf = (s: string) =>
  norm(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')

/** The path of a URL or a bare path ("/services/ai?x=1" → "/services/ai"). */
export function pathOf(url: string): string {
  const u = url.trim()
  const withoutOrigin = u.replace(/^[a-z]+:\/\/[^/]+/i, '')
  return (withoutOrigin.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
}

function urlProblem(url: string): string | null {
  const raw = url.trim()
  const path = pathOf(raw)
  if (raw.replace(/#.*$/, '').includes('?')) return 'Has query parameters; use a clean path.'
  if (/[A-Z]/.test(path)) return 'Use lower case only.'
  if (/_/.test(path)) return 'Use hyphens, not underscores.'
  if (/%20|\s/.test(path)) return 'No spaces in the URL.'
  if (/\d{5,}/.test(path)) return 'Looks like an id; use words.'
  if (/\.(php|aspx?|html?)$/i.test(path)) return 'Drop the file extension.'
  if (path.split('/').filter(Boolean).length > 4) return 'Too many folders (more than 4).'
  if (path.length > URL_MAX) return `Longer than ${URL_MAX} characters.`
  return null
}

const check = (key: SeoCheckKey, status: SeoCheckStatus, detail: string): SeoCheck => ({ key, label: SEO_CHECK_LABEL[key], status, detail })

/**
 * The checks of one page. `others` are the company's other pages (duplicate title / meta).
 * Rules: title 30–60 (empty fail, outside warn); meta 70–160 (empty fail, outside warn); H1 present
 * (fail) and different from the title (warn); target keyword set (warn) and found in the title, H1,
 * meta description and URL slug (warn each); a readable slug (warn); duplicates across pages (fail).
 */
export function seoChecks(page: CheckInput, others: CheckInput[] = []): SeoCheck[] {
  const out: SeoCheck[] = []
  const title = page.title.trim()
  const meta = page.metaDescription.trim()
  const h1 = page.h1.trim()
  const kw = norm(page.targetKeyword)

  if (!title) out.push(check('title_length', 'fail', 'No title.'))
  else if (title.length < TITLE_MIN) out.push(check('title_length', 'warn', `${title.length} characters: too short.`))
  else if (title.length > TITLE_MAX) out.push(check('title_length', 'warn', `${title.length} characters: search engines cut it.`))
  else out.push(check('title_length', 'pass', `${title.length} characters.`))

  if (!meta) out.push(check('meta_length', 'fail', 'No meta description.'))
  else if (meta.length < META_MIN) out.push(check('meta_length', 'warn', `${meta.length} characters: too short.`))
  else if (meta.length > META_MAX) out.push(check('meta_length', 'warn', `${meta.length} characters: search engines cut it.`))
  else out.push(check('meta_length', 'pass', `${meta.length} characters.`))

  out.push(h1 ? check('h1_present', 'pass', 'The page has an H1.') : check('h1_present', 'fail', 'No H1 heading.'))
  if (h1 && title) {
    out.push(norm(h1) === norm(title) ? check('h1_differs', 'warn', 'Same text as the title; vary it.') : check('h1_differs', 'pass', 'Different from the title.'))
  }

  if (!kw) out.push(check('keyword_set', 'warn', 'No target keyword: the keyword checks are skipped.'))
  else {
    out.push(check('keyword_set', 'pass', `“${page.targetKeyword.trim()}”.`))
    const has = (text: string) => norm(text).includes(kw)
    out.push(has(title) ? check('keyword_in_title', 'pass', 'Found.') : check('keyword_in_title', 'warn', 'Not in the title.'))
    out.push(has(h1) ? check('keyword_in_h1', 'pass', 'Found.') : check('keyword_in_h1', 'warn', 'Not in the H1.'))
    out.push(has(meta) ? check('keyword_in_meta', 'pass', 'Found.') : check('keyword_in_meta', 'warn', 'Not in the meta description.'))
    const inUrl = pathOf(page.url).toLowerCase().includes(slugOf(page.targetKeyword))
    out.push(inUrl ? check('keyword_in_url', 'pass', 'Found in the slug.') : check('keyword_in_url', 'warn', `The slug doesn’t contain “${slugOf(page.targetKeyword)}”.`))
  }

  const problem = urlProblem(page.url)
  out.push(problem ? check('url_readable', 'warn', problem) : check('url_readable', 'pass', 'Short, lower case, hyphenated.'))

  const rest = others.filter((o) => !page.id || o.id !== page.id)
  if (title) {
    const dup = rest.filter((o) => norm(o.title) === norm(title))
    out.push(dup.length ? check('duplicate_title', 'fail', `Same title as ${dup.map((d) => pathOf(d.url)).join(', ')}.`) : check('duplicate_title', 'pass', 'No other page uses it.'))
  }
  if (meta) {
    const dup = rest.filter((o) => norm(o.metaDescription) === norm(meta))
    out.push(dup.length ? check('duplicate_meta', 'fail', `Same meta description as ${dup.map((d) => pathOf(d.url)).join(', ')}.`) : check('duplicate_meta', 'pass', 'No other page uses it.'))
  }
  return out
}

/** 0–100: pass 1, warning ½, fail 0; every check weighs the same. */
export function seoScore(checks: SeoCheck[]): number {
  if (!checks.length) return 0
  const points = checks.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0)
  return Math.round((points / checks.length) * 100)
}

/** Site summary over computed pages. */
export function seoSummary(pages: Pick<SitePage, 'checks' | 'score'>[]): SeoSummary {
  const keys = Object.keys(SEO_CHECK_LABEL) as SeoCheckKey[]
  const byCheck = keys.map((key) => ({
    key,
    label: SEO_CHECK_LABEL[key],
    fail: pages.filter((p) => p.checks.some((c) => c.key === key && c.status === 'fail')).length,
    warn: pages.filter((p) => p.checks.some((c) => c.key === key && c.status === 'warn')).length,
  }))
  const all = pages.flatMap((p) => p.checks)
  return {
    pages: pages.length,
    averageScore: pages.length ? Math.round(pages.reduce((s, p) => s + p.score, 0) / pages.length) : null,
    pagesWithIssues: pages.filter((p) => p.checks.some((c) => c.status === 'fail')).length,
    failing: all.filter((c) => c.status === 'fail').length,
    warnings: all.filter((c) => c.status === 'warn').length,
    byCheck: byCheck.filter((c) => c.fail || c.warn),
  }
}
