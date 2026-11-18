/** API shapes for the sales targets module (spec: monthly activity targets per agent). */

/** Activity kinds with a monthly target. */
export type TargetKey = 'leads' | 'calls' | 'emails' | 'visits' | 'meetings' | 'proposals' | 'partnerships' | 'events'

/** Monthly target per kind. 0 means "no target": the kind is skipped in every completion figure. */
export type TargetValues = Record<TargetKey, number>

export const TARGET_KEYS: TargetKey[] = ['leads', 'calls', 'emails', 'visits', 'meetings', 'proposals', 'partnerships', 'events']

/** Highest monthly target the API accepts for one kind. */
export const MAX_TARGET = 10_000

/**
 * Recommended company defaults (spec: Settings > Targets). Events attended has none: there's
 * no target for it unless one is set per agent or as a company default.
 */
export const RECOMMENDED_TARGETS: TargetValues = {
  leads: 1000,
  calls: 1000,
  emails: 1000,
  visits: 5,
  meetings: 5,
  proposals: 5,
  partnerships: 5,
  events: 0,
}

/** Kinds that only count when a target is set (0 shows "No default" rather than a number). */
export const OPTIONAL_TARGET_KEYS: TargetKey[] = ['events']

export const TARGET_LABELS: Record<TargetKey, string> = {
  leads: 'New leads',
  calls: 'Calls',
  emails: 'Emails',
  visits: 'Visits',
  meetings: 'Meetings',
  proposals: 'Proposals',
  partnerships: 'Partnerships',
  events: 'Events attended',
}

/** How each actual is counted, shown as help text. */
export const TARGET_SOURCES: Record<TargetKey, string> = {
  leads: 'Leads created this month and owned by the agent',
  calls: 'Call activities logged',
  emails: 'Email and WhatsApp activities logged',
  visits: 'Visit activities logged',
  meetings: 'Meeting activities logged',
  proposals: 'Leads in the Proposal stage',
  partnerships: 'Partnership agreements signed',
  events: 'Events attended (counted once the Events module is live)',
}

/** One agent's targets and actuals for a month. */
export interface AgentTargetRow {
  userId: string
  name: string
  title: string
  values: TargetValues
  /** Calculated by the server from logged activities and lead records. */
  actuals: TargetValues
  /** True when no targets were saved for this month, so the company defaults apply. */
  isDefault: boolean
}

/** GET /targets?month=yyyy-MM */
export interface TargetsMonth {
  /** `yyyy-MM`. */
  month: string
  /** Share of the month elapsed, 0..1 (1 for past months, 0 for future ones). */
  elapsed: number
  /** Whether the caller may change targets (sales scope full or team). */
  canEdit: boolean
  rows: AgentTargetRow[]
}

/** PUT /targets/:userId?month=yyyy-MM */
export interface UpdateTargetsInput {
  values: TargetValues
}

/** GET / PUT /targets/defaults: company defaults used by every month without a per-agent row. */
export interface TargetDefaults {
  values: TargetValues
  /** Whether the caller may change the defaults (Company Admin). */
  canEdit: boolean
}
