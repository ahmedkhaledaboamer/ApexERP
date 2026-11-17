import type { User } from '@/shared/types'

/** GET /account: the signed-in user's own profile, with names resolved for display. */
export interface AccountInfo {
  user: User
  departmentName: string | null
  managerName: string | null
  lastLoginAt: string | null
  /** When the password was last set (seeded accounts: some weeks ago). */
  passwordChangedAt: string | null
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface PasswordChanged {
  changedAt: string
  /** Other devices that were signed out because the password changed. */
  signedOutSessions: number
}
