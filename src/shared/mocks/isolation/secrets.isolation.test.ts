import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { adTokens } from '@/shared/mocks/data/ads'
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
import { hrSensitiveIn } from './harness'
import { withHr } from './hrTalentEndpoints'
import { hrProfiles } from '@/shared/mocks/data/hrPeople'
import { hrPayrollProfiles } from '@/shared/mocks/data/hrPayroll'

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

describe('§8 Ad platform tokens are stored server-side and served masked', () => {
  it('the guard flags an unmasked ad token', () => {
    expect(secretsIn({ note: 'adtok_0123456789abcdef' }, 'GET /x')).toHaveLength(1)
    expect(secretsIn({ token_hint: '•••• 4f2a' }, 'GET /x')).toEqual([])
  })

  it.each(COMPANIES)('%s: connect, list, detail, sync and disconnect answer a "•••• xxxx" hint, never the token', async (co) => {
    ;(globalThis as { __apexAdsSync?: string }).__apexAdsSync = 'ok'
    try {
      const accounts = await api(adminToken(co), 'GET', '/marketing/ads/providers/tiktok/accounts')
      expect(accounts.status, accounts.text).toBe(200)
      const res = await api(adminToken(co), 'POST', '/marketing/ads/connections', { body: { provider: 'tiktok', account_id: accounts.body[1].account_id, consent: true } })
      expect(res.status, res.text).toBe(200)
      expect(res.body.token_hint).toMatch(/^•••• [0-9a-f]{4}$/)
      const token = adTokens.get(res.body.id)!
      expect(token).toMatch(/^adtok_/)
      expect(res.body.token_hint.slice(-4)).toBe(token.slice(-4))
      for (const [method, path] of [
        ['GET', '/marketing/ads/connections'],
        ['GET', `/marketing/ads/connections/${res.body.id}`],
        ['POST', `/marketing/ads/connections/${res.body.id}/sync`],
        ['GET', '/marketing/analytics?preset=last_30_days'],
      ]) {
        const r = await api(adminToken(co), method, path)
        expect(r.status, path).toBe(200)
        expect(r.text, path).not.toContain(token)
      }
      const off = await api(adminToken(co), 'DELETE', `/marketing/ads/connections/${res.body.id}`)
      expect(off.body.token_hint).toBeNull()
      expect(adTokens.has(res.body.id)).toBe(false)
    } finally {
      delete (globalThis as { __apexAdsSync?: string }).__apexAdsSync
    }
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

describe('§8 HR identifiers (IBAN, WPS person id, national id / iqama) are served masked', () => {
  it('the guard flags a full stored IBAN / person id outside the explicit reveal / bank-file endpoints', () => {
    const [iban] = hrProfiles.filter((p) => p.iban).map((p) => p.iban)
    const pid = hrPayrollProfiles.find((p) => p.personId)!.personId
    expect(hrSensitiveIn(JSON.stringify({ iban }), 'GET /hr/employees/EMP-u11')).toHaveLength(1)
    expect(hrSensitiveIn(JSON.stringify({ note: `id ${pid}` }), 'GET /hr/payroll/payslips')).toHaveLength(1)
    expect(hrSensitiveIn(JSON.stringify({ iban_masked: `•••• ${iban.slice(-4)}` }), 'GET /hr/employees/EMP-u11')).toEqual([])
    expect(hrSensitiveIn(JSON.stringify({ value: iban }), 'POST /hr/employees/EMP-u11/reveal')).toEqual([])
    expect(hrSensitiveIn(JSON.stringify({ person_id: pid }), 'POST /hr/payroll/profiles/EMP-u11/reveal')).toEqual([])
    expect(hrSensitiveIn(JSON.stringify({ content: `EDR,${pid}` }), 'POST /hr/payroll/runs/PR-1/bank-file')).toEqual([])
    expect(hrSensitiveIn(JSON.stringify({ content: `EDR,${pid}` }), 'GET /hr/payroll/runs/PR-1')).toHaveLength(1)
  })

  it.each(COMPANIES)('%s: every HR GET, for every role, answers without a full IBAN or person id (the guard runs on each)', async (co) => {
    withHr(co)
    const hrGets = ENDPOINTS.filter((e) => e.method === 'GET' && e.path.startsWith('/hr/') && isCompany(e))
    expect(hrGets.some((e) => e.path.startsWith('/hr/payroll/'))).toBe(true)
    const active = users.filter((x) => x.companyId === co && x.active !== false)
    const perRole = active.filter((u, i) => active.findIndex((x) => x.role === u.role) === i)
    let checked = 0
    for (const u of perRole) {
      for (const e of hrGets) {
        const s = (await (e as { sample: (c: typeof co) => unknown }).sample(co)) as { params?: Record<string, string>; query?: Record<string, string> }
        const res = await api(userToken(u.id), 'GET', fill(e.path, s.params, s.query))
        expect(res.status, `${u.role} ${keyOf(e.method, e.path)}`).toBeLessThan(500)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  }, 60_000)
})
