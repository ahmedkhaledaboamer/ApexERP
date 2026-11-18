import type { PlatformRole, PlatformUser } from '@/modules/tenancy/types'
import type { PlatformPermissionV2 } from '@/modules/platform/types'

/**
 * Platform permissions (contract: platform/types.ts › PlatformPermissionV2). Platform roles are a
 * separate set from company roles; nothing here reads a company role. The server is the authority
 * (every /platform/* endpoint checks the permission again); the UI only hides what it would refuse.
 */
export const ALL_PLATFORM_PERMISSIONS: PlatformPermissionV2[] = [
  'tenants:view',
  'tenants:manage',
  'tenants:subdomain',
  'billing:view',
  'billing:manage',
  'plans:manage',
  'support:impersonate',
  'support:notes',
  'announcements:manage',
  'audit:view',
]

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermissionV2[]> = {
  'Platform Owner': ALL_PLATFORM_PERMISSIONS,
  'Platform Support': ['tenants:view', 'support:impersonate', 'support:notes', 'audit:view'],
  'Platform Billing': ['tenants:view', 'billing:view', 'billing:manage', 'plans:manage'],
}

/** The operator's permissions: the server's list when the session carries one, else the role's set. */
export function platformPermissions(user: Pick<PlatformUser, 'platformRole'> & { permissions?: unknown }): PlatformPermissionV2[] {
  if (Array.isArray(user.permissions)) {
    return user.permissions.filter((p): p is PlatformPermissionV2 => ALL_PLATFORM_PERMISSIONS.includes(p as PlatformPermissionV2))
  }
  return PLATFORM_ROLE_PERMISSIONS[user.platformRole] ?? []
}

export function hasPlatformPermission(perms: readonly PlatformPermissionV2[], p: PlatformPermissionV2): boolean {
  return perms.includes(p)
}

/* ---------------- Console navigation ---------------- */

export type PlatformNavId = 'overview' | 'companies' | 'plans' | 'settings' | 'announcements' | 'audit'

export interface PlatformNavItem {
  id: PlatformNavId
  label: string
  to: string
  /** Any one of these shows the item. */
  anyOf: PlatformPermissionV2[]
}

export const PLATFORM_PATHS = {
  root: '/platform',
  login: '/platform/login',
  companies: '/platform/companies',
  company: '/platform/companies/:id',
  plans: '/platform/plans',
  settings: '/platform/settings',
  announcements: '/platform/announcements',
  audit: '/platform/audit',
} as const

export function platformCompanyPath(id: string): string {
  return `/platform/companies/${encodeURIComponent(id)}`
}

export const PLATFORM_NAV: PlatformNavItem[] = [
  { id: 'overview', label: 'Overview', to: PLATFORM_PATHS.root, anyOf: ['tenants:view'] },
  { id: 'companies', label: 'Companies', to: PLATFORM_PATHS.companies, anyOf: ['tenants:view'] },
  { id: 'plans', label: 'Plans', to: PLATFORM_PATHS.plans, anyOf: ['plans:manage', 'billing:view'] },
  { id: 'settings', label: 'Settings', to: PLATFORM_PATHS.settings, anyOf: ['plans:manage'] },
  { id: 'announcements', label: 'Announcements', to: PLATFORM_PATHS.announcements, anyOf: ['announcements:manage'] },
  { id: 'audit', label: 'Audit log', to: PLATFORM_PATHS.audit, anyOf: ['audit:view'] },
]

export function navItemAllowed(item: Pick<PlatformNavItem, 'anyOf'>, perms: readonly PlatformPermissionV2[]): boolean {
  return item.anyOf.some((p) => perms.includes(p))
}

/** Nav items the operator may open, in order. */
export function visiblePlatformNav(perms: readonly PlatformPermissionV2[]): PlatformNavItem[] {
  return PLATFORM_NAV.filter((item) => navItemAllowed(item, perms))
}

/** Where to land after sign-in or on a page the operator can't open: the first allowed item. */
export function platformHome(perms: readonly PlatformPermissionV2[]): string {
  return visiblePlatformNav(perms)[0]?.to ?? PLATFORM_PATHS.root
}

/** Which buttons a company page shows. */
export interface CompanyCapabilities {
  manage: boolean
  billingView: boolean
  billingManage: boolean
  subdomain: boolean
  impersonate: boolean
  notes: boolean
}

export function companyCapabilities(perms: readonly PlatformPermissionV2[]): CompanyCapabilities {
  return {
    manage: perms.includes('tenants:manage'),
    billingView: perms.includes('billing:view'),
    billingManage: perms.includes('billing:manage'),
    subdomain: perms.includes('tenants:subdomain'),
    impersonate: perms.includes('support:impersonate'),
    notes: perms.includes('support:notes'),
  }
}
