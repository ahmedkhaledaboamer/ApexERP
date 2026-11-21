import type { ModuleKey, Role, Scope } from '@/shared/types'
import { can, scopeOf } from '@/shared/lib/permissions'
import { GATEABLE_MODULES, type Entitlements, type LimitKey, type Plan, type PlanModule } from '@/modules/billing/types'

/**
 * Pure gating rules shared by the sidebar, the routes, the command palette and the upgrade prompt.
 * Access = the role can view the module (PERMISSION_MATRIX) AND the plan includes it (entitlements).
 * No React, no I/O: unit-tested in gating.test.ts.
 */

/** The part of the entitlements gating needs (null while loading). */
export type GateEntitlements = Pick<Entitlements, 'modules'> | null | undefined

export interface GateContext {
  role: Role | null | undefined
  entitlements: GateEntitlements
}

/** Modules outside GATEABLE_MODULES are in every plan. Unknown entitlements (loading) → not included yet. */
export function planIncludes(entitlements: GateEntitlements, module: PlanModule): boolean {
  if (!GATEABLE_MODULES.includes(module)) return true
  return !!entitlements && entitlements.modules.includes(module)
}

/** What a nav entry needs: the role module and, when different, the plan module. */
export interface GatedItem {
  module?: ModuleKey
  planModule?: PlanModule
  /** Only these scopes of `module` see the item (e.g. HR Reports: full and team, not an employee's own scope). */
  scopes?: readonly Scope[]
}

/** The role can view the item's module, with one of its allowed scopes when the item lists them. */
function roleSees(item: GatedItem, role: Role | null | undefined): boolean {
  if (!item.module) return true
  if (!role || !can(role, item.module, 'view')) return false
  return !item.scopes || item.scopes.includes(scopeOf(role, item.module))
}

export function itemPlanModule(item: GatedItem): PlanModule | undefined {
  return item.planModule ?? item.module
}

/**
 * visible: shown and usable · locked: the role could use it but the plan doesn't include it (shown
 * with a lock in the sidebar; its route renders the upgrade page) · hidden: the role can't see it.
 */
export type NavAccess = 'visible' | 'locked' | 'hidden'

export function navItemAccess(item: GatedItem, ctx: GateContext): NavAccess {
  if (!roleSees(item, ctx.role)) return 'hidden'
  const pm = itemPlanModule(item)
  if (!pm || planIncludes(ctx.entitlements, pm)) return 'visible'
  // While entitlements load, gateable items stay out of the way instead of flashing a lock.
  return ctx.entitlements ? 'locked' : 'hidden'
}

/** Sidebar rule: visible and locked items are listed (locked with a lock icon). */
export function navItemVisible(item: GatedItem, ctx: GateContext): boolean {
  return navItemAccess(item, ctx) !== 'hidden'
}

/** Command palette rule: only items the user can open right now. */
export function paletteItems<T extends GatedItem>(items: T[], ctx: GateContext): T[] {
  return items.filter((i) => navItemAccess(i, ctx) === 'visible')
}

export type RouteDecision = 'allow' | 'upgrade' | 'forbidden' | 'loading'

/**
 * Route guard: `module` is the role-permission module (if any), `planModule` the plan module (if
 * different). Plan first, so a direct URL to a locked module explains the plan instead of bouncing.
 */
export function routeDecision(
  item: GatedItem,
  ctx: GateContext & { entitlementsLoading?: boolean },
): RouteDecision {
  const pm = itemPlanModule(item)
  if (pm && GATEABLE_MODULES.includes(pm)) {
    if (!ctx.entitlements) return ctx.entitlementsLoading ? 'loading' : 'upgrade'
    if (!planIncludes(ctx.entitlements, pm)) return 'upgrade'
  }
  if (!roleSees(item, ctx.role)) return 'forbidden'
  return 'allow'
}

/** The lowest-ranked active plan that includes the module (excluding the current plan). */
export function cheapestPlanWith(module: PlanModule, plans: Plan[], currentPlanId?: string): Plan | null {
  return (
    [...plans]
      .filter((p) => p.active && p.id !== currentPlanId && p.modules.includes(module))
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  )
}

/** The lowest-ranked active plan whose limit for `key` is higher than `current` (null = unlimited). */
export function cheapestPlanAbove(key: LimitKey, current: number, plans: Plan[], currentPlanId?: string): Plan | null {
  return (
    [...plans]
      .filter((p) => p.active && p.id !== currentPlanId && (p.limits[key] === null || (p.limits[key] as number) > current))
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  )
}

/* ---------------- Usage meters ---------------- */

export type UsageTone = 'unlimited' | 'ok' | 'warning' | 'danger'

/** Percent of a limit used (rounded, may exceed 100); null when unlimited. */
export function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null) return null
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.round((used / limit) * 100)
}

/** Amber from the first warning threshold (80 %), red from the last (100 %). */
export function usageTone(percent: number | null, thresholds: number[] = [80, 100]): UsageTone {
  if (percent === null) return 'unlimited'
  const sorted = [...thresholds].sort((a, b) => a - b)
  const warn = sorted[0] ?? 80
  const full = sorted[sorted.length - 1] ?? 100
  if (percent >= full) return 'danger'
  if (percent >= warn) return 'warning'
  return 'ok'
}

/** Width of the meter bar (0–100). */
export function meterWidth(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(100, percent))
}

/* ---------------- Labels (from data, never a plan catalog) ---------------- */

export const PLAN_MODULE_LABEL: Record<PlanModule, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  services: 'Services',
  accounting: 'Accounts & finance',
  hr: 'HR',
  reports: 'Reports',
  settings: 'Settings',
  departments: 'Departments',
  tasks: 'Projects & tasks',
  events: 'Events',
  integrations: 'Integrations',
  ai: 'AI assistant',
}

export const LIMIT_LABEL: Record<LimitKey, string> = {
  users: 'Users',
  leadsContacts: 'Leads & contacts',
  storageMb: 'Storage',
  emailsPerMonth: 'Emails this month',
  aiCredits: 'AI credits',
}

/** "Starter" from a plan id when no name is at hand ("pro-plus" → "Pro plus"). */
export function planIdLabel(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : id
}

const nf = new Intl.NumberFormat('en')

/** "1,200 MB" / "2.5 GB" / "5". */
export function formatLimitValue(key: LimitKey, value: number | null): string {
  if (value === null) return 'Unlimited'
  if (key === 'storageMb') return value >= 1024 ? `${nf.format(Math.round((value / 1024) * 10) / 10)} GB` : `${nf.format(value)} MB`
  return nf.format(value)
}

/* ---------------- Downgrade blocks ---------------- */

const BLOCK_FIX: Record<LimitKey, (n: string) => string> = {
  users: (n) => `Deactivate ${n} ${n === '1' ? 'user' : 'users'} first.`,
  leadsContacts: (n) => `Delete ${n} leads or contacts first.`,
  storageMb: (n) => `Free up ${n} of storage first.`,
  emailsPerMonth: (n) => `Wait for the next period, or send ${n} fewer emails.`,
  aiCredits: (n) => `Wait for the next period (${n} credits over).`,
}

/** "You have 7 users; Starter allows 5. Deactivate 2 users first." */
export function downgradeBlockMessage(block: { key: LimitKey; label: string; used: number; limit: number }, planName: string): string {
  const over = Math.max(0, block.used - block.limit)
  const label = block.label.toLowerCase()
  const used = formatLimitValue(block.key, block.used)
  const limit = formatLimitValue(block.key, block.limit)
  const n = block.key === 'storageMb' ? formatLimitValue('storageMb', over) : nf.format(over)
  return `You have ${used} ${label}; ${planName} allows ${limit}. ${BLOCK_FIX[block.key](n)}`
}
