import { http } from '@/shared/lib/axios'
import type {
  BackupRun,
  BackupStatusInfo,
  SecurityPolicy,
  SecuritySession,
  TwoFactorEnabled,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@/modules/settings/security/types'
import { backupStatusMapper, plainMapper } from '@/shared/api/mappers'

/** Security API: snake_case on the wire (enabled_at, last_active_at, session_timeout_minutes…), mapped both ways. */

export async function getTwoFactor(): Promise<TwoFactorStatus> {
  return plainMapper.fromApi((await http.get<unknown>('/security/2fa')).data) as TwoFactorStatus
}

export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  return plainMapper.fromApi((await http.post<unknown>('/security/2fa/setup')).data) as TwoFactorSetup
}

export async function verifyTwoFactor(code: string): Promise<TwoFactorEnabled> {
  return plainMapper.fromApi((await http.post<unknown>('/security/2fa/verify', { code })).data) as TwoFactorEnabled
}

export async function disableTwoFactor(code: string): Promise<TwoFactorStatus> {
  return plainMapper.fromApi((await http.post<unknown>('/security/2fa/disable', { code })).data) as TwoFactorStatus
}

export async function getSessions(): Promise<SecuritySession[]> {
  return plainMapper.fromApiList((await http.get<unknown>('/security/sessions')).data) as SecuritySession[]
}

export async function revokeSession(id: string): Promise<void> {
  await http.delete(`/security/sessions/${id}`)
}

export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  return plainMapper.fromApi((await http.post<unknown>('/security/sessions/revoke-others')).data) as { revoked: number }
}

export async function getBackups(): Promise<BackupStatusInfo> {
  return backupStatusMapper.fromApi((await http.get<unknown>('/security/backups')).data)
}

export async function runBackup(): Promise<BackupRun> {
  return plainMapper.fromApi((await http.post<unknown>('/security/backups/run')).data) as BackupRun
}

export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  return plainMapper.fromApi((await http.get<unknown>('/security/policy')).data) as SecurityPolicy
}

export async function saveSecurityPolicy(input: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  return plainMapper.fromApi((await http.put<unknown>('/security/policy', plainMapper.toApi(input as never))).data) as SecurityPolicy
}
