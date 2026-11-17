import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changePassword, getAccount } from '@/modules/account/api/accountApi'
import type { ChangePasswordInput } from '@/modules/account/types'
import { securityKeys, usePolicyQuery } from '@/modules/settings/hooks/useSecurity'
import { useCurrentUser } from '@/store/hooks'

/** Fallbacks while the policy loads (or if it can't be read): the policy's own defaults. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30
export const DEFAULT_PASSWORD_MIN_LENGTH = 8

export const accountKeys = {
  me: (userId: string) => ['account', userId] as const,
}

export function useAccountQuery() {
  const id = useCurrentUser()?.id ?? ''
  return useQuery({ queryKey: accountKeys.me(id), queryFn: getAccount, enabled: !!id })
}

/** The parts of the security policy every user needs, with defaults while it loads. */
export function useAccountPolicy() {
  const query = usePolicyQuery()
  return {
    sessionTimeoutMinutes: query.data?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    passwordMinLength: query.data?.passwordMinLength ?? DEFAULT_PASSWORD_MIN_LENGTH,
    /** True once the real policy (or an error) is in, so a timeout isn't enforced on a guess. */
    settled: !query.isPending,
  }
}

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account'] })
      void qc.invalidateQueries({ queryKey: securityKeys.all })
      void qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
