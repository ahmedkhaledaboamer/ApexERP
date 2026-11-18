import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Company } from '@/modules/tenancy/types'
import type { BrandingPatch } from '@/modules/settings/branding'
import { getBrandingSettings, resetBranding, updateBranding } from '@/modules/settings/api/brandingApi'
import { useAppDispatch } from '@/store/hooks'
import { tenantRefreshed } from '@/store/authSlice'

export const brandingKeys = {
  settings: ['settings', 'branding'] as const,
}

export function useBrandingSettingsQuery(enabled = true) {
  return useQuery({ queryKey: brandingKeys.settings, queryFn: getBrandingSettings, enabled })
}

/**
 * After a save or reset the server answers the whole Company: it replaces the session tenant, so
 * the sidebar logo, switcher, palette (--color-brand-*), favicon, quotations and email previews
 * update at once, without a reload. Dependent queries are refreshed too.
 */
function useApplyCompany() {
  const qc = useQueryClient()
  const dispatch = useAppDispatch()
  return (company: Company) => {
    dispatch(tenantRefreshed(company))
    qc.setQueryData(['tenant', company.id], company)
    void qc.invalidateQueries({ queryKey: brandingKeys.settings })
    void qc.invalidateQueries({ queryKey: ['tenant'] })
    void qc.invalidateQueries({ queryKey: ['dev-accounts'] })
    void qc.invalidateQueries({ queryKey: ['public-workspace'] })
    void qc.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function useSaveBranding() {
  const apply = useApplyCompany()
  return useMutation({ mutationFn: (patch: BrandingPatch) => updateBranding(patch), onSuccess: apply })
}

export function useResetBranding() {
  const apply = useApplyCompany()
  return useMutation({ mutationFn: resetBranding, onSuccess: apply })
}
