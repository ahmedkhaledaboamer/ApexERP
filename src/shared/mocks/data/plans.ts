import type { ModuleKey } from '@/shared/types'
import type { Plan, PlanId, PlanModule, PlatformBillingSettings } from '@/modules/billing/types'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * Plan catalog and platform billing settings: DATA, not constants. Served by GET /public/plans and
 * GET /billing/overview (and editable later by the Super-Admin console). Nothing in the UI or the
 * services hardcodes a plan's price, limits or modules; they read them from here.
 */

const STARTER_MODULES: PlanModule[] = ['sales', 'services', 'tasks', 'departments', 'reports', 'settings']
const BUSINESS_MODULES: PlanModule[] = [...STARTER_MODULES, 'marketing', 'accounting', 'events', 'integrations', 'ai']
const ALL_MODULES: PlanModule[] = [...BUSINESS_MODULES, 'hr']

const STARTER_LIMITS = { users: 5, leadsContacts: 2000, storageMb: 5120, emailsPerMonth: 2000, aiCredits: 100 }

export const plans: Plan[] = [
  {
    id: 'trial',
    name: 'Trial',
    price: null,
    currency: 'USD',
    billingPeriod: 'month',
    limits: { ...STARTER_LIMITS },
    modules: [...STARTER_MODULES],
    highlights: ['Free trial, no card needed', 'Everything in Starter', 'Upgrade any time'],
    checkout: 'none',
    active: true,
    rank: 0,
    version: 1,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    currency: 'USD',
    billingPeriod: 'month',
    limits: { ...STARTER_LIMITS },
    modules: [...STARTER_MODULES],
    highlights: ['Leads, pipeline and quotations', 'Services, projects and tasks', 'Up to 5 users'],
    checkout: 'payment',
    active: true,
    rank: 1,
    version: 1,
  },
  {
    id: 'business',
    name: 'Business',
    price: 79,
    currency: 'USD',
    billingPeriod: 'month',
    limits: { users: 25, leadsContacts: 25000, storageMb: 51200, emailsPerMonth: 20000, aiCredits: 1000 },
    modules: [...BUSINESS_MODULES],
    highlights: ['Everything in Starter', 'Marketing, accounting, events and AI', 'Up to 25 users'],
    checkout: 'payment',
    active: true,
    rank: 2,
    version: 1,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    currency: 'USD',
    billingPeriod: 'month',
    limits: { users: null, leadsContacts: null, storageMb: null, emailsPerMonth: null, aiCredits: null },
    modules: [...ALL_MODULES],
    highlights: ['All modules, including HR', 'Unlimited users, leads and storage', 'Dedicated onboarding'],
    checkout: 'contact',
    active: true,
    rank: 3,
    version: 1,
  },
]
registerArray('plans', plans)

/**
 * Every version of every plan (price, billing period, limits, modules). A subscription points at one
 * (`planVersion`); its limits, modules and price come from that version, while the name, highlights,
 * rank, checkout and `active` come from the plan itself (editing those doesn't create a version).
 */
export interface PlanVersionRecord {
  planId: PlanId
  version: number
  createdAt: string
  createdBy: string
  price: number | null
  billingPeriod: Plan['billingPeriod']
  limits: Plan['limits']
  modules: PlanModule[]
}

export const planVersions: PlanVersionRecord[] = registerArray(
  'planVersions',
  plans.map((p) => ({
    planId: p.id,
    version: 1,
    createdAt: new Date(Date.UTC(2025, 0, 1)).toISOString(),
    createdBy: 'System',
    price: p.price,
    billingPeriod: p.billingPeriod,
    limits: { ...p.limits },
    modules: [...p.modules],
  })),
)

/** Platform billing settings (GET/PATCH /platform/settings). */
export const DEFAULT_BILLING_SETTINGS: PlatformBillingSettings = {
  trialDays: 14,
  trialReminderDays: [7, 3, 1],
  graceDays: 7,
  pastDueReminderDays: [1, 3, 6],
  suspendedDaysBeforeCancel: 30,
  retentionDays: 30,
  usageWarningThresholds: [80, 100],
}
export const billingSettings: PlatformBillingSettings = registerObject('billingSettings', structuredClone(DEFAULT_BILLING_SETTINGS))

export function planById(id: PlanId): Plan | undefined {
  return plans.find((p) => p.id === id)
}

/** Like planById, for ids already stored on a subscription (they always exist). */
export function planOf(id: PlanId): Plan {
  const plan = planById(id)
  if (!plan) throw new Error(`Unknown plan ${id}`)
  return plan
}

export function planVersionOf(planId: PlanId, version: number): PlanVersionRecord | undefined {
  return planVersions.find((v) => v.planId === planId && v.version === version)
}

/**
 * A plan as one version of it: price, billing period, limits and modules of `version`, everything else
 * from the current plan. Falls back to the current plan when the version is unknown.
 */
export function planAt(planId: PlanId, version: number | null | undefined): Plan {
  const plan = planOf(planId)
  const v = version == null ? undefined : planVersionOf(planId, version)
  if (!v) return { ...plan, version: plan.version ?? 1 }
  return { ...plan, price: v.price, billingPeriod: v.billingPeriod, limits: { ...v.limits }, modules: [...v.modules], version: v.version }
}

export function activePlans(): Plan[] {
  return plans.filter((p) => p.active).sort((a, b) => a.rank - b.rank)
}

const MODULE_KEYS: ModuleKey[] = ['sales', 'services', 'marketing', 'accounting', 'hr', 'reports', 'settings', 'departments', 'tasks']

/** Company.enabledModules for a set of plan modules: the ones that are role modules. */
export function enabledModulesFrom(modules: readonly PlanModule[]): ModuleKey[] {
  return MODULE_KEYS.filter((m) => modules.includes(m))
}

/** Company.enabledModules for a plan: its modules that are role modules. */
export function enabledModulesOf(plan: Plan): ModuleKey[] {
  return enabledModulesFrom(plan.modules)
}

/** The fallback plan a trial converts to (no valid selection): the lowest-ranked active paid plan. */
export function trialConversionPlan(): Plan {
  const paid = activePlans().filter((p) => p.checkout === 'payment')
  return paid[0] ?? planOf('starter')
}
