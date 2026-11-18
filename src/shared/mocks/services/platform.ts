import { startOfWeek, subDays } from 'date-fns'
import type { ModuleKey, User } from '@/shared/types'
import type { BillingPeriod, LimitKey, Plan, PlanLimits, PlanModule, PlatformBillingSettings, SubscriptionStatus } from '@/modules/billing/types'
import { GATEABLE_MODULES } from '@/modules/billing/types'
import type { Company, CountryCode } from '@/modules/tenancy/types'
import { PLATFORM_PERMISSIONS, canPlatform } from '@/modules/tenancy/types'
import type {
  Announcement,
  AnnouncementInput,
  CompanyAnnouncement,
  CompanyModuleState,
  CountBy,
  ModuleOverrideInput,
  PlanCreateInput,
  PlanEditInput,
  PlanEditResult,
  PlanMigration,
  PlatformAuditEntry,
  PlatformAuditQuery,
  PlatformCompanyDetail,
  PlatformCompanyQuery,
  PlatformCompanyRow,
  PlatformCompanyUser,
  PlatformMe,
  PlatformOverview,
  PlatformPermissionV2,
  PlatformPlan,
  PlatformSettings,
  SubdomainAlias,
  SubdomainChangeInput,
  SubdomainCheck,
  SupportNote,
  TimelineEvent,
} from '@/modules/platform/types'
import { isCountryCode } from '@/modules/tenancy/regionDefaults'
import { subdomainProblem } from '@/modules/tenancy/subdomain'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { auditLog, recordActorAudit } from '@/shared/mocks/data/audit'
import { companies, companyById, companyBySubdomain } from '@/shared/mocks/data/tenancy'
import { billingInvoices, subscriptionOf, subscriptions } from '@/shared/mocks/data/subscriptions'
import { billingSettings, planById, planVersions, plans } from '@/shared/mocks/data/plans'
import {
  announcementDismissals,
  announcements,
  consoleSettings,
  liveAliasOf,
  liveAliasesOfCompany,
  moduleOverrides,
  nextPlatformId,
  overridesOf,
  platformAudit,
  subdomainAliases,
  supportNotes,
} from '@/shared/mocks/data/platform'
import {
  amountDueOf,
  companyModules,
  migrateToVersionNow,
  monthlyRevenueOf,
  notifyAdmins,
  platformCancel,
  platformChangePlan,
  platformExtendTrial,
  platformReactivateSubscription,
  publicInvoice,
  publicSub,
  runLifecycle,
  runLifecycleForAll,
  scheduleVersionAtRenewal,
  subOf,
  subPlan,
  syncCompanyMirror,
  usageOf,
  validatedBillingSettings,
  wholeSetting,
} from '@/shared/mocks/services/billing'
import { subdomainHeldBySignup } from '@/shared/mocks/services/signup'
import { platformActor, recordPlatformAudit, type PlatformCtx } from '@/shared/mocks/services/platformAudit'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf } from '@/shared/mocks/tenant'

/**
 * Super-Admin Console (contract: src/modules/platform/types.ts, docs/API.md "Super-Admin Console").
 * Every function takes the PlatformCtx returned by requirePlatform (handlers/utils.ts), which has
 * already checked the token and the endpoint's permission. Rules enforced here:
 *   - every write takes a reason (≥ 5 characters; impersonation ≥ 10) and writes a platform audit entry
 *     (before / after / reason / mocked IP); writes that affect a company also go to its own audit log
 *     and notify its Company Admins;
 *   - reads of one company's data (page, users, timeline) are audited as `company.viewed`;
 *   - no response carries a password, hash, 2FA secret or full card number (card = brand, last 4, expiry, holder);
 *   - revenue (MRR, invoices) only with billing:view.
 */

const DAY = 86_400_000
const MIN_REASON = 5
const iso = (ms: number) => new Date(ms).toISOString()
const round2 = (n: number) => Math.round(n * 100) / 100
const err = (message: string, status: number, code: string, details: Record<string, unknown> = {}) =>
  new CodedApiError(message, status, code, details)

const can = (ctx: PlatformCtx, p: PlatformPermissionV2) => canPlatform(ctx.user.platformRole, p)

function requireReason(reason: unknown, min = MIN_REASON): string {
  const r = String(reason ?? '').trim()
  if (r.length < min) throw err(`Give a reason of at least ${min} characters (it is kept in the audit log).`, 422, 'reason_required', { min })
  return r
}

function companyOr404(id: string): Company {
  const company = companyById(String(id ?? ''))
  if (!company) throw err('Company not found.', 404, 'company_not_found')
  return company
}

const STATUS_LABEL: Record<SubscriptionStatus | 'locked', string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
  locked: 'Locked by Apex CRM',
}

const MODULE_KEYS: ModuleKey[] = ['sales', 'services', 'marketing', 'accounting', 'hr', 'reports', 'settings', 'departments', 'tasks']
const ALL_PLAN_MODULES: PlanModule[] = [...MODULE_KEYS, 'events', 'integrations', 'ai']
const LIMIT_KEYS: LimitKey[] = ['users', 'leadsContacts', 'storageMb', 'emailsPerMonth', 'aiCredits']
const MODULE_LABEL: Record<string, string> = {
  hr: 'HR',
  events: 'Events',
  marketing: 'Marketing',
  accounting: 'Accounting',
  integrations: 'Integrations',
  ai: 'AI',
}

/* ---------------- Me ---------------- */

/** GET /platform/me */
export async function getMe(ctx: PlatformCtx): Promise<PlatformMe> {
  return delay({ platformUser: ctx.user, permissions: [...PLATFORM_PERMISSIONS[ctx.user.platformRole]] })
}

/* ---------------- Companies ---------------- */

function lastActivityOf(companyId: string): string | null {
  let latest: string | null = null
  for (const u of users) if (u.companyId === companyId && u.lastLoginAt && (!latest || u.lastLoginAt > latest)) latest = u.lastLoginAt
  const entry = auditLog.find((a) => a.companyId === companyId && a.userId !== 'system' && !a.userId.startsWith('platform:'))
  if (entry && (!latest || entry.at > latest)) latest = entry.at
  return latest
}

function rowOf(ctx: PlatformCtx, company: Company): PlatformCompanyRow {
  const sub = subOf(company.id)
  const plan = subPlan(sub)
  return {
    id: company.id,
    name: company.name,
    subdomain: company.subdomain,
    country: company.regional.country,
    planId: plan.id,
    planName: plan.name,
    companyStatus: company.status,
    subscriptionStatus: sub.status,
    users: users.filter((u) => u.companyId === company.id && u.active).length,
    lastActivityAt: lastActivityOf(company.id),
    createdAt: company.createdAt,
    mrr: can(ctx, 'billing:view') ? monthlyRevenueOf(sub) : null,
  }
}

/** GET /platform/companies — tenants:view. Filters: status (subscription status or 'locked'), plan, country, q; sort + dir. */
export async function listCompanies(ctx: PlatformCtx, query: PlatformCompanyQuery): Promise<PlatformCompanyRow[]> {
  runLifecycleForAll()
  const q = String(query.q ?? '').trim().toLowerCase()
  let rows = companies.map((c) => rowOf(ctx, c))
  if (query.status === 'locked') rows = rows.filter((r) => r.companyStatus === 'suspended')
  else if (query.status) rows = rows.filter((r) => r.subscriptionStatus === query.status)
  if (query.plan) rows = rows.filter((r) => r.planId === query.plan)
  if (query.country) rows = rows.filter((r) => r.country === query.country)
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.subdomain.includes(q) || r.id.toLowerCase().includes(q))
  const sort = query.sort === 'mrr' && !can(ctx, 'billing:view') ? 'name' : (query.sort ?? 'name')
  const dir = query.dir === 'desc' ? -1 : 1
  const key = (r: PlatformCompanyRow): string | number => {
    switch (sort) {
      case 'createdAt':
        return r.createdAt
      case 'lastActivityAt':
        return r.lastActivityAt ?? ''
      case 'users':
        return r.users
      case 'mrr':
        return r.mrr ?? 0
      default:
        return r.name.toLowerCase()
    }
  }
  rows.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || a.name.localeCompare(b.name)
  })
  return delay(rows)
}

function moduleStates(companyId: string): CompanyModuleState[] {
  const planModules = subPlan(subOf(companyId)).modules
  const effective = companyModules(companyId)
  const overrides = overridesOf(companyId)
  return GATEABLE_MODULES.map((module) => {
    const o = overrides.find((x) => x.module === module)
    return {
      module,
      inPlan: planModules.includes(module),
      enabled: effective.includes(module),
      override: o ? { module: o.module, enabled: o.enabled, reason: o.reason, by: o.by, at: o.at } : null,
    }
  })
}

const publicAlias = (a: SubdomainAlias): SubdomainAlias => ({ subdomain: a.subdomain, redirectUntil: a.redirectUntil, changedAt: a.changedAt, changedBy: a.changedBy })

function detailOf(ctx: PlatformCtx, company: Company): PlatformCompanyDetail {
  runLifecycle(company.id)
  const sub = subOf(company.id)
  const companyUsers = users.filter((u) => u.companyId === company.id)
  return {
    company: {
      ...rowOf(ctx, company),
      legalName: company.profile.legalName,
      tradeName: company.profile.tradeName,
      email: company.profile.email,
      phone: company.profile.phone,
      website: company.profile.website,
      city: company.profile.address.city,
      currency: company.regional.currency,
      timezone: company.regional.timezone,
    },
    // The payment method is stored masked (brand, last 4, expiry, holder): no card number exists to leak.
    subscription: publicSub(sub),
    plan: subPlan(sub),
    usage: usageOf(company.id),
    invoices: can(ctx, 'billing:view')
      ? billingInvoices
          .filter((i) => i.companyId === company.id)
          .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number.localeCompare(a.number))
          .map(publicInvoice)
      : null,
    usersCount: { active: companyUsers.filter((u) => u.active).length, total: companyUsers.length },
    modules: moduleStates(company.id),
    subdomainAliases: liveAliasesOfCompany(company.id).map(publicAlias),
  }
}

function auditView(ctx: PlatformCtx, company: Company, what: string): void {
  recordPlatformAudit(ctx, { action: 'company.viewed', companyId: company.id, summary: `Viewed ${what} of ${company.name}` })
}

/** GET /platform/companies/:id — tenants:view; audited (company.viewed). */
export async function getCompanyDetail(ctx: PlatformCtx, id: string): Promise<PlatformCompanyDetail> {
  const company = companyOr404(id)
  const detail = detailOf(ctx, company)
  auditView(ctx, company, 'the company page')
  return delay(detail)
}

/** GET /platform/companies/:id/users — tenants:view; audited. No secrets. */
export async function getCompanyUsers(ctx: PlatformCtx, id: string): Promise<PlatformCompanyUser[]> {
  const company = companyOr404(id)
  const rows = users
    .filter((u) => u.companyId === company.id)
    .map(({ id: uid, name, role, email, active, lastLoginAt }) => ({ id: uid, name, role, email, active, lastLoginAt }))
  auditView(ctx, company, 'the users')
  return delay(rows)
}

/**
 * GET /platform/companies/:id/timeline — tenants:view; audited. The company's audit log (subscription
 * entries as `billing`), plus the platform audit entries about it (views excluded), newest first.
 */
export async function getCompanyTimeline(ctx: PlatformCtx, id: string): Promise<TimelineEvent[]> {
  const company = companyOr404(id)
  runLifecycle(company.id)
  const events: TimelineEvent[] = [
    ...auditLog
      .filter((a) => a.companyId === company.id)
      .map((a) => ({ id: a.id, at: a.at, source: a.entity === 'subscription' ? ('billing' as const) : ('company' as const), actor: a.userName, summary: a.summary })),
    ...platformAudit
      .filter((p) => p.companyId === company.id && p.action !== 'company.viewed')
      .map((p) => ({
        id: p.id,
        at: p.at,
        source: 'platform' as const,
        actor: `${p.actorName} (${p.actorRole})`,
        summary: p.reason ? `${p.summary}. Reason: ${p.reason}` : p.summary,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  auditView(ctx, company, 'the timeline')
  return delay(events)
}

/* ---------------- Support notes ---------------- */

/** GET /platform/companies/:id/notes — tenants:view. That company's notes only, newest first. */
export async function listNotes(_ctx: PlatformCtx, id: string): Promise<SupportNote[]> {
  const company = companyOr404(id)
  return delay(supportNotes.filter((n) => n.companyId === company.id).sort((a, b) => b.at.localeCompare(a.at)))
}

/** POST /platform/companies/:id/notes { body } — support:notes. The author comes from the token. */
export async function addNote(ctx: PlatformCtx, id: string, input: { body?: unknown } | null): Promise<SupportNote> {
  const company = companyOr404(id)
  const body = String(input?.body ?? '').trim()
  if (body.length < 1 || body.length > 2000) throw err('Write a note (up to 2,000 characters).', 422, 'invalid_note')
  const note: SupportNote = { id: nextPlatformId('NOTE'), companyId: company.id, body, authorId: ctx.user.id, authorName: ctx.user.name, at: nowIso() }
  supportNotes.push(note)
  recordPlatformAudit(ctx, { action: 'note.added', companyId: company.id, summary: `Added a support note to ${company.name}`, after: { id: note.id } })
  return delay(note)
}

/* ---------------- Actions ---------------- */

/** Permission per CompanyAction (POST /platform/companies/:id/actions). */
export const ACTION_PERMISSION: Record<string, PlatformPermissionV2> = {
  change_plan: 'billing:manage',
  extend_trial: 'billing:manage',
  suspend: 'tenants:manage',
  reactivate: 'tenants:manage',
  cancel: 'tenants:manage',
}

function stateOf(company: Company) {
  const sub = subOf(company.id)
  return { companyStatus: company.status, subscriptionStatus: sub.status, planId: sub.planId, planVersion: sub.planVersion, trialEndsAt: sub.trialEndsAt }
}

function companyLockAudit(ctx: PlatformCtx, company: Company, summary: string): void {
  recordActorAudit(company.id, platformActor(ctx.user), { action: 'security', entity: 'company', entityId: company.id, summary, at: nowIso() })
}

/**
 * POST /platform/companies/:id/actions — permission per action (ACTION_PERMISSION, checked by the
 * handler); reason ≥ 5 characters. Returns the refreshed PlatformCompanyDetail.
 */
export async function runCompanyAction(ctx: PlatformCtx, id: string, input: Record<string, unknown> | null): Promise<PlatformCompanyDetail> {
  const company = companyOr404(id)
  const action = String(input?.action ?? '')
  if (!(action in ACTION_PERMISSION)) throw err('Unknown action.', 422, 'invalid_action')
  const reason = requireReason(input?.reason)
  runLifecycle(company.id)
  const before = stateOf(company)
  const actor = platformActor(ctx.user)
  let summary: string
  switch (action) {
    case 'change_plan': {
      const r = platformChangePlan(company.id, input?.planId, reason, actor)
      summary = `Changed the plan of ${company.name}: ${r.from} → ${r.to} (no charge)`
      break
    }
    case 'extend_trial': {
      platformExtendTrial(company.id, input?.days, reason, actor)
      summary = `Extended the trial of ${company.name} by ${Number(input?.days)} days`
      break
    }
    case 'suspend': {
      if (company.status === 'suspended') throw err('This workspace is already locked.', 409, 'invalid_state', { status: 'locked' })
      company.status = 'suspended'
      companyLockAudit(ctx, company, `Workspace locked by Apex CRM (${ctx.user.name}). Reason: ${reason}`)
      notifyAdmins(company.id, 'billing', 'Workspace locked', 'Apex CRM locked your workspace. Contact support for details.', nowIso(), '/settings/billing')
      summary = `Locked ${company.name}`
      break
    }
    case 'reactivate': {
      const wasLocked = company.status === 'suspended'
      const sub = subOf(company.id)
      if (!wasLocked && sub.status !== 'suspended' && sub.status !== 'cancelled') {
        throw err('This workspace is neither locked, suspended nor cancelled.', 409, 'invalid_state', { status: sub.status })
      }
      if (wasLocked) {
        company.status = 'active'
        syncCompanyMirror(company.id)
        companyLockAudit(ctx, company, `Workspace unlocked by Apex CRM (${ctx.user.name}). Reason: ${reason}`)
        notifyAdmins(company.id, 'billing', 'Workspace unlocked', 'Apex CRM unlocked your workspace.', nowIso())
      }
      platformReactivateSubscription(company.id, reason, actor)
      summary = `Reactivated ${company.name}`
      break
    }
    default: {
      platformCancel(company.id, reason, actor)
      summary = `Cancelled the subscription of ${company.name}`
    }
  }
  recordPlatformAudit(ctx, { action: `company.${action}`, companyId: company.id, summary, before, after: stateOf(company), reason })
  return delay(detailOf(ctx, company))
}

/* ---------------- Module overrides ---------------- */

/** POST /platform/companies/:id/modules { module, enabled: true | false | null (remove), reason } — tenants:manage. */
export async function setModuleOverride(ctx: PlatformCtx, id: string, input: Partial<ModuleOverrideInput> | null): Promise<PlatformCompanyDetail> {
  const company = companyOr404(id)
  const module = input?.module as PlanModule
  if (!GATEABLE_MODULES.includes(module)) {
    throw err(`Only these modules can be overridden: ${GATEABLE_MODULES.join(', ')}.`, 422, 'invalid_module', { allowed: GATEABLE_MODULES })
  }
  const enabled = input?.enabled
  if (enabled !== true && enabled !== false && enabled !== null) throw err('enabled must be true, false or null (remove the override).', 422, 'invalid_override')
  const reason = requireReason(input?.reason)
  const before = moduleStates(company.id).find((m) => m.module === module)!
  const i = moduleOverrides.findIndex((o) => o.companyId === company.id && o.module === module)
  if (enabled === null) {
    if (i < 0) throw err('There is no override for this module.', 409, 'no_override')
    moduleOverrides.splice(i, 1)
  } else {
    const row = { companyId: company.id, module, enabled, reason, by: ctx.user.name, at: nowIso() }
    if (i >= 0) moduleOverrides[i] = row
    else moduleOverrides.push(row)
  }
  syncCompanyMirror(company.id)
  const after = moduleStates(company.id).find((m) => m.module === module)!
  const label = MODULE_LABEL[module] ?? module
  const what = enabled === null ? `override of ${label} removed (back to the plan: ${after.enabled ? 'on' : 'off'})` : `${label} turned ${enabled ? 'on' : 'off'}`
  recordPlatformAudit(ctx, { action: 'company.module_override', companyId: company.id, summary: `Module ${what} for ${company.name}`, before, after, reason })
  recordActorAudit(company.id, platformActor(ctx.user), {
    action: 'update',
    entity: 'company',
    entityId: company.id,
    summary: `Module ${what} by Apex CRM. Reason: ${reason}`,
    changes: [{ field: `module:${module}`, from: before.enabled ? 'on' : 'off', to: after.enabled ? 'on' : 'off' }],
    at: nowIso(),
  })
  if (before.enabled !== after.enabled) {
    notifyAdmins(company.id, 'billing', `${label} ${after.enabled ? 'enabled' : 'disabled'}`, `Apex CRM turned ${label} ${after.enabled ? 'on' : 'off'} for your workspace.`, nowIso())
  }
  return delay(detailOf(ctx, company))
}

/* ---------------- Subdomains ---------------- */

const fmtDay = (v: string) => new Date(v).toISOString().slice(0, 10)

/** Availability of an address for `companyId` (its own current address and its own aliases don't count as taken). */
export function subdomainAvailability(raw: unknown, companyId?: string | null): SubdomainCheck {
  const subdomain = String(raw ?? '').trim().toLowerCase()
  const problem = subdomainProblem(subdomain)
  if (problem) return { subdomain, available: false, reason: problem }
  const owner = companyBySubdomain(subdomain)
  if (owner) {
    return { subdomain, available: false, reason: owner.id === companyId ? 'This is the company’s current address.' : 'That address belongs to another workspace.' }
  }
  const alias = liveAliasOf(subdomain)
  if (alias && alias.companyId !== companyId) {
    return { subdomain, available: false, reason: `That address still redirects to another workspace until ${fmtDay(alias.redirectUntil)}.` }
  }
  if (subdomainHeldBySignup(subdomain)) return { subdomain, available: false, reason: 'A sign-up in progress is holding that address.' }
  return { subdomain, available: true, reason: null }
}

/** GET /platform/subdomains/check?subdomain=&companyId= — tenants:subdomain. */
export async function checkSubdomain(_ctx: PlatformCtx, subdomain: unknown, companyId: string | null): Promise<SubdomainCheck> {
  return delay(subdomainAvailability(subdomain, companyId))
}

/**
 * POST /platform/companies/:id/subdomain { subdomain, reason } — tenants:subdomain. The old address
 * becomes an alias that redirects for `subdomainRedirectDays` and can't be taken meanwhile.
 */
export async function changeSubdomain(ctx: PlatformCtx, id: string, input: Partial<SubdomainChangeInput> | null): Promise<PlatformCompanyDetail> {
  const company = companyOr404(id)
  const reason = requireReason(input?.reason)
  const check = subdomainAvailability(input?.subdomain, company.id)
  const next = check.subdomain
  if (next === company.subdomain) throw err('That is already the company’s address.', 409, 'same_subdomain')
  if (!check.available) {
    const format = !!subdomainProblem(next)
    throw err(check.reason ?? 'That address isn’t available.', format ? 422 : 409, format ? 'invalid_subdomain' : 'subdomain_taken')
  }
  const old = company.subdomain
  const t = nowMs()
  const at = iso(t)
  // Taking back one of its own old addresses ends that alias.
  for (let i = subdomainAliases.length - 1; i >= 0; i--) {
    if (subdomainAliases[i].companyId === company.id && subdomainAliases[i].subdomain === next) subdomainAliases.splice(i, 1)
  }
  company.subdomain = next
  const redirectUntil = iso(t + consoleSettings.subdomainRedirectDays * DAY)
  subdomainAliases.push({ companyId: company.id, subdomain: old, redirectUntil, changedAt: at, changedBy: ctx.user.name })
  recordPlatformAudit(ctx, {
    action: 'subdomain.changed',
    companyId: company.id,
    summary: `Changed the address of ${company.name}: ${old} → ${next}`,
    before: { subdomain: old },
    after: { subdomain: next, oldRedirectsUntil: redirectUntil },
    reason,
  })
  recordActorAudit(company.id, platformActor(ctx.user), {
    action: 'update',
    entity: 'company',
    entityId: company.id,
    summary: `Workspace address changed by Apex CRM: ${old} → ${next} (the old address redirects until ${fmtDay(redirectUntil)}). Reason: ${reason}`,
    changes: [{ field: 'subdomain', from: old, to: next }],
    at,
  })
  notifyAdmins(
    company.id,
    'billing',
    'Your workspace address changed',
    `Your workspace is now at ${next}.apexcrm.app. The old address ${old}.apexcrm.app redirects until ${fmtDay(redirectUntil)}.`,
    at,
    '/settings/company',
  )
  return delay(detailOf(ctx, company))
}

/* ---------------- Overview ---------------- */

function countBy<T>(rows: T[], keyOf: (r: T) => string, labelOf: (k: string) => string): CountBy[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1)
  return [...m.entries()].map(([key, count]) => ({ key, label: labelOf(key), count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** GET /platform/overview — tenants:view; revenue fields null without billing:view. Mock clock. */
export async function getOverview(ctx: PlatformCtx): Promise<PlatformOverview> {
  runLifecycleForAll()
  const t = nowMs()
  const billing = can(ctx, 'billing:view')
  const rows = companies.map((c) => ({ company: c, sub: subOf(c.id) }))
  const statusKey = (r: (typeof rows)[number]) => (r.company.status === 'suspended' ? 'locked' : r.sub.status)
  const mrrByPlan = new Map<string, number>()
  let mrr = 0
  for (const { sub } of rows) {
    const m = monthlyRevenueOf(sub)
    mrr += m
    if (m > 0) mrrByPlan.set(sub.planId, (mrrByPlan.get(sub.planId) ?? 0) + m)
  }
  const thisWeek = startOfWeek(new Date(t), { weekStartsOn: 1 }).getTime()
  const signups = Array.from({ length: 8 }, (_, i) => {
    const start = thisWeek - (7 - i) * 7 * DAY
    const end = start + 7 * DAY
    return { weekStart: iso(start), count: companies.filter((c) => Date.parse(c.createdAt) >= start && Date.parse(c.createdAt) < end).length }
  })
  const since30 = subDays(new Date(t), 30).getTime()
  const cancelledLast30 = rows.filter((r) => (r.sub.status === 'cancelled' || r.sub.status === 'deleted') && Date.parse(r.sub.statusChangedAt) >= since30).length
  const activeAtStart = rows.filter(
    (r) => Date.parse(r.company.createdAt) < since30 && !((r.sub.status === 'cancelled' || r.sub.status === 'deleted') && Date.parse(r.sub.statusChangedAt) < since30),
  ).length
  const topUsage = rows
    .filter((r) => r.sub.status !== 'deleted')
    .flatMap(({ company }) => {
      const best = usageOf(company.id).items.filter((i) => i.percent !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]
      return best ? [{ companyId: company.id, name: company.name, key: best.key, percent: best.percent ?? 0 }] : []
    })
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5)
  const planName = (id: string) => planById(id)?.name ?? id
  return delay({
    generatedAt: iso(t),
    totals: { companies: companies.length, activeUsers: users.filter((u) => u.active && companies.some((c) => c.id === u.companyId)).length },
    byStatus: countBy(rows, statusKey, (k) => STATUS_LABEL[k as SubscriptionStatus | 'locked'] ?? k),
    byPlan: countBy(rows, (r) => r.sub.planId, planName),
    byCountry: countBy(rows, (r) => r.company.regional.country, (k) => k),
    mrr: billing ? round2(mrr) : null,
    mrrByPlan: billing
      ? [...mrrByPlan.entries()].map(([key, v]) => ({ key, label: planName(key), count: round2(v) })).sort((a, b) => b.count - a.count)
      : null,
    currency: 'USD',
    signups,
    signupsLast30Days: companies.filter((c) => Date.parse(c.createdAt) >= since30).length,
    trialsEndingSoon: rows
      .filter((r) => r.sub.status === 'trialing' && r.sub.trialEndsAt && Date.parse(r.sub.trialEndsAt) - t <= 7 * DAY)
      .map((r) => ({
        companyId: r.company.id,
        name: r.company.name,
        trialEndsAt: r.sub.trialEndsAt!,
        daysLeft: Math.max(0, Math.ceil((Date.parse(r.sub.trialEndsAt!) - t) / DAY)),
      }))
      .sort((a, b) => a.trialEndsAt.localeCompare(b.trialEndsAt)),
    pastDue: rows
      .filter((r) => r.sub.status === 'past_due')
      .map((r) => ({ companyId: r.company.id, name: r.company.name, graceEndsAt: r.sub.graceEndsAt, amountDue: billing ? amountDueOf(r.company.id) : null })),
    topUsage,
    churn: { cancelledLast30Days: cancelledLast30, ratePct: activeAtStart ? round2((cancelledLast30 / activeAtStart) * 100) : 0 },
  })
}

/* ---------------- Plans (versioned) ---------------- */

const liveSubs = () => subscriptions.filter((s) => s.status !== 'deleted')

function platformPlanOf(plan: Plan): PlatformPlan {
  const versions = planVersions
    .filter((v) => v.planId === plan.id)
    .sort((a, b) => a.version - b.version)
    .map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      price: v.price,
      subscribers: liveSubs().filter((s) => s.planId === plan.id && s.planVersion === v.version).length,
    }))
  return { ...structuredClone(plan), version: plan.version ?? 1, versions, subscribers: liveSubs().filter((s) => s.planId === plan.id).length }
}

/** GET /platform/plans — billing:view or plans:manage. All plans (inactive too), by rank. */
export async function listPlatformPlans(_ctx: PlatformCtx): Promise<PlatformPlan[]> {
  return delay([...plans].sort((a, b) => a.rank - b.rank).map(platformPlanOf))
}

const planErr = (message: string, field: string) => err(message, 422, 'invalid_plan_input', { field })

function vName(v: unknown): string {
  const s = String(v ?? '').trim()
  if (s.length < 2 || s.length > 40) throw planErr('The plan name must be 2–40 characters.', 'name')
  return s
}
function vPrice(v: unknown): number | null {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000) throw planErr('The price must be a number from 0 to 100,000, or null.', 'price')
  return round2(v)
}
function vPeriod(v: unknown): BillingPeriod {
  if (v !== 'month' && v !== 'year') throw planErr('The billing period must be month or year.', 'billingPeriod')
  return v
}
function vLimits(v: unknown, base: PlanLimits): PlanLimits {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw planErr('Limits must be an object.', 'limits')
  const next = { ...base }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!LIMIT_KEYS.includes(k as LimitKey)) throw planErr(`Unknown limit ${k}.`, 'limits')
    if (val !== null && (!Number.isInteger(val) || (val as number) < 0 || (val as number) > 100_000_000)) {
      throw planErr(`${k} must be a whole number from 0, or null for unlimited.`, `limits.${k}`)
    }
    next[k as LimitKey] = val as number | null
  }
  return next
}
function vModules(v: unknown): PlanModule[] {
  if (!Array.isArray(v) || v.length === 0 || v.some((m) => !ALL_PLAN_MODULES.includes(m as PlanModule))) {
    throw planErr(`Modules must be a non-empty list of: ${ALL_PLAN_MODULES.join(', ')}.`, 'modules')
  }
  return ALL_PLAN_MODULES.filter((m) => (v as string[]).includes(m))
}
function vHighlights(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 8 || v.some((h) => typeof h !== 'string' || !h.trim() || h.length > 120)) {
    throw planErr('Highlights must be up to 8 lines of up to 120 characters.', 'highlights')
  }
  return (v as string[]).map((h) => h.trim())
}

/** POST /platform/plans — plans:manage. A new plan (version 1). Plans are never deleted. */
export async function createPlan(ctx: PlatformCtx, input: Partial<PlanCreateInput> | null): Promise<PlatformPlan> {
  const body = input ?? {}
  const reason = requireReason(body.reason)
  const id = String(body.id ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw planErr('The plan id must be 2–31 lowercase letters, digits or hyphens, starting with a letter.', 'id')
  if (planById(id)) throw err('A plan with this id already exists.', 409, 'plan_exists')
  const checkout = body.checkout
  if (checkout !== 'none' && checkout !== 'payment' && checkout !== 'contact') throw planErr('checkout must be none, payment or contact.', 'checkout')
  const currency = String(body.currency ?? 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw planErr('The currency must be a 3-letter code.', 'currency')
  const price = vPrice(body.price ?? null)
  if (checkout === 'payment' && !price) throw planErr('A plan paid by card needs a price above 0.', 'price')
  const rank = body.rank === undefined ? Math.max(0, ...plans.map((p) => p.rank)) + 1 : Number(body.rank)
  if (!Number.isInteger(rank) || rank < 0 || rank > 1000) throw planErr('The rank must be a whole number from 0 to 1,000.', 'rank')
  const empty: PlanLimits = { users: null, leadsContacts: null, storageMb: null, emailsPerMonth: null, aiCredits: null }
  const plan: Plan = {
    id,
    name: vName(body.name),
    price,
    currency,
    billingPeriod: vPeriod(body.billingPeriod ?? 'month'),
    limits: vLimits(body.limits ?? {}, empty),
    modules: vModules(body.modules),
    highlights: vHighlights(body.highlights ?? []),
    checkout,
    active: body.active !== false,
    rank,
    version: 1,
  }
  plans.push(plan)
  planVersions.push({ planId: id, version: 1, createdAt: nowIso(), createdBy: ctx.user.name, price: plan.price, billingPeriod: plan.billingPeriod, limits: { ...plan.limits }, modules: [...plan.modules] })
  recordPlatformAudit(ctx, { action: 'plan.created', summary: `Created the ${plan.name} plan`, after: plan, reason })
  return delay(platformPlanOf(plan))
}

const MIGRATIONS: PlanMigration[] = ['keep', 'at_renewal', 'now']

/**
 * PATCH /platform/plans/:id — plans:manage. Name / highlights / active don't create a version; a change
 * of price, billing period, limits or modules creates version N+1. Subscribers on older versions:
 * keep (stay), at_renewal (moved by their next renewal), now (moved now unless current stock usage
 * exceeds the new limits: then left on their version and reported in `skipped`). Nothing is deleted.
 */
export async function editPlan(ctx: PlatformCtx, id: string, input: Partial<PlanEditInput> | null): Promise<PlanEditResult> {
  const plan = planById(String(id ?? ''))
  if (!plan) throw err('Plan not found.', 404, 'plan_not_found')
  const body = input ?? {}
  const migration = body.migration as PlanMigration
  if (!MIGRATIONS.includes(migration)) throw err('migration must be keep, at_renewal or now.', 422, 'invalid_migration')
  const reason = requireReason(body.reason)
  const before = structuredClone(plan)

  const name = body.name !== undefined ? vName(body.name) : plan.name
  const highlights = body.highlights !== undefined ? vHighlights(body.highlights) : plan.highlights
  if (body.active !== undefined && typeof body.active !== 'boolean') throw planErr('active must be true or false.', 'active')
  const active = body.active ?? plan.active
  const price = body.price !== undefined ? vPrice(body.price) : plan.price
  if (plan.checkout === 'payment' && !price) throw planErr('A plan paid by card needs a price above 0.', 'price')
  const billingPeriod = body.billingPeriod !== undefined ? vPeriod(body.billingPeriod) : plan.billingPeriod
  const limits = body.limits !== undefined ? vLimits(body.limits, plan.limits) : plan.limits
  const modules = body.modules !== undefined ? vModules(body.modules) : plan.modules

  const versioned =
    price !== plan.price ||
    billingPeriod !== plan.billingPeriod ||
    JSON.stringify(limits) !== JSON.stringify(plan.limits) ||
    JSON.stringify([...modules].sort()) !== JSON.stringify([...plan.modules].sort())

  plan.name = name
  plan.highlights = [...highlights]
  plan.active = active
  const result: PlanEditResult = { plan: platformPlanOf(plan), newVersion: false, migrated: 0, scheduled: 0, skipped: [] }

  if (versioned) {
    const version = Math.max(0, ...planVersions.filter((v) => v.planId === plan.id).map((v) => v.version)) + 1
    planVersions.push({ planId: plan.id, version, createdAt: nowIso(), createdBy: ctx.user.name, price, billingPeriod, limits: { ...limits }, modules: [...modules] })
    Object.assign(plan, { price, billingPeriod, limits: { ...limits }, modules: [...modules], version })
    result.newVersion = true
    const actor = platformActor(ctx.user)
    for (const sub of liveSubs().filter((s) => s.planId === plan.id && s.planVersion < version)) {
      if (migration === 'at_renewal') {
        scheduleVersionAtRenewal(sub.companyId, version)
        result.scheduled++
      } else if (migration === 'now') {
        const blocks = migrateToVersionNow(sub.companyId, version, actor)
        if (blocks.length) {
          result.skipped.push({
            companyId: sub.companyId,
            name: companyById(sub.companyId)?.name ?? sub.companyId,
            reasons: blocks.map((b) => `${b.label}: ${b.used.toLocaleString('en-US')} used, the new limit is ${b.limit.toLocaleString('en-US')}`),
          })
        } else result.migrated++
      }
    }
  }
  result.plan = platformPlanOf(plan)
  recordPlatformAudit(ctx, {
    action: 'plan.updated',
    summary: `Edited the ${plan.name} plan${result.newVersion ? ` (version ${plan.version}, migration ${migration}: ${result.migrated} moved, ${result.scheduled} at renewal, ${result.skipped.length} skipped)` : ''}`,
    before,
    after: structuredClone(plan),
    reason,
  })
  return delay(result)
}

/* ---------------- Settings ---------------- */

function settingsNow(): PlatformSettings {
  return { ...structuredClone(billingSettings), subdomainRedirectDays: consoleSettings.subdomainRedirectDays, impersonationMinutes: consoleSettings.impersonationMinutes }
}

/** GET /platform/settings — tenants:view (every platform role). */
export async function getSettings(_ctx: PlatformCtx): Promise<PlatformSettings> {
  return delay(settingsNow())
}

/** PATCH /platform/settings — plans:manage + reason. Partial; ranges validated (422 invalid_settings { field }). */
export async function updateSettings(ctx: PlatformCtx, input: (Partial<PlatformSettings> & { reason?: unknown }) | null): Promise<PlatformSettings> {
  const body = input ?? {}
  const reason = requireReason(body.reason)
  const before = settingsNow()
  const nextBilling: PlatformBillingSettings = validatedBillingSettings(body)
  const redirect = body.subdomainRedirectDays !== undefined ? wholeSetting(body.subdomainRedirectDays, 'subdomainRedirectDays', 0, 365) : consoleSettings.subdomainRedirectDays
  const minutes = body.impersonationMinutes !== undefined ? wholeSetting(body.impersonationMinutes, 'impersonationMinutes', 5, 240) : consoleSettings.impersonationMinutes
  Object.assign(billingSettings, nextBilling)
  consoleSettings.subdomainRedirectDays = redirect
  consoleSettings.impersonationMinutes = minutes
  const after = settingsNow()
  recordPlatformAudit(ctx, { action: 'settings.updated', summary: 'Changed the platform settings', before, after, reason })
  return delay(after)
}

/* ---------------- Announcements ---------------- */

const TONES = ['info', 'warning', 'success']
const annErr = (message: string, field: string) => err(message, 422, 'invalid_announcement', { field })

function validAnnouncement(body: Partial<AnnouncementInput>, base?: Announcement): Omit<Announcement, 'id' | 'createdAt' | 'createdBy' | 'reach'> {
  const title = body.title !== undefined ? String(body.title).trim() : base?.title ?? ''
  if (title.length < 3 || title.length > 120) throw annErr('The title must be 3–120 characters.', 'title')
  const text = body.body !== undefined ? String(body.body).trim() : base?.body ?? ''
  if (text.length < 1 || text.length > 2000) throw annErr('The message must be 1–2,000 characters.', 'body')
  const tone = body.tone ?? base?.tone ?? 'info'
  if (!TONES.includes(tone)) throw annErr('The tone must be info, warning or success.', 'tone')
  const audience = body.audience ?? base?.audience ?? { plans: [], countries: [] }
  if (!audience || !Array.isArray(audience.plans) || !Array.isArray(audience.countries)) throw annErr('The audience needs plans and countries lists (empty = all).', 'audience')
  if (audience.plans.some((p) => !planById(p))) throw annErr('Unknown plan in the audience.', 'audience.plans')
  if (audience.countries.some((c) => !isCountryCode(c))) throw annErr('Unknown country in the audience.', 'audience.countries')
  const startsAt = body.startsAt ?? base?.startsAt ?? nowIso()
  const endsAt = body.endsAt ?? base?.endsAt
  if (Number.isNaN(Date.parse(String(startsAt)))) throw annErr('Enter a valid start time.', 'startsAt')
  if (!endsAt || Number.isNaN(Date.parse(String(endsAt)))) throw annErr('Enter a valid end time.', 'endsAt')
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw annErr('The end must be after the start.', 'endsAt')
  return {
    title,
    body: text,
    tone,
    audience: { plans: [...new Set(audience.plans)], countries: [...new Set(audience.countries)] as CountryCode[] },
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
  }
}

function inSegment(a: Announcement, company: Company): boolean {
  const planId = subscriptionOf(company.id)?.planId ?? company.plan
  return (a.audience.plans.length === 0 || a.audience.plans.includes(planId)) && (a.audience.countries.length === 0 || a.audience.countries.includes(company.regional.country))
}

function reachOf(a: Announcement): number {
  return companies.filter((c) => subscriptionOf(c.id)?.status !== 'deleted' && inSegment(a, c)).length
}

const withReach = (a: Announcement): Announcement => ({ ...structuredClone(a), reach: reachOf(a) })

function announcementOr404(id: string): Announcement {
  const a = announcements.find((x) => x.id === String(id ?? ''))
  if (!a) throw err('Announcement not found.', 404, 'announcement_not_found')
  return a
}

/** GET /platform/announcements — tenants:view. Newest first, each with `reach` (companies in the segment now). */
export async function listAnnouncements(_ctx: PlatformCtx): Promise<Announcement[]> {
  return delay([...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(withReach))
}

/** POST /platform/announcements — announcements:manage. */
export async function createAnnouncement(ctx: PlatformCtx, input: Partial<AnnouncementInput> | null): Promise<Announcement> {
  const fields = validAnnouncement(input ?? {})
  const a: Announcement = { id: nextPlatformId('ANN'), ...fields, createdAt: nowIso(), createdBy: ctx.user.name }
  announcements.push(a)
  recordPlatformAudit(ctx, { action: 'announcement.created', summary: `Created the announcement “${a.title}”`, after: a, reason: input?.reason ? String(input.reason) : null })
  return delay(withReach(a))
}

/** PATCH /platform/announcements/:id — announcements:manage. */
export async function updateAnnouncement(ctx: PlatformCtx, id: string, input: Partial<AnnouncementInput> | null): Promise<Announcement> {
  const a = announcementOr404(id)
  const before = structuredClone(a)
  Object.assign(a, validAnnouncement(input ?? {}, a))
  recordPlatformAudit(ctx, { action: 'announcement.updated', summary: `Edited the announcement “${a.title}”`, before, after: structuredClone(a), reason: input?.reason ? String(input.reason) : null })
  return delay(withReach(a))
}

/** DELETE /platform/announcements/:id — announcements:manage. Ends it now; the row is kept. */
export async function endAnnouncement(ctx: PlatformCtx, id: string): Promise<Announcement> {
  const a = announcementOr404(id)
  const before = structuredClone(a)
  const now = nowIso()
  if (a.endsAt > now) a.endsAt = now
  if (a.startsAt > a.endsAt) a.startsAt = a.endsAt
  recordPlatformAudit(ctx, { action: 'announcement.ended', summary: `Ended the announcement “${a.title}”`, before, after: structuredClone(a) })
  return delay(withReach(a))
}

/** GET /announcements — any signed-in company user: active now (mock clock), in the company's segment, not dismissed by this user. */
export async function companyAnnouncements(user: User): Promise<CompanyAnnouncement[]> {
  const company = companyById(tenantOf(user))!
  const now = nowIso()
  const dismissed = new Set(announcementDismissals.filter((d) => d.userId === user.id).map((d) => d.announcementId))
  return delay(
    announcements
      .filter((a) => a.startsAt <= now && now < a.endsAt && inSegment(a, company) && !dismissed.has(a.id))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map(({ id, title, body, tone, endsAt }) => ({ id, title, body, tone, endsAt })),
  )
}

/** POST /announcements/:id/dismiss — per user, stored on the server. 404 when not in the company's segment. */
export async function dismissAnnouncement(user: User, id: string): Promise<{ ok: true }> {
  const company = companyById(tenantOf(user))!
  const a = announcements.find((x) => x.id === String(id ?? ''))
  if (!a || !inSegment(a, company)) throw new ApiError('Not found.', 404)
  if (!announcementDismissals.some((d) => d.announcementId === a.id && d.userId === user.id)) {
    announcementDismissals.push({ announcementId: a.id, userId: user.id, companyId: company.id, at: nowIso() })
  }
  return delay({ ok: true as const })
}

/* ---------------- Platform audit ---------------- */

/** GET /platform/audit — audit:view. Filters: actor (id or name), action (exact or prefix with "."), companyId, from, to (ISO), q. */
export async function queryAudit(_ctx: PlatformCtx, query: PlatformAuditQuery): Promise<PlatformAuditEntry[]> {
  const q = String(query.q ?? '').trim().toLowerCase()
  const actor = String(query.actor ?? '').trim().toLowerCase()
  const action = String(query.action ?? '').trim()
  return delay(
    platformAudit.filter((e) => {
      if (actor && e.actorId.toLowerCase() !== actor && !e.actorName.toLowerCase().includes(actor)) return false
      if (action && e.action !== action && !(action.endsWith('.') ? e.action.startsWith(action) : e.action.startsWith(`${action}.`))) return false
      if (query.companyId && e.companyId !== query.companyId) return false
      if (query.from && e.at < query.from) return false
      if (query.to && e.at > query.to) return false
      if (q && ![e.summary, e.reason ?? '', e.companyName ?? '', e.actorName, e.action].some((s) => s.toLowerCase().includes(q))) return false
      return true
    }),
  )
}
