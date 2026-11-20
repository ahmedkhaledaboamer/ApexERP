import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * Cross-event Events sections (Attendees directory, Booth leads, Event analytics), TABLE-DRIVEN FROM
 * PERMISSION_MATRIX (docs/API.md › Events › Cross-event sections):
 *   rows        only from events the caller can see — marketing full / view: every event; team / own /
 *               hidden: the events they're on (+ team: owned by their team)
 *   export      marketing `full`
 *   analytics   Marketing view AND Reports full | marketing
 *   assign      Sales edit with scope full | team (the lead update then applies the lead scope per lead)
 * Every role × both companies, with and without event-team membership.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'team', 'own', 'hidden']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})

const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-evs-${co}-${slug}`,
        companyId: co,
        name: `Sections ${role} ${co}`,
        email: `evs-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: '',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})

function userFor(co: Co, role: Role): User {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role && x.id !== ADMIN[co])
  return u ?? users.find((x) => x.id === ADMIN[co])!
}

const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)
const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!

/** A fresh past event owned by the admin (nobody else on its team), with an attendee captured at the booth. */
async function fixture(co: Co): Promise<string> {
  const r = await call(admin(co), 'POST', '/events', { name: `Sections matrix ${co}`, type: 'meeting', start_date: '2027-03-01' })
  expect(r.status).toBe(200)
  const id = r.body.id as string
  const cap = await call(admin(co), 'POST', `/events/${id}/captures`, { name: 'Matrix Visitor', email: `matrix-visitor@${co}.test`, rating: 'hot' })
  expect(cap.status).toBe(200)
  return id
}

function expected(u: User) {
  const role = roleOf(u)
  const scope = scopeOf(role, 'marketing')
  if (!HANDLED.includes(scope)) throw new Error(`PERMISSION_MATRIX uses marketing scope "${scope}"; the sections table has no expectation for it`)
  const team = teamIdsFor(u, users.filter((x) => x.companyId === u.companyId), departments.filter((d) => d.companyId === u.companyId))
  const reports = scopeOf(role, 'reports')
  return {
    see: scope === 'full' || scope === 'view' || (scope === 'team' && team.includes(ADMIN[u.companyId as Co])),
    exportOk: scope === 'full',
    analytics: can(role, 'marketing', 'view') && (reports === 'full' || reports === 'marketing'),
    assign: can(role, 'sales', 'edit') && ['full', 'team'].includes(scopeOf(role, 'sales')),
  }
}

type Dir = { people: { registrations: { event_id: string }[] }[]; events: { id: string }[] }
type Booth = { rows: { id: string; event_id: string; can_open_lead: boolean; lead_status: string | null }[] }

async function visibleEventIds(u: User): Promise<Set<string>> {
  const list = await call(u, 'GET', '/events')
  return new Set((list.body as { id: string }[]).map((e) => e.id))
}

describe('cross-event sections follow the marketing column + team membership (table-driven)', () => {
  it('guard: every marketing scope value in the matrix is handled', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED).toContain(scopeOf(role, 'marketing'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: rows only from visible events; export / analytics / assign from the matrix`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        const x = expected(u)
        const visible = await visibleEventIds(u)
        expect(visible.has(id)).toBe(x.see)

        const dir = await call(u, 'GET', '/events/attendees')
        expect(dir.status).toBe(200)
        const d = dir.body as Dir
        expect(d.events.map((e) => e.id).sort()).toEqual([...visible].sort())
        for (const p of d.people) for (const r of p.registrations) expect(visible.has(r.event_id)).toBe(true)
        expect(d.people.some((p) => p.registrations.some((r) => r.event_id === id))).toBe(x.see)

        const booth = await call(u, 'GET', '/events/booth-leads')
        expect(booth.status).toBe(200)
        const b = booth.body as Booth
        for (const r of b.rows) expect(visible.has(r.event_id)).toBe(true)
        expect(b.rows.some((r) => r.event_id === id)).toBe(x.see)
        // Lead details only when the Sales scope reaches the lead.
        for (const r of b.rows) if (!r.can_open_lead) expect(r.lead_status).toBeNull()
        if (scopeOf(roleOf(u), 'sales') === 'hidden') expect(b.rows.every((r) => !r.can_open_lead)).toBe(true)

        expect((await call(u, 'GET', '/events/attendees/export')).status).toBe(x.exportOk ? 200 : 403)
        expect((await call(u, 'GET', '/events/analytics?preset=ytd')).status).toBe(x.analytics ? 200 : 403)
        const capture = b.rows.find((r) => r.event_id === id)?.id ?? 'ECP-none'
        const assign = await call(u, 'POST', '/events/booth-leads/assign', { capture_ids: [capture], owner_id: u.id })
        expect(assign.status).toBe(x.assign ? 200 : 403)
      })

      it(`${co} · ${role}: on the event's team → its attendees and booth leads appear`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        if (u.id !== ADMIN[co]) expect((await call(admin(co), 'POST', `/events/${id}/team`, { user_id: u.id })).status).toBe(200)
        const visible = await visibleEventIds(u)
        expect(visible.has(id)).toBe(true)
        const d = (await call(u, 'GET', '/events/attendees')).body as Dir
        expect(d.people.some((p) => p.registrations.some((r) => r.event_id === id))).toBe(true)
        for (const p of d.people) for (const r of p.registrations) expect(visible.has(r.event_id)).toBe(true)
        const b = (await call(u, 'GET', '/events/booth-leads')).body as Booth
        expect(b.rows.some((r) => r.event_id === id)).toBe(true)
        for (const r of b.rows) expect(visible.has(r.event_id)).toBe(true)
      })
    }
  }

  it('another company’s captures can’t be assigned (skipped like unknown ones)', async () => {
    const foreign = await fixture('co_crest')
    const crestBooth = (await call(admin('co_crest'), 'GET', '/events/booth-leads')).body as Booth
    const capture = crestBooth.rows.find((r) => r.event_id === foreign)!.id
    const r = await call(admin('co_apex'), 'POST', '/events/booth-leads/assign', { capture_ids: [capture], owner_id: 'u4' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ updated: 0, skipped: [{ capture_id: capture, reason: 'not_found' }] })
  })
})
