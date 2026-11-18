import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import {
  ADMIN,
  APEX,
  COMPANIES,
  CREST,
  DEMO_PASSWORD,
  api,
  adminToken,
  leaksIn,
  luhn,
  platformToken,
  recorded,
  secretsIn,
  subdomainOf,
  useSeedPerTest,
  userToken,
} from './harness'
import { ENDPOINTS, fill, isCompany, keyOf } from './endpoints'

/**
 * §8 Secrets guard. The harness's api() runs `secretsIn` on EVERY response of the whole suite (all
 * *.isolation.test.ts files of src/shared/mocks/isolation) and fails the calling test on the first
 * secret. This file adds a sweep of every GET endpoint for both companies' admins, every role, and the
 * platform owner, the payment-method round trip, and self-tests of the guard.
 */

useSeedPerTest()

describe('§8 The guard itself', () => {
  it('flags secret keys, card numbers (Luhn), the demo password and stray tokens; allows phones and ids', () => {
    expect(secretsIn({ password: 'x' }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ user: { passwordHash: 'abc' } }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ apiKey: 'sk_live_123' }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ note: 'card 4242 4242 4242 4242' }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ note: '5555555555554444' }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ note: `pw ${DEMO_PASSWORD}` }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ token: 'mock.abc' }, 'GET /leads')).toHaveLength(1)
    expect(secretsIn({ token: 'mock.abc' }, 'POST /auth/login')).toEqual([])
    expect(secretsIn({ mobile: '+971 50 412 7781', iban: 'SA0810000012345678900001', tax: '310123456700003', id: 'L-1001' }, 'GET /x')).toEqual([])
    expect(luhn('4242424242424242')).toBe(true)
    expect(luhn('4242424242424241')).toBe(false)
  })
})

describe('§8 Sweep: every GET endpoint, every viewer', () => {
  const gets = ENDPOINTS.filter((e) => e.method === 'GET')

  it.each(COMPANIES)('%s admin: every company GET is free of secrets and of the other company', async (co) => {
    let swept = 0
    for (const e of gets) {
      const sample = isCompany(e) || 'sample' in e ? await (e as { sample?: (c: typeof co) => unknown }).sample?.(co) : undefined
      if (!sample) continue
      const s = sample as { params?: Record<string, string>; query?: Record<string, string>; as?: string }
      const res = await api(userToken(s.as ?? ADMIN[co]), 'GET', fill(e.path, s.params, s.query))
      expect(res.status, keyOf(e.method, e.path)).toBeLessThan(500)
      expect(leaksIn(res.body, co), keyOf(e.method, e.path)).toEqual([])
      swept++
    }
    expect(swept).toBeGreaterThan(50)
  }, 30_000)

  it.each(COMPANIES)('%s: one user of every role sweeps the list endpoints without secrets', async (co) => {
    const lists = gets.filter((e) => isCompany(e) && !e.path.includes(':'))
    const active = users.filter((x) => x.companyId === co && x.active !== false)
    const perRole = active.filter((u, i) => active.findIndex((x) => x.role === u.role) === i)
    expect(perRole.length).toBeGreaterThan(4)
    for (const u of perRole) {
      for (const e of lists) {
        const s = (await (e as { sample: (c: typeof co) => unknown }).sample(co)) as { query?: Record<string, string> }
        const res = await api(userToken(u.id), 'GET', fill(e.path, {}, s.query))
        expect(res.status, `${u.role} ${keyOf(e.method, e.path)}`).toBeLessThan(500)
        if (res.status === 200) expect(leaksIn(res.body, co), `${u.role} ${keyOf(e.method, e.path)}`).toEqual([])
      }
    }
  }, 30_000)

  it('platform owner: every platform GET (for both companies) is free of secrets', async () => {
    for (const e of gets.filter((x) => x.kind === 'platform')) {
      for (const co of COMPANIES) {
        const res = await api(platformToken(), 'GET', fill(e.path, { id: co }, e.path.includes('subdomains') ? { subdomain: 'free-name' } : {}))
        expect(res.status, keyOf(e.method, e.path)).toBeLessThan(500)
      }
    }
  })

  it('public and dev GETs are free of secrets', async () => {
    for (const path of ['/public/plans', '/public/signup/availability?subdomain=crest', `/public/workspaces/${subdomainOf(APEX)}`, `/public/workspaces/${subdomainOf(CREST)}`, '/auth/dev/accounts']) {
      const res = await api(null, 'GET', path)
      expect(res.status, path).toBe(200)
    }
  })
})

describe('§8 Payment cards are masked end to end', () => {
  it.each(COMPANIES)('%s: a saved card comes back as brand + last 4 only, everywhere', async (co) => {
    const card = co === APEX ? '4242 4242 4242 4242' : '5555 5555 5555 4444'
    const res = await api(adminToken(co), 'POST', '/billing/payment-method', { body: { holder: 'Card Holder', card_number: card, expiry: '12/39', cvc: '123' } })
    expect(res.status, res.text).toBe(200)
    expect(res.text).not.toContain(card.replace(/ /g, ''))
    expect(res.text).not.toContain('"123"')
    const overview = await api(adminToken(co), 'GET', '/billing/overview')
    expect(overview.body.subscription.payment_method.last4).toBe(card.slice(-4))
    for (const path of ['/billing/overview', '/billing/entitlements', '/billing/export', '/dev/billing/state']) {
      const r = await api(adminToken(co), 'GET', path)
      expect(r.text, path).not.toContain(card.replace(/ /g, ''))
    }
    const platform = await api(platformToken(), 'GET', `/platform/companies/${co}`)
    expect(platform.text).not.toContain(card.replace(/ /g, ''))
  })
})

describe('§8 Integrations hold no secrets', () => {
  it.each(COMPANIES)('%s: the email connection stores provider + address only (no password / token / key)', async (co) => {
    const res = await api(adminToken(co), 'POST', '/settings/email-connection', { body: { provider: 'smtp', address: `mail@${co}.example`, password: 'smtp-secret', apiKey: 'k-123', token: 't-1' } })
    expect([200, 403]).toContain(res.status)
    const get = await api(adminToken(co), 'GET', '/settings/email-connection')
    expect(get.text).not.toMatch(/smtp-secret|k-123|t-1/)
    expect((await api(adminToken(co), 'GET', '/integrations')).status).toBeLessThan(500)
  })
})

describe('§8 Every response recorded by this file passed the guard', () => {
  it('re-checks the recorded bodies (the guard already ran inline on each)', async () => {
    // Make sure there is something to check even when this test runs alone.
    await api(adminToken(APEX), 'GET', '/account')
    await api(null, 'POST', '/auth/login', { body: { email: 'omar@apexaora.ae', password: DEMO_PASSWORD }, headers: { 'X-Workspace': subdomainOf(APEX) } })
    expect(recorded.length).toBeGreaterThan(0)
    for (const r of recorded) expect(secretsIn(r.body, `${r.method} ${r.path}`), `${r.method} ${r.path}`).toEqual([])
    for (const r of recorded) expect(r.text.includes(DEMO_PASSWORD), `${r.method} ${r.path}`).toBe(false)
  })
})
