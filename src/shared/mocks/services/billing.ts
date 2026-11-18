import { addMonths, addYears, format } from 'date-fns'
import type { User } from '@/shared/types'
import type {
  AiCreditsResult,
  BillingInvoice,
  BillingOverview,
  BillingSubscription,
  ChangePlanResult,
  DataExport,
  DevBillingStateDetails,
  DowngradeBlock,
  Entitlements,
  LimitKey,
  PaymentMethodInput,
  Plan,
  PlanModule,
  PlatformBillingSettings,
  SubscriptionStatus,
  Usage,
  UsageItem,
} from '@/modules/billing/types'
import { STOCK_LIMITS } from '@/modules/billing/types'
import type { AuditChange } from '@/modules/settings/types'
import { ApiError } from '@/shared/lib/apiError'
import { can, canViewCompanyProfile } from '@/shared/lib/permissions'
import { contacts, customers, leads, users } from '@/shared/mocks/db'
import { notifications, projects, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { quotations } from '@/shared/mocks/data/quotations'
import { companyById } from '@/shared/mocks/data/tenancy'
import { recordActorAudit, recordAudit, recordSystemAudit, type AuditActor } from '@/shared/mocks/data/audit'
import { activePlans, billingSettings, enabledModulesFrom, planAt, planById, planOf, trialConversionPlan } from '@/shared/mocks/data/plans'
import { effectiveModules } from '@/shared/mocks/data/platform'
import {
  billingInvoices,
  billingSentKeys,
  failNextPayment,
  nextInvoiceNumber,
  periodCounters,
  subscriptionOf,
  subscriptions,
  usageSimulation,
  type PeriodCounter,
} from '@/shared/mocks/data/subscriptions'
import { advanceClock, nowIso, nowMs, offsetDays } from '@/shared/mocks/clock'
import { parseCard } from '@/shared/mocks/cards'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'

/**
 * Plans, limits and the subscription lifecycle (contract: src/modules/billing/types.ts, docs/API.md
 * "Plans, limits and subscription lifecycle"). Everything is enforced here, for real:
 *   - usage: users / leads+contacts / storage are counted live from the stores; emails and AI credits
 *     are per-period counters (a new period = a new counter row = reset). Dev simulation adds an offset.
 *   - limits: `assertCapacity` throws 402 LIMIT_REACHED before a create; `recordUsage` / `noteUsage`
 *     after it (period counters, usage warnings once per threshold per limit per period).
 *   - lifecycle: `runLifecycle` walks every due transition and reminder in time order (mock clock).
 *   - request policy (`enforceRequestPolicy`, called by userFrom): deleted → 410, module not in the
 *     plan → 403, suspended / cancelled → 423 for writes (with a few exemptions).
 * Data is never deleted because of a limit or a downgrade.
 */

const DAY = 86_400_000
const BILLING_LINK = '/settings/billing'
const fmtDate = (iso: string | number) => format(new Date(iso), 'd MMM yyyy')
const round2 = (n: number) => Math.round(n * 100) / 100
const iso = (ms: number) => new Date(ms).toISOString()
const ms = (v: string) => Date.parse(v)

const LIMIT_LABEL: Record<LimitKey, string> = {
  users: 'Users',
  leadsContacts: 'Leads and contacts',
  storageMb: 'Storage',
  emailsPerMonth: 'Emails this period',
  aiCredits: 'AI credits',
}
const LIMIT_KEYS: LimitKey[] = ['users', 'leadsContacts', 'storageMb', 'emailsPerMonth', 'aiCredits']

const err = (message: string, status: number, code: string, details: Record<string, unknown> = {}) =>
  new CodedApiError(message, status, code, details)

/* ---------------- Errors with typed bodies ---------------- */

/** 402 LIMIT_REACHED; body = LimitReachedDetails + message. */
export class LimitReachedError extends CodedApiError {
  constructor(key: LimitKey, current: number, max: number, plan: Plan) {
    super(limitMessage(key, max, plan), 402, 'LIMIT_REACHED', { limit: key, current, max, planId: plan.id })
  }
}

function limitMessage(key: LimitKey, max: number, plan: Plan): string {
  const n = max.toLocaleString('en-US')
  switch (key) {
    case 'users':
      return `Your ${plan.name} plan includes up to ${n} active users. Upgrade your plan to add more.`
    case 'leadsContacts':
      return `Your ${plan.name} plan includes up to ${n} leads and contacts. Upgrade your plan to add more.`
    case 'storageMb':
      return `Your ${plan.name} plan includes ${max >= 1024 ? `${round2(max / 1024)} GB` : `${n} MB`} of storage, and it’s full. Upgrade your plan or remove files.`
    case 'emailsPerMonth':
      return `You’ve sent the ${n} emails your ${plan.name} plan includes this period. Upgrade your plan to send more.`
    case 'aiCredits':
      return `You’ve used the ${n} AI credits your ${plan.name} plan includes this period. Upgrade your plan for more.`
  }
}

/* ---------------- Lookups ---------------- */

export function subOf(companyId: string): Tenant<BillingSubscription> {
  const sub = subscriptionOf(companyId)
  if (!sub) throw new ApiError('This workspace has no subscription.', 404)
  return sub
}

/**
 * The plan as the subscription sees it: price, billing period, limits and modules of its plan VERSION
 * (`planVersion`), name / rank / checkout / active of the plan. Every limit, module and price check uses this.
 */
export function subPlan(sub: Pick<BillingSubscription, 'planId' | 'planVersion'>): Plan {
  return planAt(sub.planId, sub.planVersion)
}

/** The modules a company can use: its plan version's modules ± platform overrides. */
export function companyModules(companyId: string): PlanModule[] {
  const sub = subscriptionOf(companyId)
  return sub ? effectiveModules(companyId, subPlan(sub).modules) : []
}

function companyAdmins(companyId: string): User[] {
  return users.filter((u) => u.companyId === companyId && u.active && u.role === 'Company Admin')
}

/** A stored notification to every active Company Admin of the company. */
export function notifyAdmins(companyId: string, type: 'billing' | 'usage', title: string, body: string, at = nowIso(), link = BILLING_LINK): void {
  for (const admin of companyAdmins(companyId)) {
    pushNotification({ userId: admin.id, companyId, type, title, body, link, at })
  }
}

/** Who did it: a company user, a platform operator (AuditActor), or the System (null). */
export type BillingActor = User | AuditActor | null

const isUser = (a: BillingActor): a is User => !!a && 'companyId' in a

function audit(companyId: string, actor: BillingActor, summary: string, at: string, changes: AuditChange[] = []): void {
  const entry = { action: 'update' as const, entity: 'subscription', entityId: subOf(companyId).id, summary, changes }
  if (isUser(actor)) recordAudit(actor, entry).at = at
  else if (actor) recordActorAudit(companyId, actor, { ...entry, at })
  else recordSystemAudit(companyId, { ...entry, at })
}

function periodEndFrom(startMs: number, plan: Plan): number {
  return (plan.billingPeriod === 'year' ? addYears(startMs, 1) : addMonths(startMs, 1)).getTime()
}

function priceOf(sub: BillingSubscription, plan: Plan): number {
  return sub.customPrice ?? plan.price ?? 0
}

/** Company mirrors: plan, enabledModules (plan version's role modules ± overrides), console status (trial / active; never the operator lock). */
function syncCompany(sub: Tenant<BillingSubscription>): void {
  const company = companyById(sub.companyId)
  if (!company) return
  const plan = subPlan(sub)
  company.plan = plan.id
  company.enabledModules = enabledModulesFrom(effectiveModules(sub.companyId, plan.modules))
  if (company.status !== 'suspended') company.status = sub.status === 'trialing' ? 'trial' : 'active'
}

/** Re-syncs Company.plan / enabledModules / status after an override or lock change. */
export function syncCompanyMirror(companyId: string): void {
  const sub = subscriptionOf(companyId)
  if (sub) syncCompany(sub)
}

/** Moves the subscription to the plan's CURRENT version (a pending version is dropped). */
function setPlan(sub: Tenant<BillingSubscription>, plan: Plan): void {
  if (sub.planId !== plan.id) sub.customPrice = null
  sub.planId = plan.id
  sub.planVersion = planOf(plan.id).version ?? 1
  sub.pendingPlanVersion = null
  syncCompany(sub)
}

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
}

/** Status change: fields, company mirror, audit (System unless an actor is given) and admin notification. */
function transition(
  sub: Tenant<BillingSubscription>,
  status: SubscriptionStatus,
  at: string,
  note: { summary: string; title: string; body: string },
  actor: BillingActor = null,
): void {
  const from = sub.status
  sub.status = status
  sub.statusChangedAt = at
  if (status !== 'past_due') sub.graceEndsAt = null
  if (status !== 'cancelled') sub.deleteAt = null
  if (status !== 'trialing') sub.trialEndsAt = status === 'suspended' && from === 'trialing' ? sub.trialEndsAt : null
  syncCompany(sub)
  audit(sub.companyId, actor, note.summary, at, from === status ? [] : [{ field: 'status', from: STATUS_LABEL[from], to: STATUS_LABEL[status] }])
  notifyAdmins(sub.companyId, 'billing', note.title, note.body, at)
}

/* ---------------- Invoices / charges ---------------- */

function createInvoice(
  sub: Tenant<BillingSubscription>,
  plan: Plan,
  amount: number,
  periodStart: number,
  periodEnd: number,
  description: string,
  status: BillingInvoice['status'],
  at: string,
): Tenant<BillingInvoice> {
  const { id, number } = nextInvoiceNumber()
  const inv: Tenant<BillingInvoice> = {
    id,
    companyId: sub.companyId,
    number,
    issuedAt: at,
    periodStart: iso(periodStart),
    periodEnd: iso(periodEnd),
    planId: plan.id,
    description,
    amount: round2(amount),
    currency: plan.currency,
    status,
  }
  billingInvoices.push(inv)
  return inv
}

/**
 * An automatic charge (trial conversion, renewal): fails when there's no payment method or the dev
 * "fail next payment" flag is set (the flag then resets). A free period (amount 0) charges nothing.
 */
function autoCharge(sub: Tenant<BillingSubscription>, plan: Plan, start: number, end: number, at: string): { ok: boolean; invoice: BillingInvoice | null } {
  const amount = priceOf(sub, plan)
  if (amount <= 0) return { ok: true, invoice: null }
  const flagged = failNextPayment.indexOf(sub.companyId)
  const fails = flagged >= 0 || !sub.paymentMethod
  if (flagged >= 0) failNextPayment.splice(flagged, 1)
  const invoice = createInvoice(sub, plan, amount, start, end, `${plan.name} plan, ${plan.billingPeriod === 'year' ? 'yearly' : 'monthly'}`, fails ? 'open' : 'paid', at)
  return { ok: !fails, invoice }
}

const openInvoices = (companyId: string) => billingInvoices.filter((i) => i.companyId === companyId && i.status === 'open')

function voidOpenInvoices(companyId: string): void {
  for (const inv of openInvoices(companyId)) inv.status = 'void'
}

/* ---------------- Usage ---------------- */

function counterRow(companyId: string, periodStart: string): Tenant<PeriodCounter> {
  let row = periodCounters.find((c) => c.companyId === companyId && c.periodStart === periodStart)
  if (!row) {
    row = { companyId, periodStart, emailsPerMonth: 0, aiCredits: 0 }
    periodCounters.push(row)
  }
  return row
}

function realUsage(companyId: string, key: LimitKey, sub: BillingSubscription): number {
  switch (key) {
    case 'users':
      return users.filter((u) => u.companyId === companyId && u.active).length
    case 'leadsContacts':
      return leads.filter((l) => l.companyId === companyId).length + contacts.filter((c) => c.companyId === companyId).length
    case 'storageMb': {
      let bytes = 0
      for (const t of tasks) if (t.companyId === companyId) for (const a of t.attachments) bytes += a.size
      return round2(bytes / (1024 * 1024))
    }
    case 'emailsPerMonth':
    case 'aiCredits':
      return periodCounters.find((c) => c.companyId === companyId && c.periodStart === sub.currentPeriodStart)?.[key] ?? 0
  }
}

function simulatedOffset(companyId: string, key: LimitKey): number {
  return usageSimulation.find((s) => s.companyId === companyId && s.key === key)?.offset ?? 0
}

/** Current usage of one limit (real + dev simulation, never below 0). */
export function usedOf(companyId: string, key: LimitKey): number {
  const sub = subOf(companyId)
  return Math.max(0, round2(realUsage(companyId, key, sub) + simulatedOffset(companyId, key)))
}

function percentOf(used: number, limit: number | null): number | null {
  if (limit === null) return null
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.round((used / limit) * 100)
}

export function usageOf(companyId: string): Usage {
  const sub = subOf(companyId)
  const plan = subPlan(sub)
  const items: UsageItem[] = LIMIT_KEYS.map((key) => {
    const used = usedOf(companyId, key)
    const limit = plan.limits[key]
    return {
      key,
      label: LIMIT_LABEL[key],
      used,
      limit,
      percent: percentOf(used, limit),
      resets: !STOCK_LIMITS.includes(key),
      unit: key === 'storageMb' ? 'MB' : 'count',
    }
  })
  return { periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, items }
}

/** Sends each usage warning (thresholds from platform settings) once per limit per period, to Company Admins. */
export function checkUsageWarnings(companyId: string): void {
  const sub = subscriptionOf(companyId)
  if (!sub) return
  const plan = subPlan(sub)
  const thresholds = [...billingSettings.usageWarningThresholds].sort((a, b) => a - b)
  for (const key of LIMIT_KEYS) {
    const limit = plan.limits[key]
    if (limit === null || limit <= 0) continue
    const used = usedOf(companyId, key)
    for (const t of thresholds) {
      if ((used / limit) * 100 < t) continue
      const sentKey = `${companyId}|usage|${sub.currentPeriodStart}|${key}|${t}`
      if (billingSentKeys.includes(sentKey)) continue
      billingSentKeys.push(sentKey)
      const amount = `${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')}${key === 'storageMb' ? ' MB' : ''}`
      notifyAdmins(
        companyId,
        'usage',
        t >= 100 ? `${LIMIT_LABEL[key]}: plan limit reached` : `${LIMIT_LABEL[key]}: ${t}% of your plan used`,
        t >= 100
          ? `${amount} used on the ${plan.name} plan. New ones are blocked until you upgrade.`
          : `${amount} used on the ${plan.name} plan. Upgrade before you reach the limit.`,
      )
    }
  }
}

/**
 * Throws 402 LIMIT_REACHED when `need` more of `key` would exceed the plan limit. Stock limits
 * (users, leads+contacts, storage) and period limits (emails, AI credits) alike; unlimited passes.
 */
export function assertCapacity(companyId: string, key: LimitKey, need = 1): void {
  const sub = subscriptionOf(companyId)
  if (!sub) return
  const plan = subPlan(sub)
  const max = plan.limits[key]
  if (max === null) return
  const current = usedOf(companyId, key)
  if (current + need > max) throw new LimitReachedError(key, current, max, plan)
}

/** How many more of `key` fit (Infinity when unlimited). */
export function remainingCapacity(companyId: string, key: LimitKey): number {
  const sub = subscriptionOf(companyId)
  if (!sub) return Infinity
  const max = subPlan(sub).limits[key]
  return max === null ? Infinity : Math.max(0, max - usedOf(companyId, key))
}

/** The 402 body for a limit (e.g. the import report), without throwing. */
export function limitDetails(companyId: string, key: LimitKey) {
  const sub = subOf(companyId)
  const plan = subPlan(sub)
  return { code: 'LIMIT_REACHED' as const, limit: key, current: usedOf(companyId, key), max: plan.limits[key] ?? 0, planId: plan.id }
}

/** After a successful per-period action (email sent, AI credits used): count it, then check warnings. */
export function recordUsage(companyId: string, key: 'emailsPerMonth' | 'aiCredits', amount = 1): void {
  const sub = subscriptionOf(companyId)
  if (!sub) return
  counterRow(companyId, sub.currentPeriodStart)[key] += amount
  checkUsageWarnings(companyId)
}

/** After a stock change (user, lead, contact, file added): check the warnings. */
export function noteUsage(companyId: string): void {
  checkUsageWarnings(companyId)
}

/* ---------------- Lifecycle ---------------- */

interface LifecycleEvent {
  at: number
  apply: (at: string) => void
}

function sendReminderOnce(sub: Tenant<BillingSubscription>, key: string, title: string, body: string, at: string): void {
  if (billingSentKeys.includes(key)) return
  billingSentKeys.push(key)
  notifyAdmins(sub.companyId, 'billing', title, body, at)
}

function toCancelled(sub: Tenant<BillingSubscription>, at: string, reason: string, actor: BillingActor = null): void {
  const s = billingSettings
  sub.cancelAtPeriodEnd = false
  sub.scheduledChange = null
  voidOpenInvoices(sub.companyId)
  transition(sub, 'cancelled', at, {
    summary: `Subscription cancelled (${reason}). Data kept until ${fmtDate(ms(at) + s.retentionDays * DAY)}`,
    title: 'Subscription cancelled',
    body: `The workspace is read-only. Export your data before ${fmtDate(ms(at) + s.retentionDays * DAY)}, or reactivate a plan.`,
  }, actor)
  sub.deleteAt = iso(ms(at) + s.retentionDays * DAY)
}

function toPastDue(sub: Tenant<BillingSubscription>, at: string, why: string): void {
  const graceEnd = ms(at) + billingSettings.graceDays * DAY
  transition(sub, 'past_due', at, {
    summary: `Payment failed (${why}). Past due; grace period until ${fmtDate(graceEnd)}`,
    title: 'Payment failed',
    body: `Update your payment method before ${fmtDate(graceEnd)} to keep full access.`,
  })
  sub.graceEndsAt = iso(graceEnd)
}

function trialEnded(sub: Tenant<BillingSubscription>, at: string): void {
  if (sub.cancelAtPeriodEnd) return toCancelled(sub, at, 'cancelled during the trial')
  if (!sub.paymentMethod) {
    transition(sub, 'suspended', at, {
      summary: 'Trial ended without a payment method. Suspended (read-only)',
      title: 'Your trial has ended',
      body: 'The workspace is read-only. Add a payment method to choose a plan and continue.',
    })
    return
  }
  const { plan: chosen, note } = trialTarget(sub)
  if (chosen.id !== sub.planId) setPlan(sub, chosen)
  sub.selectedPlanId = null
  const target = subPlan(sub)
  const start = ms(at)
  const end = periodEndFrom(start, target)
  sub.currentPeriodStart = iso(start)
  sub.currentPeriodEnd = iso(end)
  const { ok } = autoCharge(sub, target, start, end, at)
  if (!ok) return toPastDue(sub, at, `trial conversion to ${target.name}${note}`)
  transition(sub, 'active', at, {
    summary: `Trial converted to the ${target.name} plan${note}`,
    title: `Welcome to ${target.name}`,
    body: `Your trial has ended and the ${target.name} plan is active. Next renewal ${fmtDate(end)}.`,
  })
}

/**
 * The plan a trial converts to: the paid plan the subscription is already on (platform change), else the
 * plan selected at sign-up / in billing (`selectedPlanId`) when it's still an active paid plan, else the
 * lowest-ranked active paid plan (`note` says why, for the audit entry).
 */
function trialTarget(sub: Tenant<BillingSubscription>): { plan: Plan; note: string } {
  const current = subPlan(sub)
  if (current.checkout !== 'none') return { plan: current, note: '' }
  const selected = sub.selectedPlanId ? planById(sub.selectedPlanId) : undefined
  if (selected && selected.active && selected.checkout === 'payment') return { plan: selected, note: '' }
  const fallback = trialConversionPlan()
  return {
    plan: fallback,
    note: selected
      ? ` (the selected ${selected.name} plan is no longer available; using ${fallback.name}, the lowest-ranked active paid plan)`
      : ` (no plan was selected; using ${fallback.name}, the lowest-ranked active paid plan)`,
  }
}

/** Renewal: moves to a pending plan version (platform migration 'at_renewal') if current usage fits it. */
function applyPendingVersion(sub: Tenant<BillingSubscription>, at: string): void {
  const pending = sub.pendingPlanVersion
  if (pending == null) return
  sub.pendingPlanVersion = null
  if (pending <= sub.planVersion) return
  const target = planAt(sub.planId, pending)
  const blocks = downgradeBlocks(sub.companyId, target)
  if (blocks.length) {
    audit(sub.companyId, null, `Kept version ${sub.planVersion} of the ${target.name} plan at renewal: usage exceeds version ${pending} (${blocks.map((b) => b.label.toLowerCase()).join(', ')})`, at)
    return
  }
  const from = sub.planVersion
  sub.planVersion = pending
  syncCompany(sub)
  audit(sub.companyId, null, `Moved to version ${pending} of the ${target.name} plan at renewal`, at, [{ field: 'planVersion', from: String(from), to: String(pending) }])
}

function periodEnded(sub: Tenant<BillingSubscription>, at: string): void {
  if (sub.cancelAtPeriodEnd) return toCancelled(sub, at, 'cancelled at the end of the period')
  if (sub.scheduledChange) {
    const from = subPlan(sub)
    const to = planById(sub.scheduledChange.toPlan) ?? from
    sub.scheduledChange = null
    setPlan(sub, to)
    audit(sub.companyId, null, `Scheduled change applied: ${from.name} → ${to.name}`, at, [{ field: 'plan', from: from.name, to: to.name }])
    notifyAdmins(sub.companyId, 'billing', `You’re now on ${to.name}`, `The plan change you scheduled took effect on ${fmtDate(at)}.`, at)
  }
  applyPendingVersion(sub, at)
  const plan = subPlan(sub)
  const start = ms(sub.currentPeriodEnd)
  const end = periodEndFrom(start, plan)
  sub.currentPeriodStart = iso(start)
  sub.currentPeriodEnd = iso(end)
  const { ok, invoice } = autoCharge(sub, plan, start, end, at)
  if (!ok) return toPastDue(sub, at, `renewal of the ${plan.name} plan`)
  audit(sub.companyId, null, `Renewed the ${plan.name} plan until ${fmtDate(end)}${invoice ? ` (${invoice.number} paid)` : ''}`, at)
}

/** The next due event (status change or reminder) of a subscription, or null. */
function nextEvent(sub: Tenant<BillingSubscription>): LifecycleEvent | null {
  const s = billingSettings
  const events: LifecycleEvent[] = []
  const since = ms(sub.statusChangedAt)
  switch (sub.status) {
    case 'trialing': {
      if (!sub.trialEndsAt) break
      const end = ms(sub.trialEndsAt)
      for (const d of s.trialReminderDays) {
        const t = end - d * DAY
        const key = `${sub.companyId}|trial-reminder|${sub.trialEndsAt}|${d}`
        if (t < since || billingSentKeys.includes(key)) continue
        events.push({
          at: t,
          apply: (at) =>
            sendReminderOnce(
              sub,
              key,
              `Your trial ends in ${d} ${d === 1 ? 'day' : 'days'}`,
              sub.paymentMethod
                ? `On ${fmtDate(end)} your card ending ${sub.paymentMethod.last4} is charged and your plan starts.`
                : `Add a payment method before ${fmtDate(end)} to keep using your workspace.`,
              at,
            ),
        })
      }
      events.push({ at: end, apply: (at) => trialEnded(sub, at) })
      break
    }
    case 'active':
      events.push({ at: ms(sub.currentPeriodEnd), apply: (at) => periodEnded(sub, at) })
      break
    case 'past_due': {
      const graceEnd = sub.graceEndsAt ? ms(sub.graceEndsAt) : since + s.graceDays * DAY
      for (const d of s.pastDueReminderDays) {
        const t = since + d * DAY
        const key = `${sub.companyId}|pastdue-reminder|${sub.statusChangedAt}|${d}`
        if (t >= graceEnd || billingSentKeys.includes(key)) continue
        events.push({
          at: t,
          apply: (at) =>
            sendReminderOnce(sub, key, 'Payment overdue', `Update your payment method before ${fmtDate(graceEnd)} to keep full access.`, at),
        })
      }
      events.push({
        at: graceEnd,
        apply: (at) =>
          transition(sub, 'suspended', at, {
            summary: 'Grace period ended without payment. Suspended (read-only)',
            title: 'Workspace suspended',
            body: `The workspace is read-only. Update your payment method to restore access before ${fmtDate(ms(at) + s.suspendedDaysBeforeCancel * DAY)}.`,
          }),
      })
      break
    }
    case 'suspended':
      events.push({ at: since + s.suspendedDaysBeforeCancel * DAY, apply: (at) => toCancelled(sub, at, `suspended for ${s.suspendedDaysBeforeCancel} days`) })
      break
    case 'cancelled':
      if (sub.deleteAt) {
        events.push({
          at: ms(sub.deleteAt),
          apply: (at) =>
            transition(sub, 'deleted', at, {
              summary: 'Retention period ended. Workspace deleted',
              title: 'Workspace deleted',
              body: 'The retention period has ended.',
            }),
        })
      }
      break
    case 'deleted':
      break
  }
  if (events.length === 0) return null
  return events.reduce((a, b) => (b.at < a.at ? b : a))
}

/**
 * Applies every transition and reminder due up to `until` (default: the mock clock's now), in time
 * order, each at its own time. Idempotent; called lazily for the caller's company on every
 * authenticated request and for all companies by POST /dev/billing/advance.
 */
export function runLifecycle(companyId: string, until = nowMs()): void {
  const sub = subscriptionOf(companyId)
  if (!sub) return
  for (let i = 0; i < 1000; i++) {
    const ev = nextEvent(sub)
    if (!ev || ev.at > until) return
    ev.apply(iso(ev.at))
  }
}

export function runLifecycleForAll(until = nowMs()): void {
  for (const sub of subscriptions) runLifecycle(sub.companyId, until)
}

/* ---------------- Request policy (called centrally by userFrom) ---------------- */

/** API paths of plan modules that have no role permission (or are locked by plan): path → module. */
const MODULE_PATHS: [RegExp, PlanModule][] = [
  [/^\/hr(\/|$)/, 'hr'],
  [/^\/events(\/|$)/, 'events'],
  [/^\/marketing(\/|$)/, 'marketing'],
  [/^\/finance(\/|$)/, 'accounting'],
  [/^\/integrations(\/|$)/, 'integrations'],
  [/^\/settings\/email-connection(\/|$)/, 'integrations'],
  [/^\/ai(\/|$)/, 'ai'],
]

/**
 * Writes that stay allowed while Suspended / Cancelled (read-only): sign-in and session (role switch,
 * impersonation stop, signing out sessions, 2FA, own password), paying, exporting, marking alerts read,
 * dev tools.
 */
const READ_ONLY_EXEMPT: RegExp[] = [
  /^\/auth\//,
  /^\/security\/(sessions|2fa)(\/|$)/,
  /^\/account\/password$/,
  /^\/billing\/(payment-method|reactivate|resume|export)$/,
  /^\/alerts\/read-all$/,
  /^\/alerts\/[^/]+\/read$/,
  /^\/announcements\/[^/]+\/dismiss$/,
  /^\/dev\/billing\//,
]

export function moduleForPath(path: string): PlanModule | null {
  return MODULE_PATHS.find(([re]) => re.test(path))?.[1] ?? null
}

export function isReadOnly(status: SubscriptionStatus): boolean {
  return status === 'suspended' || status === 'cancelled'
}

/** Throws 403 module_not_in_plan when the company's modules (plan version ± platform overrides) don't include `module`. */
export function assertModule(companyId: string, module: PlanModule): void {
  const sub = subscriptionOf(companyId)
  if (!sub) return
  const plan = subPlan(sub)
  if (!effectiveModules(companyId, plan.modules).includes(module)) {
    throw err(`This feature isn’t included in your ${plan.name} plan. Upgrade to use it.`, 403, 'module_not_in_plan', { module, planId: plan.id })
  }
}

/**
 * The billing part of every authenticated request (`path` is relative to the API base, e.g.
 * "/leads/L-1"): runs the lifecycle for the company, then
 *   deleted  → 410 workspace_deleted (everything except /dev/billing/*)
 *   module   → 403 module_not_in_plan (path mapped to a plan module the plan lacks)
 *   suspended / cancelled + non-GET (not exempt) → 423 workspace_read_only
 */
export function enforceRequestPolicy(companyId: string, method: string, path: string): void {
  runLifecycle(companyId)
  const sub = subscriptionOf(companyId)
  if (!sub) return
  const dev = /^\/dev\/billing\//.test(path)
  if (sub.status === 'deleted' && !dev) {
    throw err('This workspace has been deleted.', 410, 'workspace_deleted', { status: sub.status })
  }
  const module = moduleForPath(path)
  if (module) assertModule(companyId, module)
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  if (write && isReadOnly(sub.status) && !READ_ONLY_EXEMPT.some((re) => re.test(path))) {
    throw err(
      sub.status === 'suspended'
        ? 'This workspace is suspended and read-only. Update the payment method to make changes.'
        : 'This workspace is cancelled and read-only. Reactivate a plan to make changes.',
      423,
      'workspace_read_only',
      { status: sub.status },
    )
  }
}

/** Sign-in check: a deleted workspace can't be signed in to (410). Runs the lifecycle first. */
export function assertNotDeleted(companyId: string): void {
  runLifecycle(companyId)
  if (subscriptionOf(companyId)?.status === 'deleted') throw err('This workspace has been deleted.', 410, 'workspace_deleted', { status: 'deleted' })
}

/* ---------------- Sign-up ---------------- */

/** Creates the subscription of a new company (inside sign-up's atomic transaction). */
export function createSignupSubscription(
  companyId: string,
  id: string,
  plan: Plan,
  paymentMethod: BillingSubscription['paymentMethod'],
  selectedPlanId: BillingSubscription['selectedPlanId'] = null,
): Tenant<BillingSubscription> {
  const t = nowMs()
  const at = iso(t)
  const trial = plan.checkout === 'none'
  const end = trial ? t + billingSettings.trialDays * DAY : periodEndFrom(t, plan)
  const sub: Tenant<BillingSubscription> = {
    id,
    companyId,
    planId: plan.id,
    status: trial ? 'trialing' : 'active',
    startedAt: at,
    trialEndsAt: trial ? iso(end) : null,
    currentPeriodStart: at,
    currentPeriodEnd: iso(end),
    paymentMethod: trial ? null : paymentMethod,
    scheduledChange: null,
    cancelAtPeriodEnd: false,
    statusChangedAt: at,
    graceEndsAt: null,
    deleteAt: null,
    customPrice: null,
    planVersion: plan.version ?? 1,
    pendingPlanVersion: null,
    selectedPlanId: trial ? selectedPlanId : null,
  }
  subscriptions.push(sub)
  if (!trial && (plan.price ?? 0) > 0) createInvoice(sub, plan, plan.price ?? 0, t, end, `${plan.name} plan, monthly (sign-up)`, 'paid', at)
  return sub
}

/* ---------------- Endpoints ---------------- */

function requireAdmin(user: User): void {
  if (!can(user.role, 'settings', 'edit')) throw new ApiError('Only a Company Admin can manage the subscription.', 403)
}

export const publicSub = (sub: Tenant<BillingSubscription>): BillingSubscription => {
  const { companyId: _c, ...rest } = sub
  void _c
  return rest
}
export const publicInvoice = (inv: Tenant<BillingInvoice>): BillingInvoice => {
  const { companyId: _c, ...rest } = inv
  void _c
  return rest
}

export function entitlementsOf(companyId: string): Entitlements {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  const plan = subPlan(sub)
  const usage = usageOf(companyId)
  return {
    planId: plan.id,
    planName: plan.name,
    status: sub.status,
    modules: effectiveModules(companyId, plan.modules),
    limits: { ...plan.limits },
    reached: usage.items.filter((i) => i.limit !== null && i.used >= i.limit).map((i) => i.key),
    readOnly: isReadOnly(sub.status),
    trialDaysLeft: sub.status === 'trialing' && sub.trialEndsAt ? Math.max(0, Math.ceil((ms(sub.trialEndsAt) - nowMs()) / DAY)) : null,
    graceEndsAt: sub.status === 'past_due' ? sub.graceEndsAt : null,
    deleteAt: sub.status === 'cancelled' ? sub.deleteAt : null,
    serverNow: nowIso(),
  }
}

/** GET /billing/entitlements — any signed-in user of the company. */
export async function getEntitlements(user: User): Promise<Entitlements> {
  return delay(entitlementsOf(tenantOf(user)))
}

function overviewOf(companyId: string): BillingOverview {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  const plan = subPlan(sub)
  const offered = activePlans()
  if (!offered.some((p) => p.id === plan.id)) offered.push(plan)
  return {
    subscription: publicSub(sub),
    plan,
    usage: usageOf(companyId),
    invoices: billingInvoices
      .filter((i) => i.companyId === companyId)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number.localeCompare(a.number))
      .map(publicInvoice),
    plans: offered.sort((a, b) => a.rank - b.rank),
    settings: structuredClone(billingSettings),
    serverNow: nowIso(),
  }
}

/** GET /billing/overview — Company Admin and Management (read). */
export async function getBillingOverview(user: User): Promise<BillingOverview> {
  if (!canViewCompanyProfile(user.role)) throw new ApiError('Only admins can see the subscription.', 403)
  return delay(overviewOf(tenantOf(user)))
}

/** Stock limits the plan can't hold right now (409 downgrade_blocked). */
export function downgradeBlocks(companyId: string, target: Plan): DowngradeBlock[] {
  return STOCK_LIMITS.flatMap((key) => {
    const limit = target.limits[key]
    if (limit === null) return []
    const used = usedOf(companyId, key)
    return used > limit ? [{ key, label: LIMIT_LABEL[key], used, limit }] : []
  })
}

function choosablePlan(planId: unknown): Plan {
  const plan = typeof planId === 'string' ? planById(planId) : undefined
  if (!plan || !plan.active) throw err('Choose an available plan.', 422, 'invalid_plan')
  if (plan.checkout === 'contact') throw err(`${plan.name} is set up with our sales team. Contact sales to switch.`, 422, 'contact_sales')
  if (plan.checkout === 'none') throw err('The trial can’t be chosen as a plan.', 422, 'invalid_plan')
  return plan
}

function assertNoBlocks(companyId: string, target: Plan): void {
  const blocks = downgradeBlocks(companyId, target)
  if (blocks.length) {
    const what = blocks.map((b) => `${b.label.toLowerCase()} (${b.used.toLocaleString('en-US')} of ${b.limit.toLocaleString('en-US')})`).join(', ')
    throw err(`You’re using more than the ${target.name} plan allows: ${what}. Reduce usage first.`, 409, 'downgrade_blocked', { blocks })
  }
}

/** POST /billing/change-plan { planId } — Company Admin. Upgrade now (prorated), downgrade at period end. */
export async function changePlan(user: User, input: { planId?: unknown } | null): Promise<ChangePlanResult> {
  requireAdmin(user)
  const co = tenantOf(user)
  runLifecycle(co)
  const sub = subOf(co)
  const current = subPlan(sub)
  const target = choosablePlan(input?.planId)
  if (target.id === current.id) throw err(`You’re already on the ${current.name} plan.`, 409, 'same_plan')
  if (sub.status !== 'trialing' && sub.status !== 'active') {
    throw err(
      sub.status === 'past_due' ? 'Your last payment failed. Update your payment method first.' : 'Reactivate the subscription to change plans.',
      409,
      'invalid_state',
      { status: sub.status },
    )
  }
  const at = nowIso()
  const t = nowMs()

  if (target.rank > current.rank || sub.status === 'trialing') {
    if (!sub.paymentMethod) throw err('Add a payment method before upgrading.', 422, 'payment_method_required')
    let invoice: BillingInvoice | null
    if (sub.status === 'trialing') {
      const end = periodEndFrom(t, target)
      setPlan(sub, target)
      sub.currentPeriodStart = at
      sub.currentPeriodEnd = iso(end)
      invoice = createInvoice(sub, target, target.price ?? 0, t, end, `${target.name} plan, monthly`, 'paid', at)
      sub.scheduledChange = null
      transition(sub, 'active', at, {
        summary: `Upgraded from the trial to the ${target.name} plan`,
        title: `Upgraded to ${target.name}`,
        body: `${user.name} upgraded the workspace to ${target.name}. Next renewal ${fmtDate(end)}.`,
      }, user)
    } else {
      const start = ms(sub.currentPeriodStart)
      const end = ms(sub.currentPeriodEnd)
      const left = Math.max(0, Math.min(1, (end - t) / Math.max(1, end - start)))
      const amount = round2(Math.max(0, ((target.price ?? 0) - priceOf(sub, current)) * left))
      setPlan(sub, target)
      sub.scheduledChange = null
      invoice = createInvoice(sub, target, amount, t, end, `Upgrade ${current.name} → ${target.name} (prorated)`, 'paid', at)
      audit(co, user, `Upgraded ${current.name} → ${target.name} (${invoice.number}, ${amount.toFixed(2)} ${target.currency})`, at, [
        { field: 'plan', from: current.name, to: target.name },
      ])
      notifyAdmins(co, 'billing', `Upgraded to ${target.name}`, `${user.name} upgraded the workspace from ${current.name} to ${target.name}.`, at)
    }
    noteUsage(co)
    return delay({ kind: 'upgraded' as const, overview: overviewOf(co), invoice: publicInvoice(invoice as Tenant<BillingInvoice>) })
  }

  // Downgrade: scheduled for the end of the period, unless stock usage doesn't fit.
  assertNoBlocks(co, target)
  sub.scheduledChange = { toPlan: target.id, effectiveAt: sub.currentPeriodEnd, requestedAt: at, requestedBy: user.name }
  audit(co, user, `Scheduled a change ${current.name} → ${target.name} on ${fmtDate(sub.currentPeriodEnd)}`, at)
  notifyAdmins(co, 'billing', `Plan change scheduled`, `${user.name} scheduled a change to ${target.name} on ${fmtDate(sub.currentPeriodEnd)}.`, at)
  return delay({ kind: 'scheduled' as const, overview: overviewOf(co), invoice: null })
}

/** DELETE /billing/scheduled-change — Company Admin. */
export async function cancelScheduledChange(user: User): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  const sub = subOf(co)
  if (!sub.scheduledChange) throw err('There’s no scheduled plan change.', 409, 'no_scheduled_change')
  const to = planById(sub.scheduledChange.toPlan)?.name ?? sub.scheduledChange.toPlan
  sub.scheduledChange = null
  audit(co, user, `Cancelled the scheduled change to ${to}`, nowIso())
  return delay(overviewOf(co))
}

/**
 * POST /billing/payment-method — Company Admin. Saves the card (mock: 4242… ok, 4000 0000 0000 0002
 * declined). Past due / suspended: retries the open invoice (or starts a new period) → active.
 */
export async function setPaymentMethod(user: User, input: Partial<PaymentMethodInput> | null): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  runLifecycle(co)
  const sub = subOf(co)
  if (sub.status === 'cancelled' || sub.status === 'deleted') {
    throw err('This subscription is cancelled. Reactivate a plan instead.', 409, 'invalid_state', { status: sub.status })
  }
  const card = parseCard(input ?? {}, new Date(nowMs()))
  const at = nowIso()
  const before = sub.paymentMethod
  sub.paymentMethod = card
  audit(co, user, `Payment method set to ${card.brand} ending ${card.last4}`, at, [
    { field: 'paymentMethod', from: before ? `${before.brand} ${before.last4}` : '—', to: `${card.brand} ${card.last4}` },
  ])

  if (sub.status === 'past_due' || sub.status === 'suspended') {
    const open = openInvoices(co)
    const t = nowMs()
    if (open.length > 0 && ms(sub.currentPeriodEnd) > t) {
      for (const inv of open) inv.status = 'paid'
    } else {
      // No open charge (trial ended without a card) or the period lapsed: start a new period now.
      voidOpenInvoices(co)
      // A trial that ended without a card converts to the selected plan (or the fallback), as at trial end.
      const { plan: chosen, note } = trialTarget(sub)
      if (chosen.id !== sub.planId) {
        setPlan(sub, chosen)
        audit(co, user, `Trial converted to the ${chosen.name} plan${note}`, at)
      }
      sub.selectedPlanId = null
      const plan = subPlan(sub)
      const end = periodEndFrom(t, plan)
      sub.currentPeriodStart = at
      sub.currentPeriodEnd = iso(end)
      const amount = priceOf(sub, plan)
      if (amount > 0) createInvoice(sub, plan, amount, t, end, `${plan.name} plan, monthly`, 'paid', at)
    }
    transition(sub, 'active', at, {
      summary: 'Payment received. Subscription active again',
      title: 'Payment received',
      body: 'Thanks! Your subscription is active and the workspace has full access again.',
    }, user)
  }
  return delay(overviewOf(co))
}

/** POST /billing/cancel — Company Admin. Cancels at the end of the period (or trial). */
export async function cancelSubscription(user: User): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  const sub = subOf(co)
  if (sub.status !== 'active' && sub.status !== 'trialing') {
    throw err('Only an active subscription or trial can be cancelled.', 409, 'invalid_state', { status: sub.status })
  }
  if (sub.cancelAtPeriodEnd) throw err('The subscription is already set to cancel.', 409, 'already_cancelling')
  sub.cancelAtPeriodEnd = true
  const end = sub.status === 'trialing' && sub.trialEndsAt ? sub.trialEndsAt : sub.currentPeriodEnd
  const at = nowIso()
  audit(co, user, `Set the subscription to cancel on ${fmtDate(end)}`, at)
  notifyAdmins(co, 'billing', 'Cancellation scheduled', `${user.name} cancelled the subscription. It stays active until ${fmtDate(end)}.`, at)
  return delay(overviewOf(co))
}

/** POST /billing/resume — Company Admin. Undoes a pending cancellation. */
export async function resumeSubscription(user: User): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  const sub = subOf(co)
  if (!sub.cancelAtPeriodEnd || (sub.status !== 'active' && sub.status !== 'trialing')) {
    throw err('There’s no pending cancellation to undo.', 409, 'not_cancelling', { status: sub.status })
  }
  sub.cancelAtPeriodEnd = false
  const at = nowIso()
  audit(co, user, 'Resumed the subscription (cancellation undone)', at)
  notifyAdmins(co, 'billing', 'Subscription resumed', `${user.name} undid the cancellation.`, at)
  return delay(overviewOf(co))
}

/** POST /billing/reactivate { planId } — Company Admin; Suspended or Cancelled. Pays now with the saved card. */
export async function reactivateSubscription(user: User, input: { planId?: unknown } | null): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  runLifecycle(co)
  const sub = subOf(co)
  if (sub.status !== 'suspended' && sub.status !== 'cancelled') {
    throw err('Only a suspended or cancelled subscription can be reactivated.', 409, 'invalid_state', { status: sub.status })
  }
  const target = choosablePlan(input?.planId)
  if (!sub.paymentMethod) throw err('Add a payment method first.', 422, 'payment_method_required')
  assertNoBlocks(co, target)
  const at = nowIso()
  const t = nowMs()
  const from = subPlan(sub)
  voidOpenInvoices(co)
  setPlan(sub, target)
  const end = periodEndFrom(t, target)
  sub.currentPeriodStart = at
  sub.currentPeriodEnd = iso(end)
  sub.scheduledChange = null
  sub.cancelAtPeriodEnd = false
  createInvoice(sub, target, priceOf(sub, target), t, end, `${target.name} plan, monthly (reactivation)`, 'paid', at)
  transition(sub, 'active', at, {
    summary: `Reactivated on the ${target.name} plan${from.id !== target.id ? ` (was ${from.name})` : ''}`,
    title: 'Subscription reactivated',
    body: `${user.name} reactivated the workspace on the ${target.name} plan. Next renewal ${fmtDate(end)}.`,
  }, user)
  return delay(overviewOf(co))
}

/** GET /billing/export — Company Admin (allowed while read-only). The company's data only. */
export async function exportData(user: User): Promise<DataExport> {
  requireAdmin(user)
  const co = tenantOf(user)
  const company = companyById(co)!
  const strip = <T extends { companyId?: string }>(rows: readonly T[]) =>
    rows
      .filter((r) => r.companyId === co)
      .map((r) => {
        const { companyId: _c, ...rest } = r
        void _c
        return rest
      })
  const data: Record<string, unknown[]> = {
    leads: strip(leads),
    contacts: strip(contacts),
    customers: strip(customers),
    tasks: strip(tasks),
    projects: strip(projects),
    quotations: strip(quotations),
    users: strip(users),
  }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]))
  recordAudit(user, { action: 'security', entity: 'subscription', entityId: subOf(co).id, summary: 'Exported the workspace data' })
  return delay({ generatedAt: nowIso(), company: { name: company.name, subdomain: company.subdomain }, counts, data })
}

/** POST /ai/credits/consume { credits } — module `ai` + the aiCredits limit. The only AI credit consumer for now. */
export async function consumeAiCredits(user: User, input: { credits?: unknown } | null): Promise<AiCreditsResult> {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  const credits = Number(input?.credits)
  if (!Number.isInteger(credits) || credits < 1 || credits > 1000) throw err('Credits must be a whole number from 1 to 1,000.', 422, 'invalid_credits')
  assertCapacity(co, 'aiCredits', credits)
  recordUsage(co, 'aiCredits', credits)
  const limit = subPlan(subOf(co)).limits.aiCredits
  const used = usedOf(co, 'aiCredits')
  return delay({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used) })
}

/* ---------------- Trial plan selection ---------------- */

/** POST /billing/trial-plan { planId } — Company Admin, trialing only: the paid plan the trial converts to. */
export async function setTrialPlan(user: User, input: { planId?: unknown } | null): Promise<BillingOverview> {
  requireAdmin(user)
  const co = tenantOf(user)
  runLifecycle(co)
  const sub = subOf(co)
  if (sub.status !== 'trialing') throw err('A plan to continue on can only be chosen during the trial.', 409, 'invalid_state', { status: sub.status })
  const target = choosablePlan(input?.planId)
  const before = sub.selectedPlanId ? (planById(sub.selectedPlanId)?.name ?? sub.selectedPlanId) : '—'
  sub.selectedPlanId = target.id
  audit(co, user, `Chose the ${target.name} plan to continue on after the trial`, nowIso(), [{ field: 'selectedPlan', from: before, to: target.name }])
  return delay(overviewOf(co))
}

/* ---------------- Platform settings validation (used by /platform/settings) ---------------- */

function dayList(v: unknown, field: string, max: number): number[] {
  if (!Array.isArray(v) || v.length > 10 || v.some((d) => !Number.isInteger(d) || d < 1 || d > max)) {
    throw err(`${field} must be a list of up to 10 whole numbers from 1 to ${max}.`, 422, 'invalid_settings', { field })
  }
  return [...new Set(v as number[])].sort((a, b) => b - a)
}

/** A whole-number setting in [min, max], else 422 invalid_settings { field }. */
export function wholeSetting(v: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
    throw err(`${field} must be a whole number from ${min} to ${max}.`, 422, 'invalid_settings', { field })
  }
  return v as number
}

/** Validates a billing-settings patch and returns the would-be settings (nothing is saved). */
export function validatedBillingSettings(patch: Partial<PlatformBillingSettings> | null): PlatformBillingSettings {
  const p = patch ?? {}
  const next: PlatformBillingSettings = structuredClone(billingSettings)
  if (p.trialDays !== undefined) next.trialDays = wholeSetting(p.trialDays, 'trialDays', 1, 90)
  if (p.graceDays !== undefined) next.graceDays = wholeSetting(p.graceDays, 'graceDays', 0, 60)
  if (p.suspendedDaysBeforeCancel !== undefined) next.suspendedDaysBeforeCancel = wholeSetting(p.suspendedDaysBeforeCancel, 'suspendedDaysBeforeCancel', 0, 365)
  if (p.retentionDays !== undefined) next.retentionDays = wholeSetting(p.retentionDays, 'retentionDays', 0, 365)
  if (p.trialReminderDays !== undefined) next.trialReminderDays = dayList(p.trialReminderDays, 'trialReminderDays', 90)
  if (p.pastDueReminderDays !== undefined) next.pastDueReminderDays = dayList(p.pastDueReminderDays, 'pastDueReminderDays', 60)
  if (p.usageWarningThresholds !== undefined) {
    next.usageWarningThresholds = dayList(p.usageWarningThresholds, 'usageWarningThresholds', 100).sort((a, b) => a - b)
  }
  return next
}

/* ---------------- Platform operations (Super-Admin Console; permission + reason checked by the caller) ---------------- */

const invalidState = (sub: BillingSubscription, message: string) => err(message, 409, 'invalid_state', { status: sub.status })

/** change_plan: immediate, no charge, same subscription (a trial stays a trial), the plan's current version. */
export function platformChangePlan(companyId: string, planId: unknown, reason: string, actor: AuditActor): { from: string; to: string } {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  if (sub.status === 'deleted') throw invalidState(sub, 'This workspace has been deleted.')
  const target = typeof planId === 'string' ? planById(planId) : undefined
  if (!target || !target.active || target.checkout === 'none') throw err('Choose an active plan (not the trial).', 422, 'invalid_plan')
  const from = subPlan(sub)
  if (target.id === sub.planId) throw err(`The company is already on the ${from.name} plan.`, 409, 'same_plan')
  const at = nowIso()
  sub.scheduledChange = null
  setPlan(sub, target)
  if (sub.status === 'trialing') sub.selectedPlanId = null
  audit(companyId, actor, `Plan changed by Apex CRM: ${from.name} → ${target.name} (no charge). Reason: ${reason}`, at, [{ field: 'plan', from: from.name, to: target.name }])
  notifyAdmins(companyId, 'billing', `Your plan is now ${target.name}`, `Apex CRM changed your plan from ${from.name} to ${target.name}. No charge was made.`, at)
  return { from: from.name, to: target.name }
}

/** extend_trial: trialing only, 1–90 days. Reminders already due under the new date are skipped (not sent late). */
export function platformExtendTrial(companyId: string, days: unknown, reason: string, actor: AuditActor): { from: string; to: string } {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  if (sub.status !== 'trialing' || !sub.trialEndsAt) throw invalidState(sub, 'Only a trial can be extended.')
  const n = Number(days)
  if (!Number.isInteger(n) || n < 1 || n > 90) throw err('Extend the trial by 1 to 90 days.', 422, 'invalid_days')
  const before = sub.trialEndsAt
  const end = ms(before) + n * DAY
  sub.trialEndsAt = iso(end)
  sub.currentPeriodEnd = iso(end)
  for (const d of billingSettings.trialReminderDays) {
    const key = `${companyId}|trial-reminder|${sub.trialEndsAt}|${d}`
    if (end - d * DAY <= nowMs() && !billingSentKeys.includes(key)) billingSentKeys.push(key)
  }
  const at = nowIso()
  audit(companyId, actor, `Trial extended by Apex CRM by ${n} ${n === 1 ? 'day' : 'days'}, to ${fmtDate(end)}. Reason: ${reason}`, at, [
    { field: 'trialEndsAt', from: fmtDate(before), to: fmtDate(end) },
  ])
  notifyAdmins(companyId, 'billing', 'Your trial was extended', `Your trial now ends on ${fmtDate(end)}.`, at)
  return { from: before, to: sub.trialEndsAt }
}

/**
 * reactivate (billing part): a suspended / cancelled subscription returns to active with a new period
 * from now, no charge (open invoices void). An ended trial converts as at trial end. Returns false when
 * the subscription wasn't suspended / cancelled (nothing to do).
 */
export function platformReactivateSubscription(companyId: string, reason: string, actor: AuditActor): boolean {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  if (sub.status === 'deleted') throw invalidState(sub, 'This workspace has been deleted and can’t be reactivated.')
  if (sub.status !== 'suspended' && sub.status !== 'cancelled') return false
  const at = nowIso()
  const t = nowMs()
  voidOpenInvoices(companyId)
  if (subPlan(sub).checkout === 'none') setPlan(sub, trialTarget(sub).plan)
  sub.selectedPlanId = null
  const plan = subPlan(sub)
  const end = periodEndFrom(t, plan)
  sub.currentPeriodStart = at
  sub.currentPeriodEnd = iso(end)
  sub.scheduledChange = null
  sub.cancelAtPeriodEnd = false
  transition(sub, 'active', at, {
    summary: `Reactivated by Apex CRM on the ${plan.name} plan (no charge). Reason: ${reason}`,
    title: 'Subscription reactivated',
    body: `Apex CRM reactivated your workspace on the ${plan.name} plan. Next renewal ${fmtDate(end)}.`,
  }, actor)
  return true
}

/** cancel: the subscription is cancelled now (read-only; the retention countdown starts). */
export function platformCancel(companyId: string, reason: string, actor: AuditActor): { from: SubscriptionStatus } {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  if (sub.status === 'cancelled' || sub.status === 'deleted') throw invalidState(sub, 'The subscription is already cancelled.')
  const from = sub.status
  toCancelled(sub, nowIso(), `by Apex CRM: ${reason}`, actor)
  return { from }
}

/**
 * Plan migration 'now' for one subscription: moves it to `version` of its plan unless current stock usage
 * exceeds that version's limits (then it stays and the blocks are returned). Nothing is deleted.
 */
export function migrateToVersionNow(companyId: string, version: number, actor: AuditActor): DowngradeBlock[] {
  runLifecycle(companyId)
  const sub = subOf(companyId)
  const target = planAt(sub.planId, version)
  const blocks = downgradeBlocks(companyId, target)
  if (blocks.length) return blocks
  const from = sub.planVersion
  sub.planVersion = version
  sub.pendingPlanVersion = null
  syncCompany(sub)
  const at = nowIso()
  audit(companyId, actor, `Moved to version ${version} of the ${target.name} plan by Apex CRM`, at, [{ field: 'planVersion', from: String(from), to: String(version) }])
  notifyAdmins(companyId, 'billing', `Your ${target.name} plan was updated`, 'Your plan’s limits, modules or price changed today. See Billing for details.', at)
  return []
}

/** Plan migration 'at_renewal': the version is applied by the next renewal (if usage fits then). */
export function scheduleVersionAtRenewal(companyId: string, version: number): void {
  subOf(companyId).pendingPlanVersion = version
}

/** MRR of one subscription, normalized to a month (custom price wins; yearly / 12). Billable statuses only. */
export function monthlyRevenueOf(sub: BillingSubscription): number {
  if (sub.status !== 'active' && sub.status !== 'past_due') return 0
  const plan = subPlan(sub)
  const price = priceOf(sub, plan)
  return round2(plan.billingPeriod === 'year' ? price / 12 : price)
}

/** Open / failed invoices of a company (amount due). */
export function amountDueOf(companyId: string): number {
  return round2(billingInvoices.filter((i) => i.companyId === companyId && (i.status === 'open' || i.status === 'failed')).reduce((a, i) => a + i.amount, 0))
}

export { LIMIT_LABEL }

/* ---------------- Dev-only simulation (/dev/billing/*) ---------------- */

function devStateOf(companyId: string): DevBillingStateDetails {
  const sub = subOf(companyId)
  return {
    offsetDays: offsetDays(),
    now: nowIso(),
    failNextPayment: failNextPayment.includes(companyId),
    subscription: publicSub(sub),
    simulated: Object.fromEntries(usageSimulation.filter((s) => s.companyId === companyId).map((s) => [s.key, s.offset])),
  }
}

export async function devGetState(user: User): Promise<DevBillingStateDetails> {
  return delay(devStateOf(tenantOf(user)))
}

/** POST /dev/billing/advance { days } — moves the mock clock and runs the lifecycle for every company. */
export async function devAdvance(user: User, input: { days?: unknown } | null): Promise<DevBillingStateDetails> {
  const days = Number(input?.days)
  if (!Number.isFinite(days) || days <= 0 || days > 400) throw err('Days must be a number from 1 to 400.', 422, 'invalid_days')
  advanceClock(days)
  runLifecycleForAll()
  return delay(devStateOf(tenantOf(user)))
}

const STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'suspended', 'cancelled', 'deleted']

/** POST /dev/billing/status { status } — forces a state for the caller's company (audited, admins notified). */
export async function devSetStatus(user: User, input: { status?: unknown } | null): Promise<DevBillingStateDetails> {
  const status = input?.status as SubscriptionStatus
  if (!STATUSES.includes(status)) throw err('Unknown status.', 422, 'invalid_status')
  const co = tenantOf(user)
  const sub = subOf(co)
  const s = billingSettings
  const t = nowMs()
  const at = iso(t)
  const plan = subPlan(sub)
  if (status === 'trialing' || status === 'active') {
    const end = status === 'trialing' ? t + s.trialDays * DAY : periodEndFrom(t, plan)
    sub.currentPeriodStart = at
    sub.currentPeriodEnd = iso(end)
    sub.cancelAtPeriodEnd = false
    voidOpenInvoices(co)
    transition(sub, status, at, { summary: `Status forced to ${STATUS_LABEL[status]} (dev)`, title: `Subscription ${STATUS_LABEL[status].toLowerCase()}`, body: 'Set by the dev billing tools.' }, user)
    if (status === 'trialing') sub.trialEndsAt = iso(end)
  } else if (status === 'past_due') {
    if (openInvoices(co).length === 0 && priceOf(sub, plan) > 0) {
      createInvoice(sub, plan, priceOf(sub, plan), ms(sub.currentPeriodStart), ms(sub.currentPeriodEnd), `${plan.name} plan, monthly`, 'open', at)
    }
    transition(sub, 'past_due', at, { summary: 'Status forced to Past due (dev)', title: 'Payment failed', body: `Update your payment method before ${fmtDate(t + s.graceDays * DAY)} to keep full access.` }, user)
    sub.graceEndsAt = iso(t + s.graceDays * DAY)
  } else if (status === 'cancelled') {
    toCancelled(sub, at, 'forced by the dev billing tools', user)
  } else {
    transition(sub, status, at, { summary: `Status forced to ${STATUS_LABEL[status]} (dev)`, title: `Subscription ${STATUS_LABEL[status].toLowerCase()}`, body: 'Set by the dev billing tools.' }, user)
  }
  return delay(devStateOf(co))
}

/** POST /dev/billing/fail-next-payment { fail } — the next automatic charge of the caller's company fails. */
export async function devFailNextPayment(user: User, input: { fail?: unknown } | null): Promise<DevBillingStateDetails> {
  const co = tenantOf(user)
  const i = failNextPayment.indexOf(co)
  if (input?.fail === false) {
    if (i >= 0) failNextPayment.splice(i, 1)
  } else if (i < 0) failNextPayment.push(co)
  return delay(devStateOf(co))
}

/**
 * POST /dev/billing/usage { key, percent } — simulated usage: stores an offset so that used ≈ percent
 * of the plan limit (real usage + offset). Unlimited limits are ignored. Usage warnings fire as usual.
 */
export async function devSetUsage(user: User, input: { key?: unknown; percent?: unknown } | null): Promise<DevBillingStateDetails> {
  const co = tenantOf(user)
  const key = input?.key as LimitKey
  if (!LIMIT_KEYS.includes(key)) throw err('Unknown limit.', 422, 'invalid_limit')
  const percent = Number(input?.percent)
  if (!Number.isFinite(percent) || percent < 0 || percent > 120) throw err('Percent must be from 0 to 120.', 422, 'invalid_percent')
  const limit = subPlan(subOf(co)).limits[key]
  if (limit !== null) {
    const real = realUsage(co, key, subOf(co))
    const target = key === 'storageMb' ? round2((limit * percent) / 100) : Math.round((limit * percent) / 100)
    const offset = round2(target - real)
    const row = usageSimulation.find((s) => s.companyId === co && s.key === key)
    if (row) row.offset = offset
    else usageSimulation.push({ companyId: co, key, offset })
    checkUsageWarnings(co)
  }
  return delay(devStateOf(co))
}

/** POST /dev/billing/reset — clears the caller's company simulation (usage offsets, fail flag). */
export async function devReset(user: User): Promise<DevBillingStateDetails> {
  const co = tenantOf(user)
  for (let i = usageSimulation.length - 1; i >= 0; i--) if (usageSimulation[i].companyId === co) usageSimulation.splice(i, 1)
  const f = failNextPayment.indexOf(co)
  if (f >= 0) failNextPayment.splice(f, 1)
  return delay(devStateOf(co))
}

/** Test helper: the stored notifications of a company's admins of one type. */
export function billingNotificationsOf(companyId: string, type: 'billing' | 'usage') {
  return notifications.filter((n) => n.companyId === companyId && n.type === type)
}

/** Exposed for sign-up (TRIAL_DAYS etc. come from the platform settings). */
export function currentBillingSettings(): PlatformBillingSettings {
  return billingSettings
}
