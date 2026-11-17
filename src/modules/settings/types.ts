import type { Tone } from '@/shared/components/ui/Badge'

/* ---------------- Fixed lists (spec: Settings > Fixed lists) ---------------- */

/**
 * What a status means for the pipeline:
 * open = being worked; parked = Cold, no automatic follow-ups; won / lost = decided.
 */
export type StatusKind = 'open' | 'parked' | 'won' | 'lost'

/** What must be recorded before a lead can enter the status (spec section 4). */
export type StatusRequirement = 'none' | 'next-step' | 'loss-reason' | 'convert'

export interface ListOption {
  /** Stable id stored on records. Never changes once created; labels can. */
  key: string
  label: string
  active: boolean
  /** Sort position, 0-based. */
  order: number
  /**
   * Protected item the system relies on (e.g. the "Imported - no reason recorded" loss reason).
   * It can't be removed, renamed, deactivated or moved; it stays pinned last. On statuses this
   * flag has its own meaning (see StatusOption.system).
   */
  system?: boolean
  /** Never offered in pickers for new values; labels still resolve for existing records. */
  hiddenFromPickers?: boolean
}

export interface StatusOption extends ListOption {
  /** Win probability for the weighted forecast, 0..100. */
  probability: number
  kind: StatusKind
  requires: StatusRequirement
  tone: Tone
  /** Hex for charts. */
  color: string
  /** Built-in statuses can be renamed and deactivated but not removed. */
  system: boolean
}

export interface IndustryOption extends ListOption {
  subIndustries: ListOption[]
}

export interface Lookups {
  statuses: StatusOption[]
  sources: ListOption[]
  industries: IndustryOption[]
  lossReasons: ListOption[]
  tags: ListOption[]
  /** Service catalog categories (Settings > Fixed lists > Service categories). */
  serviceCategories: ListOption[]
}

export type LookupList = keyof Lookups

/* ---------------- Automation rules ---------------- */

/** Every number the lead journey automation uses (spec section 4; proposals, configurable). */
export interface AutomationRules {
  /** Remind the agent when a New lead has had no contact for this many days. */
  noContactReminderDays: number
  /** After moving to "No response", the next follow-up is set this many days later. */
  noResponseFollowUpDays: number
  /** Outreach attempts with no reply before the lead becomes Cold. */
  attemptsBeforeCold: number
  /** Alert the sales manager when an Interested lead has no activity for this many days. */
  stalledInterestedDays: number
  /** Lost / Not interested leads may be reopened after this many days. */
  lostReopenDays: number
  /** Alert this many days before a contract renewal. */
  renewalAlertDays: number
  /** Remind a task owner this many days before the due date. */
  taskReminderDaysBefore: number
}

export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  noContactReminderDays: 1,
  noResponseFollowUpDays: 2,
  attemptsBeforeCold: 3,
  stalledInterestedDays: 3,
  lostReopenDays: 90,
  renewalAlertDays: 30,
  taskReminderDaysBefore: 1,
}

/* ---------------- Audit log ---------------- */

export type AuditAction = 'create' | 'update' | 'delete' | 'deactivate' | 'reactivate' | 'security'

export interface AuditChange {
  field: string
  from: string
  to: string
}

/** One entry in the audit log: who did what, and when (spec section 3). */
export interface AuditEntry {
  id: string
  at: string
  userId: string
  userName: string
  action: AuditAction
  /** e.g. "user", "lookup:statuses", "automation", "template", "security". */
  entity: string
  entityId: string
  summary: string
  changes: AuditChange[]
}
