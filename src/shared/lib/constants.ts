import type { ActivityType, Priority, Role, TaskStatus } from '@/shared/types'

export const ACTIVITY_TYPES: ActivityType[] = ['call', 'email', 'whatsapp', 'visit', 'meeting']

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  visit: 'Visit',
  meeting: 'Meeting',
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
  'System Admin',
  'Management',
  'Sales Manager',
  'Sales Agent',
  'Marketing Manager',
  'Accountant',
  'HR Manager',
  'Department Head',
  'Employee',
]

/** The seeded user who represents each role in the role switcher and the demo logins. */
export const DEMO_USER_BY_ROLE: Record<Role, string> = {
  'System Admin': 'u1',
  Management: 'u2',
  'Sales Manager': 'u3',
  'Sales Agent': 'u4',
  'Marketing Manager': 'u7',
  Accountant: 'u8',
  'HR Manager': 'u9',
  'Department Head': 'u10',
  Employee: 'u11',
}

export const DEMO_PASSWORD = 'apex2025'

export const LOGO_URL = 'https://cdn.magicpatterns.com/uploads/eKKXVjahfoDq12vpjN8HQk/logo.png'

/** SVG charts cannot read Tailwind classes, so the brand colours are repeated here. */
export const BRAND_HEX = { violet: '#7c3aed', blue: '#2563eb' }
