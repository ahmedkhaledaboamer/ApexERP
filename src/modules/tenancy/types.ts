import type { ModuleKey, Role } from '@/shared/types'
import type { PlanId } from '@/modules/billing/types'
import type { ImpersonationMode, PlatformPermissionV2 } from '@/modules/platform/types'

/**
 * Multi-tenancy (Apex CRM). A Company is a tenant; users reach it through a Membership.
 * The client never sends a company id: the server derives it from the session token.
 */

export type CountryCode = 'AE' | 'SA' | 'EG' | 'QA' | 'KW' | 'BH' | 'OM'
/**
 * Platform-console status. `suspended` here is the OPERATOR lock (full block, `workspace_suspended`),
 * separate from the billing subscription status (billing never sets it). `trial` / `active` mirror the
 * subscription: trialing → `trial`, anything else → `active`.
 */
export type CompanyStatus = 'active' | 'trial' | 'suspended'

/** Brand colour scale (Tailwind steps) applied to the `--color-brand-*` CSS variables. */
export type BrandScale = Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900', string>

export interface Branding {
  /** Shown next to the logo, e.g. "Apex Aora". */
  displayName: string
  /**
   * Logo for light backgrounds (and documents, emails), or null to render the monogram. A URL; images
   * uploaded in Settings › Branding are data URLs in the mock (a real backend would serve a CDN URL).
   */
  logoUrl: string | null
  /** Logo for the dark theme; absent/null → the light logo is used in dark mode too. */
  logoDarkUrl?: string | null
  /** Browser-tab icon while signed in to the workspace or on its sign-in page; absent/null → the product icon. */
  faviconUrl?: string | null
  /**
   * The primary colour picked in Settings › Branding (`#rrggbb`); `palette` is derived from it
   * (`deriveBrandScale`, it is the 600 step). Absent for seeded / default palettes.
   */
  primaryColor?: string | null
  /** 1–3 letters used when there's no logo. */
  monogram: string
  palette: BrandScale
  /** "From" for emails sent from the system. */
  emailSenderName: string
  emailSenderAddress: string
}

export interface RegionalSettings {
  country: CountryCode
  /** ISO 4217, e.g. AED, SAR. */
  currency: string
  /** IANA zone, e.g. Asia/Dubai. */
  timezone: string
  /** UI language (English only for now; RTL-ready). */
  language: 'en'
  /** date-fns pattern for dates, e.g. "d MMM yyyy". */
  dateFormat: string
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: 0 | 1 | 6
  /** Weekend days (0 = Sunday … 6 = Saturday); UAE Sat–Sun, Saudi Fri–Sat. */
  weekend: number[]
  /** VAT/tax rate in percent used as the default on quotations. */
  vatPct: number
}

export interface Company {
  id: string
  name: string
  /** `<subdomain>.apexcrm.app` (dev: `<subdomain>.localhost` or `?workspace=`). */
  subdomain: string
  status: CompanyStatus
  /** Subscription plan id (plans are data: GET /public/plans, GET /billing/overview). Mirrors the subscription. */
  plan: PlanId
  /**
   * Modules this tenant can use = the plan's modules that are role modules (ModuleKey). Kept in sync
   * by the server whenever the plan changes; disabled ones are hidden from navigation and routes.
   */
  enabledModules: ModuleKey[]
  regional: RegionalSettings
  branding: Branding
  /**
   * Settings > Company profile: the issuer printed on quotations (and future invoices) and
   * offered to templates as {{company.*}}. Read it through `issuerFor()`.
   */
  profile: CompanyProfile
  createdAt: string
}

export interface CompanyAddress {
  line1: string
  line2: string
  city: string
  /** Emirate / province / governorate. */
  region: string
  country: CountryCode
}

export interface GeoPoint {
  /** -90..90 */
  lat: number
  /** -180..180 */
  lng: number
}

export interface BankDetails {
  bankName: string
  accountName: string
  iban: string
  swift: string
}

export interface CompanyProfile {
  /** Registered name, printed on legal documents. Also kept in `Company.name`. */
  legalName: string
  /** Name customers know; the quotation letterhead. */
  tradeName: string
  address: CompanyAddress
  /** Optional map pin. */
  location: GeoPoint | null
  /**
   * VAT / tax registration number, validated by the company country (`regional.country`);
   * its label (TRN, VAT number, Tax ID…) comes from `taxLabel()` in shared/lib/taxNumber.ts.
   * Empty until registered; printed only when set.
   */
  taxNumber: string
  /** Commercial registration / trade licence number. */
  commercialLicenseNo: string
  phone: string
  email: string
  website: string
  /** Optional; printed on quotations and invoices when set. */
  bank: BankDetails | null
}

/** Public subset served before sign-in (login page branding). */
export type PublicCompany = Pick<Company, 'id' | 'name' | 'subdomain' | 'status'> & {
  branding: Branding
  /**
   * Set when the address looked up is an OLD subdomain of the company (changed by the platform and
   * still redirecting): the current subdomain to redirect to. Absent for the current address.
   */
  redirectTo?: string
}

export type MembershipStatus = 'active' | 'invited' | 'suspended'

/**
 * A user's place in a company. Exactly one active membership per user for now; modelled
 * separately so multi-company users can be added later without a rewrite.
 */
export interface Membership {
  id: string
  userId: string
  companyId: string
  /** Company role (the role id is the role name). */
  role: Role
  status: MembershipStatus
  createdAt: string
}

/* ---------------- Platform (never mixed with company roles) ---------------- */

export type PlatformRole = 'Platform Owner' | 'Platform Support' | 'Platform Billing'

/**
 * Platform permissions (Super-Admin Console). The set is defined in the platform contract
 * (`PlatformPermissionV2`, src/modules/platform/types.ts); this name is kept for existing imports.
 */
export type PlatformPermission = PlatformPermissionV2

/**
 * Platform permission set. Separate from PERMISSION_MATRIX (company roles); a platform user has no company role.
 * Owner: all. Support: view, impersonate, notes, audit. Billing: view, revenue, billing actions, plans + settings.
 */
export const PLATFORM_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  'Platform Owner': [
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
  ],
  'Platform Support': ['tenants:view', 'support:impersonate', 'support:notes', 'audit:view'],
  'Platform Billing': ['tenants:view', 'billing:view', 'billing:manage', 'plans:manage'],
}

export function canPlatform(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_PERMISSIONS[role].includes(permission)
}

export interface PlatformUser {
  id: string
  name: string
  email: string
  platformRole: PlatformRole
}

/** Platform operator session (platform console only; no tenant data). */
export interface PlatformSession {
  kind: 'platform'
  token: string
  platformUser: PlatformUser
}

/** Who started an impersonation (shown in a banner; every write is audited with it). */
export interface ImpersonationInfo {
  platformUserId: string
  platformUserName: string
  platformRole: PlatformRole
  startedAt: string
  /** The impersonation session record on the server (mode and expiry are read from there, never from the token). */
  sessionId: string
  /** Why the operator opened the session (shown to the company admin in their audit log). */
  reason: string
  /** The session ends (401 impersonation_expired) at this time; platform setting `impersonationMinutes`. */
  expiresAt: string
  /** 'read' (default): every write is refused; 'write' after POST /auth/impersonation/write-mode. */
  mode: ImpersonationMode
}

/** Row for the platform console. */
export interface TenantSummary extends Company {
  users: number
  leads: number
}
