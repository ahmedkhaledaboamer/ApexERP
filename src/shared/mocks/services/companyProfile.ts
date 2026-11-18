import type { User } from '@/shared/types'
import type { AuditChange } from '@/modules/settings/types'
import type { Company, CompanyProfile } from '@/modules/tenancy/types'
import { finalizeProfile, mergeProfile, validateProfile, type CompanyProfilePatch } from '@/modules/settings/companyProfile'
import { canEditCompanyProfile, canViewCompanyProfile } from '@/shared/lib/permissions'
import { companyById } from '@/shared/mocks/data/tenancy'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'
import { ApiError } from '@/shared/lib/apiError'

/**
 * Settings > Company profile (GET/PATCH /settings/company-profile). The profile lives inside the
 * Company record, so GET /tenant (and the session) carry it and `issuerFor(tenant)` prints it.
 * The company is always the caller's own: a body `companyId` is ignored.
 */

function ownCompany(user: User): Company {
  const company = companyById(tenantOf(user))
  if (!company) throw new ApiError('Workspace not found.', 404)
  return company
}

/** Flat view for the audit diff; the IBAN is masked to its last 4 characters. */
function auditView(p: CompanyProfile): Record<string, unknown> {
  const mask = (iban: string) => (iban ? `•••• ${iban.slice(-4)}` : '')
  return {
    legalName: p.legalName,
    tradeName: p.tradeName,
    'address.line1': p.address.line1,
    'address.line2': p.address.line2,
    'address.city': p.address.city,
    'address.region': p.address.region,
    'address.country': p.address.country,
    location: p.location ? `${p.location.lat}, ${p.location.lng}` : null,
    taxNumber: p.taxNumber,
    commercialLicenseNo: p.commercialLicenseNo,
    phone: p.phone,
    email: p.email,
    website: p.website,
    'bank.bankName': p.bank?.bankName ?? null,
    'bank.accountName': p.bank?.accountName ?? null,
    'bank.iban': p.bank ? mask(p.bank.iban) : null,
    'bank.swift': p.bank?.swift ?? null,
  }
}

/** Company Admin and Management (view only); everyone else 403. */
export async function getCompanyProfile(user: User): Promise<CompanyProfile> {
  if (!canViewCompanyProfile(user.role)) return fail('Only admins can see the company profile.', 403)
  return delay(ownCompany(user).profile)
}

/** Company Admin only. Validates against the company country, audits every changed field. */
export async function updateCompanyProfile(user: User, input: unknown): Promise<CompanyProfile> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can change the company profile.', 403)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Send the profile fields to change.', 400)
  // The tenant comes from the session only; never from the body.
  const { companyId: _ignored, id: _id, ...patch } = input as Record<string, unknown>
  void _ignored
  void _id
  const company = ownCompany(user)
  const country = company.regional.country
  const merged = mergeProfile(company.profile, patch as CompanyProfilePatch)
  const errors = validateProfile(merged, country)
  const first = Object.values(errors)[0]
  if (first) return fail(first, 422)
  const next = finalizeProfile(merged, country)

  const changes: AuditChange[] = diff(auditView(company.profile), auditView(next))
  if (changes.length) {
    recordAudit(user, {
      action: 'update',
      entity: 'company-profile',
      entityId: company.id,
      summary: `Updated the company profile (${changes.map((c) => c.field).join(', ')})`,
      changes,
    })
  }
  // Only the profile changes. The workspace name (header, switcher) is a separate field and is
  // never overwritten by the trade or legal name.
  company.profile = next
  return delay(next)
}
