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

export async function getTwoFactor(): Promise<TwoFactorStatus> {
  return (await http.get<TwoFactorStatus>('/security/2fa')).data
}

export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  return (await http.post<TwoFactorSetup>('/security/2fa/setup')).data
}

export async function verifyTwoFactor(code: string): Promise<TwoFactorEnabled> {
  return (await http.post<TwoFactorEnabled>('/security/2fa/verify', { code })).data
}

export async function disableTwoFactor(code: string): Promise<TwoFactorStatus> {
  return (await http.post<TwoFactorStatus>('/security/2fa/disable', { code })).data
}

export async function getSessions(): Promise<SecuritySession[]> {
  return (await http.get<SecuritySession[]>('/security/sessions')).data
}

export async function revokeSession(id: string): Promise<void> {
  await http.delete(`/security/sessions/${id}`)
}

export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  return (await http.post<{ revoked: number }>('/security/sessions/revoke-others')).data
}

export async function getBackups(): Promise<BackupStatusInfo> {
  return (await http.get<BackupStatusInfo>('/security/backups')).data
}

export async function runBackup(): Promise<BackupRun> {
  return (await http.post<BackupRun>('/security/backups/run')).data
}

export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  return (await http.get<SecurityPolicy>('/security/policy')).data
}

export async function saveSecurityPolicy(input: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  return (await http.put<SecurityPolicy>('/security/policy', input)).data
}
