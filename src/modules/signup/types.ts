import type { ModuleKey, Role, Scope, Session } from '@/shared/types'
import type { CountryCode } from '@/modules/tenancy/types'
import type { BillingSubscription, PlanId } from '@/modules/billing/types'

export type { PlanId, SubscriptionStatus } from '@/modules/billing/types'

/**
 * Self-service sign-up contract (public endpoints, no auth). Flow:
 *   1. GET  /public/signup/availability?subdomain=  live check while typing
 *   2. POST /public/signup                         validate + start (pending, nothing created) → code emailed
 *   3. POST /public/signup/:id/resend              new code, cooldown
 *   4. POST /public/signup/:id/verify              { code }
 *   5. GET  /public/plans                          plan cards (billing `Plan[]`, active plans only)
 *   6. POST /public/checkout                       mocked payment for paid plans → checkoutId
 *   7. POST /public/signup/:id/complete            { plan, checkoutId? } → ONE atomic action creates
 *      everything and returns a Session
 *   Enterprise: POST /public/contact-sales (no workspace is created).
 */

export type LanguageCode = 'en'

export interface SignupStartInput {
  companyName: string
  subdomain: string
  country: CountryCode
  language: LanguageCode
  adminName: string
  adminEmail: string
  /** Validated for the chosen country. */
  mobile: string
  password: string
  acceptTerms: boolean
  /**
   * Optional company logo (light mode) as an image data URL, checked with the same rules as
   * Settings › Branding; null for none (the monogram shows). Becomes branding.logoUrl.
   */
  logo?: string | null
  /** Honeypot: hidden from people; bots fill it. Must be empty. */
  website?: string
}

export interface SignupStarted {
  signupId: string
  email: string
  /** Seconds until "Resend code" is allowed. */
  resendInSeconds: number
  /** When the code stops working (ISO). */
  codeExpiresAt: string
  /** Mock only: the code that was "emailed", so the demo can be completed. Never sent by a real backend. */
  devCode?: string
}

export interface SubdomainAvailability {
  subdomain: string
  available: boolean
  /** Why not (format, reserved, taken). */
  reason: string | null
}

export interface CheckoutInput {
  signupId: string
  /** A plan with `checkout: 'payment'` (Starter, Business). */
  plan: PlanId
  cardholder: string
  /** Mock card: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined. */
  cardNumber: string
  expiry: string
  cvc: string
}

export interface CheckoutResult {
  checkoutId: string
  status: 'paid'
  amount: number
  currency: string
}

export interface SignupCompleteInput {
  /** `trial` or a paid plan; `enterprise` (contact) answers 422 contact_sales. */
  plan: PlanId
  /** Required for paid plans. */
  checkoutId?: string
  /**
   * Plan `trial` only (optional): the paid plan to continue on when the trial ends (active, `checkout:
   * 'payment'`; otherwise 422 invalid_plan). Stored as `subscription.selectedPlanId`.
   */
  continuePlanId?: PlanId
}

/** The company's subscription (billing model, src/modules/billing/types.ts). */
export type Subscription = BillingSubscription

export type SignupCompleted = Session & { subscription: Subscription }

export interface ContactSalesInput {
  companyName: string
  name: string
  email: string
  country: CountryCode
  message?: string
}

/* ---------------- Onboarding (new Company Admin) ---------------- */

export type OnboardingItemId = 'profile' | 'team' | 'lists' | 'services' | 'leads' | 'email'

export interface OnboardingItem {
  id: OnboardingItemId
  title: string
  description: string
  /** In-app link to do it. */
  href: string
  done: boolean
  /** Items without a data signal (review lists & rules, connect email) are marked done explicitly. */
  manual: boolean
}

/** Progress is stored per company (server), so every admin of the company sees the same state. */
export interface OnboardingState {
  items: OnboardingItem[]
  done: number
  total: number
  complete: boolean
  dismissed: boolean
}

/* ---------------- Added by the server implementation (agent S) ---------------- */

/** GET /public/signup/:id → where a pending sign-up stands (lets the client resume after a reload). */
export interface SignupStatus {
  signupId: string
  email: string
  companyName: string
  subdomain: string
  country: CountryCode
  verified: boolean
  /** Checkouts paid for this sign-up (paid plans). */
  paidCheckouts: { checkoutId: string; plan: PlanId }[]
  resendInSeconds: number
  codeExpiresAt: string
}

/** POST /public/signup/:id/verify */
export interface SignupVerified {
  signupId: string
  verified: true
}

/** POST /public/contact-sales */
export interface ContactSalesResult {
  requestId: string
  /** Confirmation sentence to show. */
  message: string
}

/** GET /settings/roles: the company's roles (the 9 default roles with their permission matrix), read-only for now. */
export interface CompanyRoleDefinition {
  id: Role
  name: Role
  /** Built-in role (can't be deleted). */
  system: boolean
  permissions: Record<ModuleKey, Scope>
}

export type EmailProvider = 'google' | 'microsoft' | 'smtp'

/** GET/POST /settings/email-connection (mocked: nothing is really connected). */
export interface EmailConnection {
  provider: EmailProvider
  address: string
  connectedAt: string
  connectedBy: string
}

