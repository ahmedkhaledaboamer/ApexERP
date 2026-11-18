import type { Tone } from '@/shared/components/ui/Badge'

/**
 * Task and project enums as the database stores them (Apex Aora ERP Database Design v1.0:
 * tasks.status, tasks.priority, projects.status). The values travel on the wire; screens show the
 * labels. One place for UI, the mock API and the docs (docs/DB-ALIGNMENT.md).
 */

/* ---------------- tasks.status ---------------- */

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
}

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  todo: 'neutral',
  in_progress: 'blue',
  review: 'teal',
  done: 'green',
  cancelled: 'neutral',
}

/** Done and cancelled tasks are closed: no reminders, not overdue, not "open" in any count. */
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['done', 'cancelled']
export const isClosedTaskStatus = (s: TaskStatus): boolean => s === 'done' || s === 'cancelled'
export const isOpenTaskStatus = (s: TaskStatus): boolean => !isClosedTaskStatus(s)

/* ---------------- tasks.priority ---------------- */

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const TASK_PRIORITY_TONE: Record<TaskPriority, Tone> = {
  urgent: 'red',
  high: 'amber',
  medium: 'blue',
  low: 'neutral',
}

/** Sort order (urgent first). */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/* ---------------- projects.status ---------------- */

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  planned: 'sky',
  active: 'blue',
  on_hold: 'amber',
  completed: 'green',
  cancelled: 'neutral',
}

/* ---------------- Legacy values (before the database alignment) ---------------- */

/**
 * Old wire values → new ones. "Blocked" was a status and is now a flag (tasks.blocked_at /
 * blocked_reason): it maps to in_progress and the caller sets the flag (see migrateLegacyTask).
 * Already-migrated values pass through unchanged.
 */
const LEGACY_TASK_STATUS: Record<string, TaskStatus> = { 'To do': 'todo', 'In progress': 'in_progress', Blocked: 'in_progress', Done: 'done' }
const LEGACY_PRIORITY: Record<string, TaskPriority> = { Low: 'low', Medium: 'medium', High: 'high', Urgent: 'urgent' }
const LEGACY_PROJECT_STATUS: Record<string, ProjectStatus> = {
  Planned: 'planned',
  Active: 'active',
  'On hold': 'on_hold',
  Completed: 'completed',
  Cancelled: 'cancelled',
}

export function taskStatusFromLegacy(s: string): TaskStatus {
  if ((TASK_STATUSES as readonly string[]).includes(s)) return s as TaskStatus
  return LEGACY_TASK_STATUS[s] ?? 'todo'
}

export function taskPriorityFromLegacy(p: string): TaskPriority {
  if ((TASK_PRIORITIES as readonly string[]).includes(p)) return p as TaskPriority
  return LEGACY_PRIORITY[p] ?? 'medium'
}

export function projectStatusFromLegacy(s: string): ProjectStatus {
  if ((PROJECT_STATUSES as readonly string[]).includes(s)) return s as ProjectStatus
  return LEGACY_PROJECT_STATUS[s] ?? 'planned'
}
