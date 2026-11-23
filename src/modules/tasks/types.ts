/**
 * Task Management API shapes (spec: Task Management — daily work and delivery of customer projects).
 * One task store for everything: lead follow-up tasks, project delivery tasks, personal to-dos.
 * Field names follow the database design in camelCase (tasks, time_entries, attachments, projects):
 * see docs/DB-ALIGNMENT.md.
 */

import type { TaskPriority, TaskStatus, ProjectStatus } from './enums'

export {
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  TASK_PRIORITY_RANK,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  CLOSED_TASK_STATUSES,
  isClosedTaskStatus,
  isOpenTaskStatus,
} from './enums'
export type { TaskPriority, TaskStatus, ProjectStatus } from './enums'

/**
 * What a task can be related to (tasks.related_type + related_id: Lead, Customer or Event). The
 * project is NOT a related link: it is its own column (`projectId`, tasks.project_id). Events stay
 * inactive until the Events module exists.
 */
export type TaskLinkType = 'lead' | 'customer' | 'event'
export const TASK_LINK_TYPES: TaskLinkType[] = ['lead', 'customer', 'event']

export interface TaskLink {
  type: TaskLinkType
  id: string
}

/** Resolved link for display (chip). */
export interface TaskLinkView {
  type: TaskLinkType | 'project'
  id: string
  label: string
  /** False when the target can't be opened (unknown, out of scope, or events not enabled). */
  available: boolean
}

/** attachments row (attachable = Task). */
export interface TaskAttachment {
  id: string
  /** original_name. */
  name: string
  /** attachments.size_bytes. */
  sizeBytes: number
  /** attachments.mime_type. */
  mimeType: string
  uploadedBy: string
  uploadedAt: string
}

export interface TaskComment {
  id: string
  authorId: string
  body: string
  /** User ids @mentioned in the body. */
  mentions: string[]
  at: string
}

export type TaskEventKind =
  | 'created'
  | 'status'
  | 'owner'
  | 'due'
  | 'priority'
  | 'edited'
  | 'comment'
  | 'attachment'
  | 'follower'
  | 'hours'
  | 'link'
  | 'blocked'
  | 'subtask'

export interface TaskEvent {
  id: string
  kind: TaskEventKind
  userId: string
  at: string
  /** Human summary, e.g. "Status: To do → In progress". */
  summary: string
}

/** time_entries row: hours logged by a user on a task (and its project). */
export interface TimeEntry {
  id: string
  /** time_entries.project_id: the task's project (null for a task outside projects: see Design gaps). */
  projectId: string | null
  taskId: string | null
  userId: string
  /** yyyy-MM-dd (company calendar). */
  entryDate: string
  hours: number
  description: string | null
  isBillable: boolean
  createdAt: string
}

export interface TimeEntryView extends TimeEntry {
  userName: string
}

export interface TimeEntryInput {
  entryDate: string
  hours: number
  description?: string | null
  isBillable?: boolean
}

export interface Task {
  id: string
  title: string
  description: string
  ownerId: string
  followerIds: string[]
  priority: TaskPriority
  /** yyyy-MM-dd or null. */
  dueDate: string | null
  status: TaskStatus
  /** tasks.related_type + related_id (lead, customer or event), or null. */
  link: TaskLink | null
  /** tasks.project_id. */
  projectId: string | null
  /** tasks.parent_task_id: one level only (a sub-task has no sub-tasks). */
  parentTaskId: string | null
  /** Estimated hours (project tasks come from the service template). */
  estimatedHours: number
  /** Template task it was generated from (Won flow), if any. */
  templateTaskId: string | null
  /** Working-day offset from project start (generated tasks), for the timeline. */
  dayOffset: number | null
  /** tasks.sort_order (template order for generated tasks, else 0). */
  sortOrder: number
  /** Blocked flag (Design gap: tasks.blocked_at / blocked_reason). Null = not blocked. */
  blockedAt: string | null
  blockedReason: string | null
  /** tasks.reminder_sent_at: the owner's "due soon" reminder was stored (once; reset when the due date changes). */
  reminderSentAt: string | null
  /** tasks.overdue_notified_at: the manager's overdue notice was stored (once; reset when the due date changes). */
  overdueNotifiedAt: string | null
  attachments: TaskAttachment[]
  comments: TaskComment[]
  history: TaskEvent[]
  createdBy: string
  createdAt: string
  updatedAt: string
  /** Set when the status becomes done, cleared on reopen. */
  completedAt: string | null
}

export interface SubtaskView {
  id: string
  title: string
  status: TaskStatus
  ownerId: string
  ownerName: string
  dueDate: string | null
  blocked: boolean
}

/** Task as returned by the API: names resolved, link chip, overdue flag, hours, sub-tasks. */
export interface TaskView extends Task {
  ownerName: string
  followerNames: string[]
  linkView: TaskLinkView | null
  projectName: string | null
  /** Open and due before today in the company's timezone. */
  overdue: boolean
  /** blockedAt is set. */
  blocked: boolean
  /** May the caller change this task (status, dates, fields)? Same rule the API enforces (403). */
  canEdit: boolean
  /** Sum of the task's time entries (cached like projects.actual_hours). */
  loggedHours: number
  timeEntries: TimeEntryView[]
  /** Parent's title for a sub-task. */
  parentTitle: string | null
  subtasks: SubtaskView[]
  /** Done sub-tasks / all sub-tasks (cancelled ones don't count). */
  subtaskProgress: { done: number; total: number }
}

export interface TaskInput {
  title: string
  description?: string
  ownerId?: string
  followerIds?: string[]
  priority?: TaskPriority
  dueDate?: string | null
  status?: TaskStatus
  link?: TaskLink | null
  projectId?: string | null
  /** Creates a sub-task of this task (same project and company; one level only). */
  parentTaskId?: string | null
  estimatedHours?: number
}

export type TaskUpdateInput = Partial<Omit<TaskInput, 'parentTaskId'>> & {
  /** Moving a parent to done with open sub-tasks is refused (409) unless forced. */
  force?: boolean
}

export interface TaskFilter {
  /** 'me' = owner or follower is the caller. */
  mine?: boolean
  ownerId?: string
  projectId?: string
  linkType?: TaskLinkType
  linkId?: string
  status?: TaskStatus
  priority?: TaskPriority
  /** Due on or before (yyyy-MM-dd). */
  dueTo?: string
  dueFrom?: string
  /** Include done and cancelled tasks. */
  includeDone?: boolean
  /** Only blocked (true) or only unblocked (false) tasks. */
  blocked?: boolean
}

/* ---------------- Projects ---------------- */

export interface Project {
  id: string
  name: string
  customerId: string
  serviceId: string
  /** The won lead it came from. */
  leadId: string | null
  /** The accepted quotation it came from. */
  quotationId: string | null
  /** projects.contract_id: the contract the Won flow created with it, if any. */
  contractId: string | null
  /** projects.project_template_id: the service's template the tasks came from (the service id in this mock), if any. */
  projectTemplateId: string | null
  managerId: string
  /** yyyy-MM-dd. */
  startDate: string
  endDate: string
  status: ProjectStatus
  estimatedHours: number
  createdAt: string
  createdBy: string
  createdFrom: 'won' | 'manual'
}

export interface ProjectRow extends Project {
  customerName: string
  serviceName: string
  managerName: string
  taskCount: number
  doneCount: number
  overdueCount: number
  /** Done tasks ÷ all tasks (by estimated hours when available), 0..100. Cancelled tasks don't count. */
  progress: number
  /** projects.actual_hours: sum of the project's time entries. */
  loggedHours: number
}

export type ProjectInput = Omit<
  Project,
  'id' | 'createdAt' | 'createdBy' | 'createdFrom' | 'leadId' | 'quotationId' | 'contractId' | 'projectTemplateId'
> & {
  leadId?: string | null
  /** Generate tasks from the service's project template (default true). */
  generateTasks?: boolean
}
export type ProjectUpdateInput = Partial<Omit<ProjectInput, 'customerId' | 'serviceId' | 'generateTasks'>> & {
  /** Managers may complete a project that still has open tasks. */
  force?: boolean
}

/** GET /projects/:id: the row plus its tasks, its audit trail and what the caller may do. */
export interface ProjectDetail extends ProjectRow {
  tasks: TaskView[]
  audit: import('@/modules/settings/types').AuditEntry[]
  canManage: boolean
}

/* ---------------- Notifications (stored) ---------------- */

export interface StoredNotification {
  id: string
  userId: string
  /**
   * `billing`: subscription lifecycle and reminders; `usage`: plan usage warnings (to Company Admins);
   * `task-due`: the owner's reminder N days before the due date; `task-overdue`: the overdue notice
   * to the owner's manager (both stored once per task by the reminder tick). `marketing-due` /
   * `marketing-overdue` / `marketing`: content calendar, design requests and brand assets
   * (services/creativeReminders.ts and the creative services).
   */
  type: 'won' | 'assignment' | 'mention' | 'task-overdue' | 'task-due' | 'billing' | 'usage' | 'marketing-due' | 'marketing-overdue' | 'marketing' | 'event-follow-up' | 'hr' | 'hr-people' | 'hr-payroll' | 'hr-journey' | 'hr-requests' | 'finance' | 'integrations'
  title: string
  body: string
  link: string
  at: string
  read: boolean
  /** The task a task-due / task-overdue notification is about. */
  taskId?: string
}
