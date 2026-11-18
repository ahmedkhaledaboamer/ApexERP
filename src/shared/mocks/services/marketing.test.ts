import { afterEach, describe, expect, it } from 'vitest'
import { activities, leads } from '@/shared/mocks/db'
import { bulkEmailRecipients, bulkEmails } from '@/shared/mocks/data/marketing'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { companyById } from '@/shared/mocks/data/tenancy'
import { advanceClock, nowMs } from '@/shared/mocks/clock'
import { subOf, usedOf } from '@/shared/mocks/services/billing'
import { QUEUE, excludedStatusKeys } from '@/shared/mocks/services/marketing'
import { zonedParts } from '@/shared/lib/zonedTime'
import { APEX, CREST, adminToken, api, useSeedPerTest, type Co } from '@/shared/mocks/isolation/harness'

/**
 * Marketing rules through the real handlers: exclusions enforced at send time, the monthly email
 * limit (402 LIMIT_REACHED, whole send refused), the fair queue across companies, scheduling in the
 * company's timezone on the mock clock, activities on leads, campaign results numbers, module gating.
 */

useSeedPerTest()
afterEach(() => {
  delete (globalThis as { __apexMarketingEngagement?: unknown }).__apexMarketingEngagement
})

const DAY = 86_400_000
/** Moves the mock clock forward by `ms` and runs the lazy tick (any authenticated request). */
async function advance(co: Co, ms: number) {
  advanceClock(ms / DAY)
  await api(adminToken(co), 'GET', '/marketing/emails')
}
const companyLeads = (co: Co) => leads.filter((l) => l.companyId === co)

async function newEmail(co: Co, filters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const r = await api(adminToken(co), 'POST', '/marketing/emails', {
    body: { name: `Test send ${Math.random().toString(36).slice(2, 7)}`, subject: 'Hello {{lead.firstName}}', body: 'Hi {{lead.firstName}},\n\nNews from {{company.name}}.', filters, ...extra },
  })
  expect(r.status, r.text).toBe(200)
  return r.body.id as string
}
const recipientsOf = (id: string) => bulkEmailRecipients.filter((r) => r.bulkEmailId === id)
const recipientFor = (id: string, leadId: string) => recipientsOf(id).find((r) => r.leadId === leadId)

/** Every lead of the company eligible (open status, email, not DNC), each with a unique email. */
function cleanAudience(co: Co): typeof leads {
  const list = companyLeads(co)
  list.forEach((l, i) => {
    l.doNotContact = false
    l.status = 'Contacted'
    l.contactEmail = `lead${i}@${co}.example.org`
  })
  return list
}

describe('exclusions', () => {
  it('excludes Not interested and custom lost-type statuses, keeps Lost', () => {
    expect(excludedStatusKeys(APEX)).toEqual(['Not interested'])
  })

  it('preview counts DNC, Not interested, no email and duplicates', async () => {
    const [a, b, c, d, e] = cleanAudience(APEX)
    a.doNotContact = true
    b.status = 'Not interested'
    c.contactEmail = ''
    d.contactEmail = e.contactEmail
    const id = await newEmail(APEX)
    const p = await api(adminToken(APEX), 'POST', `/marketing/emails/${id}/preview-audience`, { body: {} })
    expect(p.status).toBe(200)
    const total = companyLeads(APEX).length
    expect(p.body.excluded).toEqual({ dnc: 1, not_interested: 1, no_email: 1, duplicate: 1 })
    expect(p.body.matched).toBe(total)
    expect(p.body.eligible).toBe(total - 4)
    expect(p.body.available).toBeNull()
  })

  it('are enforced at send time, even when the lead changed after the preview and after queueing', async () => {
    const list = cleanAudience(APEX)
    const [x, y, z, w] = list
    const id = await newEmail(APEX)
    await api(adminToken(APEX), 'POST', `/marketing/emails/${id}/preview-audience`, { body: {} })
    // Changed after the preview: resolved when the send starts.
    x.doNotContact = true
    y.status = 'Not interested'
    const send = await api(adminToken(APEX), 'POST', `/marketing/emails/${id}/send-now`)
    expect(send.status, send.text).toBe(200)
    expect(recipientFor(id, x.id)).toMatchObject({ status: 'skipped', skipReason: 'dnc' })
    expect(recipientFor(id, y.id)?.skipReason).toBe('not_interested')
    // Changed while queued: checked again by the queue worker.
    expect(recipientFor(id, z.id)?.status).toBe('queued')
    z.doNotContact = true
    w.status = 'Not interested'
    await advance(APEX, 60_000)
    expect(recipientFor(id, z.id)).toMatchObject({ status: 'skipped', skipReason: 'dnc' })
    expect(recipientFor(id, w.id)).toMatchObject({ status: 'skipped', skipReason: 'not_interested' })
    expect(activities.some((a) => a.leadId === z.id && a.summary.startsWith('Bulk email'))).toBe(false)
    const detail = await api(adminToken(APEX), 'GET', `/marketing/emails/${id}`)
    expect(detail.body.status).toBe('sent')
    expect(detail.body.counts.skipped_by).toMatchObject({ dnc: 2, not_interested: 2 })
    expect(detail.body.counts.sent).toBe(list.length - 4)
  })

  it('no email and duplicate addresses are skipped; each address is mailed once', async () => {
    const [a, b, c] = cleanAudience(CREST)
    a.contactEmail = 'not-an-email'
    c.contactEmail = b.contactEmail.toUpperCase()
    const id = await newEmail(CREST)
    expect((await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/send-now`)).status).toBe(200)
    await advance(CREST, 60_000)
    expect(recipientFor(id, a.id)?.skipReason).toBe('no_email')
    expect(recipientFor(id, c.id)?.skipReason).toBe('duplicate')
    const sent = recipientsOf(id).filter((r) => r.status === 'sent').map((r) => r.email)
    expect(new Set(sent).size).toBe(sent.length)
  })
})

describe('activities and engagement', () => {
  it('logs one email activity per sent email on the lead, by the sender', async () => {
    const list = cleanAudience(CREST).slice(0, 3)
    const id = await newEmail(CREST, { owner_ids: [] , industries: [list[0].industry] })
    await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/send-now`)
    await advance(CREST, 60_000)
    const sent = recipientsOf(id).filter((r) => r.status === 'sent')
    expect(sent.length).toBeGreaterThan(0)
    for (const r of sent) {
      const a = activities.find((x) => x.id === `A-${r.id}`)
      expect(a).toMatchObject({ companyId: CREST, leadId: r.leadId, type: 'email', userId: 'u101' })
    }
  })

  it('opens and replies are simulated deterministically and appear once the clock passes them; the dev hook forces them', async () => {
    cleanAudience(APEX)
    const id = await newEmail(APEX)
    await api(adminToken(APEX), 'POST', `/marketing/emails/${id}/send-now`)
    await advance(APEX, 60_000)
    const first = (await api(adminToken(APEX), 'GET', `/marketing/emails/${id}`)).body.counts
    await advance(APEX, 4 * 3600_000)
    const later = (await api(adminToken(APEX), 'GET', `/marketing/emails/${id}`)).body.counts
    expect(later.opened).toBeGreaterThanOrEqual(first.opened)
    expect(later.opened).toBeGreaterThan(0)
    expect(later.replied).toBeLessThanOrEqual(later.opened)
    expect(later.open_rate).toBe(Math.round((later.opened / later.sent) * 1000) / 10)

    ;(globalThis as { __apexMarketingEngagement?: string }).__apexMarketingEngagement = 'all'
    const forced = await newEmail(APEX)
    await api(adminToken(APEX), 'POST', `/marketing/emails/${forced}/send-now`)
    await advance(APEX, 60_000)
    const c = (await api(adminToken(APEX), 'GET', `/marketing/emails/${forced}`)).body.counts
    expect(c.opened).toBe(c.sent)
    expect(c.replied).toBe(c.sent)
    expect(c.open_rate).toBe(100)
  })
})

describe('monthly email limit (emailsPerMonth)', () => {
  it('refuses the whole send with a typed 402 when the audience is bigger than what is left; never sends part of it', async () => {
    const list = cleanAudience(CREST)
    const max = 20000 // Business
    usageSimulation.push({ companyId: CREST, key: 'emailsPerMonth', offset: max - usedOf(CREST, 'emailsPerMonth') - 5 })
    const id = await newEmail(CREST)
    const p = await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/preview-audience`, { body: {} })
    expect(p.body.available).toBe(5)
    const tz = companyById(CREST)!.regional.timezone
    const later = zonedParts(nowMs() + DAY, tz)
    const attempts: [string, unknown][] = [
      ['send-now', undefined],
      ['schedule', { scheduled_at: `${later.date}T${later.time}` }],
    ]
    for (const [path, body] of attempts) {
      const r = await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/${path}`, { body })
      expect(r.status, r.text).toBe(402)
      expect(r.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'emailsPerMonth', max, requested: list.length, available: 5 })
    }
    expect(recipientsOf(id)).toHaveLength(0)
    expect(bulkEmails.find((e) => e.id === id)?.status).toBe('draft')
  })

  it('sent emails count toward the period; the allowance running out mid-send skips the rest with reason "limit"', async () => {
    cleanAudience(CREST)
    const before = usedOf(CREST, 'emailsPerMonth')
    const id = await newEmail(CREST)
    expect((await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/send-now`)).status).toBe(200)
    // Something else used the allowance up after the send started.
    usageSimulation.push({ companyId: CREST, key: 'emailsPerMonth', offset: 20000 - before - 3 })
    await advance(CREST, 60_000)
    const rows = recipientsOf(id)
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(3)
    expect(rows.filter((r) => r.skipReason === 'limit').length).toBe(rows.length - 3)
    expect(usedOf(CREST, 'emailsPerMonth')).toBe(20000)
  })
})

describe('fair queue across companies', () => {
  it('a large Apex send does not delay a small Crest send', async () => {
    const big = cleanAudience(APEX)
    for (let i = 0; i < 600; i++) {
      leads.push({ ...big[0], id: `L-bulk-${i}`, company: `Bulk Co ${i}`, contactEmail: `bulk${i}@apex-bulk.example.org`, campaignId: null })
    }
    const crest = cleanAudience(CREST)
    const apexId = await newEmail(APEX)
    await api(adminToken(APEX), 'POST', `/marketing/emails/${apexId}/send-now`)
    const crestId = await newEmail(CREST)
    await api(adminToken(CREST), 'POST', `/marketing/emails/${crestId}/send-now`)
    // Within one slot after Crest queued, all of Crest is sent (BATCH per company per round), Apex is not done.
    await advance(CREST, QUEUE.SLOT_MS)
    expect(recipientsOf(crestId).filter((r) => r.status === 'sent')).toHaveLength(crest.length)
    expect(bulkEmails.find((e) => e.id === crestId)?.status).toBe('sent')
    const apexSent = recipientsOf(apexId).filter((r) => r.status === 'sent').length
    expect(apexSent).toBeLessThanOrEqual(2 * QUEUE.SLOT_CAPACITY)
    expect(bulkEmails.find((e) => e.id === apexId)?.status).toBe('sending')
    // Apex drains at SLOT_CAPACITY per slot afterwards.
    await advance(APEX, QUEUE.SLOT_MS * 10)
    expect(bulkEmails.find((e) => e.id === apexId)?.status).toBe('sent')
  })
})

describe('scheduling in the company timezone (mock clock)', () => {
  it('stores the UTC instant of the local time and starts exactly then', async () => {
    cleanAudience(APEX)
    const tz = companyById(APEX)!.regional.timezone
    expect(tz).toBe('Asia/Dubai')
    const day = zonedParts(nowMs() + 2 * DAY, tz).date
    const id = await newEmail(APEX)
    const r = await api(adminToken(APEX), 'POST', `/marketing/emails/${id}/schedule`, { body: { scheduled_at: `${day}T09:00` } })
    expect(r.status, r.text).toBe(200)
    expect(r.body.scheduled_at).toBe(`${day}T05:00:00.000Z`) // Dubai is UTC+4
    expect(r.body.scheduled_local).toBe(`${day}T09:00`)
    expect(r.body.timezone).toBe('Asia/Dubai')
    expect(r.body.status).toBe('scheduled')

    const at = Date.parse(`${day}T05:00:00.000Z`)
    await advance(APEX, at - nowMs() - 60_000)
    expect(bulkEmails.find((e) => e.id === id)?.status).toBe('scheduled')
    expect(recipientsOf(id)).toHaveLength(0)
    await advance(APEX, 2 * 60_000)
    expect(bulkEmails.find((e) => e.id === id)?.status).toBe('sent')
    expect(recipientsOf(id).every((r) => r.status !== 'queued')).toBe(true)
    expect(recipientsOf(id).find((r) => r.status === 'sent')!.queuedAt).toBe(`${day}T05:00:00.000Z`)
  })

  it('refuses a time in the past or a malformed one; cancelling stops the send', async () => {
    cleanAudience(CREST)
    const id = await newEmail(CREST)
    const tz = companyById(CREST)!.regional.timezone
    const past = zonedParts(nowMs() - DAY, tz)
    expect((await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/schedule`, { body: { scheduled_at: `${past.date}T${past.time}` } })).status).toBe(422)
    expect((await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/schedule`, { body: { scheduled_at: 'tomorrow' } })).status).toBe(422)
    const later = zonedParts(nowMs() + DAY, tz)
    expect((await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/schedule`, { body: { scheduled_at: `${later.date}T${later.time}` } })).status).toBe(200)
    const c = await api(adminToken(CREST), 'DELETE', `/marketing/emails/${id}`)
    expect(c.body.status).toBe('cancelled')
    await advance(CREST, 2 * DAY)
    expect(recipientsOf(id)).toHaveLength(0)
  })
})

describe('campaign results', () => {
  it('cost per lead, cost per won deal, spend and email rates', async () => {
    const created = await api(adminToken(CREST), 'POST', '/marketing/campaigns', { body: { name: 'Results probe', channel: 'ads', budget: 1000 } })
    expect(created.status, created.text).toBe(200)
    const cid = created.body.id as string
    expect(created.body.currency_code).toBe('SAR')
    for (const amount of [300, 200]) {
      const r = await api(adminToken(CREST), 'POST', `/marketing/campaigns/${cid}/costs`, { body: { amount, incurred_on: '2026-11-01', description: 'Probe' } })
      expect(r.status, r.text).toBe(200)
    }
    const four = companyLeads(CREST).filter((l) => !l.doNotContact && l.status !== 'Won').slice(0, 4)
    for (const l of four) {
      const r = await api(adminToken(CREST), 'PATCH', `/leads/${l.id}`, { body: { campaign_id: cid } })
      expect(r.status, r.text).toBe(200)
    }
    four[0].status = 'Won'
    ;(globalThis as { __apexMarketingEngagement?: string }).__apexMarketingEngagement = 'all'
    four.forEach((l, i) => (l.contactEmail = `probe${i}@crest-probe.example.org`))
    const id = await newEmail(CREST, { owner_ids: [] }, { campaign_id: cid })
    await api(adminToken(CREST), 'PATCH', `/marketing/emails/${id}`, { body: { filters: { statuses: [...new Set(four.map((l) => l.status))], industries: [], sources: [], owner_ids: [] } } })
    await api(adminToken(CREST), 'POST', `/marketing/emails/${id}/send-now`)
    await advance(CREST, 60_000)

    const res = await api(adminToken(CREST), 'GET', `/marketing/campaigns/${cid}/results`)
    expect(res.status).toBe(200)
    const k = res.body.kpis
    expect(k).toMatchObject({ leads: 4, won: 1, spend: 500, budget: 1000, cost_per_lead: 125, cost_per_won: 500 })
    expect(k.sent).toBeGreaterThan(0)
    expect(k.opened).toBe(k.sent)
    expect(k.open_rate).toBe(100)
    expect(res.body.costs).toHaveLength(2)
    expect(res.body.costs[0]).toMatchObject({ incurred_on: '2026-11-01', description: 'Probe' })
    expect(res.body.emails[0].id).toBe(id)
    expect(res.body.timeline.length).toBeGreaterThan(0)

    const list = await api(adminToken(CREST), 'GET', '/marketing/campaigns')
    expect(list.body.find((c: { id: string }) => c.id === cid)).toMatchObject({ spend: 500, leads: 4, won: 1, cost_per_lead: 125 })

    const today = zonedParts(nowMs(), 'Asia/Riyadh').date
    const report = await api(adminToken(CREST), 'GET', `/marketing/reports/cost-per-lead?from=2026-01-01&to=${today}`)
    expect(report.status).toBe(200)
    const row = report.body.rows.find((r: { campaign_id: string }) => r.campaign_id === cid)
    expect(row).toMatchObject({ spend: 500 })
  })

  it('a lead created or imported with a campaign is attributed; an unknown or foreign campaign is refused', async () => {
    const own = (await api(adminToken(APEX), 'GET', '/marketing/campaigns')).body[0].id as string
    const crestCampaign = (await api(adminToken(CREST), 'GET', '/marketing/campaigns')).body[0].id as string
    const lead = (campaign: string) => ({
      company_name: `Campaign Probe ${campaign}`,
      source_id: 'LinkedIn',
      industry_id: companyLeads(APEX)[0].industry,
      contacts: [{ name: 'Probe Person', title: '', mobile: '+971 50 555 0199', email: `probe-${campaign}@example.org`, is_decision_maker: false }],
      next_follow_up_date: null,
      campaign_id: campaign,
    })
    const ok = await api(adminToken(APEX), 'POST', '/leads', { body: lead(own) })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.campaign_id).toBe(own)
    const foreign = await api(adminToken(APEX), 'POST', '/leads', { body: lead(crestCampaign) })
    const missing = await api(adminToken(APEX), 'POST', '/leads', { body: lead('CMP-nope') })
    expect(foreign.status).toBe(422)
    expect(foreign.body).toEqual(missing.body)
  })
})

describe('module gating', () => {
  it('a plan without marketing answers 403 module_not_in_plan on every /marketing path', async () => {
    const sub = subOf(CREST)
    sub.planId = 'starter'
    sub.planVersion = 1
    for (const [method, path] of [
      ['GET', '/marketing/campaigns'],
      ['GET', '/marketing/emails'],
      ['POST', '/marketing/campaigns'],
      ['GET', '/marketing/reports/cost-per-lead?from=2026-01-01&to=2026-12-31'],
    ] as const) {
      const r = await api(adminToken(CREST), method, path, { body: method === 'POST' ? { name: 'x', channel: 'ads' } : undefined })
      expect(r.status, path).toBe(403)
      expect(r.body).toMatchObject({ code: 'module_not_in_plan', module: 'marketing' })
    }
    expect((await api(adminToken(APEX), 'GET', '/marketing/campaigns')).status).toBe(200)
  })
})
