/**
 * Lead status model (database: lead_statuses.type + requirement flags). Shared by the UI (pipeline
 * board, stage dialog, Settings > Fixed lists), the mock API (stage rules, import, reports) and
 * docs/API.md. Pipeline rules read these flags, never status names.
 *
 *  - type: open (worked) · won · lost · cold (parked after unanswered attempts) · parked (other parked);
 *  - requiresNextStep: entering needs a next step and its follow-up date (Interested, Meeting);
 *  - requiresLossReason: entering needs a reason from the loss-reasons list (Lost, Not interested).
 * Won statuses are only ever set by the atomic Won flow (POST /leads/:id/won).
 */

export const LEAD_STATUS_TYPES = ['open', 'won', 'lost', 'cold', 'parked'] as const
export type LeadStatusType = (typeof LEAD_STATUS_TYPES)[number]

export const LEAD_STATUS_TYPE_LABEL: Record<LeadStatusType, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  cold: 'Cold',
  parked: 'Parked',
}

export const LEAD_STATUS_TYPE_HINT: Record<LeadStatusType, string> = {
  open: 'In the pipeline and worked by the owner',
  won: 'Closed as won (set only by the Won flow)',
  lost: 'Closed as lost',
  cold: 'Parked after unanswered attempts; no automatic follow-ups',
  parked: 'Out of the pipeline; no automatic follow-ups',
}

export function isLeadStatusType(v: unknown): v is LeadStatusType {
  return typeof v === 'string' && (LEAD_STATUS_TYPES as readonly string[]).includes(v)
}

/** The fields of a status the pipeline rules read. */
export interface StatusRuleFields {
  type: LeadStatusType
  requiresNextStep: boolean
  requiresLossReason: boolean
}

/** Out of the active pipeline (won, lost, cold or parked): no follow-up date. */
export const isClosedType = (t: LeadStatusType | undefined) => !!t && t !== 'open'
/** Cold or another parked status. */
export const isParkedType = (t: LeadStatusType | undefined) => t === 'cold' || t === 'parked'

/** What the stage dialog asks for before a lead enters a status. */
export type StageRequirement = 'none' | 'next-step' | 'loss-reason'

export function requirementOf(s: Pick<StatusRuleFields, 'requiresNextStep' | 'requiresLossReason'>): StageRequirement {
  if (s.requiresLossReason) return 'loss-reason'
  if (s.requiresNextStep) return 'next-step'
  return 'none'
}

export function flagsOfRequirement(r: StageRequirement): Pick<StatusRuleFields, 'requiresNextStep' | 'requiresLossReason'> {
  return { requiresNextStep: r === 'next-step', requiresLossReason: r === 'loss-reason' }
}

export const STAGE_REQUIREMENT_LABEL: Record<StageRequirement, string> = {
  none: 'None',
  'next-step': 'Next step & date',
  'loss-reason': 'Loss reason',
}
