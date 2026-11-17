import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  disableTwoFactor,
  getBackups,
  getSecurityPolicy,
  getSessions,
  getTwoFactor,
  revokeOtherSessions,
  revokeSession,
  runBackup,
  saveSecurityPolicy,
  setupTwoFactor,
  verifyTwoFactor,
} from '@/modules/settings/api/securityApi'
import type { SecurityPolicy } from '@/modules/settings/security/types'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'

export const securityKeys = {
  all: ['security'] as const,
  twoFactor: (userId: string) => ['security', '2fa', userId] as const,
  sessions: (userId: string) => ['security', 'sessions', userId] as const,
  backups: ['security', 'backups'] as const,
  policy: ['security', 'policy'] as const,
}

function useUserId() {
  return useCurrentUser()?.id ?? ''
}

export function useTwoFactorQuery() {
  const id = useUserId()
  return useQuery({ queryKey: securityKeys.twoFactor(id), queryFn: getTwoFactor, enabled: !!id })
}

export function useSessionsQuery() {
  const id = useUserId()
  return useQuery({ queryKey: securityKeys.sessions(id), queryFn: getSessions, enabled: !!id })
}

export function useBackupsQuery() {
  return useQuery({
    queryKey: securityKeys.backups,
    queryFn: getBackups,
    // Poll while a manual backup is running so it flips to "Succeeded" by itself.
    refetchInterval: (q) => (q.state.data?.history.some((r) => r.status === 'running') ? 1500 : false),
  })
}

export function usePolicyQuery() {
  return useQuery({ queryKey: securityKeys.policy, queryFn: getSecurityPolicy })
}

/** Keeps the signed-in user's 2FA flag in the stored session in step with the server. */
function useSyncSessionTwoFactor() {
  const dispatch = useAppDispatch()
  const session = useAppSelector((s) => s.auth.session)
  return (enabled: boolean) => {
    if (session) dispatch(signedIn({ ...session, user: { ...session.user, twoFactorEnabled: enabled } }))
  }
}

function useAfterSecurityWrite() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: securityKeys.all })
    void qc.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function useSetupTwoFactor() {
  return useMutation({ mutationFn: setupTwoFactor })
}

export function useVerifyTwoFactor() {
  const after = useAfterSecurityWrite()
  const sync = useSyncSessionTwoFactor()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => verifyTwoFactor(code),
    onSuccess: () => {
      sync(true)
      after()
      void qc.invalidateQueries({ queryKey: ['settings-users'] })
    },
  })
}

export function useDisableTwoFactor() {
  const after = useAfterSecurityWrite()
  const sync = useSyncSessionTwoFactor()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => disableTwoFactor(code),
    onSuccess: () => {
      sync(false)
      after()
      void qc.invalidateQueries({ queryKey: ['settings-users'] })
    },
  })
}

export function useRevokeSession() {
  const after = useAfterSecurityWrite()
  return useMutation({ mutationFn: (id: string) => revokeSession(id), onSuccess: after })
}

export function useRevokeOtherSessions() {
  const after = useAfterSecurityWrite()
  return useMutation({ mutationFn: revokeOtherSessions, onSuccess: after })
}

export function useRunBackup() {
  const after = useAfterSecurityWrite()
  return useMutation({ mutationFn: runBackup, onSuccess: after })
}

export function useSavePolicy() {
  const after = useAfterSecurityWrite()
  return useMutation({ mutationFn: (input: Partial<SecurityPolicy>) => saveSecurityPolicy(input), onSuccess: after })
}
