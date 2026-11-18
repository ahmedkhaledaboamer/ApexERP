import type { BillingPeriod, LimitKey, Plan, PlanLimits, PlanModule } from '@/modules/billing/types'
import { GATEABLE_MODULES } from '@/modules/billing/types'
import type { PlanEditInput, PlanMigration } from '@/modules/platform/types'

/** Modules every plan has (not plan-gated). */
export const CORE_MODULES: PlanModule[] = ['sales', 'services', 'reports', 'settings', 'departments', 'tasks']
export const PLAN_MODULE_CHOICES: PlanModule[] = [...CORE_MODULES, ...GATEABLE_MODULES]
export const LIMIT_KEYS: LimitKey[] = ['users', 'leadsContacts', 'storageMb', 'emailsPerMonth', 'aiCredits']

/** Form state: numbers as strings ('' = null: free price / unlimited limit). */
export interface PlanDraft {
  id: string
  name: string
  price: string
  currency: string
  billingPeriod: BillingPeriod
  checkout: Plan['checkout']
  limits: Record<LimitKey, string>
  modules: PlanModule[]
  highlights: string
  active: boolean
}

export function draftFromPlan(p: Plan | null): PlanDraft {
  return {
    id: p?.id ?? '',
    name: p?.name ?? '',
    price: p?.price === null || p?.price === undefined ? '' : String(p.price),
    currency: p?.currency ?? 'USD',
    billingPeriod: p?.billingPeriod ?? 'month',
    checkout: p?.checkout ?? 'payment',
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, p && p.limits[k] !== null ? String(p.limits[k]) : ''])) as Record<LimitKey, string>,
    modules: p ? [...p.modules] : [...CORE_MODULES],
    highlights: p?.highlights.join('\n') ?? '',
    active: p?.active ?? true,
  }
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

export function draftPrice(d: PlanDraft): number | null {
  return num(d.price)
}

export function draftLimits(d: PlanDraft): PlanLimits {
  return Object.fromEntries(LIMIT_KEYS.map((k) => [k, num(d.limits[k])])) as PlanLimits
}

export function draftHighlights(d: PlanDraft): string[] {
  return d.highlights
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Field errors (empty object = valid). */
export function validateDraft(d: PlanDraft, isNew: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (isNew && !/^[a-z0-9][a-z0-9-]{1,30}$/.test(d.id)) e.id = 'Lowercase letters, numbers and hyphens (2–31).'
  if (!d.name.trim()) e.name = 'Enter a name.'
  const price = num(d.price)
  if (price !== null && (!Number.isFinite(price) || price < 0)) e.price = 'Enter a price of 0 or more, or leave empty.'
  for (const k of LIMIT_KEYS) {
    const v = num(d.limits[k])
    if (v !== null && (!Number.isInteger(v) || v < 0)) e[`limit-${k}`] = 'Whole number, or empty for unlimited.'
  }
  if (isNew && !/^[A-Z]{3}$/.test(d.currency)) e.currency = 'Three-letter currency code.'
  return e
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** Price, limits or modules changed → a new plan version and a migration choice. */
export function versionedChange(plan: Plan, d: PlanDraft): { price: boolean; limits: boolean; modules: boolean; any: boolean } {
  const price = draftPrice(d) !== plan.price
  const limits = LIMIT_KEYS.some((k) => draftLimits(d)[k] !== plan.limits[k])
  const modules = !sameSet(plan.modules, d.modules)
  return { price, limits, modules, any: price || limits || modules }
}

/** PATCH body with only the fields that changed. */
export function planEditInput(plan: Plan, d: PlanDraft, migration: PlanMigration, reason: string): PlanEditInput {
  const input: PlanEditInput = { migration, reason }
  const ch = versionedChange(plan, d)
  if (d.name.trim() !== plan.name) input.name = d.name.trim()
  if (ch.price) input.price = draftPrice(d)
  if (d.billingPeriod !== plan.billingPeriod) input.billingPeriod = d.billingPeriod
  if (ch.limits) {
    const next = draftLimits(d)
    input.limits = Object.fromEntries(LIMIT_KEYS.filter((k) => next[k] !== plan.limits[k]).map((k) => [k, next[k]]))
  }
  if (ch.modules) input.modules = [...d.modules]
  const hl = draftHighlights(d)
  if (hl.join('\n') !== plan.highlights.join('\n')) input.highlights = hl
  if (d.active !== plan.active) input.active = d.active
  if (!ch.any) input.migration = 'keep'
  return input
}

export const MIGRATION_COPY: Record<PlanMigration, { label: string; body: string }> = {
  keep: {
    label: 'Keep current subscribers on their version',
    body: 'Only new sign-ups and plan changes get the new version. Existing companies keep today’s price, limits and modules.',
  },
  at_renewal: {
    label: 'Move them at their next renewal',
    body: 'Each company switches to the new version when its current period ends. Nothing changes for them before that.',
  },
  now: {
    label: 'Move them now',
    body: 'Every company switches immediately. Companies whose usage is above a new limit are left on their version and listed.',
  },
}
