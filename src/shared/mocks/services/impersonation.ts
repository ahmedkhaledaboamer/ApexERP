import type { ImpersonationInfo, PlatformUser } from '@/modules/tenancy/types'
import type { ImpersonationEndReason, ImpersonationSessionRecord } from '@/modules/platform/types'
import type { User } from '@/shared/types'
import { CodedApiError } from '@/shared/mocks/tenant'
import { consoleSettings, impersonationSessions, nextPlatformId } from '@/shared/mocks/data/platform'
import { platformUsers } from '@/shared/mocks/data/tenancy'
import { recordActorAudit } from '@/shared/mocks/data/audit'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { platformActor, recordPlatformAudit, type PlatformCtx } from '@/shared/mocks/services/platformAudit'

/**
 * Impersonation (support sessions). The token only names the session (`imp.sessionId`); its mode,
 * expiry and end are read from the server record on every request, so nothing in the token is trusted.
 *
 *   read mode (default)  every non-GET → 403 impersonation_read_only, except /auth/impersonation/* and /auth/logout
 *   write mode           after POST /auth/impersonation/write-mode { confirm: true }
 *   any mode             sensitive paths → 403 impersonation_blocked (ALWAYS_BLOCKED)
 *   expired              401 impersonation_expired (the session is ended and audited in both logs)
 *   ended                401 impersonation_ended
 */

const MIN_REASON = 10

const err = (message: string, status: number, code: string, details: Record<string, unknown> = {}) =>
  new CodedApiError(message, status, code, details)

const isWrite = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())

/** Allowed in read mode although they are writes. */
const READ_MODE_EXEMPT: RegExp[] = [/^\/auth\/impersonation\//, /^\/auth\/logout$/]

/**
 * Always refused while impersonating, in both modes. `writes`: only non-GET requests.
 * Password and 2FA, signing sessions out, role switching (would mint a non-impersonation session),
 * billing and payment methods (all writes) and every export, deleting the company.
 */
const ALWAYS_BLOCKED: { re: RegExp; writesOnly: boolean; what: string }[] = [
  { re: /^\/account\/password$/, writesOnly: false, what: 'Changing the password' },
  { re: /^\/security\/2fa(\/|$)/, writesOnly: false, what: 'Two-factor authentication' },
  { re: /^\/security\/sessions(\/|$)/, writesOnly: true, what: 'Signing sessions out' },
  { re: /^\/auth\/switch-role$/, writesOnly: false, what: 'Switching role' },
  { re: /^\/billing\//, writesOnly: true, what: 'Billing and payment changes' },
  { re: /(^|\/)export(\/|$)/, writesOnly: false, what: 'Exporting data' },
  { re: /^\/(tenant|company|workspace)(\/delete)?$/, writesOnly: true, what: 'Deleting the company' },
  { re: /^\/(tenant|company|workspace)\/delete(\/|$)/, writesOnly: false, what: 'Deleting the company' },
]

export function reasonOk(reason: unknown, min: number): string | null {
  const r = String(reason ?? '').trim()
  return r.length >= min ? r : null
}

export function infoOf(rec: ImpersonationSessionRecord): ImpersonationInfo {
  return {
    platformUserId: rec.platformUserId,
    platformUserName: rec.platformUserName,
    platformRole: rec.platformRole,
    startedAt: rec.startedAt,
    sessionId: rec.sessionId,
    reason: rec.reason,
    expiresAt: rec.expiresAt,
    mode: rec.mode,
  }
}

function ctxOf(rec: ImpersonationSessionRecord): PlatformCtx {
  const pu: PlatformUser = platformUsers.find((p) => p.id === rec.platformUserId) ?? {
    id: rec.platformUserId,
    name: rec.platformUserName,
    email: '',
    platformRole: rec.platformRole,
  }
  return { user: pu, ip: rec.ip }
}

/** Both logs: the platform audit and the company's own audit log (who accessed, role, why). */
function auditBoth(rec: ImpersonationSessionRecord, action: string, companySummary: string, platformSummary: string, at: string, before: unknown = null, after: unknown = null): void {
  recordPlatformAudit(ctxOf(rec), { action, companyId: rec.companyId, summary: platformSummary, reason: rec.reason, before, after, at })
  recordActorAudit(rec.companyId, platformActor({ id: rec.platformUserId, name: rec.platformUserName }), {
    action: 'security',
    entity: 'security',
    entityId: 'impersonation',
    summary: companySummary,
    at,
  })
}

const who = (rec: ImpersonationSessionRecord) => `${rec.platformUserName} (${rec.platformRole}, Apex CRM)`

/** Creates the session record (permission, user and company checks are done by the caller). Audited in both logs. */
export function createImpersonationSession(ctx: PlatformCtx, user: User, reasonInput: unknown): ImpersonationSessionRecord {
  const reason = reasonOk(reasonInput, MIN_REASON)
  if (!reason) throw err(`Give a reason of at least ${MIN_REASON} characters. The company admin sees it in their audit log.`, 422, 'reason_required', { min: MIN_REASON })
  const t = nowMs()
  const rec: ImpersonationSessionRecord = {
    sessionId: nextPlatformId('IMP'),
    platformUserId: ctx.user.id,
    platformUserName: ctx.user.name,
    platformRole: ctx.user.platformRole,
    companyId: user.companyId,
    userId: user.id,
    userName: user.name,
    reason,
    startedAt: new Date(t).toISOString(),
    expiresAt: new Date(t + consoleSettings.impersonationMinutes * 60_000).toISOString(),
    mode: 'read',
    endedAt: null,
    endReason: null,
    ip: ctx.ip,
  }
  impersonationSessions.push(rec)
  auditBoth(
    rec,
    'impersonation.started',
    `${who(rec)} started a read-only support session as ${user.name}. Reason: ${reason}`,
    `Started a read-only support session as ${user.name}`,
    rec.startedAt,
    null,
    { sessionId: rec.sessionId, userId: user.id, mode: 'read', expiresAt: rec.expiresAt },
  )
  return rec
}

function endSession(rec: ImpersonationSessionRecord, why: ImpersonationEndReason, at: string): void {
  rec.endedAt = at
  rec.endReason = why
  if (why === 'expired') {
    auditBoth(rec, 'impersonation.expired', `The support session of ${who(rec)} as ${rec.userName} expired`, `Support session as ${rec.userName} expired`, at)
  } else {
    auditBoth(rec, 'impersonation.ended', `${who(rec)} ended the support session as ${rec.userName}`, `Ended the support session as ${rec.userName}`, at)
  }
}

/**
 * The live session behind an impersonation token, or 401: `impersonation_ended` (stopped, or unknown /
 * legacy token) or `impersonation_expired` (expiresAt passed by the mock clock: ended now and audited).
 */
export function liveImpersonation(imp: Partial<ImpersonationInfo>): ImpersonationSessionRecord {
  const rec = imp.sessionId ? impersonationSessions.find((s) => s.sessionId === imp.sessionId) : undefined
  if (!rec || rec.endReason === 'ended') throw err('This support session has ended.', 401, 'impersonation_ended')
  if (rec.endReason === 'expired') throw err('This support session has expired.', 401, 'impersonation_expired')
  if (Date.parse(rec.expiresAt) <= nowMs()) {
    endSession(rec, 'expired', rec.expiresAt)
    throw err('This support session has expired.', 401, 'impersonation_expired')
  }
  return rec
}

/** The impersonation rules for one request (`path` relative to the API base). */
export function assertImpersonationAllows(rec: ImpersonationSessionRecord, method: string, path: string): void {
  const write = isWrite(method)
  const blocked = ALWAYS_BLOCKED.find((b) => b.re.test(path) && (!b.writesOnly || write))
  if (blocked) {
    throw err(`${blocked.what} isn’t allowed during a support session.`, 403, 'impersonation_blocked', { mode: rec.mode })
  }
  if (write && rec.mode === 'read' && !READ_MODE_EXEMPT.some((re) => re.test(path))) {
    throw err('This support session is read-only. Switch to write mode to make changes.', 403, 'impersonation_read_only', { mode: rec.mode })
  }
}

/** POST /auth/impersonation/stop. */
export function stopImpersonationSession(rec: ImpersonationSessionRecord): void {
  if (!rec.endReason) endSession(rec, 'ended', nowIso())
}

/** POST /auth/impersonation/write-mode { confirm: true } (second confirmation). Audited in both logs. */
export function enableWriteMode(rec: ImpersonationSessionRecord, input: { confirm?: unknown } | null): ImpersonationSessionRecord {
  if (input?.confirm !== true) throw err('Confirm that you want to make changes in this workspace.', 422, 'confirmation_required')
  if (rec.mode === 'write') return rec
  rec.mode = 'write'
  auditBoth(
    rec,
    'impersonation.write_mode',
    `${who(rec)} switched the support session as ${rec.userName} to write mode. Reason: ${rec.reason}`,
    `Switched the support session as ${rec.userName} to write mode`,
    nowIso(),
    { mode: 'read' },
    { mode: 'write' },
  )
  return rec
}

export function impersonationSessionById(sessionId: string): ImpersonationSessionRecord | undefined {
  return impersonationSessions.find((s) => s.sessionId === sessionId)
}
