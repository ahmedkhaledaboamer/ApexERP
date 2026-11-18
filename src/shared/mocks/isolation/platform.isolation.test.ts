import { describe, expect, it } from 'vitest'
import { leads, users } from '@/shared/mocks/db'
import { advanceClock } from '@/shared/mocks/clock'
import { consoleSettings } from '@/shared/mocks/data/platform'
import {
  APEX,
  COMPANIES,
  CREST,
  DEMO_PASSWORD,
  PLATFORM,
  api,
  adminToken,
  label,
  leaksIn,
  platformToken,
  slicesText,
  subdomainOf,
  userToken,
  useSeedPerTest,
  type Co,
} from './harness'
import { ENDPOINTS, fill, isCompany, keyOf } from './endpoints'

/**
 * §5 Platform boundary: company tokens never open /platform, platform tokens never open a workspace,
 * and an impersonation token is bound to one user of one company, read-only by default, blocked for
 * sensitive actions in both modes, and expires on the mock clock.
 */

useSeedPerTest()

const platformEntries = ENDPOINTS.filter((e) => e.kind === 'platform')
const companyEntries = ENDPOINTS.filter(isCompany)
const methodOf = (m: string) => (m === 'ALL' ? 'GET' : m)
const everyUser = () => users.filter((u) => (u.companyId === APEX || u.companyId === CREST) && u.active !== false)

/** A support session as Crest's sales agent (u104), through the real endpoint. */
async function impersonateCrest(): Promise<string> {
  const res = await api(platformToken(PLATFORM.support), 'POST', '/platform/impersonations', { body: { userId: 'u104', reason: 'Customer reported a lead import problem' } })
  expect(res.status, res.text).toBe(200)
  expect(res.body.user.companyId).toBe(CREST)
  return res.body.token as string
}

describe('§5 Company tokens never reach /platform', () => {
  it(`every role of both companies → 401 on all ${platformEntries.length} platform endpoints`, async () => {
    for (const u of everyUser()) {
      const token = userToken(u.id)
      for (const e of platformEntries) {
        const res = await api(token, methodOf(e.method), fill(e.path, { id: CREST }), { body: {} })
        expect(res.status, `${u.id} (${u.role}, ${u.companyId}) on ${keyOf(e.method, e.path)}`).toBe(401)
      }
    }
  }, 30_000)

  it('platform sign-in refuses company accounts', async () => {
    const res = await api(null, 'POST', '/platform/auth/login', { body: { email: 'omar@apexaora.ae', password: DEMO_PASSWORD } })
    expect(res.status).toBe(401)
  })
})

describe('§5 Platform tokens never open a workspace', () => {
  it(`every platform role → 401 on all ${companyEntries.length} company endpoints`, async () => {
    for (const id of Object.values(PLATFORM)) {
      for (const e of companyEntries) {
        const res = await api(platformToken(id), methodOf(e.method), fill(e.path), { body: {} })
        expect(res.status, `${id} on ${keyOf(e.method, e.path)}`).toBe(401)
      }
    }
  }, 30_000)

  it('a company sign-in at the other company’s address is refused like a wrong password', async () => {
    const wrongWorkspace = await api(null, 'POST', '/auth/login', { body: { email: 'faisal@crestlogistics.sa', password: DEMO_PASSWORD }, headers: { 'X-Workspace': subdomainOf(APEX) } })
    const wrongPassword = await api(null, 'POST', '/auth/login', { body: { email: 'faisal@crestlogistics.sa', password: 'not-the-password' }, headers: { 'X-Workspace': subdomainOf(CREST) } })
    expect(wrongWorkspace.status).toBe(401)
    expect(wrongWorkspace.body).toEqual(wrongPassword.body)
    const ok = await api(null, 'POST', '/auth/login', { body: { email: 'faisal@crestlogistics.sa', password: DEMO_PASSWORD }, headers: { 'X-Workspace': subdomainOf(CREST) } })
    expect(ok.status).toBe(200)
    expect(ok.body.tenant.id).toBe(CREST)
    expect(leaksIn(ok.body, CREST)).toEqual([])
  })

  it('a session token of one company is refused on the other company’s address', async () => {
    for (const co of COMPANIES) {
      const res = await api(adminToken(co), 'GET', '/leads', { headers: { 'X-Workspace': subdomainOf(co === APEX ? CREST : APEX) } })
      expect(res.status, label(co)).toBe(403)
      expect(res.body.code).toBe('tenant_mismatch')
    }
  })
})

describe('§5 Impersonation token (Crest user) is bound to Crest', () => {
  it('cannot reach Apex: X-Workspace apexaora → tenant_mismatch, Apex ids → 404, lists hold Crest only', async () => {
    const token = await impersonateCrest()
    const apexBefore = slicesText()[APEX]
    const mismatch = await api(token, 'GET', '/leads', { headers: { 'X-Workspace': subdomainOf(APEX) } })
    expect(mismatch.status).toBe(403)
    expect(mismatch.body.code).toBe('tenant_mismatch')

    const apexLead = leads.find((l) => l.companyId === APEX)!
    const missing = await api(token, 'GET', '/leads/L-999999')
    const foreign = await api(token, 'GET', `/leads/${apexLead.id}`)
    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual(missing.body)
    for (const path of ['/customers/C-1004', '/departments/d-sales', '/services/S-101', `/quotations/${'Q-1001'}`]) {
      expect((await api(token, 'GET', path)).status, path).toBe(404)
    }
    for (const path of ['/leads', '/customers', '/tasks', '/alerts', '/dashboard/summary', '/users', '/tenant']) {
      const res = await api(token, 'GET', path)
      expect(res.status, path).toBe(200)
      expect(leaksIn(res.body, CREST), path).toEqual([])
    }
    expect(slicesText()[APEX], 'an impersonation session changed Apex data').toBe(apexBefore)
  })

  it('cannot call /platform (401 on every platform endpoint)', async () => {
    const token = await impersonateCrest()
    for (const e of platformEntries) {
      const res = await api(token, methodOf(e.method), fill(e.path, { id: CREST }), { body: {} })
      expect(res.status, keyOf(e.method, e.path)).toBe(401)
    }
  })

  it('is read-only by default', async () => {
    const token = await impersonateCrest()
    const write = await api(token, 'POST', '/tasks', { body: { title: 'Support wrote this' } })
    expect(write.status).toBe(403)
    expect(write.body.code).toBe('impersonation_read_only')
    expect((await api(token, 'GET', '/tasks')).status).toBe(200)
  })

  it('stays blocked for sensitive actions in read and in write mode', async () => {
    let token = await impersonateCrest()
    const sensitive: [string, string, unknown?][] = [
      ['POST', '/account/password', { currentPassword: DEMO_PASSWORD, newPassword: 'Another-Strong-Pass-99' }],
      ['GET', '/security/2fa'],
      ['POST', '/security/2fa/setup'],
      ['POST', '/security/2fa/disable', { code: '000000' }],
      ['POST', '/security/sessions/revoke-others'],
      ['POST', '/billing/payment-method', { holder: 'X', card_number: '4242 4242 4242 4242', expiry: '12/39', cvc: '123' }],
      ['POST', '/billing/change-plan', { plan_id: 'enterprise' }],
      ['POST', '/billing/cancel'],
      ['GET', '/billing/export'],
      ['POST', '/auth/switch-role', { role: 'Company Admin' }],
    ]
    for (const mode of ['read', 'write'] as const) {
      if (mode === 'write') {
        const sw = await api(token, 'POST', '/auth/impersonation/write-mode', { body: { confirm: true } })
        expect(sw.status, sw.text).toBe(200)
        token = sw.body.token
        expect(sw.body.impersonation.mode).toBe('write')
      }
      for (const [method, path, body] of sensitive) {
        const res = await api(token, method, path, { body })
        expect(res.status, `${mode} mode ${method} ${path}`).toBe(403)
        expect(res.body.code, `${mode} mode ${method} ${path}`).toBe('impersonation_blocked')
      }
    }
    // Write mode does allow ordinary writes, still inside Crest only.
    const apexBefore = slicesText()[APEX]
    const task = await api(token, 'POST', '/tasks', { body: { title: 'Support wrote this' } })
    expect(task.status, task.text).toBe(200)
    expect(slicesText()[APEX]).toBe(apexBefore)
  })

  it('expires on the mock clock (401 impersonation_expired)', async () => {
    const token = await impersonateCrest()
    expect((await api(token, 'GET', '/leads')).status).toBe(200)
    advanceClock((consoleSettings.impersonationMinutes + 1) / (24 * 60))
    const res = await api(token, 'GET', '/leads')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('impersonation_expired')
  })

  it('ends with stop: the token is dead afterwards', async () => {
    const token = await impersonateCrest()
    expect((await api(token, 'POST', '/auth/impersonation/stop')).status).toBe(200)
    const res = await api(token, 'GET', '/leads')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('impersonation_ended')
  })

  it('an impersonation token edited to name another company is refused', async () => {
    const token = await impersonateCrest()
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.replace(/^mock\./, '')), (c) => c.charCodeAt(0))))
    const forged = { ...claims, co: APEX }
    const bytes = new TextEncoder().encode(JSON.stringify(forged))
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    const res = await api(`mock.${btoa(bin)}`, 'GET', '/leads')
    expect(res.status).toBe(401)
  })
})

describe('§5 Platform reads of a company stay about that company', () => {
  it.each([APEX, CREST] as Co[])('GET /platform/companies/%s/users lists only that company’s users', async (co) => {
    const res = await api(platformToken(), 'GET', `/platform/companies/${co}/users`)
    expect(res.status).toBe(200)
    expect(leaksIn(res.body, co)).toEqual([])
    const own = users.filter((u) => u.companyId === co).map((u) => u.id).sort()
    expect((res.body as { id: string }[]).map((u) => u.id).sort()).toEqual(own)
  })

  it.each([APEX, CREST] as Co[])('GET /platform/companies/%s and its timeline hold no other-company data', async (co) => {
    for (const path of [`/platform/companies/${co}`, `/platform/companies/${co}/timeline`, `/platform/companies/${co}/notes`]) {
      const res = await api(platformToken(), 'GET', path)
      expect(res.status, path).toBe(200)
      expect(leaksIn(res.body, co), path).toEqual([])
    }
  })
})
