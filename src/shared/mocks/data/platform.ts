import type { PlanModule } from '@/modules/billing/types'
import type { Company } from '@/modules/tenancy/types'
import type {
  Announcement,
  ImpersonationSessionRecord,
  ModuleOverride,
  PlatformAuditEntry,
  SubdomainAlias,
  SupportNote,
} from '@/modules/platform/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject, registerValue } from '@/shared/mocks/persist/registry'
import { companyById, companyBySubdomain } from '@/shared/mocks/data/tenancy'
import { nowMs } from '@/shared/mocks/clock'

/**
 * Super-Admin Console state (platform level; nothing here is served to a company except its own
 * announcements). Every store is registered for the dev persistence snapshot.
 *   consoleSettings         subdomainRedirectDays, impersonationMinutes (billing settings live in data/plans.ts)
 *   platformAudit           every platform write and company view (newest first)
 *   supportNotes            internal notes per company (never shown to the company)
 *   moduleOverrides         a module turned on/off for one company, overriding its plan
 *   subdomainAliases        old subdomains that keep redirecting after a change (until redirectUntil)
 *   impersonationSessions   one per POST /platform/impersonations (mode, expiry, end)
 *   announcements           platform banners for companies; dismissals per user
 */

export interface ConsoleSettings {
  subdomainRedirectDays: number
  impersonationMinutes: number
}

export const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = { subdomainRedirectDays: 30, impersonationMinutes: 30 }
export const consoleSettings: ConsoleSettings = registerObject('platform.consoleSettings', { ...DEFAULT_CONSOLE_SETTINGS })

export const platformAudit: PlatformAuditEntry[] = registerArray('platform.audit', [])
export const supportNotes: SupportNote[] = registerArray('platform.supportNotes', [])
export const moduleOverrides: Tenant<ModuleOverride>[] = registerArray('platform.moduleOverrides', [])
export const subdomainAliases: Tenant<SubdomainAlias>[] = registerArray('platform.subdomainAliases', [])
export const impersonationSessions: ImpersonationSessionRecord[] = registerArray('platform.impersonations', [])
export const announcements: Announcement[] = registerArray('platform.announcements', [])

export interface AnnouncementDismissal {
  announcementId: string
  userId: string
  companyId: string
  at: string
}
export const announcementDismissals: AnnouncementDismissal[] = registerArray('platform.announcementDismissals', [])

let seq = 1
registerValue('platform.seq', () => seq, (v) => { seq = v })

/** A new platform-level id, e.g. `PA-12`, `NOTE-3`, `IMP-4`, `ANN-2`. */
export function nextPlatformId(prefix: string): string {
  return `${prefix}-${seq++}`
}

/* ---------------- Subdomain aliases ---------------- */

/** A still-redirecting old subdomain (of any company). */
export function liveAliasOf(subdomain: string, at = nowMs()): Tenant<SubdomainAlias> | undefined {
  const s = subdomain.trim().toLowerCase()
  return subdomainAliases.find((a) => a.subdomain === s && Date.parse(a.redirectUntil) > at)
}

export function liveAliasesOfCompany(companyId: string, at = nowMs()): Tenant<SubdomainAlias>[] {
  return subdomainAliases.filter((a) => a.companyId === companyId && Date.parse(a.redirectUntil) > at)
}

/** The company a workspace address belongs to: its current subdomain, or a live alias (then `alias` is set). */
export function resolveWorkspace(subdomain: string): { company: Company; alias: Tenant<SubdomainAlias> | null } | undefined {
  const current = companyBySubdomain(subdomain)
  if (current) return { company: current, alias: null }
  const alias = liveAliasOf(subdomain)
  const company = alias && companyById(alias.companyId)
  return company ? { company, alias } : undefined
}

/* ---------------- Module overrides ---------------- */

export function overridesOf(companyId: string): Tenant<ModuleOverride>[] {
  return moduleOverrides.filter((o) => o.companyId === companyId)
}

/** Plan modules ± the company's overrides (overrides survive plan changes). */
export function effectiveModules(companyId: string, planModules: readonly PlanModule[]): PlanModule[] {
  const set = new Set<PlanModule>(planModules)
  for (const o of overridesOf(companyId)) {
    if (o.enabled) set.add(o.module)
    else set.delete(o.module)
  }
  return [...set]
}
