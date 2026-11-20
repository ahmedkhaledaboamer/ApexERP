import { describe, expect, it } from 'vitest'
import type { Lead } from '@/shared/types'
import { leads } from '@/shared/mocks/db'
import { campaignCosts, campaigns } from '@/shared/mocks/data/marketing'
import { adConnections, adDailyStats } from '@/shared/mocks/data/ads'
import { contentItems } from '@/shared/mocks/data/marketingCreative'
import { formSubmissions } from '@/shared/mocks/data/marketingGrowth'
import { companyById } from '@/shared/mocks/data/tenancy'
import { leadStatusHistory } from '@/shared/mocks/data/leadStatusHistory'
import { statusOf } from '@/shared/mocks/data/lookups'
import { zonedParts } from '@/shared/lib/zonedTime'
import { addDaysIso } from '@/shared/lib/companyDay'
import { presetRange, previousRange } from '@/shared/mocks/services/marketingAnalytics'
import { APEX, CREST, COMPANIES, api, adminToken, leaksIn, useSeedPerTest, userToken, type Co } from '@/shared/mocks/isolation/harness'

/**
 * Marketing analytics: every number recomputed here from the raw tables, for a fixed range, in both
 * companies; previous-period comparison; CPL / ROI / conversion math on a controlled period; the
 * funnel from lead_status_history; presets in the company timezone; access.
 */

useSeedPerTest()
const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10
const tzOf = (co: Co) => companyById(co)!.regional.timezone
const todayOf = (co: Co) => zonedParts(Date.now(), tzOf(co)).date

function recompute(co: Co, from: string, to: string) {
  const day = (iso: string) => zonedParts(iso, tzOf(co)).date
  const ls = leads.filter((l) => l.companyId === co && day(l.createdAt) >= from && day(l.createdAt) <= to)
  const spend = r2(campaignCosts.filter((c) => c.companyId === co && c.date >= from && c.date <= to).reduce((s, c) => s + c.amount, 0))
  const attributed = ls.filter((l) => l.campaignId)
  const won = ls.filter((l) => statusOf(co, l.status)?.type === 'won')
  const attributedWonValue = r2(won.filter((l) => l.campaignId).reduce((s, l) => s + (l.value || 0), 0))
  return {
    spend,
    leads: ls.length,
    attributed_leads: attributed.length,
    cost_per_lead: attributed.length ? r2(spend / attributed.length) : null,
    won: won.length,
    won_value: r2(won.reduce((s, l) => s + (l.value || 0), 0)),
    attributed_won_value: attributedWonValue,
    roi: spend > 0 ? r1(((attributedWonValue - spend) / spend) * 100) : null,
    conversion_rate: ls.length ? r1((won.length / ls.length) * 100) : null,
  }
}

const get = (co: Co, query: string) => api(adminToken(co), 'GET', `/marketing/analytics?${query}`)

describe('numbers equal a recomputation from the raw data, per company', () => {
  for (const co of COMPANIES) {
    it(`${co}: KPIs, previous period, campaigns, ads and timeline for a fixed range`, async () => {
      const to = todayOf(co)
      const from = addDaysIso(to, -89)
      const res = await get(co, `preset=custom&from=${from}&to=${to}`)
      expect(res.status, res.text).toBe(200)
      const b = res.body
      expect(b).toMatchObject({ from, to, days: 90, currency: companyById(co)!.regional.currency, bucket: 'week' })
      expect(b.kpis).toEqual(recompute(co, from, to))
      const prev = previousRange(from, to)
      expect(b.previous).toEqual(prev)
      expect(b.previous_kpis).toEqual(recompute(co, prev.from, prev.to))
      expect(b.kpis.spend).toBeGreaterThan(0)

      // Every campaign row is the company's; totals match the timeline and the KPIs.
      const own = new Set(campaigns.filter((c) => c.companyId === co).map((c) => c.id))
      expect(b.campaigns.every((r: { campaign_id: string }) => own.has(r.campaign_id))).toBe(true)
      expect(r2(b.campaigns.reduce((s: number, r: { spend: number }) => s + r.spend, 0))).toBe(b.kpis.spend)
      expect(r2(b.timeline.reduce((s: number, p: { spend: number }) => s + p.spend, 0))).toBe(b.kpis.spend)
      expect(b.timeline.reduce((s: number, p: { leads: number }) => s + p.leads, 0)).toBe(b.kpis.leads)
      expect(b.by_source.reduce((s: number, r: { leads: number }) => s + r.leads, 0)).toBe(b.kpis.leads)
      expect(b.funnel[0].count).toBe(b.kpis.leads)

      // Ads: the company's synced stats in the range.
      const mine = new Set(adConnections.filter((c) => c.companyId === co).map((c) => c.id))
      const stats = adDailyStats.filter((s) => s.companyId === co && s.date >= from && s.date <= to)
      expect(stats.every((s) => mine.has(s.connectionId))).toBe(true)
      expect(b.ads.totals.spend).toBe(r2(stats.reduce((s, x) => s + x.spend, 0)))
      expect(b.ads.totals.clicks).toBe(stats.reduce((s, x) => s + x.clicks, 0))
      expect(b.ads.providers.map((p: { provider: string }) => p.provider)).toEqual(co === APEX ? ['meta', 'google'] : ['linkedin'])
      // Content Calendar and Lead Generation forms of the company in the range.
      const day = (iso: string | null) => (iso ? zonedParts(iso, tzOf(co)).date : '')
      const inR = (iso: string | null) => !!iso && day(iso) >= from && day(iso) <= to
      expect(b.content.published).toBe(contentItems.filter((c) => c.companyId === co && c.status === 'published' && inR(c.publishedAt)).length)
      const subs = formSubmissions.filter((s) => s.companyId === co && s.outcome !== 'spam' && inR(s.submittedAt))
      expect(b.forms).toMatchObject({ submissions: subs.length, leads_created: subs.filter((s) => s.outcome === 'created').length })
      expect(leaksIn(b, co)).toEqual([])
    })
  }
})

describe('CPL, ROI, conversion, previous period and funnel on a controlled period', () => {
  it('2020-03: 1,000 spend, 4 leads (2 attributed, 1 won worth 5,000) → CPL 500, ROI 400 %, conversion 25 %', async () => {
    const co = APEX
    const c = await api(adminToken(co), 'POST', '/marketing/campaigns', { body: { name: 'Analytics probe', channel: 'ads' } })
    expect(c.status, c.text).toBe(200)
    const id = c.body.id
    expect((await api(adminToken(co), 'POST', `/marketing/campaigns/${id}/costs`, { body: { amount: 1000, incurred_on: '2020-03-10' } })).status).toBe(200)
    expect((await api(adminToken(co), 'POST', `/marketing/campaigns/${id}/costs`, { body: { amount: 200, incurred_on: '2020-02-15' } })).status).toBe(200)
    const template = leads.find((l) => l.companyId === co)!
    const add = (n: number, status: string, campaignId: string | null, value: number): Lead => {
      const lead = { ...structuredClone(template), id: `L-AN-${n}`, status, campaignId, value, createdAt: `2020-03-1${n}T08:00:00.000Z`, company: `Analytics probe ${n}` }
      leads.push(lead as never)
      return lead
    }
    add(1, 'Won', id, 5000)
    const lost = add(2, 'Lost', id, 800)
    add(3, 'Contacted', null, 0)
    add(4, 'New', null, 0)
    for (const [from, to] of [[null, 'New'], ['New', 'Contacted'], ['Contacted', 'Interested'], ['Interested', 'Lost']] as const) {
      leadStatusHistory.push({ companyId: co, id: `LSH-AN-${to}`, leadId: lost.id, fromStatusId: from, toStatusId: to, changedBy: null, reason: null, changedAt: '2020-03-15T08:00:00.000Z' })
    }

    const res = await get(co, 'preset=custom&from=2020-03-01&to=2020-03-31')
    expect(res.status).toBe(200)
    expect(res.body.kpis).toEqual({
      spend: 1000,
      leads: 4,
      attributed_leads: 2,
      cost_per_lead: 500,
      won: 1,
      won_value: 5000,
      attributed_won_value: 5000,
      roi: 400,
      conversion_rate: 25,
    })
    expect(res.body.previous).toEqual({ from: '2020-01-30', to: '2020-02-29' })
    expect(res.body.previous_kpis).toMatchObject({ spend: 200, leads: 0, cost_per_lead: null, roi: -100, conversion_rate: null })
    expect(res.body.funnel.map((s: { count: number }) => s.count)).toEqual([4, 3, 2, 1, 1, 1])
    expect(res.body.funnel[1].rate).toBe(75)
    expect(res.body.bucket).toBe('day')
    expect(res.body.timeline).toHaveLength(31)
    const row = res.body.campaigns.find((r: { campaign_id: string }) => r.campaign_id === id)
    expect(row).toMatchObject({ spend: 1000, leads: 2, cost_per_lead: 500, won: 1, won_value: 5000, cost_per_won: 1000, roi: 400 })
    expect(res.body.by_channel.find((r: { channel: string }) => r.channel === 'ads')).toMatchObject({ leads: 2, spend: 1000, won: 1 })
    expect(res.body.by_channel.find((r: { channel: string }) => r.channel === 'none')).toMatchObject({ leads: 2, spend: 0 })

    const noCompare = await get(co, 'preset=custom&from=2020-03-01&to=2020-03-31&compare=false')
    expect(noCompare.body.previous).toBeNull()
    expect(noCompare.body.previous_kpis).toBeNull()
  })
})

describe('presets, validation and access', () => {
  it('presets resolve in the company timezone and end today', async () => {
    for (const co of COMPANIES) {
      const today = todayOf(co)
      for (const preset of ['this_month', 'last_30_days', 'this_quarter', 'ytd'] as const) {
        const res = await get(co, `preset=${preset}`)
        expect(res.status).toBe(200)
        expect({ from: res.body.from, to: res.body.to }).toEqual(presetRange(preset, tzOf(co)))
        expect(res.body.to).toBe(today)
      }
      expect((await get(co, 'preset=last_30_days')).body.days).toBe(30)
    }
    expect(presetRange('this_quarter', 'Asia/Dubai', Date.parse('2026-11-20T10:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-11-20' })
    expect(presetRange('ytd', 'Asia/Riyadh', Date.parse('2026-02-03T10:00:00Z'))).toEqual({ from: '2026-01-01', to: '2026-02-03' })
  })

  it('bad ranges answer 400', async () => {
    expect((await get(APEX, 'preset=forever')).status).toBe(400)
    expect((await get(APEX, 'preset=custom&from=2026-02-30&to=2026-03-01')).status).toBe(400)
    expect((await get(APEX, 'preset=custom&from=2026-03-02&to=2026-03-01')).status).toBe(400)
    expect((await get(APEX, 'preset=custom&from=2020-01-01&to=2026-03-01')).status).toBe(400)
  })

  it('marketing view without a marketing Reports scope is refused (Sales Manager); Crest numbers never mix into Apex', async () => {
    expect((await api(userToken('u3'), 'GET', '/marketing/analytics?preset=ytd')).status).toBe(403)
    const apex = await get(APEX, 'preset=ytd')
    const crest = await get(CREST, 'preset=ytd')
    expect(apex.body.currency).toBe('AED')
    expect(crest.body.currency).toBe('SAR')
    expect(leaksIn(apex.body, APEX)).toEqual([])
    expect(leaksIn(crest.body, CREST)).toEqual([])
  })
})
