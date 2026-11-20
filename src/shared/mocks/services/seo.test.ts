import { describe, expect, it } from 'vitest'
import { format, subDays } from 'date-fns'
import { leads } from '@/shared/mocks/db'
import { leadForms, seoKeywords, sitePages } from '@/shared/mocks/data/marketingGrowth'
import { seoChecks, seoScore, seoSummary } from '@/modules/marketing/growth/seoChecks'
import { parseKeywordCsv } from '@/modules/marketing/growth/csv'
import type { SeoCheck } from '@/modules/marketing/growth/types'
import { APEX, api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * Website & SEO: the on-page checks (pure), duplicate titles / metas across pages recomputed on every
 * save, the keyword tracker (manual entries, CSV import like a Search Console export, current vs
 * previous position) and the website leads report.
 */

useSeedPerTest()

const apexAdmin = (method: string, path: string, body?: unknown) => api(userToken('u1'), method, path, { body })
const status = (checks: SeoCheck[], key: string) => checks.find((c) => c.key === key)?.status
const day = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd')
const GOOD = {
  url: 'https://example.org/services/ai-chatbot',
  title: 'AI chatbot for hotels in Dubai | Example Co', // 43
  metaDescription: 'Our AI chatbot answers hotel guests on WhatsApp and the website in Arabic and English, around the clock, connected to your CRM.',
  h1: 'An AI chatbot that answers every guest',
  targetKeyword: 'ai chatbot',
}

describe('seoChecks (pure)', () => {
  it('a well-formed page passes every check (score 100)', () => {
    const checks = seoChecks(GOOD)
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([])
    expect(seoScore(checks)).toBe(100)
  })

  it('title 30–60 and meta 70–160: empty fails, outside warns', () => {
    expect(status(seoChecks({ ...GOOD, title: '' }), 'title_length')).toBe('fail')
    expect(status(seoChecks({ ...GOOD, title: 'Too short ai chatbot' }), 'title_length')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, title: `ai chatbot ${'x'.repeat(60)}` }), 'title_length')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, title: 'a'.repeat(30) }), 'title_length')).toBe('pass')
    expect(status(seoChecks({ ...GOOD, title: 'a'.repeat(60) }), 'title_length')).toBe('pass')
    expect(status(seoChecks({ ...GOOD, metaDescription: '' }), 'meta_length')).toBe('fail')
    expect(status(seoChecks({ ...GOOD, metaDescription: 'Short ai chatbot text.' }), 'meta_length')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, metaDescription: 'm'.repeat(161) }), 'meta_length')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, metaDescription: 'm'.repeat(70) }), 'meta_length')).toBe('pass')
  })

  it('H1 present (fail) and different from the title (warn)', () => {
    expect(status(seoChecks({ ...GOOD, h1: '' }), 'h1_present')).toBe('fail')
    expect(status(seoChecks({ ...GOOD, h1: GOOD.title.toUpperCase() }), 'h1_differs')).toBe('warn')
  })

  it('keyword: set, and found in the title, H1, meta and URL slug (case-insensitive)', () => {
    const none = seoChecks({ ...GOOD, targetKeyword: '' })
    expect(status(none, 'keyword_set')).toBe('warn')
    expect(none.some((c) => c.key === 'keyword_in_title')).toBe(false)
    const missing = seoChecks({ ...GOOD, targetKeyword: 'crm automation' })
    for (const k of ['keyword_in_title', 'keyword_in_h1', 'keyword_in_meta', 'keyword_in_url']) expect(status(missing, k), k).toBe('warn')
    expect(status(seoChecks({ ...GOOD, targetKeyword: 'AI Chatbot' }), 'keyword_in_url')).toBe('pass')
  })

  it('readable URL slug: lower case, hyphens, no query, no ids, not too deep', () => {
    expect(status(seoChecks({ ...GOOD, url: 'https://example.org/Services/AI' }), 'url_readable')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, url: 'https://example.org/services/ai_chatbot' }), 'url_readable')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, url: 'https://example.org/p?id=123' }), 'url_readable')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, url: 'https://example.org/p/1234567' }), 'url_readable')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, url: '/a/b/c/d/e' }), 'url_readable')).toBe('warn')
    expect(status(seoChecks({ ...GOOD, url: '/services/ai-chatbot' }), 'url_readable')).toBe('pass')
  })

  it('duplicate titles and metas across pages fail; the page itself is not a duplicate', () => {
    const a = { ...GOOD, id: 'a' }
    const b = { ...GOOD, id: 'b', url: '/other' }
    expect(status(seoChecks(a, [a, b]), 'duplicate_title')).toBe('fail')
    expect(status(seoChecks(a, [a, b]), 'duplicate_meta')).toBe('fail')
    expect(status(seoChecks(a, [a]), 'duplicate_title')).toBe('pass')
    const summary = seoSummary([{ checks: seoChecks(a, [a, b]), score: 80 }, { checks: seoChecks(GOOD), score: 100 }])
    expect(summary).toMatchObject({ pages: 2, averageScore: 90, pagesWithIssues: 1 })
    expect(summary.byCheck.find((c) => c.key === 'duplicate_title')?.fail).toBe(1)
  })
})

describe('site pages API', () => {
  it('checks are computed on save; a duplicate title flags both pages and clears when fixed', async () => {
    const seed = sitePages.find((p) => p.id === 'SP-1002')!
    const r = await apexAdmin('POST', '/marketing/seo/pages', { url: '/services/copy', title: seed.title, meta_description: 'Different meta description long enough to pass the length check of seventy chars.', h1: 'Copy', target_keyword: '', page_type: 'service' })
    expect(r.status, r.text).toBe(200)
    expect(r.body.checks.find((c: { key: string }) => c.key === 'duplicate_title').status).toBe('fail')
    expect(seed.checks.find((c) => c.key === 'duplicate_title')?.status).toBe('fail')
    const fixed = await apexAdmin('PATCH', `/marketing/seo/pages/${r.body.id}`, { title: 'A unique title for the copied page, long enough' })
    expect(fixed.body.checks.find((c: { key: string }) => c.key === 'duplicate_title').status).toBe('pass')
    expect(seed.checks.find((c) => c.key === 'duplicate_title')?.status).toBe('pass')
    expect(typeof fixed.body.score).toBe('number')
  })

  it('the list has a site summary; the seed has duplicates and failing pages', async () => {
    const r = await apexAdmin('GET', '/marketing/seo/pages')
    expect(r.status).toBe(200)
    expect(r.body.summary.pages).toBe(r.body.pages.length)
    expect(r.body.summary.pages_with_issues).toBeGreaterThan(0)
    expect(r.body.summary.by_check.some((c: { key: string }) => c.key === 'duplicate_title')).toBe(true)
    // Worst pages first.
    const scores = r.body.pages.map((p: { score: number }) => p.score)
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
  })

  it('validation: URL required and unique per company', async () => {
    expect((await apexAdmin('POST', '/marketing/seo/pages', { url: 'not a url' })).status).toBe(422)
    expect((await apexAdmin('POST', '/marketing/seo/pages', { url: 'https://apexaora.ae/contact/' })).status).toBe(422)
    // The same URL in the other company is fine (company-scoped uniqueness).
    expect((await api(userToken('u101'), 'POST', '/marketing/seo/pages', { body: { url: 'https://apexaora.ae/contact' } })).status).toBe(200)
  })
})

describe('keyword tracker', () => {
  it('current vs previous position and change', async () => {
    const r = await apexAdmin('GET', '/marketing/seo/keywords')
    const kw = r.body.find((k: { keyword: string }) => k.keyword === 'ai chatbot dubai')
    expect(kw).toMatchObject({ current_position: 8, previous_position: 9, change: 1, best_position: 8 })
    const falling = r.body.find((k: { keyword: string }) => k.keyword === 'invoice ocr')
    expect(falling.change).toBe(-3)
  })

  it('manual entry: one per date (replaced), not in the future, 1–1000 or empty = not ranking', async () => {
    const add = (date: string, position: unknown) => apexAdmin('POST', '/marketing/seo/keywords/KW-1001/positions', { date, position })
    expect((await add(day(0), 5)).body.current_position).toBe(5)
    const replaced = await add(day(0), 4.26)
    expect(replaced.body.current_position).toBe(4.3)
    expect(replaced.body.positions.filter((p: { date: string }) => p.date === day(0))).toHaveLength(1)
    expect((await add(day(0), '')).body.current_position).toBeNull()
    expect((await add(format(new Date(Date.now() + 3 * 86_400_000), 'yyyy-MM-dd'), 3)).status).toBe(422)
    expect((await add(day(1), 0)).status).toBe(422)
  })

  it('CSV import (keyword,date,position like a Search Console export): adds missing keywords, replaces dates, reports bad rows', async () => {
    const csv = ['Top queries,Date,Position', `AI Chatbot Dubai,${day(1)},6.5`, `brand new keyword,${day(2)},31`, `brand new keyword,${day(1)},28`, `bad row,tomorrow,3`, `ai chatbot dubai,${day(1)},x`].join('\n')
    const rows = parseKeywordCsv(csv)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ row: 2, keyword: 'AI Chatbot Dubai', date: day(1), position: '6.5' })
    const before = seoKeywords.filter((k) => k.companyId === APEX).length
    const r = await apexAdmin('POST', '/marketing/seo/keywords/import', { file_name: 'gsc.csv', rows })
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ imported: 3, keywords_created: 1 })
    expect(r.body.failed.map((f: { row: number }) => f.row)).toEqual([5, 6])
    expect(seoKeywords.filter((k) => k.companyId === APEX).length).toBe(before + 1)
    const list = await apexAdmin('GET', '/marketing/seo/keywords')
    const created = list.body.find((k: { keyword: string }) => k.keyword === 'brand new keyword')
    expect(created).toMatchObject({ current_position: 28, previous_position: 31, change: 3, country: 'AE' })
    const dubai = list.body.find((k: { keyword: string }) => k.keyword === 'ai chatbot dubai')
    expect(dubai.positions.find((p: { date: string }) => p.date === day(1)).position).toBe(6.5)
  })

  it('parses headerless and semicolon files, and day-first dates', () => {
    expect(parseKeywordCsv('crm uae,2026-03-01,12\n\ncrm uae,2026-03-08,10')).toEqual([
      { row: 1, keyword: 'crm uae', date: '2026-03-01', position: '12' },
      { row: 3, keyword: 'crm uae', date: '2026-03-08', position: '10' },
    ])
    expect(parseKeywordCsv('Query;Date;Avg position\n"a, b";08/03/2026;4,5')[0]).toEqual({ row: 2, keyword: 'a, b', date: '2026-03-08', position: '4,5' })
  })

  it('a keyword is unique per company and country', async () => {
    expect((await apexAdmin('POST', '/marketing/seo/keywords', { keyword: 'AI  chatbot dubai' })).status).toBe(422)
    expect((await apexAdmin('POST', '/marketing/seo/keywords', { keyword: 'ai chatbot dubai', country: 'SA' })).status).toBe(200)
    expect((await apexAdmin('POST', '/marketing/seo/keywords', { keyword: 'x', difficulty: 120 })).status).toBe(422)
  })
})

describe('website leads', () => {
  it('counts form / landing page leads and Website-source leads once each, per month', async () => {
    const from = day(400)
    const to = day(0)
    const r = await apexAdmin('GET', `/marketing/seo/website-leads?from=${from}&to=${to}`)
    expect(r.status, r.text).toBe(200)
    const inRange = leads.filter((l) => l.companyId === APEX && l.createdAt.slice(0, 10) >= from)
    expect(r.body.total).toBe(inRange.filter((l) => l.sourceType === 'Website').length)
    expect(r.body.months.reduce((s: number, m: { total: number }) => s + m.total, 0)).toBe(r.body.total)
    expect(r.body.by_source.find((s: { kind: string }) => s.kind === 'form').name).toBe('Website contact form')

    // A lead from a landing page is attributed to the page, even with another source.
    const form = leadForms.find((f) => f.id === 'LF-1002')!
    const sub = await api(null, 'POST', `/public/forms/${form.publicKey}/submit`, { body: { values: { contact_name: 'Lp', email: 'lp.person@lp.example.org', company_name: 'LP Co' }, landing_page: 'ai-chatbot-demo' } })
    expect(sub.status).toBe(200)
    const after = await apexAdmin('GET', `/marketing/seo/website-leads?from=${from}&to=${to}`)
    expect(after.body.total).toBe(r.body.total + 1)
    expect(after.body.by_source.find((s: { kind: string }) => s.kind === 'landing')).toMatchObject({ name: '/p/ai-chatbot-demo', leads: 1 })
    expect(after.body.leads[0]).toMatchObject({ company: 'LP Co', via: 'landing' })
    expect((await apexAdmin('GET', '/marketing/seo/website-leads?from=bad&to=x')).status).toBe(400)
  })
})
