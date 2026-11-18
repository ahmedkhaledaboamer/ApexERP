import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCompanyProfile, updateCompanyProfile } from '@/modules/settings/api/companyProfileApi'
import type { CompanyProfilePatch } from '@/modules/settings/companyProfile'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { tenantRefreshed } from '@/store/authSlice'

export const companyProfileKeys = {
  profile: ['settings', 'company-profile'] as const,
}

export function useCompanyProfileQuery(enabled = true) {
  return useQuery({ queryKey: companyProfileKeys.profile, queryFn: getCompanyProfile, enabled })
}

/**
 * Saves the profile, then refreshes everything that prints it: the session tenant (issuer on
 * quotations, template {{company.*}}), the tenant query, the onboarding checklist and the audit log.
 */
export function useSaveCompanyProfile() {
  const qc = useQueryClient()
  const dispatch = useAppDispatch()
  const tenant = useAppSelector((s) => s.auth.session?.tenant ?? null)
  return useMutation({
    mutationFn: (patch: CompanyProfilePatch) => updateCompanyProfile(patch),
    onSuccess: (profile) => {
      qc.setQueryData(companyProfileKeys.profile, profile)
      if (tenant) dispatch(tenantRefreshed({ ...tenant, name: profile.legalName, profile }))
      void qc.invalidateQueries({ queryKey: ['tenant'] })
      void qc.invalidateQueries({ queryKey: companyProfileKeys.profile })
      void qc.invalidateQueries({ queryKey: ['onboarding'] })
      void qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
