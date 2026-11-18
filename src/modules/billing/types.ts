import type { ModuleKey } from '@/shared/types'

/**
 * Plans, limits and the subscription lifecycle (contract shared by the mock API and the UI).
 *
 * - Plans are DATA (served by the API, editable later by the Super-Admin console). Components never
 *   import a plan catalog; they read GET /public/plans or GET /billing/overview.
 * - Every row below is scoped by company on the server (Tenant<T>); the client never sends a company id.
 * - Money is in the plan currency (USD) as a number with 2 decimals.
 */

/* ---------------- Plans ---------------- */

/** Plan ids are open strings (new plans can be added as data); these four are seeded. */
export type PlanId = string
export const SEEDED_PLAN_IDS = ['trial', 'starter', 'business', 'enterprise'] as const

/**
 * What a plan can switch on. Role-permission modules (ModuleKey) plus product areas that have no
 * role permission of their own. Gating = plan includes it (this file) AND role can view it (PERMISSION_MATRIX).
 */
export type PlanModule = ModuleKey | 'events' | 'integrations' | 'ai'

/** Modules that can be locked by plan (the rest — sales, settings, reports … — are in every plan). */
export const GATEABLE_MODULES: PlanModule[] = ['hr', 'events', 'marketing', 'accounting', 'integrations', 'ai']

export type LimitKey = 'users' | 'leadsContacts' | 'storageMb' | 'emailsPerMonth' | 'aiCredits'

/** null = unlimited. */
export type PlanLimits = Record<LimitKey, number | null>

/** Limits that count what exists now (never reset); the others are per billing period and reset on renewal. */
export const STOCK_LIMITS: LimitKey[] = ['users', 'leadsContacts', 'storageMb']
export const PERIOD_LIMITS: LimitKey[] = ['emailsPerMonth', 'aiCredits']

export type BillingPeriod = 'month' | 'year'

export interface Plan {
  id: PlanId
  name: string
  /** Price per billing period; null = free (Trial) or "contact us" (Enterprise). */
  price: number | null
  currency: string
  billingPeriod: BillingPeriod
  limits: PlanLimits
  modules: PlanModule[]
  highlights: string[]
  /** How the plan is started: free (trial), card payment, or contact sales. */
  checkout: 'none' | 'payment' | 'contact'
  /** Inactive plans are not offered to new sign-ups or changes; existing subscribers keep them. */
  active: boolean
  /** Order on comparison screens (low → high). Upgrade/downgrade is decided by this rank. */
  rank: number
  /**
   * Current version of the plan (always set by the server). Editing price / billing period / limits /
   * modules in the Super-Admin console creates version N+1; subscribers keep their own version
   * (BillingSubscription.planVersion) and see that version's price, limits and modules.
   */
  version?: number
}

/* ---------------- Platform settings (not constants in code) ---------------- */

export interface PlatformBillingSettings {
  trialDays: number
  /** Days before trial end on which the admin gets a reminder (e.g. [7, 3, 1]). */
  trialReminderDays: number[]
  /** Past due: access continues this many days after the failed renewal, then Suspended. */
  graceDays: number
  /** Days after the failed renewal on which a payment reminder is sent (e.g. [1, 3, 6]). */
  pastDueReminderDays: number[]
  /** Suspended this long without payment → Cancelled. */
  suspendedDaysBeforeCancel: number
  /** Cancelled data is kept this long (export available), then Deleted. */
  retentionDays: number
  /** Usage warning thresholds in percent (e.g. [80, 100]). */
  usageWarningThresholds: number[]
}

/* ---------------- Subscription ---------------- */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'deleted'

export interface PaymentMethod {
  brand: 'visa' | 'mastercard'
  last4: string
  expMonth: number
  expYear: number
  holder: string
}

export interface ScheduledChange {
  toPlan: PlanId
  /** = current period end. */
  effectiveAt: string
  requestedAt: string
  requestedBy: string
}

export interface BillingSubscription {
  id: string
  planId: PlanId
  status: SubscriptionStatus
  startedAt: string
  /** Trial only. */
  trialEndsAt: string | null
  currentPeriodStart: string
  /** Renewal date (next charge). */
  currentPeriodEnd: string
  paymentMethod: PaymentMethod | null
  /** Downgrade waiting for the end of the period. */
  scheduledChange: ScheduledChange | null
  /** Admin asked to cancel: becomes Cancelled at period end (can be undone until then). */
  cancelAtPeriodEnd: boolean
  /** When the current status started (drives grace / retention countdowns). */
  statusChangedAt: string
  /** Past due: access ends (→ Suspended) at this time. */
  graceEndsAt: string | null
  /** Cancelled: data is deleted at this time. */
  deleteAt: string | null
  /** Negotiated price per period (Enterprise); null = the plan's price. (added by the mock server) */
  customPrice: number | null
  /** The plan version this subscription is on (price, limits, modules come from it). */
  planVersion: number
  /** A newer version of the same plan applied at the next renewal (platform plan edit with migration 'at_renewal'). */
  pendingPlanVersion: number | null
  /**
   * Trial only: the paid plan the company chose at sign-up / in billing (POST /billing/trial-plan). The trial
   * converts to it when it ends with a card on file; null (or inactive) = the lowest-ranked active paid plan.
   */
  selectedPlanId: PlanId | null
}

/** POST /billing/trial-plan { planId } — Company Admin, trialing only: the plan the trial converts to. */
export interface TrialPlanInput {
  planId: PlanId
}

/* ---------------- Usage ---------------- */

export interface UsageItem {
  key: LimitKey
  label: string
  used: number
  /** null = unlimited. */
  limit: number | null
  /** 0–100+, null when unlimited. */
  percent: number | null
  /** Per-period counters reset on renewal; stock counters don't. */
  resets: boolean
  unit: 'count' | 'MB'
}

export interface Usage {
  periodStart: string
  periodEnd: string
  items: UsageItem[]
}

/* ---------------- Platform invoices (mocked) ---------------- */

export type InvoiceStatus = 'paid' | 'open' | 'failed' | 'void'

export interface BillingInvoice {
  id: string
  number: string
  issuedAt: string
  periodStart: string
  periodEnd: string
  planId: PlanId
  description: string
  amount: number
  currency: string
  status: InvoiceStatus
}

/* ---------------- Endpoints ---------------- */

/** GET /billing/entitlements — any signed-in user (drives gating everywhere in the UI). */
export interface Entitlements {
  planId: PlanId
  planName: string
  status: SubscriptionStatus
  modules: PlanModule[]
  limits: PlanLimits
  /** Limits currently at or over 100% (create/invite/import/send for them is rejected). */
  reached: LimitKey[]
  /** Suspended or Cancelled: every create/edit/delete is rejected by the API. */
  readOnly: boolean
  /** Days left in the trial (trialing only). */
  trialDaysLeft: number | null
  /** Past due only: when access becomes read-only. */
  graceEndsAt: string | null
  /** Cancelled only: when the data is deleted. */
  deleteAt: string | null
  /** The server's clock (ISO). Count days from this, not the browser clock (the dev simulator moves it). */
  serverNow: string
}

/** GET /billing/overview — Company Admin and Management (Management read-only). */
export interface BillingOverview {
  subscription: BillingSubscription
  plan: Plan
  usage: Usage
  invoices: BillingInvoice[]
  /** Active plans to compare (+ the current one even if inactive). */
  plans: Plan[]
  settings: PlatformBillingSettings
  /** The server's clock (ISO); see Entitlements.serverNow. */
  serverNow: string
}

/** POST /billing/change-plan { planId } — Company Admin. */
export interface ChangePlanInput {
  planId: PlanId
}
export interface ChangePlanResult {
  kind: 'upgraded' | 'scheduled'
  overview: BillingOverview
  /** Upgrade: the (mocked, prorated) invoice charged now. */
  invoice: BillingInvoice | null
}

/** 409 `downgrade_blocked` body: why the downgrade can't be scheduled. */
export interface DowngradeBlock {
  key: LimitKey
  label: string
  used: number
  limit: number
}

/** 402 `LIMIT_REACHED` body (in addition to message and code). Typed so every UI shows the same prompt. */
export interface LimitReachedDetails {
  code: 'LIMIT_REACHED'
  limit: LimitKey
  current: number
  max: number
  planId: PlanId
}

/** 403 `module_not_in_plan` body. */
export interface ModuleLockedDetails {
  code: 'module_not_in_plan'
  module: PlanModule
  planId: PlanId
}

/** 423 `workspace_read_only` body: Suspended / Cancelled. */
export interface ReadOnlyDetails {
  code: 'workspace_read_only'
  status: SubscriptionStatus
}

/** POST /billing/payment-method { cardNumber, holder, expiry, cvc } (mock cards as in sign-up). */
export interface PaymentMethodInput {
  holder: string
  cardNumber: string
  expiry: string
  cvc: string
}

/** GET /billing/export — Cancelled (and any admin): the company's data as JSON (mocked download). */
export interface DataExport {
  generatedAt: string
  company: { name: string; subdomain: string }
  counts: Record<string, number>
  /** Collection name → rows (leads, contacts, customers, tasks, projects, quotations, users). */
  data: Record<string, unknown[]>
}

/* ---------------- Dev-only simulation (/dev/billing/*, registered only in dev) ---------------- */

export interface DevBillingState {
  /** Simulated clock: now = real now + offsetDays. */
  offsetDays: number
  now: string
  /** The next renewal charge fails (then resets). */
  failNextPayment: boolean
}

/** POST /dev/billing/usage { key, percent } sets a simulated usage level for one limit. */
export interface DevUsageInput {
  key: LimitKey
  /** Target percent of the limit (0–120). */
  percent: number
}

/* ---------------- Added by the mock server implementation ---------------- */

/** 409 `downgrade_blocked` body (in addition to message and code). */
export interface DowngradeBlockedDetails {
  code: 'downgrade_blocked'
  blocks: DowngradeBlock[]
}

/** POST /ai/credits/consume { credits } — the single consumer of AI credits (module `ai`). */
export interface AiCreditsInput {
  credits: number
}
export interface AiCreditsResult {
  used: number
  /** null = unlimited. */
  limit: number | null
  /** null = unlimited. */
  remaining: number | null
}

/** GET /dev/billing/state (dev only): DevBillingState plus the caller's company subscription and simulation. */
export interface DevBillingStateDetails extends DevBillingState {
  subscription: BillingSubscription
  /** Simulated usage offsets per limit (added to the real count). */
  simulated: Partial<Record<LimitKey, number>>
}

