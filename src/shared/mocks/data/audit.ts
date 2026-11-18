import { subDays, subHours } from 'date-fns'
import type { User } from '@/shared/types'
import type { AuditAction, AuditChange, AuditEntry } from '@/modules/settings/types'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/** Server-side row: every entry belongs to one company (filter with scoped() from mocks/tenant). */
export type AuditRow = AuditEntry & { companyId: string }

/** Mutable audit log (newest first), all tenants. Every sensitive edit in the mock API appends here. */
export const auditLog: AuditRow[] = [
  {
    id: 'AU-3',
    companyId: 'co_apex',
    at: subHours(new Date(), 5).toISOString(),
    userId: 'u1',
    userName: 'Omar Haddad',
    action: 'update',
    entity: 'user',
    entityId: 'u6',
    summary: 'Changed Priya Raman’s direct manager',
    changes: [{ field: 'managerId', from: 'Layla Mansour', to: 'Karim Nasser' }],
  },
  {
    id: 'AU-2',
    companyId: 'co_apex',
    at: subDays(new Date(), 2).toISOString(),
    userId: 'u1',
    userName: 'Omar Haddad',
    action: 'security',
    entity: 'security',
    entityId: 'backup',
    summary: 'Ran a manual backup',
    changes: [],
  },
  {
    id: 'AU-1',
    companyId: 'co_apex',
    at: subDays(new Date(), 6).toISOString(),
    userId: 'u1',
    userName: 'Omar Haddad',
    action: 'update',
    entity: 'lookup:lossReasons',
    entityId: 'lossReasons',
    summary: 'Added loss reason “Unresponsive after proposal”',
    changes: [],
  },
]

let seq = 4
registerArray('auditLog', auditLog)
registerValue('auditLog.seq', () => seq, (v) => { seq = v })

/** Records who did what, and when (spec: any edit or deletion of sensitive data is logged). */
/**
 * The support session behind the current request, set by userFrom for every company request (null
 * for a normal session). Writes made while a platform operator impersonates the user are marked in
 * the company audit log, so the company admin sees that support made them and why.
 */
let supportActor: { userId: string; label: string } | null = null
export function setSupportActor(actor: { userId: string; platformUserName: string; reason: string } | null): void {
  supportActor = actor ? { userId: actor.userId, label: `${actor.platformUserName}, Apex CRM support — reason: ${actor.reason}` } : null
}

export function recordAudit(
  user: User,
  entry: { action: AuditAction; entity: string; entityId: string; summary: string; changes?: AuditChange[] },
): AuditRow {
  const row: AuditRow = {
    id: `AU-${seq++}`,
    companyId: user.companyId,
    at: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    changes: [],
    ...entry,
  }
  if (supportActor && supportActor.userId === user.id && entry.entityId !== 'impersonation') {
    row.summary = `${row.summary} (during a support session by ${supportActor.label})`
  }
  auditLog.unshift(row)
  return row
}

/**
 * An automatic entry (subscription lifecycle, scheduled jobs) in one company, by "System". `at`
 * defaults to now; the billing lifecycle passes the simulated time of the transition.
 */
export function recordSystemAudit(
  companyId: string,
  entry: { action: AuditAction; entity: string; entityId: string; summary: string; changes?: AuditChange[]; at?: string },
): AuditRow {
  const { at, ...rest } = entry
  const row: AuditRow = {
    id: `AU-${seq++}`,
    companyId,
    at: at ?? new Date().toISOString(),
    userId: 'system',
    userName: 'System',
    changes: [],
    ...rest,
  }
  auditLog.unshift(row)
  return row
}

/** Someone who isn't a user of the company (a platform operator), named in the company's audit log. */
export interface AuditActor {
  /** e.g. `platform:p2`. */
  id: string
  /** e.g. "Sami Haddad (Apex CRM support)". */
  name: string
}

/**
 * An entry in one company's log by an outside actor (Apex CRM staff acting from the Super-Admin
 * Console), so the company admin sees who accessed or changed their workspace and why.
 */
export function recordActorAudit(
  companyId: string,
  actor: AuditActor,
  entry: { action: AuditAction; entity: string; entityId: string; summary: string; changes?: AuditChange[]; at?: string },
): AuditRow {
  const { at, ...rest } = entry
  const row: AuditRow = {
    id: `AU-${seq++}`,
    companyId,
    at: at ?? new Date().toISOString(),
    userId: actor.id,
    userName: actor.name,
    changes: [],
    ...rest,
  }
  auditLog.unshift(row)
  return row
}

/** Field-by-field diff of two flat objects, for audit entries. */
export function diff(before: object, after: object): AuditChange[] {
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  return Object.keys(b)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: k, from: fmt(a[k]), to: fmt(b[k]) }))
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
