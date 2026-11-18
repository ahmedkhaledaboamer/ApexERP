import type { Company } from '@/modules/tenancy/types'
import type { BrandingPatch, BrandingSettings } from '@/modules/settings/branding'
import { http } from '@/shared/lib/axios'

/** Settings › Branding. No company id is sent; the server uses the session's company. */
export async function getBrandingSettings(): Promise<BrandingSettings> {
  return (await http.get<BrandingSettings>('/settings/branding')).data
}

/** Returns the updated Company (the client refreshes the session tenant with it). */
export async function updateBranding(patch: BrandingPatch): Promise<Company> {
  return (await http.patch<Company>('/settings/branding', patch)).data
}

export async function resetBranding(): Promise<Company> {
  return (await http.post<Company>('/settings/branding/reset')).data
}
