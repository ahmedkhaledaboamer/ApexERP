import type { CompanyStatus, CountryCode, PlatformRole, PlatformUser } from '@/modules/tenancy/types'
import type { Role } from '@/shared/types'
import type {
  BillingInvoice,
  BillingSubscription,
  LimitKey,
  Plan,
  PlanId,
  PlanModule,
  PlatformBillingSettings,
  SubscriptionStatus,
  Usage,
} from '@/modules/billing/types'

/**
 * Super-Admin Console contract (/platform). Platform staff are not company users: they sign in at
 * /platform/login with a platform token (kind 'platform'), which no company endpoint accepts, and
 * company tokens are refused by every /platform/* endpoint (401). Platform permissions are a
 * separate set (PLATFORM_PERMISSIONS in tenancy/types.ts), never mixed with company roles.
 *
 * Platform staff never see passwords or full card data: card = brand + last4 + expiry only.
 * Every platform write takes a `reason` and writes a PlatformAuditEntry; reads of a company's
 * data (company page, users, timeline) are also audited as `company.viewed`.
 */

/* ---------------- Permissions ---------------- */

/**
 * Owner: all. Support: tenants:view, support:impersonate, support:notes, audit:view.
 * Billing: tenants:view, billing:view, billing:manage, plans:manage.
 */
export type PlatformPermissionV2 =
  | 'tenants:view' //          company list, company page, overview (without revenue)
  | 'tenants:manage' //        suspend / reactivate / cancel, module overrides
  | 'tenants:subdomain' //     change a subdomain
  | 'billing:view' //          revenue (MRR, churn), invoices, billing history
  | 'billing:manage' //        change plan, extend trial
  | 'plans:manage' //          edit plans + platform settings
  | 'support:impersonate'
  | 'support:notes' //         internal support notes (write; view = tenants:view)
  | 'announcements:manage'
  | 'audit:view'

/* ---------------- Company list / page ---------------- */

export interface PlatformCompanyRow {
  id: string
  name: string
  subdomain: string
  country: CountryCode
  planId: PlanId
  planName: string
  /** Operator lock (Company.status) — 'suspended' here = blocked by the platform. */
  companyStatus: CompanyStatus
  subscriptionStatus: SubscriptionStatus
  users: number
  /** Latest sign-in or audited write in the company (ISO), null if none. */
  lastActivityAt: string | null
  createdAt: string
  /** Normalized monthly revenue (null without billing:view). */
  mrr: number | null
}

/** GET /platform/companies?status=&plan=&country=&q=&sort=&dir= */
export interface PlatformCompanyQuery {
  status?: SubscriptionStatus | 'locked'
  plan?: PlanId
  country?: CountryCode
  q?: string
  sort?: 'name' | 'createdAt' | 'lastActivityAt' | 'users' | 'mrr'
  dir?: 'asc' | 'desc'
}

/** A module the platform turned on/off for one company, overriding its plan. */
export interface ModuleOverride {
  module: PlanModule
  enabled: boolean
  reason: string
  by: string
  at: string
}

export interface CompanyModuleState {
  module: PlanModule
  /** In the plan. */
  inPlan: boolean
  /** Effective (plan ± override). */
  enabled: boolean
  override: ModuleOverride | null
}

export interface SupportNote {
  id: string
  companyId: string
  body: string
  authorId: string
  authorName: string
  at: string
}

export interface SubdomainAlias {
  subdomain: string
  /** Old address redirects to the current one until this time. */
  redirectUntil: string
  changedAt: string
  changedBy: string
}

/** GET /platform/companies/:id (audited as company.viewed) */
export interface PlatformCompanyDetail {
  company: PlatformCompanyRow & {
    legalName: string
    tradeName: string
    email: string
    phone: string
    website: string
    city: string
    currency: string
    timezone: string
  }
  /** Card shown masked only. */
  subscription: BillingSubscription
  plan: Plan
  usage: Usage
  /** Null without billing:view. */
  invoices: BillingInvoice[] | null
  usersCount: { active: number; total: number }
  modules: CompanyModuleState[]
  subdomainAliases: SubdomainAlias[]
}

export interface TimelineEvent {
  id: string
  at: string
  /** company = company audit log, platform = platform audit log, billing = lifecycle. */
  source: 'company' | 'platform' | 'billing'
  actor: string
  summary: string
}

/* ---------------- Actions (confirm + reason) ---------------- */

export type CompanyAction =
  | { action: 'change_plan'; planId: PlanId; reason: string } // billing:manage. Immediate, no charge (comp/manual), keeps the subscription.
  | { action: 'extend_trial'; days: number; reason: string } // billing:manage. Trialing only (1–90 days).
  | { action: 'suspend'; reason: string } // tenants:manage. Operator lock (Company.status 'suspended', full block).
  | { action: 'reactivate'; reason: string } // tenants:manage. Lifts the lock; a billing-suspended/cancelled subscription returns to active (new period, no charge).
  | { action: 'cancel'; reason: string } // tenants:manage. Subscription → cancelled now (retention countdown starts).

/** POST /platform/companies/:id/modules { module, enabled: boolean | null (null = remove override), reason } — tenants:manage */
export interface ModuleOverrideInput {
  module: PlanModule
  enabled: boolean | null
  reason: string
}

/** POST /platform/companies/:id/subdomain — tenants:subdomain */
export interface SubdomainChangeInput {
  subdomain: string
  reason: string
}

/** GET /platform/subdomains/check?subdomain=&companyId= */
export interface SubdomainCheck {
  subdomain: string
  available: boolean
  reason: string | null
}

/* ---------------- Overview ---------------- */

export interface CountBy {
  key: string
  label: string
  count: number
}

/** GET /platform/overview — tenants:view; revenue fields null without billing:view. */
export interface PlatformOverview {
  generatedAt: string
  totals: { companies: number; activeUsers: number }
  byStatus: CountBy[]
  byPlan: CountBy[]
  byCountry: CountBy[]
  mrr: number | null
  /** MRR per plan (null without billing:view). */
  mrrByPlan: CountBy[] | null
  currency: string
  /** New sign-ups per week, last 8 weeks (oldest first). */
  signups: { weekStart: string; count: number }[]
  signupsLast30Days: number
  trialsEndingSoon: { companyId: string; name: string; trialEndsAt: string; daysLeft: number }[]
  pastDue: { companyId: string; name: string; graceEndsAt: string | null; amountDue: number | null }[]
  /** Highest usage % across limits. */
  topUsage: { companyId: string; name: string; key: LimitKey; percent: number }[]
  /** Last 30 days: cancelled / companies active at the start, in percent. */
  churn: { cancelledLast30Days: number; ratePct: number }
}

/* ---------------- Plans (versioned) ---------------- */

/**
 * Plans are versioned. Editing price/limits/modules creates version N+1; subscribers keep the
 * version they're on (BillingSubscription.planVersion) unless the editor chooses to migrate them.
 * Plans are never deleted (deactivate instead). A migration never breaks a subscription: a
 * subscriber whose current usage exceeds the new limits is left on its version and reported.
 */
export type PlanMigration = 'keep' | 'at_renewal' | 'now'

export interface PlanVersionSummary {
  version: number
  createdAt: string
  createdBy: string
  price: number | null
  subscribers: number
}

export interface PlatformPlan extends Plan {
  version: number
  versions: PlanVersionSummary[]
  /** Companies on any version of this plan. */
  subscribers: number
}

/** PATCH /platform/plans/:id — plans:manage */
export interface PlanEditInput {
  name?: string
  price?: number | null
  billingPeriod?: Plan['billingPeriod']
  limits?: Partial<Plan['limits']>
  modules?: PlanModule[]
  highlights?: string[]
  active?: boolean
  migration: PlanMigration
  reason: string
}

export interface PlanEditResult {
  plan: PlatformPlan
  /** True when a new version was created (price/limits/modules changed). */
  newVersion: boolean
  migrated: number
  scheduled: number
  /** Left on their version because usage exceeds the new limits. */
  skipped: { companyId: string; name: string; reasons: string[] }[]
}

/** POST /platform/plans — create a new plan (plans:manage). */
export type PlanCreateInput = Omit<Plan, 'rank'> & { rank?: number; reason: string }

/** GET/PATCH /platform/settings — PlatformBillingSettings + console settings. PATCH requires plans:manage + reason. */
export interface PlatformSettings extends PlatformBillingSettings {
  /** Old subdomains keep redirecting this long after a change. */
  subdomainRedirectDays: number
  /** Impersonation session length. */
  impersonationMinutes: number
}

/* ---------------- Announcements ---------------- */

export type AnnouncementTone = 'info' | 'warning' | 'success'

export interface AnnouncementAudience {
  /** Empty = all plans. */
  plans: PlanId[]
  /** Empty = all countries. */
  countries: CountryCode[]
}

export interface Announcement {
  id: string
  title: string
  body: string
  tone: AnnouncementTone
  audience: AnnouncementAudience
  startsAt: string
  endsAt: string
  createdAt: string
  createdBy: string
  /** Platform list only: companies in the segment right now. */
  reach?: number
}

/** POST/PATCH /platform/announcements — announcements:manage; DELETE ends it (kept in the audit log). */
export type AnnouncementInput = Pick<Announcement, 'title' | 'body' | 'tone' | 'audience' | 'startsAt' | 'endsAt'> & { reason?: string }

/** Company app: GET /announcements → active, in-segment, not dismissed by this user. POST /announcements/:id/dismiss. */
export type CompanyAnnouncement = Pick<Announcement, 'id' | 'title' | 'body' | 'tone' | 'endsAt'>

/* ---------------- Platform audit log ---------------- */

export interface PlatformAuditEntry {
  id: string
  at: string
  actorId: string
  actorName: string
  actorRole: PlatformRole
  /** e.g. company.viewed, company.suspended, plan.updated, subdomain.changed, impersonation.started. */
  action: string
  companyId: string | null
  companyName: string | null
  summary: string
  before: unknown
  after: unknown
  reason: string | null
  /** Mocked client IP. */
  ip: string
}

/** GET /platform/audit?actor=&action=&companyId=&from=&to=&q= — audit:view */
export interface PlatformAuditQuery {
  actor?: string
  action?: string
  companyId?: string
  from?: string
  to?: string
  q?: string
}

/* ---------------- Impersonation ---------------- */

export type ImpersonationMode = 'read' | 'write'

/** POST /platform/impersonations { userId, reason } — support:impersonate (Owner, Support). Returns a company Session. */
export interface ImpersonationStartInput {
  userId: string
  /** Required, at least 10 characters. Shown to the company admin in their audit log. */
  reason: string
}

/**
 * Carried in Session.impersonation (extends tenancy ImpersonationInfo):
 * sessionId, reason, expiresAt, mode. Read-only by default; POST /auth/impersonation/write-mode
 * { confirm: true } switches to write mode (second confirmation) and returns a new Session.
 * Always blocked while impersonating (403 impersonation_blocked): password and 2FA changes,
 * billing and payment methods, deleting the company, exporting all data.
 * Expired (expiresAt passed) → 401 impersonation_expired, and the session is ended and audited.
 */
export interface ImpersonationDetails {
  sessionId: string
  reason: string
  expiresAt: string
  mode: ImpersonationMode
}

/* ---------------- Added by the mock server implementation ---------------- */

/** GET /platform/me — any platform token: who is signed in and what they may do. */
export interface PlatformMe {
  platformUser: PlatformUser
  permissions: PlatformPermissionV2[]
}

/** GET /platform/companies/:id/users — never any secret (no password, hash, 2FA secret or token). */
export interface PlatformCompanyUser {
  id: string
  name: string
  role: Role
  email: string
  active: boolean
  lastLoginAt: string | null
}

export type ImpersonationEndReason = 'ended' | 'expired'

/** Server-side impersonation session (one per POST /platform/impersonations). */
export interface ImpersonationSessionRecord {
  sessionId: string
  platformUserId: string
  platformUserName: string
  platformRole: PlatformRole
  companyId: string
  userId: string
  userName: string
  reason: string
  startedAt: string
  expiresAt: string
  mode: ImpersonationMode
  endedAt: string | null
  endReason: ImpersonationEndReason | null
  /** Mocked client IP of the operator who started it. */
  ip: string
}

/** POST /auth/impersonation/write-mode — impersonation token only; `confirm` must be true. */
export interface ImpersonationWriteModeInput {
  confirm: true
}
