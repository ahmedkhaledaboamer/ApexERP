import type { ContactSalesInput, PlanId } from '@/modules/signup/types'
import type { CountryCode } from '@/modules/tenancy/types'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * Platform-level (not tenant-owned) state of the public sign-up flow: pending sign-ups, mocked
 * checkouts, contact-sales requests and rate-limit hits. Nothing here belongs to a company until
 * POST /public/signup/:id/complete creates it.
 */

export interface PendingSignup {
  id: string
  companyName: string
  subdomain: string
  country: CountryCode
  language: 'en'
  adminName: string
  /** Lower-cased. */
  adminEmail: string
  /** Normalized (+<dial><local>). */
  mobile: string
  /** Mock only; a real backend stores a hash. */
  password: string
  createdAt: string
  code: string
  codeSentAt: string
  codeExpiresAt: string
  /** Wrong codes entered so far (all codes of this sign-up). */
  attempts: number
  /** Too many wrong codes: the sign-up must be started again. */
  locked: boolean
  verified: boolean
  verifiedAt: string | null
  /** Completed: the workspace exists. */
  consumed: boolean
  companyId: string | null
}

export interface CheckoutRecord {
  id: string
  signupId: string
  /** A plan with `checkout: 'payment'`. */
  plan: PlanId
  amount: number
  currency: string
  status: 'paid'
  cardLast4: string
  cardholder: string
  /** The card, saved as the new subscription's payment method. */
  cardBrand: 'visa' | 'mastercard'
  cardExpMonth: number
  cardExpYear: number
  createdAt: string
  /** Set when a workspace was created with it (a checkout pays for one workspace). */
  usedByCompanyId: string | null
}

export interface ContactSalesRequest extends ContactSalesInput {
  id: string
  createdAt: string
  status: 'new'
}

export interface RateHit {
  key: string
  at: number
}

export const pendingSignups: PendingSignup[] = registerArray('signup.pending', [])
export const checkouts: CheckoutRecord[] = registerArray('signup.checkouts', [])
/** Platform list (sales team), not visible to any company. */
export const contactSalesRequests: ContactSalesRequest[] = registerArray('platform.contactSales', [])
export const rateHits: RateHit[] = registerArray('signup.rateHits', [])

let seq = 1
registerValue('signup.seq', () => seq, (v) => { seq = v })

export function nextSignupSeq(): number {
  return seq++
}
