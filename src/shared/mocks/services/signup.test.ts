import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/lib/apiError'
import { DEFAULT_AUTOMATION_RULES } from '@/modules/settings/types'
import type { SignupStartInput } from '@/modules/signup/types'
import { billingSettings, planOf as planById } from '@/shared/mocks/data/plans'
import { billingInvoices } from '@/shared/mocks/data/subscriptions'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companies, companyBySubdomain, memberships } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { auditLog } from '@/shared/mocks/data/audit'
import { subscriptions } from '@/shared/mocks/data/subscriptions'
import { templates, DEFAULT_TEMPLATES } from '@/shared/mocks/data/templates'
import { automationRulesFor, lookupsFor } from '@/shared/mocks/data/lookups'
import { DEFAULT_TARGETS, targetDefaultsFor } from '@/shared/mocks/data/targets'
import { securityPolicyFor } from '@/shared/mocks/data/security'
import { defaultRoles, rolesFor } from '@/shared/mocks/data/roles'
import { checkouts, contactSalesRequests, pendingSignups } from '@/shared/mocks/data/signups'
import { passwordMatches } from '@/shared/mocks/data/passwords'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import {
  SIGNUP_STEPS,
  __signupFailAfter,
  checkSubdomain,
  checkout,
  completeSignup,
  contactSales,
  getSignup,
  resendCode,
  startSignup,
  verifySignup,
} from '@/shared/mocks/services/signup'
import { connectEmail, getOnboarding, setOnboardingDismissed, setOnboardingItem } from '@/shared/mocks/services/onboarding'
import { getRoles } from '@/shared/mocks/services/subscription'
import { getBillingOverview } from '@/shared/mocks/services/billing'

/* The mock DB is shared module state: every test starts from the seed. */
const seed = takeSnapshot(true)
afterEach(() => {
  restoreSnapshot(seed)
  __signupFailAfter.step = null
  vi.useRealTimers()
})

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

let clients = 0
const client = () => `test-client-${++clients}`
/** A fresh email (the per-email rate limit would otherwise trip in tests with many starts). */
const fresh = () => `person${++clients}@fresh.example`

const input = (over: Partial<SignupStartInput> = {}): SignupStartInput => ({
  companyName: 'Nimbus Trading',
  subdomain: 'nimbus-trading',
  country: 'EG',
  language: 'en',
  adminName: 'Test Admin',
  adminEmail: 'admin@nimbus.example',
  mobile: '01012345678',
  password: 'Sunny-Harbor-42',
  acceptTerms: true,
  ...over,
})

async function verified(over: Partial<SignupStartInput> = {}) {
  const s = await startSignup(input(over), client())
  await verifySignup(s.signupId, { code: s.devCode })
  return s
}

const card = { cardholder: 'Test Admin', cardNumber: '4242 4242 4242 4242', expiry: '12/39', cvc: '123' }

const apexEmail = users.find((u) => u.companyId === APEX_ID)!.email
const crestEmail = users.find((u) => u.companyId === CREST_ID)!.email

describe('sign-up: full trial flow', () => {
  it('start → verify → complete creates the workspace with every product default and signs the admin in', async () => {
    const s = await startSignup(input(), client())
    expect(s.devCode).toMatch(/^\d{6}$/)
    expect(s.email).toBe('admin@nimbus.example')
    expect(s.resendInSeconds).toBe(30)
    // Nothing is created by start.
    expect(companyBySubdomain('nimbus-trading')).toBeUndefined()
    expect(users.some((u) => u.email === 'admin@nimbus.example')).toBe(false)

    expect(await verifySignup(s.signupId, { code: s.devCode })).toEqual({ signupId: s.signupId, verified: true })
    expect((await getSignup(s.signupId)).verified).toBe(true)

    const session = await completeSignup(s.signupId, { plan: 'trial' })
    const c = session.tenant
    expect(c.subdomain).toBe('nimbus-trading')
    expect(c.status).toBe('trial')
    expect(c.plan).toBe('trial')
    // enabledModules = the plan's role modules (events / integrations / ai are plan-only areas).
    expect([...c.enabledModules].sort()).toEqual(planById('trial').modules.filter((m) => !['events', 'integrations', 'ai'].includes(m)).sort())
    expect(c.regional).toMatchObject({ country: 'EG', currency: 'EGP', timezone: 'Africa/Cairo', language: 'en' })
    expect(c.branding.monogram).toBe('NT')
    expect(c.branding.palette['600']).toBe('#7c3aed')
    expect(c.profile).toMatchObject({ legalName: 'Nimbus Trading', tradeName: 'Nimbus Trading', email: 'admin@nimbus.example', phone: '+20 10 1234 5678' })
    expect(c.profile.address.country).toBe('EG')
    expect(session.token).toBeTruthy()
    expect(session.subscription).toMatchObject({ planId: 'trial', status: 'trialing', paymentMethod: null })
    // Trial length comes from the platform billing settings.
    const trialMs = Date.parse(session.subscription.trialEndsAt!) - Date.parse(session.subscription.startedAt)
    expect(Math.round(trialMs / 86_400_000)).toBe(billingSettings.trialDays)
    expect(billingInvoices.filter((i) => i.companyId === c.id)).toHaveLength(0)

    const admin = users.find((u) => u.id === session.user.id)!
    expect(admin).toMatchObject({ companyId: c.id, role: 'Company Admin', email: 'admin@nimbus.example', mobile: '+20 10 1234 5678', active: true })
    expect(Number(admin.id.slice(1))).toBeGreaterThan(107)
    expect(passwordMatches(admin.id, 'Sunny-Harbor-42')).toBe(true)
    expect(memberships.filter((m) => m.userId === admin.id)).toEqual([expect.objectContaining({ companyId: c.id, role: 'Company Admin', status: 'active' })])
    const root = departments.find((d) => d.companyId === c.id && d.parentId === null)
    expect(root).toMatchObject({ name: 'Nimbus Trading', headId: admin.id })
    expect(admin.departmentId).toBe(root!.id)
    expect(subscriptions.filter((x) => x.companyId === c.id)).toHaveLength(1)

    // Product defaults: identical for every new company (Apex's seed is the product default).
    expect(rolesFor(c.id)).toEqual(defaultRoles())
    expect(rolesFor(c.id)).toHaveLength(9)
    expect(rolesFor(c.id).find((r) => r.id === 'Sales Agent')!.permissions).toEqual(PERMISSION_MATRIX['Sales Agent'])
    expect(lookupsFor(c.id)).toEqual(lookupsFor(APEX_ID))
    expect(lookupsFor(c.id).statuses.some((x) => x.key === 'Cold')).toBe(true)
    expect(lookupsFor(c.id).serviceCategories.length).toBeGreaterThan(0)
    expect(automationRulesFor(c.id)).toEqual(DEFAULT_AUTOMATION_RULES)
    expect(targetDefaultsFor(c.id)).toEqual(DEFAULT_TARGETS)
    expect(securityPolicyFor(c.id)).toEqual(securityPolicyFor(APEX_ID))
    const own = templates.filter((t) => t.companyId === c.id)
    expect(own).toHaveLength(DEFAULT_TEMPLATES.length)
    expect(own.map(({ channel, name, subject, body }) => ({ channel, name, subject, body }))).toEqual(
      DEFAULT_TEMPLATES.map(({ channel, name, subject, body }) => ({ channel, name, subject, body })),
    )
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length)
    expect(auditLog.some((a) => a.companyId === c.id && a.entity === 'company' && a.entityId === c.id)).toBe(true)

    // The pending sign-up is consumed: it can't be completed twice.
    expect((await apiError(completeSignup(s.signupId, { plan: 'trial' }))).status).toBe(404)
    // The address is now taken.
    expect((await checkSubdomain('nimbus-trading')).available).toBe(false)

    // Signed-in endpoints for the new company.
    expect((await getBillingOverview(admin)).subscription.planId).toBe('trial')
    expect(await getRoles(admin)).toHaveLength(9)
    const onboarding = await getOnboarding(admin)
    expect(onboarding.total).toBe(6)
    expect(onboarding.done).toBe(0)
    expect(onboarding.dismissed).toBe(false)
  })
})

describe('sign-up: paid plans', () => {
  it('needs a paid checkout for that sign-up and plan', async () => {
    const s = await verified()
    expect((await apiError(completeSignup(s.signupId, { plan: 'starter' }))).status).toBe(402)

    const declined = await apiError(checkout({ signupId: s.signupId, plan: 'starter', ...card, cardNumber: '4000 0000 0000 0002' }))
    expect(declined.status).toBe(402)
    expect(declined.code).toBe('card_declined')
    expect(checkouts).toHaveLength(0)

    const paid = await checkout({ signupId: s.signupId, plan: 'starter', ...card })
    expect(paid).toMatchObject({ status: 'paid', amount: planById('starter').price, currency: 'USD' })
    // Paid for Starter, can't complete Business with it.
    expect((await apiError(completeSignup(s.signupId, { plan: 'business', checkoutId: paid.checkoutId }))).status).toBe(402)

    const session = await completeSignup(s.signupId, { plan: 'starter', checkoutId: paid.checkoutId })
    expect(session.tenant.status).toBe('active')
    expect(session.tenant.plan).toBe('starter')
    expect(session.subscription).toMatchObject({ planId: 'starter', status: 'active', trialEndsAt: null })
    // The checkout's card is the payment method; the first invoice is paid.
    expect(session.subscription.paymentMethod).toMatchObject({ brand: 'visa', last4: '4242', holder: 'Test Admin' })
    expect(billingInvoices.filter((i) => i.companyId === session.tenant.id)).toEqual([
      expect.objectContaining({ planId: 'starter', amount: 29, status: 'paid' }),
    ])
  })

  it('business plan includes marketing and accounting', async () => {
    const s = await verified()
    const paid = await checkout({ signupId: s.signupId, plan: 'business', ...card })
    const session = await completeSignup(s.signupId, { plan: 'business', checkoutId: paid.checkoutId })
    expect(session.tenant.enabledModules).toEqual(expect.arrayContaining(['marketing', 'accounting']))
    expect(session.tenant.enabledModules).not.toContain('hr')
  })

  it('checkout requires a verified sign-up; enterprise goes to sales', async () => {
    const s = await startSignup(input(), client())
    expect((await apiError(checkout({ signupId: s.signupId, plan: 'starter', ...card }))).status).toBe(409)
    await verifySignup(s.signupId, { code: s.devCode })
    expect((await apiError(checkout({ signupId: s.signupId, plan: 'starter', ...card, cardNumber: '1234' }))).status).toBe(422)
    expect((await apiError(completeSignup(s.signupId, { plan: 'enterprise' as never }))).status).toBe(422)
    expect(companies).toHaveLength(2)

    const r = await contactSales({ companyName: 'Big Corp', name: 'Jane Doe', email: 'jane@big.example', country: 'AE', message: '200 seats' })
    expect(r.requestId).toBeTruthy()
    expect(contactSalesRequests).toHaveLength(1)
    expect(companies).toHaveLength(2)
  })

  it('complete requires a verified email', async () => {
    const s = await startSignup(input(), client())
    expect((await apiError(completeSignup(s.signupId, { plan: 'trial' }))).status).toBe(409)
  })
})

describe('sign-up: subdomain', () => {
  it('rejects taken (company or pending), reserved and malformed addresses', async () => {
    expect((await apiError(startSignup(input({ subdomain: 'apexaora', adminEmail: fresh() }), client()))).status).toBe(409)
    expect((await apiError(startSignup(input({ subdomain: 'crest', adminEmail: fresh() }), client()))).status).toBe(409)
    expect((await checkSubdomain('crest')).available).toBe(false)

    await startSignup(input({ subdomain: 'held-co', adminEmail: 'one@held.example' }), client())
    const taken = await apiError(startSignup(input({ subdomain: 'held-co', adminEmail: 'two@held.example' }), client()))
    expect(taken.status).toBe(409)
    expect(taken.code).toBe('subdomain_taken')
    expect(await checkSubdomain('held-co')).toMatchObject({ available: false, reason: expect.stringMatching(/taken/) })

    expect((await apiError(startSignup(input({ subdomain: 'admin', adminEmail: fresh() }), client()))).status).toBe(422)
    expect((await checkSubdomain('admin')).reason).toMatch(/reserved/)
    expect((await apiError(startSignup(input({ subdomain: 'ab', adminEmail: fresh() }), client()))).status).toBe(422)
    expect((await apiError(startSignup(input({ subdomain: 'a'.repeat(31), adminEmail: fresh() }), client()))).status).toBe(422)
    expect((await apiError(startSignup(input({ subdomain: 'Bad_Name', adminEmail: fresh() }), client()))).status).toBe(422)
    expect((await apiError(startSignup(input({ subdomain: '-dash', adminEmail: fresh() }), client()))).status).toBe(422)
    expect((await checkSubdomain('a'.repeat(30))).available).toBe(true)
    expect((await checkSubdomain('abc')).available).toBe(true)
  })

  it('a pending reservation lapses when its code expires unverified', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-01T08:00:00Z'))
    await startSignup(input({ subdomain: 'lapse-co' }), client())
    expect((await checkSubdomain('lapse-co')).available).toBe(false)
    vi.setSystemTime(new Date('2026-05-01T08:16:00Z'))
    expect((await checkSubdomain('lapse-co')).available).toBe(true)
  })
})

describe('sign-up: validation', () => {
  it('validates every field', async () => {
    const code = async (over: Partial<SignupStartInput>) => (await apiError(startSignup(input({ adminEmail: fresh(), ...over }), client()))).code
    expect(await code({ companyName: 'X' })).toBe('invalid_company_name')
    expect(await code({ country: 'US' as never })).toBe('invalid_country')
    expect(await code({ language: 'ar' as never })).toBe('invalid_language')
    expect(await code({ adminName: '' })).toBe('invalid_admin_name')
    expect(await code({ adminEmail: 'not-an-email' })).toBe('invalid_email')
    expect(await code({ mobile: '+971 50 123 4567' })).toBe('invalid_mobile') // UAE number for an Egyptian workspace
    expect(await code({ password: 'short1' })).toBe('weak_password')
    expect(await code({ password: 'aaaaaaaaaaaa' })).toBe('weak_password')
    expect(await code({ password: 'password1234' })).toBe('weak_password')
    expect(await code({ acceptTerms: false })).toBe('terms_required')
    expect(pendingSignups).toHaveLength(0)
    // Mobile is validated for the chosen country.
    expect((await startSignup(input({ country: 'SA', mobile: '0551234567' }), client())).signupId).toBeTruthy()
  })
})

describe('sign-up: one email, one company', () => {
  it('rejects an email already used in Apex, in Crest or by a pending sign-up', async () => {
    for (const email of [apexEmail, crestEmail.toUpperCase()]) {
      const e = await apiError(startSignup(input({ adminEmail: email }), client()))
      expect(e.status).toBe(409)
      expect(e.message).toBe('This email already has an Apex CRM account. Sign in to your workspace instead.')
    }
    await startSignup(input({ adminEmail: 'dup@pending.example', subdomain: 'first-co' }), client())
    const e = await apiError(startSignup(input({ adminEmail: 'dup@pending.example', subdomain: 'second-co' }), client()))
    expect(e.status).toBe(409)
    expect(pendingSignups).toHaveLength(1)
  })

  it('re-checks email and subdomain at completion', async () => {
    const s = await verified()
    // Someone else got the email meanwhile (e.g. added as a user in another company).
    users.push({ ...users.find((u) => u.companyId === CREST_ID)!, id: 'u9999', email: 'admin@nimbus.example' })
    expect((await apiError(completeSignup(s.signupId, { plan: 'trial' }))).status).toBe(409)
    expect(companyBySubdomain('nimbus-trading')).toBeUndefined()
  })
})

describe('sign-up: abuse protection', () => {
  it('honeypot answers like a success but stores nothing', async () => {
    const before = JSON.stringify(takeSnapshot(true).stores)
    const r = await startSignup(input({ website: 'http://spam.example' }), client())
    expect(r.signupId).toBeTruthy()
    expect(r.devCode).toBeUndefined()
    expect(JSON.stringify(takeSnapshot(true).stores)).toBe(before)
    expect((await apiError(verifySignup(r.signupId, { code: '000000' }))).status).toBe(404)
  })

  it('rate limits starts per client and per email (429 with retry time)', async () => {
    const c = client()
    for (let i = 0; i < 5; i++) await startSignup(input({ adminEmail: `user${i}@rate.example`, subdomain: `rate-co-${i}` }), c)
    const e = await apiError(startSignup(input({ adminEmail: 'user9@rate.example', subdomain: 'rate-co-9' }), c))
    expect(e.status).toBe(429)
    expect(e.message).toMatch(/Try again in \d+ seconds/)

    // Same email from different clients.
    for (let i = 0; i < 5; i++) await startSignup(input({ adminEmail: 'same@rate.example', subdomain: `same-co-${i}` }), client()).catch(() => null)
    expect((await apiError(startSignup(input({ adminEmail: 'same@rate.example', subdomain: 'same-co-9' }), client()))).status).toBe(429)
  })

  it('rate limit window expires after 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-01T08:00:00Z'))
    const c = client()
    for (let i = 0; i < 5; i++) await startSignup(input({ adminName: '' }), c).catch(() => null)
    expect((await apiError(startSignup(input(), c))).status).toBe(429)
    vi.setSystemTime(new Date('2026-05-01T08:10:01Z'))
    expect((await startSignup(input(), c)).signupId).toBeTruthy()
  })

  it('resend has a 30 second cooldown and replaces the code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-01T08:00:00Z'))
    const s = await startSignup(input(), client())
    const e = await apiError(resendCode(s.signupId))
    expect(e.status).toBe(429)
    expect(e.code).toBe('resend_cooldown')
    vi.setSystemTime(new Date('2026-05-01T08:00:31Z'))
    const again = await resendCode(s.signupId)
    expect(again.resendInSeconds).toBe(30)
    if (again.devCode !== s.devCode) expect((await apiError(verifySignup(s.signupId, { code: s.devCode }))).status).toBe(422)
    expect((await verifySignup(s.signupId, { code: again.devCode })).verified).toBe(true)
  })

  it('wrong codes: 5 attempts, then the sign-up must restart', async () => {
    const s = await startSignup(input(), client())
    const wrong = s.devCode === '000000' ? '111111' : '000000'
    for (let i = 4; i >= 1; i--) {
      const e = await apiError(verifySignup(s.signupId, { code: wrong }))
      expect(e.status).toBe(422)
      expect(e.message).toContain(`${i} attempt`)
    }
    expect((await apiError(verifySignup(s.signupId, { code: wrong }))).status).toBe(429)
    expect((await apiError(verifySignup(s.signupId, { code: s.devCode }))).status).toBe(429)
    expect((await apiError(resendCode(s.signupId))).status).toBe(429)
    // The locked sign-up releases its email and address: start again.
    expect((await startSignup(input(), client())).signupId).not.toBe(s.signupId)
  })

  it('an expired code is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-01T08:00:00Z'))
    const s = await startSignup(input(), client())
    vi.setSystemTime(new Date('2026-05-01T08:15:01Z'))
    const e = await apiError(verifySignup(s.signupId, { code: s.devCode }))
    expect(e.status).toBe(422)
    expect(e.code).toBe('code_expired')
  })
})

describe('sign-up: atomic completion', () => {
  it.each(SIGNUP_STEPS)('a failure after "%s" rolls back everything', async (step) => {
    const s = await verified()
    const counts = () => ({
      companies: companies.length,
      users: users.length,
      memberships: memberships.length,
      departments: departments.length,
      subscriptions: subscriptions.length,
      templates: templates.length,
      auditLog: auditLog.length,
    })
    const before = counts()
    const db = JSON.stringify(takeSnapshot(true).stores)

    __signupFailAfter.step = step
    const e = await apiError(completeSignup(s.signupId, { plan: 'trial' }))
    expect(e.status).toBe(500)

    expect(counts()).toEqual(before)
    expect(JSON.stringify(takeSnapshot(true).stores)).toBe(db)
    expect(companyBySubdomain('nimbus-trading')).toBeUndefined()
    expect(users.some((u) => u.email === 'admin@nimbus.example')).toBe(false)
    expect(lookupsFor(APEX_ID).statuses.length).toBeGreaterThan(0)

    // The sign-up is intact: the same address and email can be completed once the fault is gone.
    __signupFailAfter.step = null
    const session = await completeSignup(s.signupId, { plan: 'trial' })
    expect(session.tenant.subdomain).toBe('nimbus-trading')
    expect(companies).toHaveLength(before.companies + 1)
  })
})

describe('onboarding', () => {
  it('computes the 6 items for Apex and Crest', async () => {
    const apexAdmin = users.find((u) => u.id === 'u1')!
    const apex = await getOnboarding(apexAdmin)
    expect(apex.items.map((i) => i.id)).toEqual(['profile', 'team', 'lists', 'services', 'leads', 'email'])
    expect(apex.items.find((i) => i.id === 'team')!.done).toBe(true)
    expect(apex.items.find((i) => i.id === 'services')!.done).toBe(true)
    expect(apex.items.find((i) => i.id === 'leads')!.done).toBe(true)
    expect(apex.items.find((i) => i.id === 'email')!.done).toBe(false)
    const crest = await getOnboarding(users.find((u) => u.id === 'u102')!)
    expect(crest.items.find((i) => i.id === 'profile')!.done).toBe(true)
  })

  it('manual items, email connection and dismissal are per company; Management reads only', async () => {
    const s = await verified()
    const session = await completeSignup(s.signupId, { plan: 'trial' })
    const admin = users.find((u) => u.id === session.user.id)!

    expect((await setOnboardingItem(admin, 'lists')).items.find((i) => i.id === 'lists')!.done).toBe(true)
    expect((await apiError(setOnboardingItem(admin, 'leads'))).status).toBe(422)
    expect((await apiError(setOnboardingItem(admin, 'nope'))).status).toBe(404)
    await connectEmail(admin, { provider: 'google', address: 'admin@nimbus.example' })
    const st = await getOnboarding(admin)
    expect(st.items.find((i) => i.id === 'email')!.done).toBe(true)
    expect(st.done).toBe(2)
    expect((await setOnboardingDismissed(admin, true)).dismissed).toBe(true)

    // Apex is untouched.
    const apex = await getOnboarding(users.find((u) => u.id === 'u1')!)
    expect(apex.dismissed).toBe(false)
    expect(apex.items.find((i) => i.id === 'lists')!.done).toBe(false)

    const management = users.find((u) => u.id === 'u2')!
    expect((await apiError(setOnboardingDismissed(management, true))).status).toBe(403)
    expect((await apiError(connectEmail(management, { provider: 'smtp', address: 'x@y.example' }))).status).toBe(403)
    expect((await getBillingOverview(management)).subscription.planId).toBe('enterprise')
    expect((await apiError(getBillingOverview(users.find((u) => u.id === 'u3')!))).status).toBe(403)
  })
})
