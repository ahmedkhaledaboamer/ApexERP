/** Alerts raised by the lead-journey and CRM automation rules (Settings > Automation). */

export type AlertType = 'no-contact' | 'stalled' | 'follow-up' | 'renewal' | 'task'

export type AlertSeverity = 'info' | 'warning' | 'danger'

export interface Alert {
  /** Stable per subject, e.g. "no-contact:L-1008". */
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  body: string
  leadId?: string
  customerId?: string
  /** In-app path to open, e.g. "/leads/L-1008". */
  link: string
  /** When the alert became due (ISO). Newest first in the list. */
  at: string
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  'no-contact': 'No first contact',
  stalled: 'Stalled interest',
  'follow-up': 'Follow-ups due',
  renewal: 'Renewals',
  task: 'Tasks',
}

/** Display order of the groups in the bell. */
export const ALERT_TYPES: AlertType[] = ['follow-up', 'no-contact', 'stalled', 'task', 'renewal']
