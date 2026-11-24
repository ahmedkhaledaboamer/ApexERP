import type { User } from '@/shared/types'
import type { Company } from '@/modules/tenancy/types'
import type {
  CheckoutInput,
  CheckoutResult,
  ContactSalesInput,
  ContactSalesResult,
  SignupCompleted,
  SignupCompleteInput,
  SignupStarted,
  SignupStartInput,
  SignupStatus,
  SignupVerified,
  SubdomainAvailability,
} from '@/modules/signup/types'
import type { PaymentMethod, Plan } from '@/modules/billing/types'
import { DEFAULT_PALETTE } from '@/modules/tenancy/branding'
import { checkImageDataUrl } from '@/modules/settings/branding'
import { isCountryCode, regionalDefaults } from '@/modules/tenancy/regionDefaults'
import { monogramFor, subdomainProblem } from '@/modules/tenancy/subdomain'
import { ApiError } from '@/shared/lib/apiError'
import { formatMobile, mobileError, normalizeMobile } from '@/shared/lib/phone'
import { signupPasswordProblem } from '@/shared/lib/passwordStrength'
import { takeSnapshot, restoreSnapshot } from '@/shared/mocks/persist/registry'
import { users } from '@/shared/mocks/db'
import { addMembership, companies, companyBySubdomain } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { setPassword } from '@/shared/mocks/data/passwords'
import { recordAudit } from '@/shared/mocks/data/audit'
import { automationRulesFor, lookupsFor } from '@/shared/mocks/data/lookups'
import { targetDefaultsFor } from '@/shared/mocks/data/targets'
import { securityPolicyFor } from '@/shared/mocks/data/security'
import { seedDefaultTemplates } from '@/shared/mocks/data/templates'
import { rolesFor } from '@/shared/mocks/data/roles'
import { nextSubscriptionId } from '@/shared/mocks/data/subscriptions'
import { activePlans, enabledModulesOf, planById } from '@/shared/mocks/data/plans'
import { createSignupSubscription } from '@/shared/mocks/services/billing'
import { parseCard } from '@/shared/mocks/cards'
import {
  checkouts,
  contactSalesRequests,
  nextSignupSeq,
  pendingSignups,
  rateHits,
  type PendingSignup,
} from '@/shared/mocks/data/signups'
import { delay, tokenFor } from '@/shared/mocks/server'
import { CodedApiError } from '@/shared/mocks/tenant'
import { userWithEmail } from '@/shared/mocks/data/identity'
import { liveAliasOf } from '@/shared/mocks/data/platform'

/**
 * Self-service sign-up for Apex CRM (public, no auth). Multi-step:
 *   start (validate, nothing created, code "emailed") → verify code → [checkout for paid plans]
 *   → complete: ONE atomic action that creates the company and every default it needs, then
 *   signs the Company Admin in. If any step of completion fails, the whole mock DB is restored
 *   to the snapshot taken before it, so nothing is left half-created.
 */

/* ---------------- Rules ---------------- */

export const CODE_TTL_MINUTES = 15
export const RESEND_COOLDOWN_SECONDS = 30
export const MAX_CODE_ATTEMPTS = 5
export const START_LIMIT = 5
export const START_WINDOW_MINUTES = 10
/** A verified sign-up keeps its address and email reserved this long. */
const VERIFIED_HOLD_HOURS = 24

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const EMAIL_TAKEN = 'This email already has an Apex CRM account. Sign in to your workspace instead.'
const EMAIL_PENDING = 'A sign-up with this email is already in progress. Enter the code we sent, or try again in a few minutes.'
const SUBDOMAIN_TAKEN = 'That workspace address is taken. Choose another.'
const NOT_FOUND = 'This sign-up has expired or doesn’t exist. Start again.'

const err = (message: string, status: number, code: string) => new CodedApiError(message, status, code)

/** Steps of the atomic completion, in order. Tests can force a failure after any of them. */
export const SIGNUP_STEPS = [
  'company',
  'department',
  'admin',
  'membership',
  'password',
  'subscription',
  'roles',
  'lookups',
  'automationRules',
  'targets',
  'security',
  'templates',
  'audit',
] as const
export type SignupStep = (typeof SIGNUP_STEPS)[number]

/** Test-only failpoint: when `step` is set, completion throws right after that step. */
export const __signupFailAfter: { step: SignupStep | null } = { step: null }

function checkpoint(step: SignupStep): void {
  if (__signupFailAfter.step === step) throw new Error(`Failpoint after step "${step}"`)
}

/* ---------------- Helpers ---------------- */

const now = () => Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

/** Does this pending sign-up still hold its subdomain and email? */
function holds(p: PendingSignup, at = now()): boolean {
  if (p.consumed || p.locked) return false
  if (p.verified) return at - Date.parse(p.verifiedAt ?? p.createdAt) < VERIFIED_HOLD_HOURS * 3600_000
  return at < Date.parse(p.codeExpiresAt)
}

function emailInUse(email: string): boolean {
  return !!userWithEmail(email)
}

function pendingWithEmail(email: string, exceptId?: string): PendingSignup | undefined {
  return pendingSignups.find((p) => p.id !== exceptId && p.adminEmail === email && holds(p))
}

function pendingWithSubdomain(subdomain: string, exceptId?: string): PendingSignup | undefined {
  return pendingSignups.find((p) => p.id !== exceptId && p.subdomain === subdomain && holds(p))
}

/** A sign-up in progress currently holds this address (used by the platform subdomain change). */
export function subdomainHeldBySignup(subdomain: string): boolean {
  return !!pendingWithSubdomain(subdomain.trim().toLowerCase())
}

function subdomainCheck(raw: unknown, exceptSignupId?: string): SubdomainAvailability {
  const subdomain = String(raw ?? '').trim().toLowerCase()
  const problem = subdomainProblem(subdomain)
  if (problem) return { subdomain, available: false, reason: problem }
  if (companyBySubdomain(subdomain) || liveAliasOf(subdomain) || pendingWithSubdomain(subdomain, exceptSignupId)) {
    return { subdomain, available: false, reason: SUBDOMAIN_TAKEN }
  }
  return { subdomain, available: true, reason: null }
}

function newCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

/** Mocked rate limit: at most START_LIMIT hits per key in the window; throws 429 with the wait. */
function hitRateLimit(keys: string[]): void {
  const t = now()
  const windowMs = START_WINDOW_MINUTES * 60_000
  // Forget old hits.
  for (let i = rateHits.length - 1; i >= 0; i--) if (t - rateHits[i].at >= windowMs) rateHits.splice(i, 1)
  for (const key of keys) {
    const hits = rateHits.filter((h) => h.key === key)
    if (hits.length >= START_LIMIT) {
      const oldest = Math.min(...hits.map((h) => h.at))
      const retry = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000))
      throw err(`Too many sign-up attempts. Try again in ${retry} seconds.`, 429, 'rate_limited')
    }
  }
  for (const key of keys) rateHits.push({ key, at: t })
}

function pendingById(id: string): PendingSignup {
  const p = pendingSignups.find((x) => x.id === id)
  if (!p || p.consumed) throw err(NOT_FOUND, 404, 'signup_not_found')
  if (p.locked) throw err('Too many incorrect codes. Start the sign-up again.', 429, 'too_many_attempts')
  return p
}

function resendIn(p: PendingSignup): number {
  return Math.max(0, Math.ceil((Date.parse(p.codeSentAt) + RESEND_COOLDOWN_SECONDS * 1000 - now()) / 1000))
}

function started(p: PendingSignup): SignupStarted {
  return { signupId: p.id, email: p.adminEmail, resendInSeconds: resendIn(p), codeExpiresAt: p.codeExpiresAt, devCode: p.code }
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  let id = base
  for (let n = 2; taken(id); n++) id = `${base}_${n}`
  return id
}

function nextUserId(): string {
  // One global sequence: ids never collide across tenants.
  return `u${Math.max(0, ...users.map((u) => Number(u.id.replace(/\D/g, '')) || 0)) + 1}`
}

/* ---------------- Endpoints ---------------- */

/** GET /public/plans: the active plans (data, src/shared/mocks/data/plans.ts), by rank. */
export async function listPlans(): Promise<Plan[]> {
  return delay(activePlans())
}

/** GET /public/signup/availability?subdomain= */
export async function checkSubdomain(subdomain: unknown): Promise<SubdomainAvailability> {
  return delay(subdomainCheck(subdomain))
}

/**
 * POST /public/signup (start). Validates everything, holds the address and email, and "emails" a
 * 6-digit code. Nothing is created yet. `clientKey` is the rate-limit key (X-Client-Id header).
 */
export async function startSignup(input: Partial<SignupStartInput> | null, clientKey = 'anonymous'): Promise<SignupStarted> {
  await delay(null)
  const body = input ?? {}

  // Honeypot: answer like a success so bots learn nothing; store nothing, send nothing.
  if (String(body.website ?? '').trim() !== '') {
    return {
      signupId: `su_${Math.random().toString(36).slice(2, 10)}`,
      email: String(body.adminEmail ?? '').trim().toLowerCase(),
      resendInSeconds: RESEND_COOLDOWN_SECONDS,
      codeExpiresAt: iso(now() + CODE_TTL_MINUTES * 60_000),
    }
  }

  const adminEmail = String(body.adminEmail ?? '').trim().toLowerCase()
  hitRateLimit([`client:${clientKey || 'anonymous'}`, ...(EMAIL.test(adminEmail) ? [`email:${adminEmail}`] : [])])

  const companyName = String(body.companyName ?? '').trim()
  const subdomain = String(body.subdomain ?? '').trim().toLowerCase()
  const adminName = String(body.adminName ?? '').trim()
  const password = String(body.password ?? '')
  const country = body.country

  if (companyName.length < 2 || companyName.length > 80) throw err('Enter your company name (2–80 characters).', 422, 'invalid_company_name')
  const sub = subdomainCheck(subdomain)
  if (!sub.available) {
    throw err(sub.reason ?? SUBDOMAIN_TAKEN, sub.reason === SUBDOMAIN_TAKEN ? 409 : 422, sub.reason === SUBDOMAIN_TAKEN ? 'subdomain_taken' : 'invalid_subdomain')
  }
  if (!isCountryCode(country)) throw err('Choose your country.', 422, 'invalid_country')
  if (body.language !== undefined && body.language !== 'en') throw err('English is the only language available for now.', 422, 'invalid_language')
  if (adminName.length < 2 || adminName.length > 80) throw err('Enter your full name.', 422, 'invalid_admin_name')
  if (!EMAIL.test(adminEmail) || adminEmail.length > 120) throw err('Enter a valid work email.', 422, 'invalid_email')
  if (emailInUse(adminEmail)) throw err(EMAIL_TAKEN, 409, 'email_taken')
  if (pendingWithEmail(adminEmail)) throw err(EMAIL_PENDING, 409, 'email_pending')
  const mobile = normalizeMobile(String(body.mobile ?? ''), country)
  if (!mobile) throw err(mobileError(country), 422, 'invalid_mobile')
  const pw = signupPasswordProblem(password)
  if (pw) throw err(pw, 422, 'weak_password')
  if (body.acceptTerms !== true) throw err('Accept the terms of service to continue.', 422, 'terms_required')
  let logoUrl: string | null = null
  if (body.logo !== undefined && body.logo !== null && body.logo !== '') {
    const logo = checkImageDataUrl('logoLight', body.logo)
    if (!logo.ok) throw err(logo.message, 422, 'invalid_logo')
    logoUrl = logo.dataUrl
  }

  const t = now()
  const p: PendingSignup = {
    id: `su_${nextSignupSeq()}_${Math.random().toString(36).slice(2, 8)}`,
    companyName,
    subdomain,
    country,
    language: 'en',
    adminName,
    adminEmail,
    mobile,
    password,
    logoUrl,
    createdAt: iso(t),
    code: newCode(),
    codeSentAt: iso(t),
    codeExpiresAt: iso(t + CODE_TTL_MINUTES * 60_000),
    attempts: 0,
    locked: false,
    verified: false,
    verifiedAt: null,
    consumed: false,
    companyId: null,
  }
  pendingSignups.push(p)
  return structuredClone(started(p))
}

/** GET /public/signup/:id */
export async function getSignup(id: string): Promise<SignupStatus> {
  await delay(null)
  const p = pendingById(id)
  return structuredClone({
    signupId: p.id,
    email: p.adminEmail,
    companyName: p.companyName,
    subdomain: p.subdomain,
    country: p.country,
    verified: p.verified,
    paidCheckouts: checkouts.filter((c) => c.signupId === p.id && !c.usedByCompanyId).map((c) => ({ checkoutId: c.id, plan: c.plan })),
    resendInSeconds: resendIn(p),
    codeExpiresAt: p.codeExpiresAt,
  })
}

/** POST /public/signup/:id/resend: a new code (the old one stops working), after a 30 s cooldown. */
export async function resendCode(id: string): Promise<SignupStarted> {
  await delay(null)
  const p = pendingById(id)
  if (p.verified) throw err('Your email is already verified.', 409, 'already_verified')
  const wait = resendIn(p)
  if (wait > 0) throw err(`Wait ${wait} seconds before requesting a new code.`, 429, 'resend_cooldown')
  const t = now()
  p.code = newCode()
  p.codeSentAt = iso(t)
  p.codeExpiresAt = iso(t + CODE_TTL_MINUTES * 60_000)
  return structuredClone(started(p))
}

/** POST /public/signup/:id/verify { code } */
export async function verifySignup(id: string, body: { code?: unknown } | null): Promise<SignupVerified> {
  await delay(null)
  const p = pendingById(id)
  if (p.verified) return { signupId: p.id, verified: true }
  if (now() >= Date.parse(p.codeExpiresAt)) throw err('This code has expired. Request a new one.', 422, 'code_expired')
  const code = String(body?.code ?? '').replace(/\s/g, '')
  if (code !== p.code) {
    p.attempts++
    if (p.attempts >= MAX_CODE_ATTEMPTS) {
      p.locked = true
      throw err('Too many incorrect codes. Start the sign-up again.', 429, 'too_many_attempts')
    }
    const left = MAX_CODE_ATTEMPTS - p.attempts
    throw err(`That code isn’t right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, 422, 'invalid_code')
  }
  p.verified = true
  p.verifiedAt = iso(now())
  return { signupId: p.id, verified: true }
}

/**
 * POST /public/checkout (mocked payment). The sign-up must be verified. 4242 4242 4242 4242 (or
 * any other valid test number) succeeds; 4000 0000 0000 0002 is declined with 402.
 */
export async function checkout(input: Partial<CheckoutInput> | null): Promise<CheckoutResult> {
  await delay(null)
  const body = input ?? {}
  const p = pendingById(String(body.signupId ?? ''))
  if (!p.verified) throw err('Verify your email before paying.', 409, 'not_verified')
  const plan = typeof body.plan === 'string' ? planById(body.plan) : undefined
  if (!plan || !plan.active || plan.checkout !== 'payment') throw err('Choose a paid plan (Starter or Business) to pay by card.', 422, 'invalid_plan')
  const card = parseCard({ holder: body.cardholder, cardNumber: body.cardNumber, expiry: body.expiry, cvc: body.cvc }, new Date(now()))

  const record = {
    id: `chk_${nextSignupSeq()}_${Math.random().toString(36).slice(2, 8)}`,
    signupId: p.id,
    plan: plan.id,
    amount: plan.price ?? 0,
    currency: plan.currency,
    status: 'paid' as const,
    cardLast4: card.last4,
    cardholder: card.holder,
    cardBrand: card.brand,
    cardExpMonth: card.expMonth,
    cardExpYear: card.expYear,
    createdAt: iso(now()),
    usedByCompanyId: null,
  }
  checkouts.push(record)
  return { checkoutId: record.id, status: 'paid', amount: record.amount, currency: record.currency }
}

/** POST /public/contact-sales: Enterprise enquiries go to a platform list; no workspace is created. */
export async function contactSales(input: Partial<ContactSalesInput> | null): Promise<ContactSalesResult> {
  await delay(null)
  const body = input ?? {}
  const companyName = String(body.companyName ?? '').trim()
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const message = String(body.message ?? '').trim()
  if (companyName.length < 2 || companyName.length > 80) throw err('Enter your company name (2–80 characters).', 422, 'invalid_company_name')
  if (name.length < 2 || name.length > 80) throw err('Enter your full name.', 422, 'invalid_name')
  if (!EMAIL.test(email)) throw err('Enter a valid work email.', 422, 'invalid_email')
  if (!isCountryCode(body.country)) throw err('Choose your country.', 422, 'invalid_country')
  if (message.length > 2000) throw err('Keep the message under 2,000 characters.', 422, 'invalid_message')
  const row = { id: `CS-${nextSignupSeq()}`, companyName, name, email, country: body.country, message, createdAt: iso(now()), status: 'new' as const }
  contactSalesRequests.push(row)
  return { requestId: row.id, message: 'Thanks! Our sales team will contact you within one business day.' }
}

/**
 * POST /public/signup/:id/complete { plan, checkoutId? }: ONE atomic action. Creates the company,
 * root department, Company Admin (+ membership, password), subscription and every default
 * (roles, lookups, automation rules, targets, security policy, templates) plus an audit entry.
 * On any failure the whole mock DB is restored to the snapshot taken first: nothing is created.
 */
export async function completeSignup(id: string, input: Partial<SignupCompleteInput> | null): Promise<SignupCompleted> {
  await delay(null)
  const p = pendingById(id)
  if (!p.verified) throw err('Verify your email first.', 409, 'not_verified')
  const planId = input?.plan as unknown
  const plan = typeof planId === 'string' ? planById(planId) : undefined
  if (!plan || !plan.active) throw err('Choose a plan.', 422, 'invalid_plan')
  if (plan.checkout === 'contact') throw err(`${plan.name} is set up with our sales team. Contact sales to get started.`, 422, 'contact_sales')

  let checkoutRecord: (typeof checkouts)[number] | undefined
  if (plan.checkout === 'payment') {
    const checkoutId = String(input?.checkoutId ?? '')
    checkoutRecord = checkouts.find((c) => c.id === checkoutId && c.signupId === p.id)
    if (!checkoutRecord || checkoutRecord.plan !== plan.id || checkoutRecord.status !== 'paid' || checkoutRecord.usedByCompanyId) {
      throw err(`Pay for the ${plan.name} plan to continue.`, 402, 'checkout_required')
    }
  }

  // Trial: the paid plan to continue on when the trial ends (optional; changeable later in billing).
  let continuePlan: Plan | undefined
  if (input?.continuePlanId !== undefined && input?.continuePlanId !== null && plan.checkout === 'none') {
    const cp = typeof input.continuePlanId === 'string' ? planById(input.continuePlanId) : undefined
    if (!cp || !cp.active || cp.checkout !== 'payment') throw err('Choose an available paid plan to continue on after the trial.', 422, 'invalid_plan')
    continuePlan = cp
  }

  // Re-check: another workspace or account may have taken them since the sign-up started.
  if (subdomainProblem(p.subdomain)) throw err(subdomainProblem(p.subdomain)!, 422, 'invalid_subdomain')
  if (companyBySubdomain(p.subdomain) || liveAliasOf(p.subdomain) || pendingWithSubdomain(p.subdomain, p.id)) throw err(SUBDOMAIN_TAKEN, 409, 'subdomain_taken')
  if (emailInUse(p.adminEmail)) throw err(EMAIL_TAKEN, 409, 'email_taken')

  const snap = takeSnapshot(true)
  try {
    const card: PaymentMethod | null = checkoutRecord
      ? {
          brand: checkoutRecord.cardBrand,
          last4: checkoutRecord.cardLast4,
          expMonth: checkoutRecord.cardExpMonth,
          expYear: checkoutRecord.cardExpYear,
          holder: checkoutRecord.cardholder,
        }
      : null
    const result = createWorkspace(p, plan, card, continuePlan?.id ?? null)
    p.consumed = true
    p.companyId = result.tenant.id
    p.password = ''
    if (checkoutRecord) checkoutRecord.usedByCompanyId = result.tenant.id
    return structuredClone(result)
  } catch (e) {
    restoreSnapshot(snap)
    if (e instanceof ApiError) throw e
    throw err('We couldn’t create your workspace. Nothing was saved; please try again.', 500, 'signup_failed')
  }
}

/** Synchronous on purpose: no other request can interleave between the snapshot and the commit. */
function createWorkspace(p: PendingSignup, plan: Plan, card: PaymentMethod | null, continuePlanId: string | null = null): SignupCompleted {
  const t = now()
  const at = iso(t)
  const trial = plan.checkout === 'none'
  const mobile = formatMobile(p.mobile, p.country)

  const companyId = uniqueId(`co_${p.subdomain.replace(/-/g, '_')}`, (cid) => companies.some((c) => c.id === cid))
  const company: Company = {
    id: companyId,
    name: p.companyName,
    subdomain: p.subdomain,
    status: trial ? 'trial' : 'active',
    plan: plan.id,
    enabledModules: enabledModulesOf(plan),
    regional: regionalDefaults(p.country),
    branding: {
      displayName: p.companyName,
      logoUrl: p.logoUrl ?? null,
      monogram: monogramFor(p.companyName),
      palette: { ...DEFAULT_PALETTE },
      emailSenderName: p.companyName,
      emailSenderAddress: p.adminEmail,
    },
    profile: {
      legalName: p.companyName,
      tradeName: p.companyName,
      address: { line1: '', line2: '', city: '', region: '', country: p.country },
      location: null,
      taxNumber: '',
      commercialLicenseNo: '',
      phone: mobile,
      email: p.adminEmail,
      website: '',
      bank: null,
    },
    createdAt: at,
  }
  companies.push(company)
  checkpoint('company')

  const userId = nextUserId()
  const departmentId = uniqueId(`d-${p.subdomain}-company`, (did) => departments.some((d) => d.id === did))
  departments.push({
    id: departmentId,
    companyId,
    name: p.companyName,
    headId: userId,
    parentId: null,
    goals: [],
    costCenter: '',
    active: true,
    createdAt: at,
    updatedAt: at,
  })
  checkpoint('department')

  const admin: User = {
    id: userId,
    companyId,
    name: p.adminName,
    email: p.adminEmail,
    mobile,
    role: 'Company Admin',
    title: 'Administrator',
    departmentId,
    managerId: null,
    active: true,
    twoFactorEnabled: false,
    lastLoginAt: at,
    createdAt: at,
  }
  users.push(admin)
  checkpoint('admin')

  addMembership(userId, companyId, 'Company Admin')
  checkpoint('membership')

  setPassword(userId, p.password)
  checkpoint('password')

  // Billing subscription: trial (trialEndsAt from the platform settings, no card) or paid (active,
  // the checkout's card saved, first invoice paid).
  const subscription = createSignupSubscription(companyId, nextSubscriptionId(), plan, card, continuePlanId)
  checkpoint('subscription')

  // Product defaults, created eagerly (the same for every new company).
  rolesFor(companyId)
  checkpoint('roles')
  lookupsFor(companyId)
  checkpoint('lookups')
  automationRulesFor(companyId)
  checkpoint('automationRules')
  targetDefaultsFor(companyId)
  checkpoint('targets')
  securityPolicyFor(companyId)
  checkpoint('security')
  seedDefaultTemplates(companyId)
  checkpoint('templates')

  recordAudit(admin, {
    action: 'create',
    entity: 'company',
    entityId: companyId,
    summary: `Created the workspace ${p.companyName} (${p.subdomain}) on the ${plan.name} plan`,
  })
  checkpoint('audit')

  const { companyId: _omit, ...sub } = subscription
  void _omit
  return { token: tokenFor(admin), user: admin, tenant: company, impersonation: null, subscription: sub }
}
