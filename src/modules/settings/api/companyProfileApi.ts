import type { CompanyProfile } from '@/modules/tenancy/types'
import type { CompanyProfilePatch } from '@/modules/settings/companyProfile'
import { http } from '@/shared/lib/axios'
import { companyProfileMapper } from '@/shared/api/mappers'

/** Settings > Company profile. No company id is sent; the server uses the session's company. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  return companyProfileMapper.fromApi((await http.get<unknown>('/settings/company-profile')).data)
}

export async function updateCompanyProfile(patch: CompanyProfilePatch): Promise<CompanyProfile> {
  return companyProfileMapper.fromApi((await http.patch<unknown>('/settings/company-profile', companyProfileMapper.toApi(patch as never))).data)
}
