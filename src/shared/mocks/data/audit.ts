import { subDays, subHours } from 'date-fns'
import type { User } from '@/shared/types'
import type { AuditAction, AuditChange, AuditEntry } from '@/modules/settings/types'

/** Mutable audit log (newest first). Every sensitive edit in the mock API appends here. */
export const auditLog: AuditEntry[] = [
  {
    id: 'AU-3',
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

/** Records who did what, and when (spec: any edit or deletion of sensitive data is logged). */
export function recordAudit(
  user: User,
  entry: { action: AuditAction; entity: string; entityId: string; summary: string; changes?: AuditChange[] },
): AuditEntry {
  const row: AuditEntry = {
    id: `AU-${seq++}`,
    at: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    changes: [],
    ...entry,
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
