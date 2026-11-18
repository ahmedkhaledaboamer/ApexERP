import { addDays, setHours, setMinutes, startOfDay, subDays, subHours, subMinutes } from 'date-fns'
import type { BackupRun, SecurityPolicy, SecuritySession } from '@/modules/settings/security/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { perTenant } from '@/shared/mocks/tenant'
import { registerMap, registerObject, registerSet, registerValue } from '@/shared/mocks/persist/registry'

/**
 * In-memory security state for the mock API. There is no real authenticator app, so every
 * one-time code is the fixed demo code below; the UI shows it as a hint.
 * Per-user state (2FA, recovery codes, sessions) is keyed by the globally unique user id;
 * per-company state (policy, backups) lives per tenant.
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
export const pendingTwoFactor = registerSet('security.pendingTwoFactor', new Set<string>())
registerObject('security.twoFactorEnabledAt', twoFactorEnabledAt)

/** Unused recovery codes per user (each works once). */
export const recoveryCodes: Record<string, string[]> = registerObject('security.recoveryCodes', {})

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
export const loginChallenges = registerMap('security.loginChallenges', new Map<string, LoginChallenge>())

/* ---------------- Sessions ---------------- */

const sessionsByUser: Record<string, SecuritySession[]> = registerObject('security.sessionsByUser', {})
let sessionSeq = 1
registerValue('security.sessionSeq', () => sessionSeq, (v) => { sessionSeq = v })

type Place = { ip: string; location: string }

/** Synthetic sign-in places per company country (current device first). */
const PLACES: Record<string, Place[]> = {
  AE: [
    { ip: '94.204.18.73', location: 'Dubai, UAE' },
    { ip: '5.195.42.118', location: 'Dubai, UAE' },
    { ip: '86.98.211.6', location: 'Abu Dhabi, UAE' },
    { ip: '213.42.20.9', location: 'Sharjah, UAE' },
  ],
  SA: [
    { ip: '188.48.73.21', location: 'Riyadh, Saudi Arabia' },
    { ip: '37.224.18.90', location: 'Riyadh, Saudi Arabia' },
    { ip: '95.186.40.12', location: 'Jeddah, Saudi Arabia' },
    { ip: '46.152.7.205', location: 'Dammam, Saudi Arabia' },
  ],
}

function placesFor(userId: string): Place[] {
  const companyId = users.find((u) => u.id === userId)?.companyId
  const country = companyId ? companyById(companyId)?.regional.country : undefined
  return PLACES[country ?? 'AE'] ?? PLACES.AE
}

/** Each user's signed-in devices. Seeded lazily: this browser plus a couple of others, in the user's country. */
export function sessionsFor(userId: string): SecuritySession[] {
  if (!sessionsByUser[userId]) {
    const now = new Date()
    const [p0, p1, p2, p3] = placesFor(userId)
    sessionsByUser[userId] = [
      {
        id: `S-${sessionSeq++}`,
        device: 'Windows PC',
        browser: 'Chrome 131',
        ...p0,
        lastActiveAt: now.toISOString(),
        createdAt: subHours(now, 3).toISOString(),
        current: true,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'iPhone 15',
        browser: 'Safari 18',
        ...p1,
        lastActiveAt: subMinutes(now, 47).toISOString(),
        createdAt: subDays(now, 4).toISOString(),
        current: false,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'MacBook Pro',
        browser: 'Safari 18',
        ...p2,
        lastActiveAt: subDays(now, 2).toISOString(),
        createdAt: subDays(now, 11).toISOString(),
        current: false,
      },
      {
        id: `S-${sessionSeq++}`,
        device: 'Windows PC',
        browser: 'Edge 130',
        ...p3,
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

/* ---------------- Backups (per company) ---------------- */

export const BACKUP_RETENTION_DAYS = 30

/** Time-zone abbreviations for the schedule label (company regional timezone). */
const TZ_ABBR: Record<string, string> = { 'Asia/Dubai': 'GST', 'Asia/Riyadh': 'AST' }

/** Nightly at 02:00 company time, e.g. "Daily at 02:00 (GST)". */
export function backupScheduleFor(companyId: string): string {
  const tz = companyById(companyId)?.regional.timezone ?? 'Asia/Dubai'
  return `Daily at 02:00 (${TZ_ABBR[tz] ?? tz})`
}

function nightly(daysAgo: number): Date {
  return setMinutes(setHours(startOfDay(subDays(new Date(), daysAgo)), 2), 0)
}

/** One global sequence, so backup ids never collide across companies. */
let backupSeq = 1
registerValue('security.backupSeq', () => backupSeq, (v) => { backupSeq = v })

/** Synthetic history: `count` nightly runs, newest first; `failedAt` is the index of a failed run. */
function seedRuns(count: number, baseMb: number, stepMb: number, failedAt: number | null): BackupRun[] {
  return Array.from({ length: count }, (_, i) => {
    const started = nightly(i)
    const failed = i === failedAt
    return {
      id: `BK-${backupSeq++}`,
      startedAt: started.toISOString(),
      finishedAt: failed ? subMinutes(started, -2).toISOString() : subMinutes(started, -6 - (i % 4)).toISOString(),
      status: failed ? 'failed' : 'success',
      trigger: 'scheduled',
      sizeMb: failed ? null : Math.round((baseMb - i * stepMb) * 10) / 10,
      triggeredBy: null,
      note: failed ? 'Storage target timed out; retried at the next run.' : '',
    } satisfies BackupRun
  })
}

/** Seeded eagerly, Apex first, so Apex keeps BK-1…BK-14. */
const backupsByCompany = registerMap('security.backupsByCompany', new Map<string, BackupRun[]>([
  [APEX_ID, seedRuns(14, 1840, 9.5, 9)],
  [CREST_ID, seedRuns(10, 620, 3.2, null)],
]))

/** The company's backup history, newest first (mutable: a manual run is unshifted). */
export function backupRunsFor(companyId: string): BackupRun[] {
  let runs = backupsByCompany.get(companyId)
  if (!runs) {
    runs = []
    backupsByCompany.set(companyId, runs)
  }
  return runs
}

export function nextBackupId(): string {
  return `BK-${backupSeq++}`
}

/** Next scheduled run: tonight at 02:00 if it hasn't passed, else tomorrow. */
export function nextScheduledBackup(): string {
  const today = setMinutes(setHours(startOfDay(new Date()), 2), 0)
  return (today.getTime() > Date.now() ? today : addDays(today, 1)).toISOString()
}

/* ---------------- Policy (per company) ---------------- */

const POLICY_SEED: Record<string, SecurityPolicy> = {
  [APEX_ID]: { requireTwoFactorForAdmins: false, sessionTimeoutMinutes: 60, passwordMinLength: 10 },
  // Crest: 2FA not enforced yet, shorter idle timeout and longer passwords.
  [CREST_ID]: { requireTwoFactorForAdmins: false, sessionTimeoutMinutes: 30, passwordMinLength: 12 },
}

const policies = perTenant<SecurityPolicy>((companyId) => ({
  ...(POLICY_SEED[companyId] ?? { requireTwoFactorForAdmins: false, sessionTimeoutMinutes: 60, passwordMinLength: 10 }),
}), 'securityPolicies')

/** The company's security policy (mutable: Settings > Security edits it in place). */
export function securityPolicyFor(companyId: string): SecurityPolicy {
  return policies.get(companyId)
}
