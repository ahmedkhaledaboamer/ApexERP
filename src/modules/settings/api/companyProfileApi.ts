import type { CompanyProfile } from '@/modules/tenancy/types'
import type { CompanyProfilePatch } from '@/modules/settings/companyProfile'
import { http } from '@/shared/lib/axios'

/** Settings > Company profile. No company id is sent; the server uses the session's company. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  return (await http.get<CompanyProfile>('/settings/company-profile')).data
}

export async function updateCompanyProfile(patch: CompanyProfilePatch): Promise<CompanyProfile> {
  return (await http.patch<CompanyProfile>('/settings/company-profile', patch)).data
}
