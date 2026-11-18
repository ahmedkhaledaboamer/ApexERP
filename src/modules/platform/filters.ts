import type { PlatformAuditEntry, PlatformAuditQuery, PlatformCompanyQuery, PlatformCompanyRow } from '@/modules/platform/types'

/* ---------------- Companies ---------------- */

export type CompanyFilterState = Pick<PlatformCompanyQuery, 'status' | 'plan' | 'country' | 'q'>

/** Client-side company filter (the list is small; the server takes the same params). */
export function filterCompanies(rows: readonly PlatformCompanyRow[], f: CompanyFilterState): PlatformCompanyRow[] {
  const q = f.q?.trim().toLowerCase() ?? ''
  return rows.filter((r) => {
    if (f.status === 'locked') {
      if (r.companyStatus !== 'suspended') return false
    } else if (f.status && r.subscriptionStatus !== f.status) return false
    if (f.plan && r.planId !== f.plan) return false
    if (f.country && r.country !== f.country) return false
    if (q && !`${r.name} ${r.subdomain} ${r.id}`.toLowerCase().includes(q)) return false
    return true
  })
}

/* ---------------- Platform audit log ---------------- */

export interface AuditFilterState {
  actor: string
  action: string
  companyId: string
  /** yyyy-mm-dd (inclusive, local day). */
  from: string
  to: string
  q: string
}

export const EMPTY_AUDIT_FILTERS: AuditFilterState = { actor: '', action: '', companyId: '', from: '', to: '', q: '' }

/** Start of a local yyyy-mm-dd day as ISO; null when empty or invalid. */
function dayStart(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** End of a local yyyy-mm-dd day (the last millisecond) as ISO. */
function dayEnd(day: string): string | null {
  const start = dayStart(day)
  return start ? new Date(Date.parse(start) + 86_400_000 - 1).toISOString() : null
}

/** UI filter state → GET /platform/audit params (empty values left out). */
export function auditQuery(f: AuditFilterState): PlatformAuditQuery {
  const q: PlatformAuditQuery = {}
  if (f.actor) q.actor = f.actor
  if (f.action) q.action = f.action
  if (f.companyId) q.companyId = f.companyId
  const from = dayStart(f.from)
  const to = dayEnd(f.to)
  if (from) q.from = from
  if (to) q.to = to
  if (f.q.trim()) q.q = f.q.trim()
  return q
}

/** Same filter on the client (applied over the server's answer, so the table never shows a stray row). */
export function filterAudit(entries: readonly PlatformAuditEntry[], query: PlatformAuditQuery): PlatformAuditEntry[] {
  const q = query.q?.trim().toLowerCase() ?? ''
  const from = query.from ? Date.parse(query.from) : null
  const to = query.to ? Date.parse(query.to) : null
  return entries.filter((e) => {
    if (query.actor && e.actorId !== query.actor) return false
    if (query.action && e.action !== query.action && !e.action.startsWith(`${query.action}.`)) return false
    if (query.companyId && e.companyId !== query.companyId) return false
    const at = Date.parse(e.at)
    if (from !== null && at < from) return false
    if (to !== null && at > to) return false
    if (q) {
      const hay = `${e.summary} ${e.reason ?? ''} ${e.actorName} ${e.companyName ?? ''} ${e.action}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct values for the filter selects. */
export function auditFacets(entries: readonly PlatformAuditEntry[]) {
  const actors = new Map<string, string>()
  const actions = new Set<string>()
  const companies = new Map<string, string>()
  for (const e of entries) {
    actors.set(e.actorId, `${e.actorName} (${e.actorRole})`)
    actions.add(e.action)
    if (e.companyId) companies.set(e.companyId, e.companyName ?? e.companyId)
  }
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1])
  return {
    actors: [...actors].sort(byLabel).map(([value, label]) => ({ value, label })),
    actions: [...actions].sort(),
    companies: [...companies].sort(byLabel).map(([value, label]) => ({ value, label })),
  }
}

/** Pretty JSON for the before/after diff ("—" for nothing). */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Top-level keys whose value differs between before and after (for highlighting). */
export function changedKeys(before: unknown, after: unknown): string[] {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const b = obj(before)
  const a = obj(after)
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort()
}
