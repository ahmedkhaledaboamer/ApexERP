import type { PlatformUser } from '@/modules/tenancy/types'
import type { PlatformAuditEntry } from '@/modules/platform/types'
import type { AuditActor } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { nextPlatformId, platformAudit } from '@/shared/mocks/data/platform'
import { nowIso } from '@/shared/mocks/clock'

/** A signed-in platform operator for one request: who, and the (mocked) client IP of their session. */
export interface PlatformCtx {
  user: PlatformUser
  ip: string
}

/** Stable fake client IP per platform user + sign-in session (token issue time). A real backend logs the real one. */
export function fakeIp(platformUserId: string, sessionKey: string | number): string {
  let h = 2166136261
  for (const ch of `${platformUserId}|${sessionKey}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${(h & 255) || 1}`
}

/** How a platform operator appears in a company's own audit log. */
export function platformActor(pu: Pick<PlatformUser, 'id' | 'name'>): AuditActor {
  return { id: `platform:${pu.id}`, name: `${pu.name} (Apex CRM support)` }
}

/** Appends to the platform audit log (newest first). */
export function recordPlatformAudit(
  ctx: PlatformCtx,
  entry: { action: string; companyId?: string | null; summary: string; before?: unknown; after?: unknown; reason?: string | null; at?: string },
): PlatformAuditEntry {
  const companyId = entry.companyId ?? null
  const row: PlatformAuditEntry = {
    id: nextPlatformId('PA'),
    at: entry.at ?? nowIso(),
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    actorRole: ctx.user.platformRole,
    action: entry.action,
    companyId,
    companyName: companyId ? (companyById(companyId)?.name ?? null) : null,
    summary: entry.summary,
    before: entry.before === undefined ? null : structuredClone(entry.before),
    after: entry.after === undefined ? null : structuredClone(entry.after),
    reason: entry.reason ?? null,
    ip: ctx.ip,
  }
  platformAudit.unshift(row)
  return row
}
