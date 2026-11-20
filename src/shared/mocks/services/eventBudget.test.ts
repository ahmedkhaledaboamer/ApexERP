import { describe, expect, it } from 'vitest'
import { leads } from '@/shared/mocks/db'
import { campaignCosts } from '@/shared/mocks/data/marketing'
import { eventCostLinks } from '@/shared/mocks/data/events'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Budget lines, campaign cost posting (idempotent, unlink keeps history), ROI and cost per won deal. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
const costsOf = (campaignId: string) => campaignCosts.filter((c) => c.campaignId === campaignId && c.note.startsWith('Event '))

describe('budget lines', () => {
  it('totals vs the event budget; seeded actuals equal the event’s actual cost', async () => {
    const b = await apexAdmin('GET', '/events/EV-1001/budget')
    expect(b.status).toBe(200)
    expect(b.body).toMatchObject({ actual_total: 79250, budget: 85000, remaining: 5750, currency: 'AED', can_manage: true })
    expect(b.body.lines[0]).toMatchObject({ category: 'venue', planned: 50000, actual: 52000 })
    const crest = await crestAdmin('GET', '/events/EV-5001/budget')
    expect(crest.body).toMatchObject({ actual_total: 116500, currency: 'SAR' })
    expect((await apexAdmin('GET', '/events/EV-5001/budget')).status).toBe(404)
  })

  it('add / change / remove need the manage right (owner or marketing full); a team member can read', async () => {
    // EV-1003: owner u3; u6 on the team.
    expect((await as('u6')('POST', '/events/EV-1003/budget-lines', { category: 'travel', planned: 100 })).status).toBe(403)
    expect((await as('u6')('GET', '/events/EV-1003/budget')).body.can_manage).toBe(false)
    const r = await as('u3')('POST', '/events/EV-1003/budget-lines', { category: 'catering', planned: 4000, actual: 3800, note: 'Breakfast' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ planned_total: 4000, actual_total: 3800, remaining: 12000 - 3800 })
    expect((await apexAdmin('POST', '/events/EV-1003/budget-lines', { category: 'yachts' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events/EV-1003/budget-lines', { category: 'travel', actual: -5 })).status).toBe(422)
    const id = r.body.lines[0].id
    expect((await apexAdmin('PATCH', `/events/EV-1003/budget-lines/${id}`, { actual: 4100 })).body.actual_total).toBe(4100)
    expect((await apexAdmin('DELETE', `/events/EV-1003/budget-lines/${id}`)).body.lines).toHaveLength(0)
  })
})

describe('campaign link', () => {
  it('posts each line’s actual as a campaign cost once; edits update in place; re-linking never duplicates', async () => {
    const before = campaignCosts.length
    const r = await apexAdmin('PUT', '/events/EV-1001/campaign', { campaign_id: 'CMP-1002' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ campaign_id: 'CMP-1002', campaign_name: 'GITEX Global 2026 booth', posted_total: 79250 })
    expect(r.body.lines.every((l: { posted: boolean }) => l.posted)).toBe(true)
    expect(costsOf('CMP-1002')).toHaveLength(5)
    expect(campaignCosts.length).toBe(before + 5)
    // Idempotent.
    await apexAdmin('PUT', '/events/EV-1001/campaign', { campaign_id: 'CMP-1002' })
    expect(costsOf('CMP-1002')).toHaveLength(5)
    // A changed actual updates its entry; 0 removes it.
    const line = r.body.lines.find((l: { category: string }) => l.category === 'printing')
    await apexAdmin('PATCH', `/events/EV-1001/budget-lines/${line.id}`, { actual: 5000 })
    expect(costsOf('CMP-1002').find((c) => c.note.includes('Printing'))!.amount).toBe(5000)
    await apexAdmin('PATCH', `/events/EV-1001/budget-lines/${line.id}`, { actual: 0 })
    expect(costsOf('CMP-1002')).toHaveLength(4)
    // The campaign's own spend sees them (Marketing results).
    const results = await apexAdmin('GET', '/marketing/campaigns/CMP-1002/results')
    expect(results.status).toBe(200)
  })

  it('unlinking keeps the posted history; another company’s campaign is refused', async () => {
    await apexAdmin('PUT', '/events/EV-1001/campaign', { campaign_id: 'CMP-1002' })
    const unlinked = await apexAdmin('PUT', '/events/EV-1001/campaign', { campaign_id: null })
    expect(unlinked.body).toMatchObject({ campaign_id: null, posted_total: 0 })
    expect(costsOf('CMP-1002')).toHaveLength(5)
    // Changes after unlinking don't touch the old entries.
    await apexAdmin('POST', '/events/EV-1001/budget-lines', { category: 'other', actual: 999 })
    expect(costsOf('CMP-1002')).toHaveLength(5)
    expect((await apexAdmin('PUT', '/events/EV-1001/campaign', { campaign_id: 'CMP-5001' })).status).toBe(422)
    expect(eventCostLinks.every((k) => k.companyId === 'co_apex' || k.companyId === 'co_crest')).toBe(true)
    expect(campaignCosts.filter((c) => c.campaignId === 'CMP-5001' && c.note.startsWith('Event ')).length).toBe(0)
  })
})

describe('ROI', () => {
  it('ROI = (won value − actual cost) / actual cost; cost per won deal; actual cost from the lines', async () => {
    const s0 = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s0).toMatchObject({ actual_cost: 79250, actual_cost_source: 'budget_lines' })
    // Win one of the event's leads for 158,500 → ROI = (158500 − 79250) / 79250 = 1.
    const won = lookupsFor('co_apex').statuses.find((s) => s.type === 'won')!.key
    for (const l of leads.filter((x) => x.eventId === 'EV-1001')) if (l.status === won) l.status = 'New'
    const lead = leads.find((l) => l.eventId === 'EV-1001')!
    lead.status = won
    lead.value = 158500
    const s = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s).toMatchObject({ deals_won: 1, won_value: 158500, roi: 1, cost_per_won_deal: 79250 })
    // Without lines and without an actual cost: no ROI.
    const plain = await apexAdmin('POST', '/events', { name: 'No costs', type: 'meeting', start_date: '2027-01-10' })
    expect((await apexAdmin('GET', `/events/${plain.body.id}/stats`)).body).toMatchObject({ roi: null, cost_per_won_deal: null, actual_cost_source: 'event' })
  })

  it('Marketing Analytics events card uses the actual cost', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
    const r = await apexAdmin('GET', `/marketing/analytics?preset=custom&from=${day(-60)}&to=${day(0)}`)
    expect(r.status).toBe(200)
    const row = r.body.events.rows.find((x: { event_id: string }) => x.event_id === 'EV-1001')
    expect(row.cost).toBe(79250)
    expect(r.body.events.cost).toBeGreaterThanOrEqual(79250)
  })
})

describe('cost per lead uses the same cost as ROI', () => {
  it('actual cost when known (budget lines), else the planned budget', async () => {
    const s = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s.actual_cost).not.toBeNull()
    expect(s.cost_per_lead_basis).toBe('actual')
    expect(s.cost_per_lead).toBeCloseTo(s.actual_cost / s.leads_created, 2)
    // Cost per lead and cost per won deal divide the same cost.
    expect(s.cost_per_lead * s.leads_created).toBeCloseTo(s.cost_per_won_deal * s.deals_won, 0)

    // An event with a budget but no actual cost yet: the budget is the basis.
    const planned = (await apexAdmin('GET', '/events/EV-1004/stats')).body
    if (planned.actual_cost === null && planned.budget !== null && planned.leads_created > 0) {
      expect(planned.cost_per_lead_basis).toBe('budget')
      expect(planned.cost_per_lead).toBeCloseTo(planned.budget / planned.leads_created, 2)
    } else {
      expect(['actual', 'budget', null]).toContain(planned.cost_per_lead_basis)
    }
  })
})
