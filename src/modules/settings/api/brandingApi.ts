import type { Company } from '@/modules/tenancy/types'
import type { BrandingPatch, BrandingSettings } from '@/modules/settings/branding'
import { http } from '@/shared/lib/axios'
import { brandingPatchMapper, brandingSettingsMapper, companyMapper } from '@/shared/api/mappers'

/** Settings › Branding. No company id is sent; the server uses the session's company. */
export async function getBrandingSettings(): Promise<BrandingSettings> {
  return brandingSettingsMapper.fromApi((await http.get<unknown>('/settings/branding')).data)
}

/** Returns the updated Company (the client refreshes the session tenant with it). */
export async function updateBranding(patch: BrandingPatch): Promise<Company> {
  return companyMapper.fromApi((await http.patch<unknown>('/settings/branding', brandingPatchMapper.toApi(patch))).data)
}

export async function resetBranding(): Promise<Company> {
  return companyMapper.fromApi((await http.post<unknown>('/settings/branding/reset')).data)
}
