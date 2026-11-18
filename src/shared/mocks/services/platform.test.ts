import { afterEach, describe, expect, it } from 'vitest'
import { getResponse } from 'msw'
import type { Session, User } from '@/shared/types'
import type { PlatformPermissionV2 } from '@/modules/platform/types'
import { canPlatform, type PlatformRole } from '@/modules/tenancy/types'
import { DEMO_PASSWORD } from '@/shared/lib/constants'
import { handlers } from '@/shared/mocks/handlers'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById, platformUsers } from '@/shared/mocks/data/tenancy'
import { auditLog } from '@/shared/mocks/data/audit'
import { notifications } from '@/shared/mocks/data/tasks'
import { billingInvoices, subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { billingSettings, planById } from '@/shared/mocks/data/plans'
import { consoleSettings, impersonationSessions, platformAudit } from '@/shared/mocks/data/platform'
import { advanceClock, nowMs } from '@/shared/mocks/clock'
import { platformTokenFor, tokenFor } from '@/shared/mocks/server'
import { devSetStatus, getEntitlements, runLifecycleForAll, setPaymentMethod, setTrialPlan, usedOf } from '@/shared/mocks/services/billing'
import { checkSubdomain as signupCheckSubdomain, completeSignup, listPlans, startSignup, verifySignup } from '@/shared/mocks/services/signup'
import { ApiError } from '@/shared/lib/apiError'
import { userFrom } from '@/shared/mocks/handlers/utils'

// MSW resolves the handlers' relative paths (`/api/...`) against document.baseURI; give node one.
;(globalThis as { document?: unknown }).document ??= { baseURI: 'http://localhost/' }

/* Every test starts from the seed (all mock stores, the clock and the platform stores are registered). */
const seed = takeSnapshot(true)
afterEach(() => {
  restoreSnapshot(seed)
})

const DAY = 86_400_000
const MINUTE = 60_000
const u = (id: string) => users.find((x) => x.id === id)!
const apexAdmin = () => u('u1')
const crestAdmin = () => u('u101')
const crestAgent = () => u('u104')

const pu = (role: PlatformRole) => platformUsers.find((p) => p.platformRole === role)!
const OWNER = () => pu('Platform Owner')
const SUPPORT = () => pu('Platform Support')
const ptoken = (role: PlatformRole) => platformTokenFor(pu(role).id)
const ROLES: PlatformRole[] = ['Platform Owner', 'Platform Support', 'Platform Billing']

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Sends a request through the real MSW handlers (the same code the browser worker runs). */
async function api(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const req = new Request(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  })
  const res = await getResponse(handlers, req)
  if (!res) throw new Error(`No handler for ${method} ${path}`)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const owner = (method: string, path: string, body?: unknown) => api(ptoken('Platform Owner'), method, path, body)
const REASON = 'Customer asked for help'

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

let n = 0
/** A new company on the trial (sign-up flow), returning its Company Admin. */
async function trialCompany(continuePlanId?: string): Promise<User> {
  n++
  const s = await startSignup(
    {
      companyName: `Platform Co ${n}`,
      subdomain: `platform-co-${n}`,
      country: 'AE',
      language: 'en',
      adminName: 'Trial Admin',
      adminEmail: `admin${n}@platform-co.example`,
      mobile: '0501234567',
      password: 'Sunny-Harbor-42',
      acceptTerms: true,
    },
    `platform-test-${n}`,
  )
  await verifySignup(s.signupId, { code: s.devCode })
  const session = await completeSignup(s.signupId, { plan: 'trial', ...(continuePlanId ? { continuePlanId } : {}) })
  return u(session.user.id)
}

const card = { holder: 'Test Admin', cardNumber: '4242 4242 4242 4242', expiry: '12/39', cvc: '123' }

async function impersonate(role: PlatformRole = 'Platform Support', userId = 'u104', reason = 'Customer reported a lead import problem'): Promise<Session> {
  const res = await api(ptoken(role), 'POST', '/platform/impersonations', { userId, reason })
  expect(res.status).toBe(200)
  return res.body as Session
}

/* ---------------- Access control ---------------- */

interface Endpoint {
  method: string
  path: string
  body?: unknown
  /** Any of these; null = any platform user. */
  perm: PlatformPermissionV2[] | null
}

const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/platform/me', perm: null },
  { method: 'GET', path: '/platform/companies', perm: ['tenants:view'] },
  { method: 'GET', path: `/platform/companies/${CREST_ID}`, perm: ['tenants:view'] },
  { method: 'GET', path: `/platform/companies/${CREST_ID}/users`, perm: ['tenants:view'] },
  { method: 'GET', path: `/platform/companies/${CREST_ID}/timeline`, perm: ['tenants:view'] },
  { method: 'GET', path: `/platform/companies/${CREST_ID}/notes`, perm: ['tenants:view'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/notes`, body: { body: 'Called the admin.' }, perm: ['support:notes'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/actions`, body: { action: 'change_plan', planId: 'enterprise', reason: REASON }, perm: ['billing:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/actions`, body: { action: 'extend_trial', days: 5, reason: REASON }, perm: ['billing:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/actions`, body: { action: 'suspend', reason: REASON }, perm: ['tenants:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/actions`, body: { action: 'reactivate', reason: REASON }, perm: ['tenants:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/actions`, body: { action: 'cancel', reason: REASON }, perm: ['tenants:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/modules`, body: { module: 'hr', enabled: true, reason: REASON }, perm: ['tenants:manage'] },
  { method: 'POST', path: `/platform/companies/${CREST_ID}/subdomain`, body: { subdomain: 'crest-new', reason: REASON }, perm: ['tenants:subdomain'] },
  { method: 'GET', path: '/platform/subdomains/check?subdomain=free-name', perm: ['tenants:subdomain'] },
  { method: 'GET', path: '/platform/overview', perm: ['tenants:view'] },
  { method: 'GET', path: '/platform/plans', perm: ['billing:view', 'plans:manage'] },
  { method: 'POST', path: '/platform/plans', body: { id: 'growth', name: 'Growth', price: 49, currency: 'USD', billingPeriod: 'month', limits: {}, modules: ['sales'], highlights: [], checkout: 'payment', active: true, reason: REASON }, perm: ['plans:manage'] },
  { method: 'PATCH', path: '/platform/plans/starter', body: { name: 'Starter+', migration: 'keep', reason: REASON }, perm: ['plans:manage'] },
  { method: 'DELETE', path: '/platform/plans/starter', perm: ['plans:manage'] },
  { method: 'GET', path: '/platform/settings', perm: ['tenants:view'] },
  { method: 'PATCH', path: '/platform/settings', body: { graceDays: 10, reason: REASON }, perm: ['plans:manage'] },
  { method: 'GET', path: '/platform/announcements', perm: ['tenants:view'] },
  { method: 'POST', path: '/platform/announcements', body: { title: 'Maintenance', body: 'Tonight', tone: 'info', audience: { plans: [], countries: [] }, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() }, perm: ['announcements:manage'] },
  { method: 'PATCH', path: '/platform/announcements/ANN-x', body: { title: 'Edited' }, perm: ['announcements:manage'] },
  { method: 'DELETE', path: '/platform/announcements/ANN-x', perm: ['announcements:manage'] },
  { method: 'GET', path: '/platform/audit', perm: ['audit:view'] },
  { method: 'POST', path: '/platform/impersonations', body: { userId: 'u104', reason: 'Customer reported a problem' }, perm: ['support:impersonate'] },
]

describe('platform access control', () => {
  it('the permission matrix', () => {
    const all: PlatformPermissionV2[] = ['tenants:view', 'tenants:manage', 'tenants:subdomain', 'billing:view', 'billing:manage', 'plans:manage', 'support:impersonate', 'support:notes', 'announcements:manage', 'audit:view']
    expect(all.every((p) => canPlatform('Platform Owner', p))).toBe(true)
    expect(all.filter((p) => canPlatform('Platform Support', p))).toEqual(['tenants:view', 'support:impersonate', 'support:notes', 'audit:view'])
    expect(all.filter((p) => canPlatform('Platform Billing', p))).toEqual(['tenants:view', 'billing:view', 'billing:manage', 'plans:manage'])
  })

  it('a company user token gets 401 on every /platform API', async () => {
    for (const e of ENDPOINTS) {
      const res = await api(tokenFor(apexAdmin()), e.method, e.path, e.body)
      expect(res.status, `${e.method} ${e.path}`).toBe(401)
    }
    // No token at all, too.
    expect((await api(null, 'GET', '/platform/companies')).status).toBe(401)
  })

  it('an impersonation token (a company session) gets 401 on every /platform API', async () => {
    const session = await impersonate('Platform Owner')
    for (const e of ENDPOINTS) {
      const res = await api(session.token, e.method, e.path, e.body)
      expect(res.status, `${e.method} ${e.path}`).toBe(401)
    }
  })

  it('each platform role gets 403 outside its permissions and passes the gate inside them', async () => {
    for (const role of ROLES) {
      for (const e of ENDPOINTS) {
        restoreSnapshot(seed)
        const res = await api(ptoken(role), e.method, e.path, e.body)
        const allowed = e.perm === null || e.perm.some((p) => canPlatform(role, p))
        if (allowed) {
          expect([401, 403].includes(res.status) && ['platform_forbidden', 'platform_auth_required'].includes(res.body?.code), `${role} ${e.method} ${e.path}`).toBe(false)
        } else {
          expect(res.status, `${role} ${e.method} ${e.path}`).toBe(403)
          expect(res.body.code).toBe('platform_forbidden')
        }
      }
    }
  })

  it('a platform token gets 401 on company APIs', async () => {
    for (const [method, path] of [
      ['GET', '/leads'],
      ['GET', '/tenant'],
      ['GET', '/auth/me'],
      ['GET', '/billing/overview'],
      ['GET', '/announcements'],
      ['POST', '/billing/trial-plan'],
    ]) {
      expect((await api(ptoken('Platform Owner'), method, path, {})).status, `${method} ${path}`).toBe(401)
    }
  })

  it('unknown /platform paths are gated too; plans can’t be deleted', async () => {
    expect((await api(tokenFor(apexAdmin()), 'GET', '/platform/whatever')).status).toBe(401)
    expect((await owner('GET', '/platform/whatever')).status).toBe(404)
    const del = await owner('DELETE', '/platform/plans/starter')
    expect(del.status).toBe(405)
    expect(planById('starter')).toBeDefined()
  })

  it('GET /platform/me lists the role’s permissions', async () => {
    const me = await api(ptoken('Platform Support'), 'GET', '/platform/me')
    expect(me.body.platformUser.id).toBe(SUPPORT().id)
    expect(me.body.permissions).toEqual(['tenants:view', 'support:impersonate', 'support:notes', 'audit:view'])
  })
})

/* ---------------- Secrets ---------------- */

describe('platform responses carry no secrets', () => {
  it('no password, hash or card number in any platform read', async () => {
    const paths = [
      '/platform/me',
      '/platform/companies',
      `/platform/companies/${APEX_ID}`,
      `/platform/companies/${CREST_ID}`,
      `/platform/companies/${CREST_ID}/users`,
      `/platform/companies/${CREST_ID}/timeline`,
      '/platform/overview',
      '/platform/plans',
      '/platform/settings',
      '/platform/audit',
    ]
    for (const path of paths) {
      const res = await owner('GET', path)
      expect(res.status, path).toBe(200)
      const text = JSON.stringify(res.body)
      expect(text, path).not.toContain(DEMO_PASSWORD)
      expect(text.toLowerCase(), path).not.toMatch(/"(password|passwordhash|hash|secret|cardnumber|cvc)"/)
      // The seeded / test card numbers never appear (only brand + last 4 are stored).
      for (const pan of ['4242424242424242', '5555555555554444', '4000000000000002']) expect(text, path).not.toContain(pan)
    }
    const detail = await owner('GET', `/platform/companies/${CREST_ID}`)
    expect(Object.keys(detail.body.subscription.paymentMethod).sort()).toEqual(['brand', 'expMonth', 'expYear', 'holder', 'last4'])
    const usersRes = await owner('GET', `/platform/companies/${CREST_ID}/users`)
    expect(Object.keys(usersRes.body[0]).sort()).toEqual(['active', 'email', 'id', 'lastLoginAt', 'name', 'role'])
  })
})

/* ---------------- Companies, isolation ---------------- */

describe('companies', () => {
  it('list: filters, search, sort; MRR only with billing:view', async () => {
    const all = await owner('GET', '/platform/companies?sort=mrr&dir=desc')
    expect(all.body.map((r: { id: string }) => r.id)).toEqual([APEX_ID, CREST_ID])
    expect(all.body[0].mrr).toBe(499)
    expect(all.body[1].mrr).toBe(79)
    expect((await owner('GET', '/platform/companies?country=SA')).body.map((r: { id: string }) => r.id)).toEqual([CREST_ID])
    expect((await owner('GET', '/platform/companies?plan=enterprise')).body.map((r: { id: string }) => r.id)).toEqual([APEX_ID])
    expect((await owner('GET', '/platform/companies?q=crest')).body).toHaveLength(1)
    expect((await owner('GET', '/platform/companies?status=locked')).body).toHaveLength(0)
    const support = await api(ptoken('Platform Support'), 'GET', '/platform/companies')
    expect(support.body.every((r: { mrr: unknown }) => r.mrr === null)).toBe(true)
  })

  it('the company page returns only that company’s data, is audited, and hides invoices without billing:view', async () => {
    const before = platformAudit.length
    const d = (await owner('GET', `/platform/companies/${CREST_ID}`)).body
    expect(d.company.id).toBe(CREST_ID)
    expect(d.company.currency).toBe('SAR')
    const crestInvoices = new Set(billingInvoices.filter((i) => i.companyId === CREST_ID).map((i) => i.id))
    expect(d.invoices.length).toBe(crestInvoices.size)
    expect(d.invoices.every((i: { id: string }) => crestInvoices.has(i.id))).toBe(true)
    expect(d.usersCount.total).toBe(users.filter((x) => x.companyId === CREST_ID).length)
    expect(platformAudit.length).toBe(before + 1)
    expect(platformAudit[0]).toMatchObject({ action: 'company.viewed', companyId: CREST_ID, actorId: OWNER().id })
    expect(platformAudit[0].ip).toMatch(/^10\.\d+\.\d+\.\d+$/)

    const sd = (await api(ptoken('Platform Support'), 'GET', `/platform/companies/${CREST_ID}`)).body
    expect(sd.invoices).toBeNull()

    const us = (await owner('GET', `/platform/companies/${CREST_ID}/users`)).body as { id: string }[]
    const crestIds = new Set(users.filter((x) => x.companyId === CREST_ID).map((x) => x.id))
    expect(us.every((x) => crestIds.has(x.id))).toBe(true)
    expect(platformAudit[0].action).toBe('company.viewed')

    const tl = (await owner('GET', `/platform/companies/${CREST_ID}/timeline`)).body as { id: string; source: string }[]
    const apexAuditIds = new Set(auditLog.filter((a) => a.companyId === APEX_ID).map((a) => a.id))
    expect(tl.some((e) => apexAuditIds.has(e.id))).toBe(false)

    expect((await owner('GET', '/platform/companies/co_nope')).status).toBe(404)
  })

  it('support notes are per company, written by support:notes with the author from the token', async () => {
    const add = await api(ptoken('Platform Support'), 'POST', `/platform/companies/${CREST_ID}/notes`, { body: 'Admin prefers WhatsApp.' })
    expect(add.status).toBe(200)
    expect(add.body).toMatchObject({ companyId: CREST_ID, authorId: SUPPORT().id, authorName: SUPPORT().name })
    expect((await owner('GET', `/platform/companies/${CREST_ID}/notes`)).body).toHaveLength(1)
    expect((await owner('GET', `/platform/companies/${APEX_ID}/notes`)).body).toHaveLength(0)
    expect((await api(ptoken('Platform Support'), 'POST', `/platform/companies/${CREST_ID}/notes`, { body: '  ' })).body.code).toBe('invalid_note')
    expect((await api(ptoken('Platform Billing'), 'POST', `/platform/companies/${CREST_ID}/notes`, { body: 'x' })).status).toBe(403)
  })
})

/* ---------------- Actions ---------------- */

describe('company actions', () => {
  const act = (body: Record<string, unknown>, role: PlatformRole = 'Platform Owner') => api(ptoken(role), 'POST', `/platform/companies/${CREST_ID}/actions`, body)

  it('need a reason (≥ 5 characters) and a known action', async () => {
    expect((await act({ action: 'suspend' })).body.code).toBe('reason_required')
    expect((await act({ action: 'suspend', reason: 'abc' })).status).toBe(422)
    expect((await act({ action: 'explode', reason: REASON })).body.code).toBe('invalid_action')
  })

  it('change_plan: immediate, no charge, same subscription; audited in both logs and admins notified', async () => {
    const invoices = billingInvoices.length
    const subId = subscriptionOf(CREST_ID)!.id
    const res = await act({ action: 'change_plan', planId: 'enterprise', reason: 'Negotiated upgrade' }, 'Platform Billing')
    expect(res.status).toBe(200)
    expect(res.body.subscription).toMatchObject({ id: subId, planId: 'enterprise', status: 'active' })
    expect(billingInvoices.length).toBe(invoices)
    expect(companyById(CREST_ID)!.enabledModules).toContain('hr')
    expect(platformAudit[0]).toMatchObject({ action: 'company.change_plan', reason: 'Negotiated upgrade', companyId: CREST_ID })
    expect((platformAudit[0].before as { planId: string }).planId).toBe('business')
    expect(auditLog.find((a) => a.companyId === CREST_ID)!.summary).toContain('Negotiated upgrade')
    expect(notifications.some((x) => x.companyId === CREST_ID && x.title === 'Your plan is now Enterprise')).toBe(true)
    expect((await act({ action: 'change_plan', planId: 'enterprise', reason: REASON })).body.code).toBe('same_plan')
    expect((await act({ action: 'change_plan', planId: 'trial', reason: REASON })).body.code).toBe('invalid_plan')
  })

  it('extend_trial: trialing only, 1–90 days; reminders follow the new end', async () => {
    expect((await act({ action: 'extend_trial', days: 5, reason: REASON })).body.code).toBe('invalid_state')
    const admin = await trialCompany()
    const co = admin.companyId
    const end = subscriptionOf(co)!.trialEndsAt!
    const ext = (days: unknown) => owner('POST', `/platform/companies/${co}/actions`, { action: 'extend_trial', days, reason: REASON })
    expect((await ext(0)).body.code).toBe('invalid_days')
    expect((await ext(91)).body.code).toBe('invalid_days')
    const res = await ext(10)
    expect(res.status).toBe(200)
    expect(Date.parse(subscriptionOf(co)!.trialEndsAt!) - Date.parse(end)).toBe(10 * DAY)
    expect(res.body.subscription.status).toBe('trialing')
    // Reminders at 7, 3, 1 days before the NEW end; the trial lasts 10 more days.
    advanceClock(billingSettings.trialDays + 1)
    runLifecycleForAll()
    expect(subscriptionOf(co)!.status).toBe('trialing')
    advanceClock(10)
    runLifecycleForAll()
    expect(subscriptionOf(co)!.status).toBe('suspended')
    const reminders = notifications.filter((x) => x.companyId === co && x.title.startsWith('Your trial ends in'))
    expect(reminders.map((r) => r.title).sort()).toEqual(['Your trial ends in 1 day', 'Your trial ends in 3 days', 'Your trial ends in 7 days'])
  })

  it('suspend locks the workspace fully; reactivate lifts it', async () => {
    expect((await act({ action: 'suspend', reason: 'Abuse report' })).status).toBe(200)
    expect(companyById(CREST_ID)!.status).toBe('suspended')
    expect((await api(tokenFor(crestAdmin()), 'GET', '/leads')).body.code).toBe('workspace_suspended')
    expect((await act({ action: 'suspend', reason: 'Abuse report' })).body.code).toBe('invalid_state')
    expect(auditLog.find((a) => a.companyId === CREST_ID)!.summary).toContain('Abuse report')
    expect((await act({ action: 'reactivate', reason: 'Resolved with the customer' })).status).toBe(200)
    expect(companyById(CREST_ID)!.status).toBe('active')
    expect((await api(tokenFor(crestAdmin()), 'GET', '/leads')).status).toBe(200)
    expect((await act({ action: 'reactivate', reason: REASON })).body.code).toBe('invalid_state')
  })

  it('cancel → cancelled now; reactivate → active with a new period and no charge', async () => {
    const res = await act({ action: 'cancel', reason: 'Customer asked to close' })
    expect(res.body.subscription.status).toBe('cancelled')
    expect(Date.parse(res.body.subscription.deleteAt) - nowMs()).toBeGreaterThan((billingSettings.retentionDays - 1) * DAY)
    expect((await act({ action: 'cancel', reason: REASON })).body.code).toBe('invalid_state')
    const invoices = billingInvoices.filter((i) => i.companyId === CREST_ID && i.status === 'paid').length
    const re = await act({ action: 'reactivate', reason: 'Customer came back' })
    expect(re.body.subscription.status).toBe('active')
    expect(Math.abs(Date.parse(re.body.subscription.currentPeriodStart) - nowMs())).toBeLessThan(5000)
    expect(billingInvoices.filter((i) => i.companyId === CREST_ID && i.status === 'paid').length).toBe(invoices)
  })
})

/* ---------------- Impersonation ---------------- */

describe('impersonation', () => {
  it('start needs a reason of 10+ characters; deactivated users and locked companies are refused', async () => {
    const start = (body: unknown) => api(ptoken('Platform Support'), 'POST', '/platform/impersonations', body)
    expect((await start({ userId: 'u104' })).body.code).toBe('reason_required')
    expect((await start({ userId: 'u104', reason: 'too short' })).body.code).toBe('reason_required')
    u('u104').active = false
    expect((await start({ userId: 'u104', reason: 'Customer reported a problem' })).status).toBe(409)
    u('u104').active = true
    companyById(CREST_ID)!.status = 'suspended'
    expect((await start({ userId: 'u104', reason: 'Customer reported a problem' })).body.code).toBe('company_locked')
  })

  it('read-only by default; write mode after a second confirmation; sensitive actions blocked in both modes', async () => {
    const session = await impersonate()
    const imp = session.impersonation!
    expect(imp).toMatchObject({ platformUserId: SUPPORT().id, mode: 'read', reason: 'Customer reported a lead import problem' })
    expect(Date.parse(imp.expiresAt) - Date.parse(imp.startedAt)).toBe(consoleSettings.impersonationMinutes * MINUTE)

    const as = (method: string, path: string, body?: unknown, token = session.token) => api(token, method, path, body)
    expect((await as('GET', '/leads')).status).toBe(200)
    const write = await as('POST', '/ai/credits/consume', { credits: 1 })
    expect(write.status).toBe(403)
    expect(write.body.code).toBe('impersonation_read_only')

    const sensitive: [string, string, unknown?][] = [
      ['POST', '/account/password', { currentPassword: DEMO_PASSWORD, newPassword: 'Another-Pass-77' }],
      ['POST', '/security/2fa/setup'],
      ['GET', '/billing/export'],
      ['POST', '/billing/cancel'],
      ['POST', '/billing/payment-method', card],
      ['POST', '/auth/switch-role', { role: 'Company Admin' }],
    ]
    for (const [m, p, b] of sensitive) {
      const r = await as(m, p, b)
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(r.body.code, `${m} ${p}`).toBe('impersonation_blocked')
    }
    // Company deletion has no endpoint yet; the rule is enforced centrally by path anyway.
    const del = new Request('http://localhost/api/tenant', { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    expect((await apiError(Promise.resolve().then(() => userFrom(del)))).code).toBe('impersonation_blocked')

    // Write mode needs { confirm: true }; it's read from the server record, so the old token is upgraded too.
    expect((await as('POST', '/auth/impersonation/write-mode', {})).body.code).toBe('confirmation_required')
    const upgraded = await as('POST', '/auth/impersonation/write-mode', { confirm: true })
    expect(upgraded.status).toBe(200)
    expect(upgraded.body.impersonation.mode).toBe('write')
    expect((await as('POST', '/ai/credits/consume', { credits: 1 })).status).toBe(200)
    expect((await as('POST', '/ai/credits/consume', { credits: 1 }, upgraded.body.token)).status).toBe(200)
    for (const [m, p, b] of sensitive) expect((await as(m, p, b)).body.code, `${m} ${p}`).toBe('impersonation_blocked')

    // Both logs record the write-mode switch with the operator, role and reason.
    expect(platformAudit.some((e) => e.action === 'impersonation.write_mode' && e.companyId === CREST_ID)).toBe(true)
    const companyEntry = auditLog.find((a) => a.companyId === CREST_ID && a.summary.includes('write mode'))!
    expect(companyEntry.summary).toContain('Sami Haddad (Platform Support, Apex CRM)')
    expect(companyEntry.summary).toContain('Customer reported a lead import problem')

    // A normal (non-impersonation) token can't call write-mode.
    expect((await api(tokenFor(crestAdmin()), 'POST', '/auth/impersonation/write-mode', { confirm: true })).body.code).toBe('not_impersonating')
  })

  it('writes made in write mode are marked in the company audit log with the operator and reason', async () => {
    const session = await impersonate('Platform Support', 'u101', 'Fix the company website at the customer’s request')
    expect((await api(session.token, 'POST', '/auth/impersonation/write-mode', { confirm: true })).status).toBe(200)
    const res = await api(session.token, 'PATCH', '/settings/company-profile', { website: 'crest-support-fix.example' })
    expect(res.status).toBe(200)
    const entry = auditLog.find((a) => a.companyId === CREST_ID && a.entity === 'company-profile')!
    expect(entry.userId).toBe('u101')
    expect(entry.summary).toContain('during a support session by Sami Haddad, Apex CRM support')
    expect(entry.summary).toContain('Fix the company website')
    // The same user's own (non-impersonated) write afterwards isn't marked.
    expect((await api(tokenFor(crestAdmin()), 'PATCH', '/settings/company-profile', { website: 'crestlogistics.sa' })).status).toBe(200)
    expect(auditLog.find((a) => a.companyId === CREST_ID && a.entity === 'company-profile')!.summary).not.toContain('support session')
  })

  it('start is audited in both logs (the company admin sees who, role and why)', async () => {
    await impersonate()
    expect(platformAudit[0]).toMatchObject({ action: 'impersonation.started', companyId: CREST_ID, actorId: SUPPORT().id, reason: 'Customer reported a lead import problem' })
    const entry = auditLog.find((a) => a.companyId === CREST_ID)!
    expect(entry.userName).toBe('Sami Haddad (Apex CRM support)')
    expect(entry.summary).toContain('Platform Support')
    expect(entry.summary).toContain('Customer reported a lead import problem')
    // Not in the other company's log.
    expect(auditLog.some((a) => a.companyId === APEX_ID && a.summary.includes('support session'))).toBe(false)
  })

  it('expiry by the mock clock → 401 impersonation_expired, ended and audited in both logs', async () => {
    const session = await impersonate()
    advanceClock((consoleSettings.impersonationMinutes + 1) / 1440)
    const res = await api(session.token, 'GET', '/leads')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('impersonation_expired')
    const rec = impersonationSessions.find((s) => s.sessionId === session.impersonation!.sessionId)!
    expect(rec.endReason).toBe('expired')
    expect(rec.endedAt).not.toBeNull()
    expect(platformAudit.filter((e) => e.action === 'impersonation.expired')).toHaveLength(1)
    expect(auditLog.some((a) => a.companyId === CREST_ID && a.summary.includes('expired'))).toBe(true)
    // Still refused afterwards (and audited once only).
    expect((await api(session.token, 'GET', '/leads')).body.code).toBe('impersonation_expired')
    expect(platformAudit.filter((e) => e.action === 'impersonation.expired')).toHaveLength(1)
  })

  it('stop ends the session (audited in both logs); the token stops working', async () => {
    const session = await impersonate('Platform Owner')
    expect((await api(session.token, 'POST', '/auth/impersonation/stop')).status).toBe(200)
    expect(platformAudit[0]).toMatchObject({ action: 'impersonation.ended', companyId: CREST_ID, actorId: OWNER().id })
    expect(auditLog.find((a) => a.companyId === CREST_ID)!.summary).toContain('ended the support session')
    const after = await api(session.token, 'GET', '/leads')
    expect(after.status).toBe(401)
    expect(after.body.code).toBe('impersonation_ended')
  })

  it('impersonation length comes from the platform settings', async () => {
    expect((await owner('PATCH', '/platform/settings', { impersonationMinutes: 15, reason: REASON })).status).toBe(200)
    const s = await impersonate()
    expect(Date.parse(s.impersonation!.expiresAt) - Date.parse(s.impersonation!.startedAt)).toBe(15 * MINUTE)
    expect((await owner('PATCH', '/platform/settings', { impersonationMinutes: 1, reason: REASON })).body).toMatchObject({ code: 'invalid_settings', field: 'impersonationMinutes' })
  })
})

/* ---------------- Module overrides ---------------- */

describe('module overrides', () => {
  const mod = (body: unknown, role: PlatformRole = 'Platform Owner') => api(ptoken(role), 'POST', `/platform/companies/${CREST_ID}/modules`, body)
  const crest = (path: string) => api(tokenFor(crestAdmin()), 'GET', path)

  it('enable a module outside the plan; disable one in the plan; survives a plan change; remove', async () => {
    expect((await crest('/hr/employees')).body.code).toBe('module_not_in_plan')
    const on = await mod({ module: 'hr', enabled: true, reason: 'HR pilot for Crest' })
    expect(on.status).toBe(200)
    expect(on.body.modules.find((m: { module: string }) => m.module === 'hr')).toMatchObject({ inPlan: false, enabled: true, override: { enabled: true, reason: 'HR pilot for Crest' } })
    expect((await getEntitlements(crestAdmin())).modules).toContain('hr')
    expect(companyById(CREST_ID)!.enabledModules).toContain('hr')
    expect((await crest('/hr/employees')).status).toBe(200)

    expect((await mod({ module: 'events', enabled: false, reason: 'Events misuse' })).status).toBe(200)
    expect((await crest('/events')).body.code).toBe('module_not_in_plan')
    expect((await getEntitlements(crestAdmin())).modules).not.toContain('events')

    // A plan change keeps the overrides (Enterprise includes events, the override still disables it).
    await api(ptoken('Platform Billing'), 'POST', `/platform/companies/${CREST_ID}/actions`, { action: 'change_plan', planId: 'enterprise', reason: REASON })
    expect((await crest('/events')).body.code).toBe('module_not_in_plan')
    await api(ptoken('Platform Billing'), 'POST', `/platform/companies/${CREST_ID}/actions`, { action: 'change_plan', planId: 'business', reason: REASON })
    expect((await crest('/hr/employees')).status).toBe(200)

    // Remove the override: back to the plan.
    expect((await mod({ module: 'events', enabled: null, reason: 'Resolved' })).status).toBe(200)
    expect((await crest('/events')).status).toBe(200)
    expect((await mod({ module: 'events', enabled: null, reason: 'Resolved' })).body.code).toBe('no_override')

    // Audited in both logs.
    expect(platformAudit.filter((e) => e.action === 'company.module_override')).toHaveLength(3)
    expect(auditLog.some((a) => a.companyId === CREST_ID && a.summary.includes('HR turned on by Apex CRM'))).toBe(true)
  })

  it('validation and permission', async () => {
    expect((await mod({ module: 'sales', enabled: false, reason: REASON })).body.code).toBe('invalid_module')
    expect((await mod({ module: 'hr', enabled: 'yes', reason: REASON })).body.code).toBe('invalid_override')
    expect((await mod({ module: 'hr', enabled: true })).body.code).toBe('reason_required')
    expect((await mod({ module: 'hr', enabled: true, reason: REASON }, 'Platform Support')).status).toBe(403)
  })
})

/* ---------------- Subdomains ---------------- */

describe('subdomain change', () => {
  const change = (subdomain: string, companyId = CREST_ID) => owner('POST', `/platform/companies/${companyId}/subdomain`, { subdomain, reason: 'Rebranding request' })

  it('validates format, reserved words and uniqueness (companies, pending sign-ups)', async () => {
    expect((await owner('GET', '/platform/subdomains/check?subdomain=admin')).body).toMatchObject({ available: false })
    expect((await change('admin')).body.code).toBe('invalid_subdomain')
    expect((await change('a')).body.code).toBe('invalid_subdomain')
    expect((await change('apexaora')).body.code).toBe('subdomain_taken')
    expect((await change('crest')).body.code).toBe('same_subdomain')
    await startSignup(
      { companyName: 'Held Co', subdomain: 'held-co', country: 'AE', language: 'en', adminName: 'Held Admin', adminEmail: 'held@held.example', mobile: '0501234567', password: 'Sunny-Harbor-42', acceptTerms: true },
      'platform-held',
    )
    expect((await owner('GET', '/platform/subdomains/check?subdomain=held-co')).body.available).toBe(false)
    expect((await change('held-co')).body.code).toBe('subdomain_taken')
    expect((await owner('POST', `/platform/companies/${CREST_ID}/subdomain`, { subdomain: 'crest-sa' })).body.code).toBe('reason_required')
  })

  it('the old address becomes a redirecting alias that can’t be taken until it expires; audited', async () => {
    const res = await change('crest-logistics')
    expect(res.status).toBe(200)
    expect(companyById(CREST_ID)!.subdomain).toBe('crest-logistics')
    expect(res.body.subdomainAliases).toHaveLength(1)
    expect(res.body.subdomainAliases[0].subdomain).toBe('crest')
    expect(Date.parse(res.body.subdomainAliases[0].redirectUntil) - nowMs()).toBeGreaterThan((consoleSettings.subdomainRedirectDays - 1) * DAY)

    // Public lookup: the old address answers with redirectTo; the new one without.
    const old = await api(null, 'GET', '/public/workspaces/crest')
    expect(old.body).toMatchObject({ id: CREST_ID, subdomain: 'crest-logistics', redirectTo: 'crest-logistics' })
    expect((await api(null, 'GET', '/public/workspaces/crest-logistics')).body.redirectTo).toBeUndefined()

    // Requests from the old host are accepted for that company only.
    expect((await api(tokenFor(crestAdmin()), 'GET', '/leads', undefined, { 'X-Workspace': 'crest' })).status).toBe(200)
    expect((await api(tokenFor(crestAdmin()), 'GET', '/leads', undefined, { 'X-Workspace': 'crest-logistics' })).status).toBe(200)
    expect((await api(tokenFor(apexAdmin()), 'GET', '/leads', undefined, { 'X-Workspace': 'crest' })).body.code).toBe('tenant_mismatch')

    // The alias can't be taken by another company or a sign-up while it redirects.
    expect((await change('crest', APEX_ID)).body.code).toBe('subdomain_taken')
    expect((await signupCheckSubdomain('crest')).available).toBe(false)

    // Both logs.
    expect(platformAudit[0]).toMatchObject({ action: 'subdomain.changed', companyId: CREST_ID, reason: 'Rebranding request', before: { subdomain: 'crest' } })
    expect(auditLog.find((a) => a.companyId === CREST_ID)!.summary).toContain('crest → crest-logistics')

    // After the redirect period the old address is free again.
    advanceClock(consoleSettings.subdomainRedirectDays + 1)
    expect((await api(null, 'GET', '/public/workspaces/crest')).status).toBe(404)
    expect((await signupCheckSubdomain('crest')).available).toBe(true)
    expect((await change('crest', APEX_ID)).status).toBe(200)
    expect(companyById(APEX_ID)!.subdomain).toBe('crest')
  })

  it('a company can take back its own old address (the alias ends)', async () => {
    await change('crest-logistics')
    const back = await change('crest')
    expect(back.status).toBe(200)
    expect(back.body.subdomainAliases.map((a: { subdomain: string }) => a.subdomain)).toEqual(['crest-logistics'])
  })
})

/* ---------------- Plans (versioned) ---------------- */

describe('plan edits never break existing subscriptions', () => {
  const edit = (id: string, body: Record<string, unknown>) => api(ptoken('Platform Billing'), 'PATCH', `/platform/plans/${id}`, { reason: 'Price review 2026', ...body })

  it('keep: a new version; subscribers stay on theirs (limits, modules and price)', async () => {
    const res = await edit('business', { price: 99, limits: { users: 10 }, migration: 'keep' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ newVersion: true, migrated: 0, scheduled: 0, skipped: [] })
    expect(res.body.plan.version).toBe(2)
    expect(res.body.plan.versions.map((v: { version: number; subscribers: number }) => [v.version, v.subscribers])).toEqual([[1, 1], [2, 0]])
    expect(subscriptionOf(CREST_ID)!.planVersion).toBe(1)
    const ent = await getEntitlements(crestAdmin())
    expect(ent.limits.users).toBe(25)
    // Renewal still charges the old version's price.
    advanceClock(25)
    runLifecycleForAll()
    const last = billingInvoices.filter((i) => i.companyId === CREST_ID).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0]
    expect(last.amount).toBe(79)
  })

  it('name / highlights / active don’t create a version', async () => {
    const res = await edit('business', { name: 'Business Plus', highlights: ['More'], migration: 'keep' })
    expect(res.body.newVersion).toBe(false)
    expect(res.body.plan.version).toBe(1)
    expect((await getEntitlements(crestAdmin())).planName).toBe('Business Plus')
  })

  it('at_renewal: moved by the next renewal', async () => {
    const res = await edit('business', { price: 89, limits: { users: 30 }, migration: 'at_renewal' })
    expect(res.body).toMatchObject({ newVersion: true, scheduled: 1 })
    expect(subscriptionOf(CREST_ID)).toMatchObject({ planVersion: 1, pendingPlanVersion: 2 })
    advanceClock(25)
    runLifecycleForAll()
    expect(subscriptionOf(CREST_ID)).toMatchObject({ planVersion: 2, pendingPlanVersion: null })
    expect((await getEntitlements(crestAdmin())).limits.users).toBe(30)
    const last = billingInvoices.filter((i) => i.companyId === CREST_ID).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0]
    expect(last.amount).toBe(89)
  })

  it('now: moved immediately, unless usage exceeds the new limits (then skipped and reported)', async () => {
    const activeUsers = usedOf(CREST_ID, 'users')
    const tooSmall = await edit('business', { limits: { users: activeUsers - 1 }, migration: 'now' })
    expect(tooSmall.body.migrated).toBe(0)
    expect(tooSmall.body.skipped).toHaveLength(1)
    expect(tooSmall.body.skipped[0].companyId).toBe(CREST_ID)
    expect(tooSmall.body.skipped[0].reasons[0]).toContain('Users')
    expect(subscriptionOf(CREST_ID)!.planVersion).toBe(1)
    expect(users.filter((x) => x.companyId === CREST_ID && x.active).length).toBe(activeUsers)

    const ok = await edit('business', { limits: { users: 50 }, modules: ['sales', 'services', 'tasks', 'departments', 'reports', 'settings', 'marketing', 'accounting', 'events', 'integrations', 'ai', 'hr'], migration: 'now' })
    expect(ok.body).toMatchObject({ migrated: 1, skipped: [] })
    expect(subscriptionOf(CREST_ID)!.planVersion).toBe(3)
    const ent = await getEntitlements(crestAdmin())
    expect(ent.limits.users).toBe(50)
    expect(ent.modules).toContain('hr')
    expect(companyById(CREST_ID)!.enabledModules).toContain('hr')
  })

  it('a deactivated plan keeps its subscribers but is no longer offered', async () => {
    expect((await edit('business', { active: false, migration: 'keep' })).status).toBe(200)
    expect((await listPlans()).map((p) => p.id)).not.toContain('business')
    expect(subscriptionOf(CREST_ID)!.planId).toBe('business')
    expect((await api(tokenFor(crestAdmin()), 'GET', '/leads')).status).toBe(200)
    const trial = await trialCompany()
    await setPaymentMethod(trial, card)
    expect((await api(tokenFor(trial), 'POST', '/billing/change-plan', { plan_id: 'business' })).body.code).toBe('invalid_plan')
    expect((await owner('POST', `/platform/companies/${APEX_ID}/actions`, { action: 'change_plan', planId: 'business', reason: REASON })).body.code).toBe('invalid_plan')
    // The platform list still has it.
    const all = (await owner('GET', '/platform/plans')).body as { id: string; active: boolean; subscribers: number }[]
    expect(all.find((p) => p.id === 'business')).toMatchObject({ active: false, subscribers: 1 })
  })

  it('validation; new plans; audited', async () => {
    expect((await edit('business', { price: 99 })).body.code).toBe('invalid_migration')
    expect((await edit('business', { price: -1, migration: 'keep' })).body.code).toBe('invalid_plan_input')
    expect((await edit('business', { modules: ['nope'], migration: 'keep' })).body.code).toBe('invalid_plan_input')
    expect((await edit('nope', { migration: 'keep' })).status).toBe(404)
    const created = await owner('POST', '/platform/plans', { id: 'growth', name: 'Growth', price: 49, currency: 'USD', billingPeriod: 'month', limits: { users: 10 }, modules: ['sales', 'tasks'], highlights: ['New'], checkout: 'payment', active: true, reason: REASON })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ id: 'growth', version: 1, subscribers: 0, rank: 4 })
    expect((await owner('POST', '/platform/plans', { ...created.body, reason: REASON })).body.code).toBe('plan_exists')
    expect(platformAudit.some((e) => e.action === 'plan.created')).toBe(true)
  })
})

/* ---------------- Overview ---------------- */

describe('overview', () => {
  it('MRR (custom price, yearly normalized), status counts; revenue hidden without billing:view', async () => {
    const o = (await owner('GET', '/platform/overview')).body
    expect(o.totals.companies).toBe(2)
    expect(o.mrr).toBe(578)
    expect(o.byPlan.map((x: { key: string }) => x.key).sort()).toEqual(['business', 'enterprise'])
    expect((await api(ptoken('Platform Support'), 'GET', '/platform/overview')).body).toMatchObject({ mrr: null, mrrByPlan: null })

    // Yearly price normalized to a month.
    await api(ptoken('Platform Billing'), 'PATCH', '/platform/plans/business', { billingPeriod: 'year', price: 790, migration: 'now', reason: REASON })
    expect((await owner('GET', '/platform/overview')).body.mrr).toBe(round2(499 + 790 / 12))
  })

  it('past due with the amount due; trials ending soon', async () => {
    const trial = await trialCompany()
    advanceClock(billingSettings.trialDays - 3)
    await devSetStatus(crestAdmin(), { status: 'past_due' })
    const o = (await owner('GET', '/platform/overview')).body
    expect(o.pastDue).toEqual([expect.objectContaining({ companyId: CREST_ID, amountDue: 79 })])
    expect(o.trialsEndingSoon).toEqual([expect.objectContaining({ companyId: trial.companyId, daysLeft: 3 })])
    expect(o.signupsLast30Days).toBe(1)
  })
})

const round2 = (v: number) => Math.round(v * 100) / 100

/* ---------------- Trial conversion ---------------- */

describe('the trial converts to the selected plan', () => {
  it('chosen at sign-up (continuePlanId), card saved during the trial', async () => {
    const admin = await trialCompany('business')
    const co = admin.companyId
    expect(subscriptionOf(co)!.selectedPlanId).toBe('business')
    await setPaymentMethod(admin, card)
    expect(subscriptionOf(co)!.selectedPlanId).toBe('business')
    advanceClock(billingSettings.trialDays + 1)
    runLifecycleForAll()
    expect(subscriptionOf(co)).toMatchObject({ status: 'active', planId: 'business', selectedPlanId: null })
    expect(billingInvoices.filter((i) => i.companyId === co).map((i) => i.amount)).toEqual([79])
    expect(companyById(co)!.enabledModules).toContain('marketing')
  })

  it('sign-up rejects an invalid continuePlanId', async () => {
    n++
    const s = await startSignup(
      { companyName: `Bad Plan ${n}`, subdomain: `bad-plan-${n}`, country: 'AE', language: 'en', adminName: 'Bad Admin', adminEmail: `bad${n}@bad.example`, mobile: '0501234567', password: 'Sunny-Harbor-42', acceptTerms: true },
      `platform-bad-${n}`,
    )
    await verifySignup(s.signupId, { code: s.devCode })
    for (const continuePlanId of ['enterprise', 'trial', 'nope']) {
      expect((await apiError(completeSignup(s.signupId, { plan: 'trial', continuePlanId }))).code).toBe('invalid_plan')
    }
  })

  it('POST /billing/trial-plan changes the selection (trialing only, Company Admin)', async () => {
    const admin = await trialCompany('starter')
    const res = await api(tokenFor(admin), 'POST', '/billing/trial-plan', { plan_id: 'business' })
    expect(res.status).toBe(200)
    expect(res.body.subscription.selected_plan_id).toBe('business')
    expect((await api(tokenFor(admin), 'POST', '/billing/trial-plan', { plan_id: 'enterprise' })).body.code).toBe('contact_sales')
    expect((await apiError(setTrialPlan(crestAdmin(), { planId: 'business' }))).code).toBe('invalid_state')
    await setPaymentMethod(admin, card)
    advanceClock(billingSettings.trialDays + 1)
    runLifecycleForAll()
    expect(subscriptionOf(admin.companyId)!.planId).toBe('business')
  })

  it('no selection, or an inactive one → the lowest-ranked active paid plan, and the audit says so', async () => {
    const none = await trialCompany()
    await setPaymentMethod(none, card)
    const inactive = await trialCompany('business')
    await setPaymentMethod(inactive, card)
    await api(ptoken('Platform Billing'), 'PATCH', '/platform/plans/business', { active: false, migration: 'keep', reason: REASON })
    advanceClock(billingSettings.trialDays + 1)
    runLifecycleForAll()
    expect(subscriptionOf(none.companyId)!.planId).toBe('starter')
    expect(subscriptionOf(inactive.companyId)!.planId).toBe('starter')
    expect(auditLog.find((a) => a.companyId === none.companyId && a.summary.startsWith('Trial converted'))!.summary).toContain('no plan was selected')
    expect(auditLog.find((a) => a.companyId === inactive.companyId && a.summary.startsWith('Trial converted'))!.summary).toContain('no longer available')
  })
})

/* ---------------- Announcements ---------------- */

describe('announcements', () => {
  const create = (body: Record<string, unknown>) =>
    owner('POST', '/platform/announcements', {
      title: 'Saudi maintenance',
      body: 'Short maintenance tonight.',
      tone: 'warning',
      audience: { plans: [], countries: [] },
      startsAt: new Date(nowMs() - MINUTE).toISOString(),
      endsAt: new Date(nowMs() + DAY).toISOString(),
      ...body,
    })
  const list = (user: User) => api(tokenFor(user), 'GET', '/announcements')

  it('segment by plan and country; reach; per-user dismiss', async () => {
    const a = (await create({ audience: { plans: ['business'], countries: ['SA'] } })).body
    expect(a.reach).toBe(1)
    expect((await list(crestAgent())).body.map((x: { id: string }) => x.id)).toEqual([a.id])
    expect(Object.keys((await list(crestAgent())).body[0]).sort()).toEqual(['body', 'ends_at', 'id', 'title', 'tone'])
    expect((await list(apexAdmin())).body).toEqual([])
    expect((await api(tokenFor(crestAgent()), 'POST', `/announcements/${a.id}/dismiss`)).status).toBe(200)
    expect((await list(crestAgent())).body).toEqual([])
    expect((await list(crestAdmin())).body).toHaveLength(1)
    // Outside the segment: 404.
    expect((await api(tokenFor(apexAdmin()), 'POST', `/announcements/${a.id}/dismiss`)).status).toBe(404)
  })

  it('scheduled and ended by the mock clock; DELETE ends it now and keeps the row', async () => {
    const future = (await create({ startsAt: new Date(nowMs() + 2 * DAY).toISOString(), endsAt: new Date(nowMs() + 3 * DAY).toISOString() })).body
    expect((await list(apexAdmin())).body).toEqual([])
    advanceClock(2.5)
    expect((await list(apexAdmin())).body.map((x: { id: string }) => x.id)).toEqual([future.id])
    const ended = await owner('DELETE', `/platform/announcements/${future.id}`)
    expect(ended.status).toBe(200)
    expect((await list(apexAdmin())).body).toEqual([])
    expect((await owner('GET', '/platform/announcements')).body.map((x: { id: string }) => x.id)).toContain(future.id)
    expect(platformAudit.some((e) => e.action === 'announcement.ended')).toBe(true)
  })

  it('validation; dismiss is a write blocked in impersonation read mode', async () => {
    expect((await create({ title: 'x' })).body).toMatchObject({ code: 'invalid_announcement', field: 'title' })
    expect((await create({ endsAt: new Date(nowMs() - DAY).toISOString() })).body.field).toBe('endsAt')
    expect((await create({ audience: { plans: ['nope'], countries: [] } })).body.field).toBe('audience.plans')
    const a = (await create({})).body
    const edited = await owner('PATCH', `/platform/announcements/${a.id}`, { title: 'Edited title' })
    expect(edited.body.title).toBe('Edited title')
    const session = await impersonate()
    expect((await api(session.token, 'POST', `/announcements/${a.id}/dismiss`)).body.code).toBe('impersonation_read_only')
  })
})

/* ---------------- Platform audit + settings ---------------- */

describe('platform audit and settings', () => {
  it('every write is in the platform audit with actor, IP, reason and before/after; filters work', async () => {
    await owner('PATCH', '/platform/settings', { graceDays: 10, subdomainRedirectDays: 14, reason: 'Policy update' })
    expect(billingSettings.graceDays).toBe(10)
    expect(consoleSettings.subdomainRedirectDays).toBe(14)
    await api(ptoken('Platform Support'), 'POST', `/platform/companies/${CREST_ID}/notes`, { body: 'Note' })
    const all = (await api(ptoken('Platform Support'), 'GET', '/platform/audit')).body as { action: string; actorId: string; ip: string }[]
    expect(all[0].action).toBe('note.added')
    const settingsEntry = (await owner('GET', '/platform/audit?action=settings')).body[0]
    expect(settingsEntry).toMatchObject({ action: 'settings.updated', actorRole: 'Platform Owner', reason: 'Policy update' })
    expect(settingsEntry.before.graceDays).toBe(7)
    expect(settingsEntry.after.graceDays).toBe(10)
    expect((await owner('GET', `/platform/audit?actor=${SUPPORT().id}`)).body.every((e: { actorId: string }) => e.actorId === SUPPORT().id)).toBe(true)
    expect((await owner('GET', `/platform/audit?companyId=${APEX_ID}`)).body).toEqual([])
    expect((await owner('GET', '/platform/audit?q=policy')).body).toHaveLength(1)
    // Same operator session → same mocked IP.
    const ips = new Set(all.filter((e) => e.actorId === SUPPORT().id).map((e) => e.ip))
    expect(ips.size).toBe(1)
  })

  it('settings: reason required, ranges validated', async () => {
    expect((await owner('PATCH', '/platform/settings', { graceDays: 10 })).body.code).toBe('reason_required')
    expect((await owner('PATCH', '/platform/settings', { trialDays: 0, reason: REASON })).body).toMatchObject({ code: 'invalid_settings', field: 'trialDays' })
    expect((await owner('PATCH', '/platform/settings', { subdomainRedirectDays: 400, reason: REASON })).body.field).toBe('subdomainRedirectDays')
    const s = (await api(ptoken('Platform Support'), 'GET', '/platform/settings')).body
    expect(s).toMatchObject({ trialDays: 14, subdomainRedirectDays: 30, impersonationMinutes: 30 })
  })
})
