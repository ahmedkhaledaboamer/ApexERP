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
 * Events permissions, TABLE-DRIVEN FROM PERMISSION_MATRIX. There is no Events column: events follow
 * the MARKETING column, plus membership of the event's team (docs/API.md › Events › Permissions):
 *   full  → every event; create, edit, cancel, manage the team
 *   view  → every event, read-only
 *   team  → events they're on + events owned by their team (edit); may create
 *   own   → events they're on (edit); may create
 *   hidden → events they're on only
 * and, for EVERY role, being on an event's team gives view + edit (attendees, check-in) of that event,
 * but not cancel / team changes (owner or marketing full only).
 * Every role × both companies; expectations come from the matrix at run time. The guard fails when the
 * marketing column uses a scope value this table can't check.
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

/** An active user per role in each company (added when the seed has none). */
function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-ev-${co}-${slug}`,
        companyId: co,
        name: `Events ${role} ${co}`,
        email: `ev-${slug}@${co}.test`,
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

/** A fresh event owned by the admin, with nobody else on its team. */
async function fixture(co: Co): Promise<string> {
  const r = await call(admin(co), 'POST', '/events', { name: `Matrix event ${co}`, type: 'meeting', start_date: '2027-03-01' })
  expect(r.status).toBe(200)
  return r.body.id as string
}

function expected(u: User) {
  const scope = scopeOf(roleOf(u), 'marketing')
  if (!HANDLED.includes(scope)) throw new Error(`PERMISSION_MATRIX uses marketing scope "${scope}"; the events table has no expectation for it`)
  const team = teamIdsFor(u, users.filter((x) => x.companyId === u.companyId), departments.filter((d) => d.companyId === u.companyId))
  const ownerInTeam = scope === 'team' && team.includes(ADMIN[u.companyId as Co])
  return {
    scope,
    see: scope === 'full' || scope === 'view' || ownerInTeam,
    edit: scope === 'full' || ownerInTeam,
    manage: scope === 'full',
    create: can(roleOf(u), 'marketing', 'create'),
  }
}

describe('events permissions follow the marketing column + team membership (table-driven)', () => {
  it('guard: every marketing scope value in the matrix is handled', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED).toContain(scopeOf(role, 'marketing'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: marketing ${PERMISSION_MATRIX[role].marketing} → list / view / edit / create / manage`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        const x = expected(u)
        const list = await call(u, 'GET', '/events')
        expect(list.status).toBe(200)
        const ids = (list.body as { id: string }[]).map((e) => e.id)
        expect(ids.includes(id)).toBe(x.see)
        expect((await call(u, 'GET', `/events/${id}`)).status).toBe(x.see ? 200 : 403)
        expect((await call(u, 'GET', `/events/${id}/attendees`)).status).toBe(x.see ? 200 : 403)
        expect((await call(u, 'PATCH', `/events/${id}`, { location: `Room ${role}` })).status).toBe(x.edit ? 200 : 403)
        expect((await call(u, 'POST', `/events/${id}/attendees`, { name: 'Matrix Person', email: `m-${role.length}-${co}@visitor.test` })).status).toBe(x.edit ? 200 : 403)
        const created = await call(u, 'POST', '/events', { name: `By ${role}`, type: 'webinar', start_date: '2027-03-02' })
        expect(created.status).toBe(x.create ? 200 : 403)
        expect((await call(u, 'POST', `/events/${id}/team`, { user_id: ADMIN[co] })).status).toBe(x.manage ? 409 : 403)
        // Without view rights the registration token is never served.
        if (x.see && !x.edit) expect((await call(u, 'GET', `/events/${id}`)).body.registration_token).toBeNull()
      })

      it(`${co} · ${role}: on the event's team → view + edit (attendees, check-in), not cancel / team changes`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        const x = expected(u)
        if (u.id !== ADMIN[co]) expect((await call(admin(co), 'POST', `/events/${id}/team`, { user_id: u.id })).status).toBe(200)
        const list = await call(u, 'GET', '/events')
        expect((list.body as { id: string }[]).some((e) => e.id === id)).toBe(true)
        const detail = await call(u, 'GET', `/events/${id}`)
        expect(detail.status).toBe(200)
        expect(detail.body.can_edit).toBe(true)
        expect(detail.body.registration_token).toMatch(/^[a-z]{20}$/)
        expect((await call(u, 'PATCH', `/events/${id}`, { budget: 1234 })).status).toBe(200)
        const att = await call(u, 'POST', `/events/${id}/attendees`, { name: 'Team Person', email: `t-${role.length}-${co}@visitor.test` })
        expect(att.status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/attendees/${att.body.attendee.id}/check-in`, {})).status).toBe(200)
        // "Open lead" only for people whose Sales scope reaches the lead.
        expect(typeof att.body.attendee.can_open_lead).toBe('boolean')
        expect((await call(u, 'DELETE', `/events/${id}`)).status).toBe(x.manage ? 200 : 403)
      })
    }
  }

  /*
   * Advanced features (docs/API.md › Events): reading follows "sees"; agenda, tickets, check-in and booth
   * capture follow "edits" (team members + marketing full); templates (company settings) need marketing
   * full; applying a template and budget lines need "manages" (owner or marketing full); invitations need
   * "sees" + the Marketing edit right (bulk emails are Marketing's).
   */
  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}: advanced event endpoints follow see / edit / manage / marketing rights`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        const x = expected(u)
        const att = await call(admin(co), 'POST', `/events/${id}/attendees`, { name: 'Code Holder', email: `code-${role.length}-${co}@visitor.test` })
        const code = att.body.attendee.ticket_code as string
        const see = x.see ? 200 : 403
        const edit = x.edit ? 200 : 403
        const manage = x.manage ? 200 : 403
        expect((await call(u, 'GET', `/events/${id}/agenda`)).status).toBe(see)
        expect((await call(u, 'GET', `/events/${id}/checklist`)).status).toBe(see)
        expect((await call(u, 'GET', `/events/${id}/budget`)).status).toBe(see)
        expect((await call(u, 'GET', `/events/${id}/survey`)).status).toBe(see)
        expect((await call(u, 'GET', `/events/${id}/leaderboard`)).status).toBe(see)
        expect((await call(u, 'POST', `/events/${id}/sessions`, { title: `Talk ${role}`, date: '2027-03-01', start_time: '10:00', end_time: '10:30' })).status).toBe(edit)
        expect((await call(u, 'POST', `/events/${id}/ticket-types`, { name: `Ticket ${role}` })).status).toBe(edit)
        expect((await call(u, 'POST', `/events/${id}/check-in`, { code })).status).toBe(edit)
        expect((await call(u, 'GET', `/events/${id}/check-in`)).status).toBe(edit)
        expect((await call(u, 'POST', `/events/${id}/captures`, { name: 'Booth Person', email: `booth-${role.length}-${co}@visitor.test`, rating: 'warm' })).status).toBe(edit)
        expect((await call(u, 'POST', `/events/${id}/budget-lines`, { category: 'travel', planned: 100 })).status).toBe(manage)
        const template = (await call(admin(co), 'GET', '/event-templates')).body[0].id as string
        expect((await call(u, 'POST', `/events/${id}/apply-template`, { template_id: template })).status).toBe(manage)
        expect((await call(u, 'GET', '/event-templates')).status).toBe(200)
        expect((await call(u, 'POST', '/event-templates', { name: `Tpl ${role} ${co}`, event_type: 'meeting', tasks: [] })).status).toBe(x.scope === 'full' ? 200 : 403)
        expect((await call(u, 'POST', `/events/${id}/invite`, {})).status).toBe(x.see && can(roleOf(u), 'marketing', 'edit') ? 200 : 403)
      })

      it(`${co} · ${role}: on the event's team → check-in and booth capture, not budget / templates`, async () => {
        const id = await fixture(co)
        const u = userFor(co, role)
        const x = expected(u)
        if (u.id !== ADMIN[co]) await call(admin(co), 'POST', `/events/${id}/team`, { user_id: u.id })
        const att = await call(admin(co), 'POST', `/events/${id}/attendees`, { name: 'Door Person', email: `door-${role.length}-${co}@visitor.test` })
        expect((await call(u, 'POST', `/events/${id}/check-in`, { code: att.body.attendee.ticket_code })).status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/captures`, { name: 'Stand Person', email: `stand-${role.length}-${co}@visitor.test`, rating: 'hot' })).status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/sessions`, { title: 'Team talk', date: '2027-03-01', start_time: '11:00', end_time: '11:30' })).status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/budget-lines`, { category: 'other', planned: 1 })).status).toBe(x.manage ? 200 : 403)
      })
    }
  }

  it('another company’s event answers 404 for every role, like a missing one', async () => {
    const foreign = await fixture('co_crest')
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      const u = userFor('co_apex', role)
      const r = await call(u, 'GET', `/events/${foreign}`)
      const missing = await call(u, 'GET', '/events/EV-NOPE')
      expect(r.status).toBe(404)
      expect(r.body).toEqual(missing.body)
    }
  })
})
