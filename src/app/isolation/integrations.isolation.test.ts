import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { leads, users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { calendarConnections, integrationSecrets, secretKey } from '@/shared/mocks/data/integrations'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * Insights & admin › Integrations — TABLE-DRIVEN FROM PERMISSION_MATRIX (`settings`):
 *   full    (Company Admin) configures every connector, creates keys / webhooks, sees the full webhook URL
 *   view    (Management) reads status, masked settings, logs; writes 403
 *   hidden  everything company-level → 403
 * Exceptions by design: every role connects ITS OWN calendar (Tasks › Calendar); WhatsApp template sends follow
 * `sales` edit. Every role × both companies; the plan gate (integrations off → 403 module_not_in_plan, public → 404).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = { id: `u-int-${co}-${slug}`, companyId: co, name: `Integrations ${role} ${co}`, email: `int-${slug}@${co === 'co_apex' ? 'apexaora.ae' : 'crestlogistics.sa'}`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}
beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})
const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!
const call = (u: User | null, method: string, path: string, body?: unknown) => callApi(u ? tokenFor(u) : null, method, path, body)
const token = (co: Co) => {
  const k = secretKey(co, 'website', 'token')
  return integrationSecrets.get(k)!
}

describe('the settings column only uses handled scopes', () => {
  it('every role’s settings scope is one this suite understands', () => {
    for (const role of ROLES) expect(HANDLED, role).toContain(PERMISSION_MATRIX[role].settings)
  })
})

describe('company integrations: scopes per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (${PERMISSION_MATRIX[role].settings})`, async () => {
        const u = userFor(co, role)
        const scope = scopeOf(roleOf(u), 'settings')
        const reads = ['/integrations', '/integrations/email', '/integrations/email/log', '/integrations/website', '/integrations/whatsapp', '/integrations/payments', '/integrations/api-keys', '/integrations/webhooks', '/integrations/calendar/connections', '/integrations/sync-log']
        for (const p of reads) {
          const r = await call(u, 'GET', p)
          expect(r.status, `${role} GET ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'hidden' ? 403 : 200)
        }
        const writes: [string, string, unknown][] = [
          ['POST', '/integrations/email/verify-domain', {}],
          ['POST', '/integrations/api-keys', { name: `Role ${role}`, scopes: { leads: 'read' } }],
          ['PUT', '/integrations/payments/stripe', { merchant_id: 'acct_role', secret_key: 'sk_test_role_1234567890', mode: 'test', currency: 'USD' }],
          ['POST', '/integrations/website/webhook/rotate', {}],
          ['POST', '/integrations/oauth/start', { purpose: 'email', provider: 'google' }],
          ['PATCH', '/integrations/state/website', { paused: false }],
        ]
        for (const [m, p, b] of writes) {
          const r = await call(u, m, p, b)
          expect(r.status, `${role} ${m} ${p}: ${JSON.stringify(r.body).slice(0, 160)}`).toBe(scope === 'full' ? 200 : 403)
        }
        // The full webhook token is for Company Admins only.
        if (scope !== 'hidden') {
          const site = await call(u, 'GET', '/integrations/website')
          expect(JSON.stringify(site.body).includes(token(co)), role).toBe(scope === 'full')
        }
        // WhatsApp sends follow the sales column.
        const opts = await call(u, 'GET', '/integrations/whatsapp/send-options')
        expect(opts.status, `${role} send-options`).toBe(can(roleOf(u), 'sales', 'edit') ? 200 : 403)
      })
    }
  }
})

describe('per-user calendar: every role connects its own calendar (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const others = calendarConnections.filter((c) => c.userId !== u.id).map((c) => JSON.stringify(c))
        const start = await call(u, 'POST', '/integrations/oauth/start', { purpose: 'calendar', provider: 'google' })
        expect(start.status, JSON.stringify(start.body)).toBe(200)
        expect(start.body.account).toBe(u.email.toLowerCase())
        const done = await call(u, 'POST', '/integrations/calendar/me/connect', { state: start.body.state, approve: true })
        expect(done.status, JSON.stringify(done.body)).toBe(200)
        expect(done.body).toMatchObject({ status: 'connected', provider: 'google', connected_as: u.email.toLowerCase() })
        expect(JSON.stringify(done.body)).not.toMatch(/ya29\./)
        expect((await call(u, 'PATCH', '/integrations/calendar/me', { push_meetings: false })).body.settings.push_meetings).toBe(false)
        expect((await call(u, 'POST', '/integrations/calendar/me/sync')).status).toBe(200)
        // Nobody else's connection moved; the admin sees the row (no token).
        expect(calendarConnections.filter((c) => c.userId !== u.id).map((c) => JSON.stringify(c))).toEqual(others)
        const list = await call(admin(co), 'GET', '/integrations/calendar/connections')
        expect((list.body as { user_id: string }[]).some((r) => r.user_id === u.id)).toBe(true)
        expect(JSON.stringify(list.body)).not.toMatch(/token|ya29/)
        expect((await call(u, 'DELETE', '/integrations/calendar/me')).body.status).toBe('not_connected')
      })
    }
  }

  it('a consent state of one user (or company) can’t be redeemed by another', async () => {
    const a = userFor('co_apex', 'Sales Agent')
    const c = userFor('co_crest', 'Sales Agent')
    const start = await call(a, 'POST', '/integrations/oauth/start', { purpose: 'calendar', provider: 'outlook' })
    const stolen = await call(c, 'POST', '/integrations/calendar/me/connect', { state: start.body.state, approve: true })
    expect(stolen.status).toBe(422)
    expect(stolen.body.code).toBe('oauth_state_invalid')
    expect((await call(a, 'POST', '/integrations/calendar/me/connect', { state: start.body.state, approve: true })).status).toBe(200)
  })
})

describe('public website webhook: a token only ever creates leads in its own company', () => {
  for (const co of COMPANIES) {
    it(`${co}`, async () => {
      const other: Co = co === 'co_apex' ? 'co_crest' : 'co_apex'
      const mine = leads.filter((l) => l.companyId === co).length
      const theirs = leads.filter((l) => l.companyId === other).length
      const r = await call(null, 'POST', `/public/integrations/forms/${token(co)}`, { name: 'Public Person', email: `public-${co}@example.org`, company: `Public ${co}` })
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      expect(r.body).toEqual({ ok: true })
      expect(leads.filter((l) => l.companyId === co).length).toBe(mine + 1)
      expect(leads.filter((l) => l.companyId === other).length).toBe(theirs)
      // A session token in the request changes nothing: the URL token decides.
      const spoof = await callApi(tokenFor(admin(other)), 'POST', `/public/integrations/forms/${token(co)}`, { name: 'Spoof', email: `spoof-${co}@example.org`, company: 'Spoof', company_id: other })
      expect(spoof.status).toBe(200)
      expect(leads.filter((l) => l.companyId === other).length).toBe(theirs)
      expect((await call(null, 'POST', '/public/integrations/forms/whk_unknownunknownunknown000', { name: 'x', email: 'x@example.org' })).status).toBe(404)
    })
  }
})

describe('plan gate', () => {
  it('without the integrations module every /integrations path answers 403 module_not_in_plan (calendar too) and the public endpoints 404 / 401', async () => {
    const crestToken = token('co_crest')
    const created = await call(admin('co_crest'), 'POST', '/integrations/api-keys', { name: 'Gate', scopes: { leads: 'read' } })
    moduleOverrides.push({ companyId: 'co_crest', module: 'integrations', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const rep = userFor('co_crest', 'Sales Agent')
    for (const [u, p] of [[admin('co_crest'), '/integrations'], [admin('co_crest'), '/integrations/sync-log'], [rep, '/integrations/calendar/me'], [rep, '/integrations/whatsapp/send-options']] as const) {
      const r = await call(u, 'GET', p)
      expect(r.status, p).toBe(403)
      expect(r.body.code, p).toBe('module_not_in_plan')
    }
    expect((await call(null, 'POST', `/public/integrations/forms/${crestToken}`, { name: 'x', email: 'x@example.org' })).status).toBe(404)
    const pub = await callApi(null, 'GET', '/public/v1/leads')
    expect(pub.status).toBe(401)
    const { getResponse } = await import('msw')
    const { handlers } = await import('@/shared/mocks/handlers')
    const res = await getResponse(handlers, new Request('http://localhost/api/public/v1/leads', { headers: { 'X-Api-Key': created.body.secret } }))
    expect(res!.status).toBe(401)
    expect((await call(admin('co_apex'), 'GET', '/integrations')).status).toBe(200)
  })
})
