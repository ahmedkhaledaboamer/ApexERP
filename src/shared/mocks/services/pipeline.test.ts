import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import type { MoveLeadInput } from '@/modules/leads/types'
import { ApiError } from '@/shared/lib/apiError'
import { can } from '@/shared/lib/permissions'
import { moveActionFor } from '@/modules/leads/lib/transitions'
import { leads, users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { moveLeadStage } from '@/shared/mocks/services/leads'

/**
 * Pipeline transition rules (regression for "New → Interested doesn't move"). Every stage of each
 * company's Settings list is tried against every other stage, so a new or renamed status is covered
 * automatically. The board (moveActionFor) and the API (PATCH /leads/:id/stage) must agree.
 */

let snap: ReturnType<typeof takeSnapshot>
beforeEach(() => {
  snap = takeSnapshot(true)
})
afterEach(() => restoreSnapshot(snap))

const u = (id: string): User => {
  const found = users.find((x) => x.id === id)
  if (!found) throw new Error(`seed user ${id} missing`)
  return found
}

async function attempt(user: User, input: MoveLeadInput): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    await moveLeadStage(user, input)
    return { ok: true }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    return { ok: false, status: e.status, message: e.message }
  }
}

const COMPANIES = [
  { co: APEX_ID, admin: 'u1' },
  { co: CREST_ID, admin: 'u101' },
]

describe('moveActionFor (what the board does on drop)', () => {
  it('maps each seeded stage to the right flow', () => {
    const byKey = new Map(lookupsFor(APEX_ID).statuses.map((s) => [s.key, moveActionFor(s)]))
    expect(byKey.get('Interested')).toBe('next-step')
    expect(byKey.get('Meeting')).toBe('next-step')
    expect(byKey.get('Lost')).toBe('loss-reason')
    expect(byKey.get('Not interested')).toBe('loss-reason')
    expect(byKey.get('Won')).toBe('won')
    for (const k of ['New', 'Contacted', 'No response', 'Call later', 'Proposal', 'Cold']) expect(byKey.get(k), k).toBe('direct')
  })
})

describe.each(COMPANIES)('every stage → every other stage ($co)', ({ co, admin }) => {
  const statuses = lookupsFor(co).statuses.filter((s) => s.active)
  const pairs = statuses.flatMap((from) => statuses.filter((to) => to.key !== from.key).map((to) => [from.key, to.key] as const))

  it.each(pairs)('%s → %s', async (fromKey, toKey) => {
    const user = u(admin)
    const lead = leads.find((l) => l.companyId === co)!
    lead.status = fromKey
    const target = statuses.find((s) => s.key === toKey)!
    const action = moveActionFor(target)
    const reason = lookupsFor(co).lossReasons.find((r) => r.active && !r.hiddenFromPickers)!.key

    if (action === 'won') {
      // Won is never a plain stage move: only the atomic Won flow converts the lead.
      const r = await attempt(user, { id: lead.id, status: toKey })
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(lead.status).toBe(fromKey)
      return
    }
    if (action === 'next-step') {
      expect(await attempt(user, { id: lead.id, status: toKey })).toMatchObject({ ok: false, status: 422 })
      expect(await attempt(user, { id: lead.id, status: toKey, nextStep: '  ' , nextFollowUpDate: new Date().toISOString() })).toMatchObject({ ok: false, status: 422 })
      expect(lead.status).toBe(fromKey)
      const when = new Date(Date.now() + 2 * 86_400_000).toISOString()
      expect(await attempt(user, { id: lead.id, status: toKey, nextStep: 'Send the proposal', nextFollowUpDate: when })).toEqual({ ok: true })
      expect(lead.status).toBe(toKey)
      expect(lead.nextStep).toBe('Send the proposal')
      expect(lead.nextFollowUpDate).toBe(when)
      return
    }
    if (action === 'loss-reason') {
      expect(await attempt(user, { id: lead.id, status: toKey })).toMatchObject({ ok: false, status: 422 })
      expect(await attempt(user, { id: lead.id, status: toKey, lossReason: 'Not a reason from the list' })).toMatchObject({ ok: false, status: 422 })
      expect(lead.status).toBe(fromKey)
      expect(await attempt(user, { id: lead.id, status: toKey, lossReason: reason })).toEqual({ ok: true })
      expect(lead.status).toBe(toKey)
      expect(lead.lossReason).toBe(reason)
      expect(lead.nextFollowUpDate).toBeNull()
      return
    }
    expect(await attempt(user, { id: lead.id, status: toKey })).toEqual({ ok: true })
    expect(lead.status).toBe(toKey)
  })
})

describe('who can move a lead (from the permission matrix)', () => {
  const interested = (id: string): MoveLeadInput => ({
    id,
    status: 'Interested',
    nextStep: 'Book a demo',
    nextFollowUpDate: new Date(Date.now() + 86_400_000).toISOString(),
  })
  const apexLead = (pred: (ownerId: string) => boolean) =>
    leads.find((l) => l.companyId === APEX_ID && l.status === 'New' && pred(l.ownerId)) ??
    leads.find((l) => l.companyId === APEX_ID && pred(l.ownerId))!

  it('Company Admin, Management and Sales Manager can move any company lead', async () => {
    for (const id of ['u1', 'u2', 'u3']) {
      expect(can(u(id).role, 'sales', 'edit'), id).toBe(true)
      const lead = apexLead(() => true)
      lead.status = 'New'
      expect(await attempt(u(id), interested(lead.id)), id).toEqual({ ok: true })
    }
  })

  it('a Sales Agent moves their own leads; a colleague’s lead is refused with a clear message', async () => {
    const agent = u('u4')
    const own = apexLead((o) => o === agent.id)
    own.status = 'New'
    expect(await attempt(agent, interested(own.id))).toEqual({ ok: true })
    const other = apexLead((o) => o !== agent.id && u(o).role === 'Sales Agent')
    other.status = 'New'
    const r = await attempt(agent, interested(other.id))
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(r.ok === false && r.message).toMatch(/outside your access/)
    expect(other.status).toBe('New')
  })

  it('a role without edit access (Marketing Manager: view) gets a clear "no permission" refusal', async () => {
    const marketing = u('u7')
    expect(can(marketing.role, 'sales', 'edit')).toBe(false)
    const lead = apexLead(() => true)
    lead.status = 'New'
    const r = await attempt(marketing, interested(lead.id))
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(r.ok === false && r.message).toMatch(/can view leads but not change them/)
    expect(lead.status).toBe('New')
  })

  it('a lead of another company is not found (404), whatever the role', async () => {
    const crestLead = leads.find((l) => l.companyId === CREST_ID)!
    expect(await attempt(u('u1'), interested(crestLead.id))).toMatchObject({ ok: false, status: 404 })
  })
})
