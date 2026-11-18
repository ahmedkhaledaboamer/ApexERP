/**
 * Task Management API shapes (spec: Task Management — daily work and delivery of customer projects).
 * One task store for everything: lead follow-up tasks, project delivery tasks, personal to-dos.
 */

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent'
export const TASK_PRIORITIES: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent']

export type TaskStatus = 'To do' | 'In progress' | 'Blocked' | 'Done'
export const TASK_STATUSES: TaskStatus[] = ['To do', 'In progress', 'Blocked', 'Done']

/** What a task can be linked to (polymorphic). Events stay inactive until the Events module exists. */
export type TaskLinkType = 'lead' | 'customer' | 'project' | 'event'
export const TASK_LINK_TYPES: TaskLinkType[] = ['lead', 'customer', 'project', 'event']

export interface TaskLink {
  type: TaskLinkType
  id: string
}

/** Resolved link for display (chip). */
export interface TaskLinkView extends TaskLink {
  label: string
  /** False when the target can't be opened (unknown, out of scope, or events not enabled). */
  available: boolean
}

export interface TaskAttachment {
  id: string
  name: string
  /** Bytes. */
  size: number
  /** MIME type. */
  type: string
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

export interface TaskEvent {
  id: string
  kind: TaskEventKind
  userId: string
  at: string
  /** Human summary, e.g. "Status: To do → In progress". */
  summary: string
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
  link: TaskLink | null
  /** Set for project tasks (also mirrored in `link` when the task is linked to the project). */
  projectId: string | null
  /** Estimated hours (project tasks come from the service template). */
  estimatedHours: number
  loggedHours: number
  /** Template task it was generated from (Won flow), if any. */
  templateTaskId: string | null
  /** Working-day offset from project start (generated tasks), for the timeline. */
  dayOffset: number | null
  attachments: TaskAttachment[]
  comments: TaskComment[]
  history: TaskEvent[]
  createdBy: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** Task as returned by the API: names resolved, link chip, overdue flag. */
export interface TaskView extends Task {
  ownerName: string
  followerNames: string[]
  linkView: TaskLinkView | null
  projectName: string | null
  /** Open and due before today in the company's timezone. */
  overdue: boolean
  /** May the caller change this task (status, dates, fields)? Same rule the API enforces (403). */
  canEdit: boolean
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
  estimatedHours?: number
  /**
   * Required (3–280 characters) when the task moves to, or is created as, Blocked: the server posts
   * it as a comment ("Blocked: …") so followers see what it waits on. Ignored otherwise.
   */
  blockedReason?: string
}

export type TaskUpdateInput = Partial<TaskInput> & { loggedHours?: number }

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
  includeDone?: boolean
}

/* ---------------- Projects ---------------- */

export type ProjectStatus = 'Planned' | 'Active' | 'On hold' | 'Completed' | 'Cancelled'
export const PROJECT_STATUSES: ProjectStatus[] = ['Planned', 'Active', 'On hold', 'Completed', 'Cancelled']

export interface Project {
  id: string
  name: string
  customerId: string
  serviceId: string
  /** The won lead it came from. */
  leadId: string | null
  /** The accepted quotation it came from. */
  quotationId: string | null
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
  /** Done tasks ÷ all tasks (by estimated hours when available), 0..100. */
  progress: number
  loggedHours: number
}

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'createdBy' | 'createdFrom' | 'leadId' | 'quotationId'> & {
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
  /** `billing`: subscription lifecycle and reminders; `usage`: plan usage warnings (to Company Admins). */
  type: 'won' | 'assignment' | 'mention' | 'task-overdue' | 'task-due' | 'billing' | 'usage'
  title: string
  body: string
  link: string
  at: string
  read: boolean
}
