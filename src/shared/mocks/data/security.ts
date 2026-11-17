import { addDays, setHours, setMinutes, startOfDay, subDays, subHours, subMinutes } from 'date-fns'
import type { BackupRun, SecurityPolicy, SecuritySession } from '@/modules/settings/security/types'

/**
 * In-memory security state for the mock API. There is no real authenticator app, so every
 * one-time code is the fixed demo code below; the UI shows it as a hint.
 */
export { DEMO_OTP } from '@/modules/auth/constants'

/** Mock base32 secret per user (deterministic, so the QR code is stable between setups). */
export function secretFor(userId: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let h = 2166136261
  for (const ch of `apex-aora:${userId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  let out = ''
  for (let i = 0; i < 32; i++) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0
    out += alphabet[h % 32]
  }
  return out
}

/** When each user turned on 2FA. */
export const twoFactorEnabledAt: Record<string, string> = {
  u1: subDays(new Date(), 210).toISOString(),
  u2: subDays(new Date(), 180).toISOString(),
  u5: subDays(new Date(), 45).toISOString(),
  u8: subDays(new Date(), 90).toISOString(),
}

/** Users who started setup but haven't confirmed a code yet. */
export const pendingTwoFactor = new Set<string>()

/** Unused recovery codes per user (each works once). */
export const recoveryCodes: Record<string, string[]> = {}

export function newRecoveryCodes(): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return Array.from({ length: 8 }, () => `${part()}-${part()}`)
}

/** Sign-in challenges waiting for a second factor. */
export interface LoginChallenge {
  userId: string
  expiresAt: number
  attempts: number
}
export const loginChallenges = new Map<string, LoginChallenge>()

/* ---------------- Sessions ---------------- */

const sessionsByUser: Record<string, SecuritySession[]> = {}
let sessionSeq = 1

/** Each user's signed-in devices. Seeded lazily: this browser plus a couple of others. */
export function sessionsFor(userId: string): SecuritySession[] {
  if (!sessionsByUser[userId]) {
    const now = new Date()
    sessionsByUser[userId] = [
      {
        id: `S-${sessionSeq++}`,
        device: 'Windows PC',
        browser: 'Chrome 131',
        ip: '94.204.18.73',
        location: 'Dubai, UAE',
        lastActiveAt: now.toISOString(),
        createdAt: subHours(now, 3).toISOString(),
        current: true,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'iPhone 15',
        browser: 'Safari 18',
        ip: '5.195.42.118',
        location: 'Dubai, UAE',
        lastActiveAt: subMinutes(now, 47).toISOString(),
        createdAt: subDays(now, 4).toISOString(),
        current: false,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'MacBook Pro',
        browser: 'Safari 18',
        ip: '86.98.211.6',
        location: 'Abu Dhabi, UAE',
        lastActiveAt: subDays(now, 2).toISOString(),
        createdAt: subDays(now, 11).toISOString(),
        current: false,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'Windows PC',
        browser: 'Edge 130',
        ip: '213.42.20.9',
        location: 'Sharjah, UAE',
        lastActiveAt: subDays(now, 6).toISOString(),
        createdAt: subDays(now, 19).toISOString(),
        current: false,
      },
    ]
  }
  return sessionsByUser[userId]
}

export function setSessionsFor(userId: string, list: SecuritySession[]): void {
  sessionsByUser[userId] = list
}

/* ---------------- Backups ---------------- */

/** Nightly at 02:00 Gulf time. */
export const BACKUP_SCHEDULE = 'Daily at 02:00 (GST)'
export const BACKUP_RETENTION_DAYS = 30

function nightly(daysAgo: number): Date {
  return setMinutes(setHours(startOfDay(subDays(new Date(), daysAgo)), 2), 0)
}

let backupSeq = 1
export const backupRuns: BackupRun[] = Array.from({ length: 14 }, (_, i) => {
  const started = nightly(i)
  const failed = i === 9
  return {
    id: `BK-${backupSeq++}`,
    startedAt: started.toISOString(),
    finishedAt: failed ? subMinutes(started, -2).toISOString() : subMinutes(started, -6 - (i % 4)).toISOString(),
    status: failed ? 'failed' : 'success',
    trigger: 'scheduled',
    sizeMb: failed ? null : Math.round((1840 - i * 9.5) * 10) / 10,
    triggeredBy: null,
    note: failed ? 'Storage target timed out; retried at the next run.' : '',
  } satisfies BackupRun
})

export function nextBackupId(): string {
  return `BK-${backupSeq++}`
}

/** Next scheduled run: tonight at 02:00 if it hasn't passed, else tomorrow. */
export function nextScheduledBackup(): string {
  const today = setMinutes(setHours(startOfDay(new Date()), 2), 0)
  return (today.getTime() > Date.now() ? today : addDays(today, 1)).toISOString()
}

/* ---------------- Policy ---------------- */

export const securityPolicy: SecurityPolicy = {
  requireTwoFactorForAdmins: false,
  sessionTimeoutMinutes: 60,
  passwordMinLength: 10,
}
