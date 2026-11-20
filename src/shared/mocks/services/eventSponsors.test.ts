import { describe, expect, it } from 'vitest'
import { leads, users } from '@/shared/mocks/db'
import { events } from '@/shared/mocks/data/events'
import { notifications, tasks } from '@/shared/mocks/data/tasks'
import { sponsorDeals, sponsorDeliverables, sponsorPackages } from '@/shared/mocks/data/eventSponsors'
import { scopeOf } from '@/shared/lib/permissions'
import { ROLES } from '@/shared/lib/constants'
import { isOnTeam } from '@/shared/mocks/selectors/events'
import { runSponsorReminders, stageProblem } from '@/shared/mocks/services/eventSponsors'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Sponsors & exhibitors: packages, the sold-out rule, stages, sponsorship income in ROI, deliverables + reminders, access. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')
let n = 0
const uniq = () => `${++n}${Date.now().toString(36)}`
const pkgOf = (eventId: string, name: string) => sponsorPackages.find((p) => p.eventId === eventId && p.name === name)!
const newSponsor = (pkgId: string, extra: Record<string, unknown> = {}) => {
  const u = uniq()
  return { package_id: pkgId, new_lead: { company: `Sponsor Co ${u}`, contact_name: 'Dana Sponsor', email: `dana-${u}@sponsor-${u}.ae` }, ...extra }
}

describe('packages and the sold-out rule', () => {
  it('signing can’t exceed the package quantity (409 sold_out), on create, on a stage move and on a package switch', async () => {
    const platinum = pkgOf('EV-1003', 'Platinum') // quantity 1, already paid in the seed
    const signedNow = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(platinum.id, { stage: 'signed' }))
    expect(signedNow.status).toBe(409)
    expect(signedNow.body.code).toBe('sold_out')
    const prospect = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(platinum.id))
    expect(prospect.status).toBe(200)
    expect(prospect.body).toMatchObject({ stage: 'prospect', amount: 25000, package_name: 'Platinum', discount: 0 })
    const move = await apexAdmin('POST', `/events/EV-1003/sponsors/${prospect.body.id}/stage`, { stage: 'signed' })
    expect(move.status).toBe(409)
    expect(move.body.code).toBe('sold_out')
    // A signed Gold deal can't switch onto the sold-out Platinum package either.
    const gold = sponsorDeals.find((d) => d.eventId === 'EV-1003' && d.stage === 'signed')!
    expect((await apexAdmin('PATCH', `/events/EV-1003/sponsors/${gold.id}`, { package_id: platinum.id })).body.code).toBe('sold_out')
    // Raising the quantity frees a slot; lowering it below the signed count is refused.
    expect((await apexAdmin('PATCH', `/events/EV-1003/sponsor-packages/${platinum.id}`, { quantity: 2 })).body).toMatchObject({ quantity: 2, sold: 1, remaining: 1 })
    expect((await apexAdmin('POST', `/events/EV-1003/sponsors/${prospect.body.id}/stage`, { stage: 'signed' })).status).toBe(200)
    expect((await apexAdmin('PATCH', `/events/EV-1003/sponsor-packages/${platinum.id}`, { quantity: 1 })).body.code).toBe('quantity_below_sold')
  })

  it('packages: company currency only, a package with sponsors can’t be deleted, attended events have no sponsors', async () => {
    const pkg = await apexAdmin('POST', '/events/EV-1003/sponsor-packages', { name: 'Silver', price: 7500, quantity: 3, benefits: ['Logo on the invitation'], deliverables: [{ title: 'Logo received', offset_days: -7 }] })
    expect(pkg.body).toMatchObject({ name: 'Silver', currency: 'AED', remaining: 3, deliverables: [{ title: 'Logo received', offset_days: -7 }] })
    expect((await apexAdmin('POST', '/events/EV-1003/sponsor-packages', { name: 'Bronze', price: 100, quantity: 1, currency: 'USD' })).status).toBe(422)
    expect((await apexAdmin('POST', '/events/EV-1003/sponsor-packages', { name: 'silver', price: 1, quantity: 1 })).status).toBe(409)
    expect((await apexAdmin('DELETE', `/events/EV-1003/sponsor-packages/${pkgOf('EV-1003', 'Gold').id}`)).body.code).toBe('package_in_use')
    expect((await apexAdmin('DELETE', `/events/EV-1003/sponsor-packages/${pkg.body.id}`)).status).toBe(200)
    const attended = await apexAdmin('POST', '/events/EV-1001/sponsor-packages', { name: 'Gold', price: 1, quantity: 1 })
    expect(attended.status).toBe(422)
    expect(attended.body.code).toBe('not_organizer')
  })

  it('the amount defaults to the package price; a discount is fine, more than the price is not', async () => {
    const gold = pkgOf('EV-1003', 'Gold')
    expect((await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(gold.id, { amount: 16000 }))).status).toBe(422)
    const r = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(gold.id, { amount: 12000 }))
    expect(r.body).toMatchObject({ amount: 12000, package_price: 15000, discount: 3000 })
  })
})

describe('stages', () => {
  it('open stages move freely; paid only after signed; signed only to paid / lost; lost needs a reason and reopens to an open stage', async () => {
    expect(stageProblem('prospect', 'negotiating')).toBeNull()
    expect(stageProblem('negotiating', 'contacted')).toBeNull()
    expect(stageProblem('prospect', 'paid')).toMatch(/signed before paid/)
    expect(stageProblem('signed', 'contacted')).toMatch(/only be marked paid or lost/)
    expect(stageProblem('lost', 'signed')).toMatch(/Reopen/)
    const exhibitor = pkgOf('EV-1003', 'Exhibitor table')
    const d = (await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(exhibitor.id))).body
    const stage = (stage: string, extra: Record<string, unknown> = {}) => apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/stage`, { stage, ...extra })
    expect((await stage('paid')).body.code).toBe('invalid_stage')
    expect((await stage('lost')).body.code).toBe('lost_reason_required')
    expect((await stage('lost', { lost_reason: 'No budget' })).body).toMatchObject({ stage: 'lost', lost_reason: 'No budget' })
    expect((await stage('signed')).body.code).toBe('invalid_stage')
    expect((await stage('negotiating')).body).toMatchObject({ stage: 'negotiating', lost_reason: '' })
    const signed = (await stage('signed')).body
    expect(signed.signed_at).toBeTruthy()
    expect((await stage('proposal_sent')).body.code).toBe('invalid_stage')
    const paid = (await stage('paid')).body
    expect(paid.stage).toBe('paid')
    expect(paid.actual_payment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await stage('signed')).body).toMatchObject({ stage: 'signed', actual_payment_date: null })
  })

  it('a new organization goes through the lead path: source Event + event_id, duplicates 409 unless a manager forces', async () => {
    const gold = pkgOf('EV-1003', 'Gold')
    const body = newSponsor(gold.id)
    const r = await apexAdmin('POST', '/events/EV-1003/sponsors', body)
    expect(r.status).toBe(200)
    const lead = leads.find((l) => l.id === r.body.lead_id)!
    expect(lead).toMatchObject({ sourceType: 'Event', sourceDetail: 'Dubai Business Breakfast', eventId: 'EV-1003', company: body.new_lead.company })
    // Same organization again → a duplicate of that lead (409) — and once linked it's already a sponsor.
    const again = await apexAdmin('POST', '/events/EV-1003/sponsors', { package_id: gold.id, new_lead: { company: body.new_lead.company } })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ code: 'duplicate_lead', matches: [{ lead_id: lead.id }] })
    expect((await apexAdmin('POST', '/events/EV-1003/sponsors', { package_id: gold.id, lead_id: lead.id })).body.code).toBe('already_sponsor')
    const existing = leads.find((l) => l.companyId === 'co_apex' && !sponsorDeals.some((d) => d.leadId === l.id))!
    const dup = { package_id: gold.id, new_lead: { company: existing.company }, force: true }
    expect((await as('u6')('POST', '/events/EV-1003/sponsors', dup)).status).toBe(403) // Sales Agent on the team: can't override
    const forced = await apexAdmin('POST', '/events/EV-1003/sponsors', dup)
    expect(forced.status).toBe(200)
    expect(forced.body.lead_id).not.toBe(existing.id)
    const linked = await apexAdmin('POST', '/events/EV-1003/sponsors', { package_id: gold.id, lead_id: existing.id, amount: 9000 })
    expect(linked.body).toMatchObject({ organization_name: existing.company, lead_id: existing.id, amount: 9000 })
  })
})

describe('sponsorship income in the event stats (the one ROI function)', () => {
  it('organized events: ROI = (won value + signed / paid sponsorship − actual cost) / actual cost; the budget shows the income', async () => {
    const income = () => sponsorDeals.filter((d) => d.eventId === 'EV-1003' && (d.stage === 'signed' || d.stage === 'paid')).reduce((s, d) => s + d.amount, 0)
    const before = await apexAdmin('GET', '/events/EV-1003/stats')
    expect(before.body.sponsorship_income).toBe(income())
    expect(before.body.sponsorship_income).toBe(25000 + 13500 + 4000)
    await apexAdmin('POST', '/events/EV-1003/budget-lines', { category: 'venue', planned: 10000, actual: 10000 })
    const deal = sponsorDeals.find((d) => d.eventId === 'EV-1003' && d.stage === 'negotiating')!
    await apexAdmin('POST', `/events/EV-1003/sponsors/${deal.id}/stage`, { stage: 'signed' })
    const s = (await apexAdmin('GET', '/events/EV-1003/stats')).body
    expect(s.sponsorship_income).toBe(income())
    expect(s.actual_cost).toBe(10000)
    expect(s.roi).toBeCloseTo(Math.round(((s.won_value + income() - 10000) / 10000) * 1000) / 1000, 3)
    expect((await apexAdmin('GET', '/events/EV-1003/budget')).body.sponsorship_income).toBe(income())
    expect((await apexAdmin('GET', '/events/EV-1003/sponsorship')).body.income).toMatchObject({ total: income(), paid: 25000 })
  })

  it('attended events are unchanged: no sponsorship income, ROI = (won value − actual cost) / actual cost', async () => {
    const s = (await apexAdmin('GET', '/events/EV-1001/stats')).body
    expect(s.sponsorship_income).toBeNull()
    expect(s.roi).toBeCloseTo(Math.round(((s.won_value - s.actual_cost) / s.actual_cost) * 1000) / 1000, 3)
    expect((await apexAdmin('GET', '/events/EV-1001/budget')).body.sponsorship_income).toBeNull()
  })
})

describe('deliverables', () => {
  it('signing creates the package’s deliverables once, due relative to the event’s start (company calendar); a task is linked once', async () => {
    const gold = pkgOf('EV-1003', 'Gold')
    const d = (await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(gold.id))).body
    expect(d.deliverables).toEqual([])
    const signed = (await apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/stage`, { stage: 'signed' })).body
    const start = signed.event_start_date as string
    const shift = (n: number) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
    expect(signed.deliverables.map((x: { title: string; due_date: string }) => [x.title, x.due_date])).toEqual(gold.deliverables.map((t) => [t.title, shift(t.offsetDays)]).sort((a, b) => a[1].localeCompare(b[1])))
    await apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/stage`, { stage: 'paid' })
    await apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/stage`, { stage: 'signed' })
    expect(sponsorDeliverables.filter((x) => x.dealId === d.id)).toHaveLength(gold.deliverables.length)
    const x = signed.deliverables[0]
    const t1 = (await apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/deliverables/${x.id}/task`)).body
    const taskId = t1.deliverables.find((y: { id: string }) => y.id === x.id).task_id
    expect(tasks.find((t) => t.id === taskId)).toMatchObject({ link: { type: 'event', id: 'EV-1003' }, dueDate: x.due_date, ownerId: 'u1' })
    const count = tasks.length
    await apexAdmin('POST', `/events/EV-1003/sponsors/${d.id}/deliverables/${x.id}/task`)
    expect(tasks.length).toBe(count)
    const done = (await apexAdmin('PATCH', `/events/EV-1003/sponsors/${d.id}/deliverables/${x.id}`, { status: 'done' })).body
    expect(done.deliverables.find((y: { id: string }) => y.id === x.id).status).toBe('done')
    expect(tasks.find((t) => t.id === taskId)!.status).toBe('done')
  })

  it('overdue deliverables notify their owner once, by the company’s calendar; a new due date re-arms the notice', async () => {
    const x = sponsorDeliverables.find((d) => d.companyId === 'co_apex' && d.status !== 'done')!
    for (const other of sponsorDeliverables) other.overdueNotifiedAt ??= 'already'
    Object.assign(x, { dueDate: '2030-01-10', overdueNotifiedAt: null, ownerId: 'u7' })
    const mine = () => notifications.filter((k) => k.userId === 'u7' && k.type === 'marketing-overdue' && k.title.startsWith(x.title)).length
    const base = mine()
    // Dubai (UTC+4): 19:59Z on the 10th is still the 10th (due today, not overdue); 20:01Z is the 11th.
    expect(runSponsorReminders('co_apex', new Date('2030-01-10T19:59:00Z')).overdue).toBe(0)
    expect(runSponsorReminders('co_apex', new Date('2030-01-10T20:01:00Z')).overdue).toBe(1)
    expect(runSponsorReminders('co_apex', new Date('2030-01-12T08:00:00Z')).overdue).toBe(0)
    runSponsorReminders('co_crest', new Date('2030-01-12T08:00:00Z')) // the other company's tick never touches Apex rows
    expect(mine()).toBe(base + 1)
    const deal = sponsorDeals.find((d) => d.id === x.dealId)!
    await apexAdmin('PATCH', `/events/${deal.eventId}/sponsors/${deal.id}/deliverables/${x.id}`, { due_date: '2030-02-01' })
    expect(x.overdueNotifiedAt).toBeNull()
    expect(runSponsorReminders('co_apex', new Date('2030-02-02T08:00:00Z')).overdue).toBe(1)
    expect(mine()).toBe(base + 2)
  })
})

describe('access (marketing column + event team) and isolation', () => {
  const ROLE_NAMES = ROLES as readonly string[]
  /** A user of each role who is NOT on the organized event's team (Apex EV-1003, else Crest EV-5101). */
  function outsider(role: string): { user: string; event: string } | null {
    for (const eventId of ['EV-1003', 'EV-5101']) {
      const e = events.find((x) => x.id === eventId)!
      const u = users.find((x) => x.companyId === e.companyId && x.role === role && x.active !== false && !isOnTeam(x, e))
      if (u) return { user: u.id, event: eventId }
    }
    return null
  }

  it('all nine roles follow the matrix: marketing full manages, view reads, hidden gets 403 (but still the empty cross-event list)', async () => {
    expect(ROLE_NAMES).toHaveLength(9)
    for (const role of ROLE_NAMES) {
      const who = outsider(role)
      expect(who, role).not.toBeNull()
      const call = as(who!.user)
      const scope = scopeOf(role as never, 'marketing')
      const read = await call('GET', `/events/${who!.event}/sponsorship`)
      expect(read.status, `${role} read`).toBe(scope === 'full' || scope === 'view' ? 200 : 403)
      const write = await call('POST', `/events/${who!.event}/sponsor-packages`, { name: `Role ${role}`, price: 10, quantity: 1 })
      expect(write.status, `${role} write`).toBe(scope === 'full' ? 200 : 403)
      const list = await call('GET', '/events/sponsors')
      expect(list.status, `${role} list`).toBe(200)
      const own = sponsorDeals.filter((d) => d.companyId === events.find((e) => e.id === who!.event)!.companyId && events.find((e) => e.id === d.eventId)?.status !== 'cancelled').length
      expect(list.body.deals.length, `${role} list rows`).toBe(scope === 'full' || scope === 'view' ? own : 0)
    }
  })

  it('event team members manage their event’s sponsors whatever their marketing scope', async () => {
    // u6: Sales Agent (marketing hidden), on the EV-1003 team.
    const r = await as('u6')('POST', '/events/EV-1003/sponsor-packages', { name: 'Team package', price: 100, quantity: 1 })
    expect(r.status).toBe(200)
    const list = await as('u6')('GET', '/events/sponsors')
    expect(list.body.deals.every((d: { event_id: string }) => d.event_id === 'EV-1003')).toBe(true)
    expect(list.body.deals.length).toBeGreaterThan(0)
    // u104: Sales Agent on the Crest EV-5101 team.
    expect((await as('u104')('POST', '/events/EV-5101/sponsor-packages', { name: 'Crest team package', price: 100, quantity: 1 })).status).toBe(200)
  })

  it('foreign ids in bodies behave like missing ones (package, lead, customer, owner)', async () => {
    const gold = pkgOf('EV-1003', 'Gold')
    const crestPkg = sponsorPackages.find((p) => p.companyId === 'co_crest')!
    const crestLead = leads.find((l) => l.companyId === 'co_crest')!
    const missingPkg = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor('ESP-nope'))
    const foreignPkg = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(crestPkg.id))
    expect(foreignPkg.status).toBe(422)
    expect(foreignPkg.body).toEqual(missingPkg.body)
    const missingLead = await apexAdmin('POST', '/events/EV-1003/sponsors', { package_id: gold.id, lead_id: 'L-nope' })
    const foreignLead = await apexAdmin('POST', '/events/EV-1003/sponsors', { package_id: gold.id, lead_id: crestLead.id })
    expect(foreignLead.status).toBe(422)
    expect(foreignLead.body).toEqual(missingLead.body)
    const missingOwner = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(gold.id, { owner_id: 'u-nope' }))
    const foreignOwner = await apexAdmin('POST', '/events/EV-1003/sponsors', newSponsor(gold.id, { owner_id: 'u101' }))
    expect(foreignOwner.status).toBe(422)
    expect(foreignOwner.body).toEqual(missingOwner.body)
    // A Crest deal through an Apex event path, and the other way round: 404 like a missing one.
    const crestDeal = sponsorDeals.find((d) => d.companyId === 'co_crest')!
    expect((await apexAdmin('GET', `/events/EV-1003/sponsors/${crestDeal.id}`)).status).toBe(404)
    expect((await crestAdmin('GET', `/events/EV-1003/sponsorship`)).status).toBe(404)
    // The cross-event list and the organization picker stay in the caller's company.
    const board = (await crestAdmin('GET', '/events/sponsors')).body
    expect(board.deals.every((d: { event_id: string }) => d.event_id === 'EV-5101')).toBe(true)
    const orgs = (await crestAdmin('GET', '/events/sponsor-organizations?q=')).body as { id: string }[]
    expect(orgs.some((o) => leads.some((l) => l.id === o.id && l.companyId === 'co_apex'))).toBe(false)
  })
})
