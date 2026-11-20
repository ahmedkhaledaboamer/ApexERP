import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { eventBudgetLines, events } from '@/shared/mocks/data/events'
import { notifications } from '@/shared/mocks/data/tasks'
import { eventDeadlines, eventLogisticsLines, eventTrips, syncLogisticsLines } from '@/shared/mocks/data/eventLogistics'
import { ROLES } from '@/shared/lib/constants'
import { scopeOf } from '@/shared/lib/permissions'
import { isOnTeam } from '@/shared/mocks/selectors/events'
import { runLogisticsReminders } from '@/shared/mocks/services/eventLogistics'
import { eventVendors } from '@/shared/mocks/data/eventLibrary'
import { takeSnapshot } from '@/shared/mocks/persist/registry'
import { api, recorded, secretsIn, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Travel & logistics: trips / shipments → budget lines (idempotent), visa masking, own trips, deadlines + reminders, access. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const linesOf = (eventId: string) => eventBudgetLines.filter((l) => l.eventId === eventId)
const lineOfTrip = (tripId: string) => eventBudgetLines.find((l) => l.id === eventLogisticsLines.find((k) => k.kind === 'trip' && k.sourceId === tripId)?.lineId)

describe('costs roll up into the event budget', () => {
  it('a trip keeps ONE travel line in step: create → line, edit → same line, delete → gone; ROI / cost per lead include it', async () => {
    const before = linesOf('EV-1101').length
    const statsBefore = (await apexAdmin('GET', '/events/EV-1101/stats')).body
    const t = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u12', flight_from: 'DXB', flight_to: 'LAS', flight_cost: 7000, hotel_cost: 3000, per_diem: 500 })
    expect(t.status).toBe(200)
    expect(t.body.total).toBe(10500)
    const line = lineOfTrip(t.body.id)!
    expect(line).toMatchObject({ category: 'travel', planned: 10500, actual: 10500 })
    expect(t.body.budget_line_id).toBe(line.id)
    expect(linesOf('EV-1101')).toHaveLength(before + 1)
    expect((await apexAdmin('GET', '/events/EV-1101/stats')).body.actual_cost).toBe(statsBefore.actual_cost + 10500)
    await apexAdmin('PATCH', `/events/EV-1101/trips/${t.body.id}`, { hotel_cost: 4000 })
    await apexAdmin('PATCH', `/events/EV-1101/trips/${t.body.id}`, { hotel_cost: 4000 })
    expect(linesOf('EV-1101')).toHaveLength(before + 1)
    expect(lineOfTrip(t.body.id)).toMatchObject({ id: line.id, actual: 11500 })
    // Idempotent: re-syncing changes nothing.
    expect(syncLogisticsLines(events.find((e) => e.id === 'EV-1101')!)).toBe(false)
    // The line follows the trip: edited here, refused on the budget tab.
    const budget = (await apexAdmin('GET', '/events/EV-1101/budget')).body
    expect(budget.lines.find((l: { id: string }) => l.id === line.id).source).toEqual({ kind: 'trip', id: t.body.id })
    expect((await apexAdmin('PATCH', `/events/EV-1101/budget-lines/${line.id}`, { actual: 1 })).body.code).toBe('managed_by_logistics')
    expect((await apexAdmin('DELETE', `/events/EV-1101/budget-lines/${line.id}`)).status).toBe(409)
    await apexAdmin('DELETE', `/events/EV-1101/trips/${t.body.id}`)
    expect(linesOf('EV-1101')).toHaveLength(before)
    expect(eventBudgetLines.some((l) => l.id === line.id)).toBe(false)
    expect((await apexAdmin('GET', '/events/EV-1101/stats')).body.actual_cost).toBe(statsBefore.actual_cost)
  })

  it('a shipment keeps one logistics line; a cost of 0 removes it; the seed trips and shipment are already on the budget', async () => {
    const seeded = eventTrips.filter((t) => t.eventId === 'EV-1101')
    expect(seeded.length).toBeGreaterThan(1)
    for (const t of seeded) expect(lineOfTrip(t.id)?.actual).toBe(t.flightCost + t.hotelCost + t.perDiem + t.otherCosts)
    const s = await apexAdmin('POST', '/events/EV-1101/shipments', { items: 'Demo kiosk', vendor_name: 'Aramex', tracking_number: 'ARX-1', cost: 2000 })
    const line = eventBudgetLines.find((l) => l.id === s.body.budget_line_id)!
    expect(line).toMatchObject({ category: 'logistics', actual: 2000 })
    await apexAdmin('PATCH', `/events/EV-1101/shipments/${s.body.id}`, { cost: 0 })
    expect(eventBudgetLines.some((l) => l.id === line.id)).toBe(false)
    const again = await apexAdmin('PATCH', `/events/EV-1101/shipments/${s.body.id}`, { cost: 300 })
    expect(eventBudgetLines.find((l) => l.id === again.body.budget_line_id)).toMatchObject({ category: 'logistics', actual: 300 })
  })

  it('a linked campaign gets the logistics costs too (kept in step)', async () => {
    const r = await apexAdmin('PUT', '/events/EV-1101/campaign', { campaign_id: 'CMP-1001' })
    expect(r.status).toBe(200)
    const t = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u12', flight_cost: 1234 })
    const budget = (await apexAdmin('GET', '/events/EV-1101/budget')).body
    expect(budget.lines.find((l: { id: string }) => l.id === t.body.budget_line_id).posted).toBe(true)
  })
})

describe('visa numbers are never stored or returned in full', () => {
  it('only the last 4 are kept and served masked; no response or store holds the full number', async () => {
    const full = 'P98765432101'
    const t = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u12', visa_required: true, visa_status: 'approved', visa_number: full, visa_expiry: '2028-01-31' })
    expect(t.body.visa_number_masked).toBe('•••• 2101')
    expect('visa_number' in t.body).toBe(false)
    const reads = [t, await apexAdmin('GET', '/events/logistics'), await apexAdmin('GET', '/events/EV-1101/logistics'), await apexAdmin('PATCH', `/events/EV-1101/trips/${t.body.id}`, { notes: 'x' })]
    for (const r of reads) {
      expect(r.text).not.toContain(full)
      expect(r.text).not.toContain('98765432')
      expect(secretsIn(r.body, `${r.method} ${r.path}`)).toEqual([])
    }
    expect(JSON.stringify(takeSnapshot().stores)).not.toContain('98765432')
    expect(recorded.every((r) => !r.text.includes(full))).toBe(true)
    // The guard itself rejects a document number under any of its keys.
    expect(secretsIn({ visa_number: full }, 'GET /x')).not.toEqual([])
    expect(secretsIn({ trip: { passportNumber: full } }, 'GET /x')).not.toEqual([])
    // Not required → the masked number and expiry are cleared; '' clears it too.
    expect((await apexAdmin('PATCH', `/events/EV-1101/trips/${t.body.id}`, { visa_required: false })).body).toMatchObject({ visa_status: 'not_needed', visa_number_masked: null, visa_expiry: null })
    expect((await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u13', visa_required: true, visa_number: '12' })).status).toBe(422)
  })
})

describe('who sees what', () => {
  it('a user without marketing access sees their OWN trips (list and event), nothing else, and can’t change them', async () => {
    // u11: Employee (marketing hidden), not on the CES team.
    const t = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u11', flight_cost: 900 })
    const list = (await as('u11')('GET', '/events/logistics')).body
    expect(list.trips.map((x: { id: string }) => x.id)).toEqual([t.body.id])
    expect(list).toMatchObject({ shipments: [], deadlines: [], sees_all: false })
    expect(list.trips[0].can_manage).toBe(false)
    const one = await as('u11')('GET', '/events/EV-1101/logistics')
    expect(one.status).toBe(200)
    expect(one.body.trips).toHaveLength(1)
    expect((await as('u11')('PATCH', `/events/EV-1101/trips/${t.body.id}`, { notes: 'mine' })).status).toBe(403)
    expect((await as('u14')('GET', '/events/EV-1101/logistics')).status).toBe(403)
    expect((await as('u14')('GET', '/events/logistics')).body.trips).toEqual([])
  })

  it('all nine roles follow the matrix: marketing full manages, view reads, hidden is refused; team members manage their event', async () => {
    expect(ROLES).toHaveLength(9)
    for (const role of ROLES) {
      const e = ['EV-1101', 'EV-5002', 'EV-1003'].map((id) => events.find((x) => x.id === id)!).find((ev) => users.some((u) => u.companyId === ev.companyId && u.role === role && !isOnTeam(u, ev)))!
      const u = users.find((x) => x.companyId === e.companyId && x.role === role && x.active !== false && !isOnTeam(x, e))!
      const scope = scopeOf(role, 'marketing')
      expect((await as(u.id)('GET', `/events/${e.id}/logistics`)).status, `${role} read`).toBe(scope === 'full' || scope === 'view' ? 200 : 403)
      const w = await as(u.id)('POST', `/events/${e.id}/deadlines`, { title: `Role ${role}`, due_date: '2030-05-01' })
      expect(w.status, `${role} write`).toBe(scope === 'full' ? 200 : 403)
      const list = await as(u.id)('GET', '/events/logistics')
      expect(list.status).toBe(200)
      if (scope === 'full' || scope === 'view') expect(list.body.trips.length, role).toBe(eventTrips.filter((t) => t.companyId === e.companyId && events.find((x) => x.id === t.eventId)?.status !== 'cancelled').length)
    }
    // u4: Sales Agent (marketing hidden) on the CES team; u104: Sales Agent on Crest's EV-5002 team.
    expect((await as('u4')('POST', '/events/EV-1101/shipments', { items: 'Team crate', cost: 10 })).status).toBe(200)
    expect((await as('u104')('POST', '/events/EV-5002/deadlines', { title: 'Team deadline', due_date: '2030-05-01' })).status).toBe(200)
  })

  it('foreign ids in bodies behave like missing ones (traveller, vendor, deadline owner)', async () => {
    const missing = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u-nope' })
    const foreign = await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u103' })
    expect(foreign.status).toBe(422)
    expect(foreign.body).toEqual(missing.body)
    const noVendor = await apexAdmin('POST', '/events/EV-1101/shipments', { items: 'Crate', vendor_id: 'VEN-nope' })
    expect(noVendor.status).toBe(422)
    const crestVendorId = eventVendors.find((v) => v.companyId === 'co_crest')?.id
    if (crestVendorId) expect((await apexAdmin('POST', '/events/EV-1101/shipments', { items: 'Crate', vendor_id: crestVendorId })).body).toEqual(noVendor.body)
    const noOwner = await apexAdmin('POST', '/events/EV-1101/deadlines', { title: 'X deadline', due_date: '2030-01-01', owner_id: 'u-nope' })
    const crestOwner = await apexAdmin('POST', '/events/EV-1101/deadlines', { title: 'X deadline', due_date: '2030-01-01', owner_id: 'u101' })
    expect(crestOwner.status).toBe(422)
    expect(crestOwner.body).toEqual(noOwner.body)
    const crestTrip = eventTrips.find((t) => t.companyId === 'co_crest')!
    expect((await apexAdmin('PATCH', `/events/EV-1101/trips/${crestTrip.id}`, { notes: 'x' })).status).toBe(404)
    expect((await as('u101')('GET', '/events/logistics')).body.trips.every((t: { event_id: string }) => events.find((e) => e.id === t.event_id)?.companyId === 'co_crest')).toBe(true)
  })

  it('one trip per person per event', async () => {
    expect((await apexAdmin('POST', '/events/EV-1101/trips', { user_id: 'u7' })).body.code).toBe('trip_exists')
  })
})

describe('deadlines', () => {
  it('a deadline appears on the list; its reminder goes once, 3 days before by the company calendar, re-armed by a new due date', async () => {
    const r = await apexAdmin('POST', '/events/EV-1101/deadlines', { title: 'Lead retrieval order', due_date: '2030-03-10', owner_id: 'u4' })
    expect(r.status).toBe(200)
    const list = (await apexAdmin('GET', '/events/logistics')).body
    expect(list.deadlines.some((d: { id: string; title: string }) => d.id === r.body.id && d.title === 'Lead retrieval order')).toBe(true)
    for (const d of eventDeadlines) if (d.id !== r.body.id) d.reminderSentAt ??= 'already'
    const mine = () => notifications.filter((k) => k.userId === 'u4' && k.type === 'marketing-due' && k.title.startsWith('Lead retrieval order')).length
    const base = mine()
    // Dubai (UTC+4): 2030-03-06T19:59Z is still the 6th (4 days left); 20:01Z is the 7th (3 days left).
    expect(runLogisticsReminders('co_apex', new Date('2030-03-06T19:59:00Z')).reminders).toBe(0)
    expect(runLogisticsReminders('co_apex', new Date('2030-03-06T20:01:00Z')).reminders).toBe(1)
    expect(runLogisticsReminders('co_apex', new Date('2030-03-08T08:00:00Z')).reminders).toBe(0)
    expect(mine()).toBe(base + 1)
    await apexAdmin('PATCH', `/events/EV-1101/deadlines/${r.body.id}`, { due_date: '2030-04-10' })
    expect(runLogisticsReminders('co_apex', new Date('2030-04-08T08:00:00Z')).reminders).toBe(1)
    await apexAdmin('PATCH', `/events/EV-1101/deadlines/${r.body.id}`, { done: true })
    const done = (await apexAdmin('GET', '/events/EV-1101/logistics')).body.deadlines.find((d: { id: string }) => d.id === r.body.id)
    expect(done).toMatchObject({ done: true, overdue: false })
    expect(mine()).toBe(base + 2)
  })
})
