import type { ActivityType, Priority, Role, TaskStatus } from '@/shared/types'

export const ACTIVITY_TYPES: ActivityType[] = ['call', 'email', 'whatsapp', 'visit', 'meeting']

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  visit: 'Visit',
  meeting: 'Meeting',
  system: 'System',
}

/** Outreach a Do Not Contact lead must not receive. */
export const OUTREACH_TYPES: ActivityType[] = ['call', 'email', 'whatsapp']

export const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  'To do': 'bg-canvas text-muted ring-1 ring-line',
  'In progress': 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200',
  Done: 'bg-success-50 text-success-700 dark:bg-success-700/25 dark:text-success-500',
}

export const PRIORITY_STYLES: Record<Priority, string> = {
  Low: 'text-muted',
  Medium: 'text-accent-700 dark:text-accent-300',
  High: 'text-danger-600 dark:text-danger-500',
}

export const ROLES: Role[] = [
  'Company Admin',
  'Management',
  'Sales Manager',
  'Sales Agent',
  'Marketing Manager',
  'Accountant',
  'HR Manager',
  'Department Head',
  'Employee',
]

export const DEMO_PASSWORD = 'apex2025'
