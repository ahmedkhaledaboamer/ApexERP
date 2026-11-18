/**
 * The bell (GET /alerts): reminders computed from the automation rules (Settings > Automation)
 * plus stored notifications (Won flow, task assignments, @mentions, billing lifecycle, plan usage warnings).
 */

export type AlertType =
  | 'no-contact'
  | 'stalled'
  | 'follow-up'
  | 'renewal'
  | 'task'
  | 'task-overdue'
  | 'won'
  | 'assignment'
  | 'mention'
  | 'billing'
  | 'usage'

export type AlertSeverity = 'info' | 'warning' | 'danger'

export interface Alert {
  /** Computed: stable per subject, e.g. "no-contact:L-1008", "task:TK-1004". Stored: "NT-12". */
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  body: string
  leadId?: string
  customerId?: string
  taskId?: string
  /** In-app path to open, e.g. "/leads/L-1008" or "/tasks/my?task=TK-1004". */
  link: string
  /** When the alert became due (ISO). Newest first in the list. */
  at: string
  /** True for stored notifications (they can be marked read); computed reminders omit it. */
  stored?: boolean
  /** Stored notifications only. */
  read?: boolean
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  won: 'Deals won',
  assignment: 'Assigned to you',
  mention: 'Mentions',
  'task-overdue': 'Overdue tasks',
  task: 'Tasks due soon',
  'follow-up': 'Follow-ups due',
  'no-contact': 'No first contact',
  stalled: 'Stalled interest',
  renewal: 'Renewals',
  billing: 'Billing',
  usage: 'Plan usage',
}

/** Display order of the groups in the bell. */
export const ALERT_TYPES: AlertType[] = ['billing', 'usage', 'mention', 'assignment', 'won', 'task-overdue', 'task', 'follow-up', 'no-contact', 'stalled', 'renewal']
