import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { libraryAccess } from '@/modules/events/lib/library'
import { navItemAccess } from '@/modules/billing/gating'
import { ALL_NAV_ITEMS } from '@/shared/components/layout/navigation'
import { PATHS } from '@/app/paths'
import { users } from '@/shared/mocks/db'
import { addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * Event libraries (speakers directory, venues, vendors) permissions, TABLE-DRIVEN FROM PERMISSION_MATRIX
 * (docs/API.md › Events › Speakers, venues & vendors). No own column: the MARKETING column decides
 *   full → manage · view → read · anything else → no access
 * and being on ANY event's team (owner or member, any role) gives read access and the right to pick from the
 * libraries in their own event (agenda speakers, the event's venue, budget-line vendors when they manage it).
 * The sidebar hides the three sections for roles without marketing view. Every role × both companies, with a
 * fresh user per role (not on any seeded event team).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'team', 'own', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]
const LIBS = ['/event-speakers', '/event-venues', '/event-vendors'] as const

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
beforeEach(() => {
  restoreSnapshot(seed)
})

/** A fresh active user of `role` in `co`, on no event team. */
function freshUser(co: Co, role: Role): User {
  const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
  const user: User = {
    id: `u-lib-${co}-${slug}`,
    companyId: co,
    name: `Library ${role} ${co}`,
    email: `lib-${slug}@${co}.test`,
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
  return user
}

const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

function expected(role: Role, onTeam: boolean) {
  const scope = scopeOf(role, 'marketing')
  if (!HANDLED.includes(scope)) throw new Error(`PERMISSION_MATRIX uses marketing scope "${scope}"; the library table has no expectation for it`)
  return libraryAccess(scope, onTeam)
}

describe('event libraries follow the marketing column + event-team membership (table-driven)', () => {
  it('guard: every marketing scope value in the matrix is handled', () => {
    for (const role of ROLES) expect(HANDLED).toContain(scopeOf(role, 'marketing'))
  })

  it('sidebar: Speakers, Venues and Vendors show for roles with marketing view, hidden for the rest', () => {
    const items = ALL_NAV_ITEMS.filter((i) => [PATHS.eventSpeakers, PATHS.eventVenues, PATHS.eventVendors].includes(i.to as never))
    expect(items.map((i) => i.label)).toEqual(['Speakers', 'Venues', 'Vendors'])
    for (const role of ROLES) {
      for (const item of items) {
        expect(navItemAccess(item, { role, entitlements: { modules: ['events', 'marketing'] } }), `${role} ${item.label}`).toBe(can(role, 'marketing', 'view') ? 'visible' : 'hidden')
        expect(navItemAccess(item, { role, entitlements: { modules: ['marketing'] } })).toBe(can(role, 'marketing', 'view') ? 'locked' : 'hidden')
      }
    }
  })

  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role}: marketing ${PERMISSION_MATRIX[role].marketing} → read / manage without a team`, async () => {
        const u = freshUser(co, role)
        const access = expected(role, false)
        for (const path of LIBS) expect((await call(u, 'GET', path)).status, path).toBe(access === 'none' ? 403 : 200)
        const venue = (await call(admin(co), 'GET', '/event-venues')).body[0].id as string
        expect((await call(u, 'GET', `/event-venues/${venue}`)).status).toBe(access === 'none' ? 403 : 200)
        expect((await call(u, 'POST', '/event-speakers', { name: `Matrix ${role}`, company: co })).status).toBe(access === 'manage' ? 200 : 403)
        expect((await call(u, 'POST', '/event-venues', { name: `Matrix venue ${role}` })).status).toBe(access === 'manage' ? 200 : 403)
        expect((await call(u, 'PATCH', `/event-venues/${venue}`, { notes: 'x' })).status).toBe(access === 'manage' ? 200 : 403)
        expect((await call(u, 'POST', '/event-vendors', { category: 'other', name: `Matrix vendor ${role}` })).status).toBe(access === 'manage' ? 200 : 403)
      })

      it(`${co} · ${role}: on an event's team (owner) → read the libraries and pick from them in that event`, async () => {
        const u = freshUser(co, role)
        const ev = await call(admin(co), 'POST', '/events', { name: `Library matrix ${role}`, type: 'conference', start_date: '2027-03-01', owner_id: u.id })
        expect(ev.status).toBe(200)
        const id = ev.body.id as string
        const access = expected(role, true)
        expect(access).not.toBe('none')
        for (const path of LIBS) expect((await call(u, 'GET', path)).status, path).toBe(200)
        const speakers = (await call(u, 'GET', '/event-speakers')).body as { id: string }[]
        const venues = (await call(u, 'GET', '/event-venues')).body as { id: string; status: string }[]
        const vendors = (await call(u, 'GET', '/event-vendors')).body as { id: string; status: string }[]
        // Pick a directory speaker; add a new one (creates the directory entry) — editing their own event.
        expect((await call(u, 'POST', `/events/${id}/speakers`, { speaker_id: speakers[0].id })).status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/speakers`, { name: `New via agenda ${role}`, company: 'Matrix Co' })).status).toBe(200)
        // Pick the venue and a vendor for a budget line (they own the event).
        expect((await call(u, 'PATCH', `/events/${id}`, { venue_id: venues.find((v) => v.status === 'active')!.id })).status).toBe(200)
        expect((await call(u, 'POST', `/events/${id}/budget-lines`, { category: 'printing', planned: 10, vendor_id: vendors.find((v) => v.status !== 'blacklisted')!.id })).status).toBe(200)
        // Managing the libraries themselves still needs marketing full.
        expect((await call(u, 'POST', '/event-speakers', { name: `Direct ${role}`, company: co })).status).toBe(access === 'manage' ? 200 : 403)
        expect((await call(u, 'PATCH', `/event-vendors/${vendors[0].id}`, { status: 'preferred' })).status).toBe(access === 'manage' ? 200 : 403)
      })
    }
  }
})
