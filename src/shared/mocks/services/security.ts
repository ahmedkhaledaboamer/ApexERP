import type { User } from '@/shared/types'
import type {
  BackupRun,
  BackupStatusInfo,
  SecurityPolicy,
  SecuritySession,
  TwoFactorEnabled,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@/modules/settings/security/types'
import { POLICY_LIMITS } from '@/modules/settings/security/types'
import { can } from '@/shared/lib/permissions'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import {
  BACKUP_RETENTION_DAYS,
  DEMO_OTP,
  backupRunsFor,
  backupScheduleFor,
  newRecoveryCodes,
  nextBackupId,
  nextScheduledBackup,
  pendingTwoFactor,
  recoveryCodes,
  secretFor,
  securityPolicyFor,
  sessionsFor,
  setSessionsFor,
  twoFactorEnabledAt,
} from '@/shared/mocks/data/security'
import { companyById } from '@/shared/mocks/data/tenancy'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'

/* Every endpoint here is called with the signed-in user from the token (see handlers/utils). */

const SIX_DIGITS = /^\d{6}$/

/** A 6-digit code from the authenticator (always the demo code here) or an unused recovery code. */
export function checkSecondFactor(userId: string, raw: string): 'otp' | 'recovery' | null {
  const code = String(raw ?? '').trim().toLowerCase()
  if (code === DEMO_OTP) return 'otp'
  const list = recoveryCodes[userId] ?? []
  const i = list.indexOf(code)
  if (i >= 0) {
    list.splice(i, 1)
    return 'recovery'
  }
  return null
}

/* ---------------- Two-factor ---------------- */

export async function getTwoFactor(user: User): Promise<TwoFactorStatus> {
  return delay({
    enabled: user.twoFactorEnabled,
    enabledAt: user.twoFactorEnabled ? (twoFactorEnabledAt[user.id] ?? null) : null,
    recoveryCodesLeft: user.twoFactorEnabled ? (recoveryCodes[user.id]?.length ?? 0) : 0,
  })
}

export async function setupTwoFactor(user: User): Promise<TwoFactorSetup> {
  if (user.twoFactorEnabled) return fail('Two-factor authentication is already on. Turn it off first to set it up again.', 409)
  pendingTwoFactor.add(user.id)
  const secret = secretFor(user.id)
  // The authenticator entry carries the workspace's display name (branding), not a fixed brand.
  const issuer = companyById(tenantOf(user))?.branding.displayName ?? 'Apex CRM'
  const label = encodeURIComponent(`${issuer}:${user.email}`)
  return delay({
    secret,
    otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
  })
}

export async function verifyTwoFactor(user: User, code: string): Promise<TwoFactorEnabled> {
  if (user.twoFactorEnabled) return fail('Two-factor authentication is already on.', 409)
  if (!pendingTwoFactor.has(user.id)) return fail('Start the setup again: scan the QR code first.', 409)
  if (!SIX_DIGITS.test(String(code ?? '').trim())) return fail('Enter the 6-digit code from your authenticator app.', 422)
  if (String(code).trim() !== DEMO_OTP) return fail('That code didn’t match. Check the time on your phone and try the newest code.', 422)
  pendingTwoFactor.delete(user.id)
  user.twoFactorEnabled = true
  const enabledAt = new Date().toISOString()
  twoFactorEnabledAt[user.id] = enabledAt
  const codes = newRecoveryCodes()
  recoveryCodes[user.id] = [...codes]
  recordAudit(user, {
    action: 'security',
    entity: 'security',
    entityId: '2fa',
    summary: `${user.name} turned on two-factor authentication`,
    changes: [{ field: 'twoFactorEnabled', from: 'Off', to: 'On' }],
  })
  return delay({ enabled: true, enabledAt, recoveryCodes: codes })
}

export async function disableTwoFactor(user: User, code: string): Promise<TwoFactorStatus> {
  if (!user.twoFactorEnabled) return fail('Two-factor authentication is already off.', 409)
  if (securityPolicyFor(tenantOf(user)).requireTwoFactorForAdmins && user.role === 'Company Admin') {
    return fail('The security policy requires 2FA for Company Admins, so it can’t be turned off.', 422)
  }
  if (!checkSecondFactor(user.id, code)) return fail('That code didn’t match. Enter a current code or a recovery code.', 422)
  user.twoFactorEnabled = false
  delete twoFactorEnabledAt[user.id]
  delete recoveryCodes[user.id]
  recordAudit(user, {
    action: 'security',
    entity: 'security',
    entityId: '2fa',
    summary: `${user.name} turned off two-factor authentication`,
    changes: [{ field: 'twoFactorEnabled', from: 'On', to: 'Off' }],
  })
  return delay({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 })
}

/* ---------------- Sessions ---------------- */

export async function getSessions(user: User): Promise<SecuritySession[]> {
  const list = sessionsFor(user.id)
  const current = list.find((s) => s.current)
  if (current) current.lastActiveAt = new Date().toISOString()
  return delay([...list].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt)))
}

export async function revokeSession(user: User, id: string): Promise<{ ok: true }> {
  const list = sessionsFor(user.id)
  const session = list.find((s) => s.id === id)
  if (!session) return fail('That session has already ended.', 404)
  if (session.current) return fail('This is the session you’re using. Sign out instead.', 422)
  setSessionsFor(
    user.id,
    list.filter((s) => s.id !== id),
  )
  recordAudit(user, {
    action: 'security',
    entity: 'security',
    entityId: 'session',
    summary: `Signed out ${session.device} · ${session.browser} (${session.location})`,
    changes: [{ field: 'session', from: `${session.device} · ${session.ip}`, to: 'Revoked' }],
  })
  return delay({ ok: true })
}

export async function revokeOtherSessions(user: User): Promise<{ revoked: number }> {
  const list = sessionsFor(user.id)
  const others = list.filter((s) => !s.current)
  setSessionsFor(
    user.id,
    list.filter((s) => s.current),
  )
  if (others.length) {
    recordAudit(user, {
      action: 'security',
      entity: 'security',
      entityId: 'session',
      summary: `Signed out ${others.length} other session${others.length === 1 ? '' : 's'}`,
      changes: others.map((s) => ({ field: 'session', from: `${s.device} · ${s.ip}`, to: 'Revoked' })),
    })
  }
  return delay({ revoked: others.length })
}

/* ---------------- Backups ---------------- */

export async function getBackups(user: User): Promise<BackupStatusInfo> {
  if (!can(user.role, 'settings', 'view')) return fail('Backups are for admins.', 403)
  const co = tenantOf(user)
  const backupRuns = backupRunsFor(co)
  const lastSuccess = backupRuns.find((r) => r.status === 'success')
  return delay({
    schedule: backupScheduleFor(co),
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    nextAt: nextScheduledBackup(),
    retentionDays: BACKUP_RETENTION_DAYS,
    history: backupRuns,
  })
}

/** Starts a manual backup: it shows as running, then succeeds a few seconds later. */
export async function runBackup(user: User): Promise<BackupRun> {
  if (!can(user.role, 'settings', 'edit')) return fail('Only a Company Admin can run a backup.', 403)
  const backupRuns = backupRunsFor(tenantOf(user))
  if (backupRuns.some((r) => r.status === 'running')) return fail('A backup is already running.', 409)
  const run: BackupRun = {
    id: nextBackupId(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    trigger: 'manual',
    sizeMb: null,
    triggeredBy: user.name,
    note: '',
  }
  backupRuns.unshift(run)
  setTimeout(() => {
    run.status = 'success'
    run.finishedAt = new Date().toISOString()
    run.sizeMb = Math.round(((backupRuns.find((r) => r.sizeMb)?.sizeMb ?? 1840) + 1.4) * 10) / 10
  }, 4000)
  recordAudit(user, {
    action: 'security',
    entity: 'security',
    entityId: 'backup',
    summary: 'Ran a manual backup',
    changes: [],
  })
  return delay(run)
}

/* ---------------- Policy ---------------- */

/** Readable by every signed-in user: the app needs the session timeout and password length. */
export async function getPolicy(user: User): Promise<SecurityPolicy> {
  return delay(securityPolicyFor(tenantOf(user)))
}

export async function savePolicy(user: User, input: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  if (!can(user.role, 'settings', 'edit')) return fail('Only a Company Admin can change the security policy.', 403)
  const securityPolicy = securityPolicyFor(tenantOf(user))
  const next: SecurityPolicy = { ...securityPolicy }
  if (input.requireTwoFactorForAdmins !== undefined) next.requireTwoFactorForAdmins = input.requireTwoFactorForAdmins === true
  for (const key of ['sessionTimeoutMinutes', 'passwordMinLength'] as const) {
    if (input[key] === undefined) continue
    const n = Number(input[key])
    const { min, max } = POLICY_LIMITS[key]
    if (!Number.isInteger(n) || n < min || n > max) {
      return fail(`${key === 'sessionTimeoutMinutes' ? 'Session timeout' : 'Password length'} must be a whole number from ${min} to ${max}.`, 422)
    }
    next[key] = n
  }
  if (next.requireTwoFactorForAdmins && !securityPolicy.requireTwoFactorForAdmins && !user.twoFactorEnabled) {
    return fail('Turn on two-factor for your own account first, so you don’t lock yourself out.', 422)
  }
  const changes = diff(securityPolicy, next)
  Object.assign(securityPolicy, next)
  if (changes.length) {
    recordAudit(user, {
      action: 'security',
      entity: 'security',
      entityId: 'policy',
      summary: 'Changed the security policy',
      changes,
    })
  }
  return delay(securityPolicy)
}
