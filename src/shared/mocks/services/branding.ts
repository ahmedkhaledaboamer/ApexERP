import type { User } from '@/shared/types'
import type { AuditChange } from '@/modules/settings/types'
import type { Branding, Company } from '@/modules/tenancy/types'
import {
  ALLOWED_TYPES_TEXT,
  DISPLAY_NAME_MAX,
  FAVICON_MAX_BYTES,
  LOGO_MAX_BYTES,
  checkImageDataUrl,
  describeImageUrl,
  displayNameProblem,
  type BrandImageKind,
  type BrandingSettings,
} from '@/modules/settings/branding'
import { DEFAULT_PALETTE } from '@/modules/tenancy/branding'
import { deriveBrandScale, normalizeHex, primaryOf } from '@/modules/tenancy/palette'
import { monogramFor } from '@/modules/tenancy/subdomain'
import { canEditCompanyProfile, canViewCompanyProfile } from '@/shared/lib/permissions'
import { companyById } from '@/shared/mocks/data/tenancy'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'
import { ApiError } from '@/shared/lib/apiError'

/**
 * Settings › Branding (GET/PATCH /settings/branding, POST /settings/branding/reset). The branding
 * lives on the Company record (`Company.branding`), so GET /tenant, the session, the public
 * workspace lookup (sign-in page) and the dev switcher all carry it. Images are stored as data
 * URLs (a real backend would store the file and serve a URL). The company is always the caller's:
 * the body is whitelisted, a `companyId` is ignored. Billing read-only and read-only support
 * sessions are refused before this runs (central policy in `userFrom`).
 */

function ownCompany(user: User): Company {
  const company = companyById(tenantOf(user))
  if (!company) throw new ApiError('Workspace not found.', 404)
  return company
}

function settingsOf(company: Company): BrandingSettings {
  return {
    branding: company.branding,
    primaryColor: company.branding.primaryColor ?? primaryOf(company.branding.palette),
    limits: { logoMaxBytes: LOGO_MAX_BYTES, faviconMaxBytes: FAVICON_MAX_BYTES, types: ALLOWED_TYPES_TEXT.split(/, | or /), displayNameMax: DISPLAY_NAME_MAX },
  }
}

/** Flat view for the audit diff: images as "PNG 34 KB, 320×80", never the data URL. */
function auditView(b: Branding): Record<string, unknown> {
  return {
    displayName: b.displayName,
    monogram: b.monogram,
    primaryColor: b.primaryColor ?? primaryOf(b.palette),
    logoLight: describeImageUrl(b.logoUrl),
    logoDark: describeImageUrl(b.logoDarkUrl),
    favicon: describeImageUrl(b.faviconUrl),
  }
}

/** Company Admin and Management (view only); everyone else 403. */
export async function getBranding(user: User): Promise<BrandingSettings> {
  if (!canViewCompanyProfile(user.role)) return fail('Only admins can see the branding settings.', 403)
  return delay(settingsOf(ownCompany(user)))
}

const IMAGE_FIELD: Record<BrandImageKind, 'logoUrl' | 'logoDarkUrl' | 'faviconUrl'> = {
  logoLight: 'logoUrl',
  logoDark: 'logoDarkUrl',
  favicon: 'faviconUrl',
}

function record(user: User, company: Company, before: Branding, after: Branding, summary: (fields: string) => string): void {
  const changes: AuditChange[] = diff(auditView(before), auditView(after))
  if (!changes.length) return
  recordAudit(user, {
    action: 'update',
    entity: 'branding',
    entityId: company.id,
    summary: summary(changes.map((c) => c.field).join(', ')),
    changes,
  })
}

/**
 * Company Admin only. Whitelisted fields: displayName, primaryColor, logoLight, logoDark, favicon
 * (data URL to set, null to remove). Everything is checked before anything is written (422 with
 * the first problem); returns the updated Company so the client refreshes the session tenant.
 */
export async function updateBranding(user: User, input: unknown): Promise<Company> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can change the branding.', 403)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Send the branding fields to change.', 400)
  const body = input as Record<string, unknown>
  const company = ownCompany(user)
  const before = company.branding
  const next: Branding = { ...before }

  if (body.displayName !== undefined) {
    const problem = displayNameProblem(body.displayName)
    if (problem) return fail(problem, 422)
    const name = String(body.displayName).trim().replace(/\s+/g, ' ')
    if (name !== before.displayName) {
      next.displayName = name
      next.monogram = monogramFor(name)
    }
  }

  if (body.primaryColor !== undefined) {
    const hex = normalizeHex(body.primaryColor)
    if (!hex) return fail('Pick the primary colour as a hex value like #7c3aed.', 422)
    if (hex !== (before.primaryColor ?? primaryOf(before.palette))) {
      next.primaryColor = hex
      next.palette = deriveBrandScale(hex)
    }
  }

  for (const kind of ['logoLight', 'logoDark', 'favicon'] as const) {
    const value = body[kind]
    if (value === undefined) continue
    if (value === null) {
      next[IMAGE_FIELD[kind]] = null
      continue
    }
    const res = checkImageDataUrl(kind, value)
    if (!res.ok) return fail(res.message, 422)
    next[IMAGE_FIELD[kind]] = res.dataUrl
  }

  record(user, company, before, next, (fields) => `Updated the branding (${fields})`)
  company.branding = next
  return delay(company)
}

/** Company Admin only: monogram, default palette, no images. The workspace name and email sender stay. */
export async function resetBranding(user: User): Promise<Company> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can change the branding.', 403)
  const company = ownCompany(user)
  const before = company.branding
  const next: Branding = {
    ...before,
    monogram: monogramFor(before.displayName),
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
    primaryColor: null,
    palette: { ...DEFAULT_PALETTE },
  }
  record(user, company, before, next, (fields) => `Reset the branding to the default (${fields})`)
  company.branding = next
  return delay(company)
}
