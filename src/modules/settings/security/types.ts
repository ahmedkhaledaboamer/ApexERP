/** Security section types (2FA, sessions, backups, policy). */

export interface TwoFactorStatus {
  enabled: boolean
  enabledAt: string | null
  /** Unused recovery codes left (0 when 2FA is off). */
  recoveryCodesLeft: number
}

export interface TwoFactorSetup {
  /** Base32 secret for manual entry in the authenticator app. */
  secret: string
  /** otpauth:// URL encoded in the QR code. */
  otpauthUrl: string
}

export interface TwoFactorEnabled {
  enabled: true
  enabledAt: string
  /** Shown once; each works one time instead of a code. */
  recoveryCodes: string[]
}

export interface SecuritySession {
  id: string
  device: string
  browser: string
  ip: string
  location: string
  lastActiveAt: string
  createdAt: string
  /** This browser. Can't be revoked from here (sign out instead). */
  current: boolean
}

export type BackupStatus = 'running' | 'success' | 'failed'

export interface BackupRun {
  id: string
  startedAt: string
  finishedAt: string | null
  status: BackupStatus
  trigger: 'scheduled' | 'manual'
  sizeMb: number | null
  /** Name of the admin who ran it by hand; null for scheduled runs. */
  triggeredBy: string | null
  note: string
}

export interface BackupStatusInfo {
  schedule: string
  lastSuccessAt: string | null
  nextAt: string
  retentionDays: number
  /** Newest first. */
  history: BackupRun[]
}

export interface SecurityPolicy {
  /** System Admins must have 2FA turned on. */
  requireTwoFactorForAdmins: boolean
  /** Idle minutes before a session signs out. */
  sessionTimeoutMinutes: number
  passwordMinLength: number
}

export const POLICY_LIMITS = {
  sessionTimeoutMinutes: { min: 5, max: 1440 },
  passwordMinLength: { min: 8, max: 64 },
} as const
