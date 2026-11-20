import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activities, leads } from '@/shared/mocks/db'
import { campaignCosts, campaigns } from '@/shared/mocks/data/marketing'
import { adCampaigns, adConnections, adCostLinks, adDailyStats, adLeadSubmissions, adSyncRuns, adTokens } from '@/shared/mocks/data/ads'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { advanceClock, nowMs } from '@/shared/mocks/clock'
import { usedOf } from '@/shared/mocks/services/billing'
import { BACKFILL_DAYS, SIMULATED_SYNC_ERROR, accountsFor, adSourceMissing, receiveLeadWebhook } from '@/shared/mocks/services/ads'
import { APEX, CREST, api, adminToken, useSeedPerTest, type Co } from '@/shared/mocks/isolation/harness'

/**
 * Ads integrations rules through the real MSW handlers (snake_case wire format): connect (mock OAuth),
 * masked token, the daily / manual sync driven by the mock clock, idempotent campaign costs from mapped
 * ad spend, mapping / unmapping, lead ads → leads (source, campaign, duplicates, plan limit, missing
 * source), simulated sync errors with retry, isolation of connections and webhooks across companies.
 */

useSeedPerTest()
const force = (v: 'ok' | 'fail' | undefined) => {
  if (v) (globalThis as { __apexAdsSync?: string }).__apexAdsSync = v
  else delete (globalThis as { __apexAdsSync?: string }).__apexAdsSync
}
beforeEach(() => force('ok'))
afterEach(() => force(undefined))

const as = (co: Co) => (method: string, path: string, body?: unknown) => api(adminToken(co), method, path, { body })
const conn = (co: Co, provider: string) => adConnections.find((c) => c.companyId === co && c.provider === provider)!
const spendOf = (id: string) => Math.round(campaignCosts.filter((c) => c.campaignId === id).reduce((s, c) => s + c.amount, 0) * 100) / 100
const statsOf = (adcId: string) => adDailyStats.filter((s) => s.adCampaignId === adcId)

async function connect(co: Co, provider = 'tiktok', index = 0) {
  const account = accountsFor(co, provider as 'tiktok')[index]
  const r = await as(co)('POST', '/marketing/ads/connections', { provider, account_id: account.accountId, consent: true })
  expect(r.status, r.text).toBe(200)
  return r.body
}

describe('seed', () => {
  it('Apex has Meta + Google, Crest LinkedIn; each with history, mapped spend as campaign costs and a masked token', async () => {
    const apex = await as(APEX)('GET', '/marketing/ads/connections')
    expect(apex.body.map((c: { provider: string }) => c.provider)).toEqual(['meta', 'google'])
    const crest = await as(CREST)('GET', '/marketing/ads/connections')
    expect(crest.body.map((c: { provider: string }) => c.provider)).toEqual(['linkedin'])
    for (const c of [...apex.body, ...crest.body]) {
      expect(c.status).toBe('connected')
      expect(c.token_hint).toMatch(/^•••• [0-9a-f]{4}$/)
      expect(c.last30.spend).toBeGreaterThan(0)
      expect(c.mapped).toBe(1)
    }
    const links = adCostLinks.filter((l) => l.companyId === APEX)
    expect(links.length).toBeGreaterThan(0)
    expect(links.every((l) => l.campaignId === 'CMP-1001')).toBe(true)
    expect(adCostLinks.some((l) => l.companyId === CREST && l.campaignId === 'CMP-5002')).toBe(true)
  })
})

describe('connect (mock OAuth) and disconnect', () => {
  it('lists the login’s ad accounts, refuses without consent / unknown account / twice, stores the token server-side only', async () => {
    const list = await as(APEX)('GET', '/marketing/ads/providers/meta/accounts')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(3)
    expect(list.body[0]).toMatchObject({ connected: true, currency_code: 'AED' })
    expect((await as(APEX)('GET', '/marketing/ads/providers/myspace/accounts')).status).toBe(404)

    const account = accountsFor(APEX, 'tiktok')[0].accountId
    expect((await as(APEX)('POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: account })).status).toBe(422)
    expect((await as(APEX)('POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: 'act_000', consent: true })).status).toBe(422)
    expect((await as(APEX)('POST', '/marketing/ads/connections', { provider: 'bing', account_id: account, consent: true })).status).toBe(422)
    // Another company's account is not available to this login.
    expect((await as(APEX)('POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: accountsFor(CREST, 'tiktok')[0].accountId, consent: true })).status).toBe(422)

    const c = await connect(APEX)
    expect(c).toMatchObject({ provider: 'tiktok', account_id: account, status: 'connected', currency_code: 'AED', connected_by: 'u1', last_sync_status: 'success' })
    expect(JSON.stringify(c)).not.toContain(adTokens.get(c.id)!)
    expect(c.token_hint).toBe(`•••• ${adTokens.get(c.id)!.slice(-4)}`)
    // Initial sync: BACKFILL_DAYS complete days for every ad campaign of the account.
    expect(c.ad_campaigns).toHaveLength(2)
    expect(adDailyStats.filter((s) => s.connectionId === c.id)).toHaveLength(2 * BACKFILL_DAYS)
    expect(c.runs[0]).toMatchObject({ trigger: 'initial', status: 'success', rows: 2 * BACKFILL_DAYS, costs: 0 })
    expect((await as(APEX)('POST', '/marketing/ads/connections', { provider: 'tiktok', account_id: account, consent: true })).status).toBe(409)
  })

  it('disconnect revokes the token and keeps the synced history; reconnecting reuses the connection without duplicates', async () => {
    const meta = conn(APEX, 'meta')
    const stats = adDailyStats.filter((s) => s.connectionId === meta.id).length
    const spend = spendOf('CMP-1001')
    const off = await as(APEX)('DELETE', `/marketing/ads/connections/${meta.id}`)
    expect(off.status).toBe(200)
    expect(off.body).toMatchObject({ status: 'disconnected', token_hint: null })
    expect(adTokens.has(meta.id)).toBe(false)
    expect(adDailyStats.filter((s) => s.connectionId === meta.id)).toHaveLength(stats)
    expect(spendOf('CMP-1001')).toBe(spend)
    expect((await as(APEX)('DELETE', `/marketing/ads/connections/${meta.id}`)).status).toBe(409)
    expect((await as(APEX)('POST', `/marketing/ads/connections/${meta.id}/sync`)).status).toBe(409)
    // A disconnected account is never synced by the daily tick.
    advanceClock(3)
    await as(APEX)('GET', '/marketing/ads/connections')
    expect(adDailyStats.filter((s) => s.connectionId === meta.id)).toHaveLength(stats)

    const again = await as(APEX)('POST', '/marketing/ads/connections', { provider: 'meta', account_id: meta.accountId, consent: true })
    expect(again.status, again.text).toBe(200)
    expect(again.body.id).toBe(meta.id)
    // The gap days are caught up, each day once.
    const keys = adDailyStats.filter((s) => s.connectionId === meta.id).map((s) => `${s.adCampaignId}|${s.date}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBe(stats + 3 * 3)
  })
})

describe('sync: idempotent costs, mapping, errors', () => {
  it('sync now twice imports nothing new and never duplicates a cost; one cost per ad campaign per day', async () => {
    const meta = conn(APEX, 'meta')
    const before = { stats: adDailyStats.length, costs: campaignCosts.length, spend: spendOf('CMP-1001') }
    const r1 = await as(APEX)('POST', `/marketing/ads/connections/${meta.id}/sync`)
    const r2 = await as(APEX)('POST', `/marketing/ads/connections/${meta.id}/sync`)
    expect(r1.status).toBe(200)
    expect(r2.body.runs[0]).toMatchObject({ trigger: 'manual', status: 'success', rows: 0, costs: 0 })
    expect(adDailyStats.length).toBe(before.stats)
    expect(campaignCosts.length).toBe(before.costs)
    expect(spendOf('CMP-1001')).toBe(before.spend)
    const mapped = adCampaigns.find((a) => a.connectionId === meta.id && a.campaignId)!
    const links = adCostLinks.filter((l) => l.adCampaignId === mapped.id)
    expect(links).toHaveLength(statsOf(mapped.id).filter((s) => s.spend > 0).length)
    expect(new Set(links.map((l) => l.date)).size).toBe(links.length)
  })

  it('the daily tick (mock clock) imports new days once and costs the mapped ones', async () => {
    const meta = conn(APEX, 'meta')
    const mapped = adCampaigns.find((a) => a.connectionId === meta.id && a.campaignId)!
    const n = statsOf(mapped.id).length
    const spend = spendOf('CMP-1001')
    advanceClock(2)
    await as(APEX)('GET', '/marketing/ads/connections')
    await as(APEX)('GET', '/marketing/ads/connections')
    expect(statsOf(mapped.id)).toHaveLength(n + 2)
    const added = statsOf(mapped.id).slice(-2).reduce((s, x) => s + x.spend, 0)
    expect(spendOf('CMP-1001')).toBeCloseTo(spend + added + statsOf(adCampaigns.find((a) => a.connectionId === conn(APEX, 'google').id && a.campaignId)!.id).slice(-2).reduce((s, x) => s + x.spend, 0), 2)
    expect(adSyncRuns.filter((r) => r.connectionId === meta.id && r.trigger === 'daily')).toHaveLength(1)
  })

  it('mapping backfills the synced spend as costs, unmapping stops new costs and keeps history, remapping never duplicates', async () => {
    const meta = conn(APEX, 'meta')
    const adc = adCampaigns.find((a) => a.connectionId === meta.id && !a.campaignId)!
    const target = 'CMP-1002'
    const spend = spendOf(target)
    const synced = Math.round(statsOf(adc.id).reduce((s, x) => s + x.spend, 0) * 100) / 100
    const r = await as(APEX)('PATCH', `/marketing/ads/campaigns/${adc.id}`, { campaign_id: target })
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ campaign_id: target, campaign_name: 'GITEX Global 2026 booth' })
    expect(spendOf(target)).toBeCloseTo(spend + synced, 2)
    const campaign = await as(APEX)('GET', `/marketing/campaigns/${target}`)
    expect(campaign.body.spend).toBeCloseTo(spend + synced, 2)

    const costs = campaignCosts.length
    const un = await as(APEX)('PATCH', `/marketing/ads/campaigns/${adc.id}`, { campaign_id: null })
    expect(un.body.campaign_id).toBeNull()
    expect(campaignCosts.length).toBe(costs)
    advanceClock(2)
    await as(APEX)('POST', `/marketing/ads/connections/${meta.id}/sync`)
    expect(adCostLinks.filter((l) => l.adCampaignId === adc.id)).toHaveLength(statsOf(adc.id).filter((s) => s.spend > 0).length - 2)
    expect(spendOf(target)).toBeCloseTo(spend + synced, 2)

    // Remap: the two new days are costed, the old ones not again.
    await as(APEX)('PATCH', `/marketing/ads/campaigns/${adc.id}`, { campaign_id: target })
    const links = adCostLinks.filter((l) => l.adCampaignId === adc.id)
    expect(links).toHaveLength(statsOf(adc.id).filter((s) => s.spend > 0).length)
    expect(new Set(links.map((l) => l.date)).size).toBe(links.length)
  })

  it('mapping to another company’s or a missing campaign answers 422; a view role can’t map', async () => {
    const adc = adCampaigns.find((a) => a.companyId === APEX)!
    const foreign = await as(APEX)('PATCH', `/marketing/ads/campaigns/${adc.id}`, { campaign_id: 'CMP-5001' })
    const missing = await as(APEX)('PATCH', `/marketing/ads/campaigns/${adc.id}`, { campaign_id: 'CMP-0000' })
    expect(foreign.status).toBe(422)
    expect(foreign.text).toBe(missing.text)
    expect((await api(adminToken(APEX), 'PATCH', `/marketing/ads/campaigns/${adCampaigns.find((a) => a.companyId === CREST)!.id}`, { body: { campaign_id: null } })).status).toBe(404)
  })

  it('a simulated error is logged, sets the connection to error, imports nothing; the retry succeeds', async () => {
    const g = conn(APEX, 'google')
    advanceClock(1)
    force('fail')
    const stats = adDailyStats.length
    const r = await as(APEX)('POST', `/marketing/ads/connections/${g.id}/sync`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'error', last_error: SIMULATED_SYNC_ERROR, last_sync_status: 'error' })
    expect(r.body.runs[0]).toMatchObject({ status: 'error', error: SIMULATED_SYNC_ERROR, rows: 0 })
    expect(adDailyStats.length).toBe(stats)
    // The daily tick waits an hour before retrying on its own.
    const runs = adSyncRuns.length
    await as(APEX)('GET', '/marketing/ads/connections')
    expect(adSyncRuns.length).toBe(runs)
    force('ok')
    const retry = await as(APEX)('POST', `/marketing/ads/connections/${g.id}/sync`)
    expect(retry.body).toMatchObject({ status: 'connected', last_error: null, last_sync_status: 'success' })
    expect(retry.body.runs[0].rows).toBe(2)
  })
})

describe('lead ads → leads', () => {
  it('Crest LinkedIn: new submissions become leads (source LinkedIn, campaign from the mapping, born at submission)', async () => {
    const li = conn(CREST, 'linkedin')
    const before = leads.length
    advanceClock(2)
    await as(CREST)('GET', '/marketing/ads/connections')
    const subs = adLeadSubmissions.filter((s) => s.connectionId === li.id)
    expect(subs.length).toBeGreaterThanOrEqual(2)
    expect(subs.every((s) => s.outcome === 'created' || s.outcome === 'duplicate')).toBe(true)
    const created = subs.filter((s) => s.outcome === 'created')
    expect(leads.length).toBe(before + created.length)
    for (const s of created) {
      const lead = leads.find((l) => l.id === s.leadId)!
      const adc = adCampaigns.find((a) => a.id === s.adCampaignId)!
      expect(lead.companyId).toBe(CREST)
      expect(lead.sourceType).toBe('LinkedIn')
      expect(lead.campaignId ?? null).toBe(adc.campaignId)
      expect(lead.createdAt).toBe(s.submittedAt)
      expect(Date.parse(s.submittedAt)).toBeGreaterThanOrEqual(Date.parse(li.leadsFrom))
    }
    // Idempotent: a second pass creates nothing.
    await as(CREST)('POST', `/marketing/ads/connections/${li.id}/sync`)
    expect(leads.length).toBe(before + created.length)
  })

  it('Apex Meta: no "Paid ads" source → submissions wait with a clear message; adding the source imports them', async () => {
    // The seed has "Paid ads"; remove it to exercise the missing-source path.
    const sources = lookupsFor(APEX).sources
    sources.splice(sources.findIndex((s) => s.key === 'Paid ads'), 1)
    const meta = conn(APEX, 'meta')
    const before = leads.length
    advanceClock(2)
    const list = await as(APEX)('GET', '/marketing/ads/connections')
    const pending = adLeadSubmissions.filter((s) => s.connectionId === meta.id)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((s) => s.outcome === 'pending_source' && s.message === adSourceMissing('meta'))).toBe(true)
    expect(list.body.find((c: { provider: string }) => c.provider === 'meta').pending_leads).toBe(pending.length)
    expect(leads.length).toBe(before)

    lookupsFor(APEX).sources.push({ key: 'Paid ads', label: 'Paid ads', active: true, order: 99 })
    const r = await as(APEX)('POST', `/marketing/ads/connections/${meta.id}/sync`)
    expect(r.body.runs[0].leads_pending).toBe(0)
    const done = adLeadSubmissions.filter((s) => s.connectionId === meta.id)
    expect(done.every((s) => s.outcome === 'created' || s.outcome === 'duplicate')).toBe(true)
    for (const s of done.filter((x) => x.outcome === 'created')) {
      const lead = leads.find((l) => l.id === s.leadId)!
      expect(lead.sourceType).toBe('Paid ads')
      expect(lead.campaignId).toBe('CMP-1001')
    }
  })

  it('duplicates link to the existing lead (activity, no new lead); the plan limit skips the lead', async () => {
    const li = conn(CREST, 'linkedin')
    const existing = leads.find((l) => l.companyId === CREST && l.contactEmail)!
    const before = leads.length
    const dup = receiveLeadWebhook({ provider: 'linkedin', accountId: li.accountId, externalId: 'wh-1', name: 'Returning Person', email: existing.contactEmail, companyName: 'Some Other Name' })
    expect(dup).toMatchObject({ accepted: true, outcome: 'duplicate' })
    expect(leads.length).toBe(before)
    expect(activities.some((a) => a.leadId === existing.id && a.id === `A-${dup.submissionId}`)).toBe(true)
    // The same provider lead id twice is one submission.
    expect(receiveLeadWebhook({ provider: 'linkedin', accountId: li.accountId, externalId: 'wh-1', name: 'x', email: 'x@y.example', companyName: 'x' }).submissionId).toBe(dup.submissionId)

    for (let i = usageSimulation.length - 1; i >= 0; i--) if (usageSimulation[i].companyId === CREST && usageSimulation[i].key === 'leadsContacts') usageSimulation.splice(i, 1)
    usageSimulation.push({ companyId: CREST, key: 'leadsContacts', offset: 25000 - usedOf(CREST, 'leadsContacts') })
    const full = receiveLeadWebhook({ provider: 'linkedin', accountId: li.accountId, externalId: 'wh-2', name: 'Over Limit', email: 'over.limit@wrenfield.example', companyName: 'Wrenfield Unique Co' })
    expect(full.outcome).toBe('limit')
    expect(leads.length).toBe(before)
    expect(adLeadSubmissions.find((s) => s.id === full.submissionId)!.message).toMatch(/limit/)
  })

  it('isolation: a webhook for Crest’s account lands in Crest only, whatever company the payload names; unknown accounts are ignored', async () => {
    const li = conn(CREST, 'linkedin')
    const apexLeads = leads.filter((l) => l.companyId === APEX).length
    const r = receiveLeadWebhook({ provider: 'linkedin', accountId: li.accountId, externalId: 'wh-iso', name: 'Iso Person', email: 'iso.person@larchmontunique.example', companyName: 'Larchmont Unique Holdings', companyId: APEX, company_id: APEX })
    expect(r.outcome).toBe('created')
    const lead = leads.find((l) => l.contactEmail === 'iso.person@larchmontunique.example')!
    expect(lead.companyId).toBe(CREST)
    expect(leads.filter((l) => l.companyId === APEX)).toHaveLength(apexLeads)
    expect(receiveLeadWebhook({ provider: 'linkedin', accountId: accountsFor(APEX, 'linkedin')[0].accountId, externalId: 'wh-x', name: 'N', email: 'n@n.example', companyName: 'N' })).toEqual({ accepted: false })
    expect(receiveLeadWebhook({ provider: 'meta', accountId: li.accountId, externalId: 'wh-y', name: 'N', email: 'n@n.example', companyName: 'N' })).toEqual({ accepted: false })
    // Apex can't see Crest's submissions or connection.
    expect((await as(APEX)('GET', `/marketing/ads/connections/${li.id}`)).status).toBe(404)
    const apexList = await as(APEX)('GET', '/marketing/ads/connections')
    expect(apexList.text).not.toContain(li.id)
  })

  it('the clock never syncs one company while another is ticked', async () => {
    const crestStats = adDailyStats.filter((s) => s.companyId === CREST).length
    advanceClock(2)
    await as(APEX)('GET', '/marketing/ads/connections')
    expect(adDailyStats.filter((s) => s.companyId === CREST)).toHaveLength(crestStats)
    expect(adDailyStats.filter((s) => s.companyId === APEX).every((s) => adConnections.find((c) => c.id === s.connectionId)!.companyId === APEX)).toBe(true)
    expect(nowMs()).toBeGreaterThan(Date.now())
  })
})

describe('campaign records', () => {
  it('synced costs carry the provider and ad campaign in the note', () => {
    const link = adCostLinks.find((l) => l.companyId === APEX)!
    const cost = campaignCosts.find((c) => c.id === link.costId)!
    expect(cost.note).toMatch(/^(Meta|Google) Ads: .+ \(synced ad spend\)$/)
    expect(campaigns.find((c) => c.id === cost.campaignId)!.companyId).toBe(APEX)
  })
})
