import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * lead_status_history (database design): one row per status change of a lead, for the funnel and
 * conversion reports. Field names are the design's columns in camelCase; status values are the
 * lead status keys (Settings › Fixed lists), which the backend stores as lead_statuses ids.
 *
 *   leadId        lead_id
 *   fromStatusId  from_status_id (null for the first status, e.g. on create)
 *   toStatusId    to_status_id
 *   changedBy     changed_by (null for system changes)
 *   reason        reason (the note: loss reason, next step, "Won by the Won flow", …)
 *   changedAt     changed_at
 *
 * Every stage change should call `recordLeadStatusChange` (the Won flow does; the pipeline's stage
 * move in services/leads.ts is wired by the lead / part A).
 */
export interface LeadStatusHistoryRow {
  id: string
  leadId: string
  fromStatusId: string | null
  toStatusId: string
  changedBy: string | null
  reason: string | null
  changedAt: string
}

export const leadStatusHistory: Tenant<LeadStatusHistoryRow>[] = registerArray('leadStatusHistory', [])

let lseq = 1
registerValue('leadStatusHistory.seq', () => lseq, (v) => { lseq = Number(v) || 1 })

/**
 * Appends a status change of `lead` (its company is the lead's). No row when the status didn't
 * change. Returns the row (or null).
 */
export function recordLeadStatusChange(
  lead: { id: string; companyId: string },
  fromStatusId: string | null,
  toStatusId: string,
  opts: { changedBy?: string | null; reason?: string | null; at?: string } = {},
): Tenant<LeadStatusHistoryRow> | null {
  if (fromStatusId === toStatusId) return null
  const row: Tenant<LeadStatusHistoryRow> = {
    companyId: lead.companyId,
    id: `LSH-${lseq++}`,
    leadId: lead.id,
    fromStatusId,
    toStatusId,
    changedBy: opts.changedBy ?? null,
    reason: opts.reason?.trim() ? opts.reason.trim().slice(0, 255) : null,
    changedAt: opts.at ?? new Date().toISOString(),
  }
  leadStatusHistory.push(row)
  return row
}

/** A lead's history, oldest first (ids are globally unique, so this never crosses companies). */
export function statusHistoryOf(leadId: string): Tenant<LeadStatusHistoryRow>[] {
  return leadStatusHistory.filter((r) => r.leadId === leadId).sort((a, b) => a.changedAt.localeCompare(b.changedAt))
}
