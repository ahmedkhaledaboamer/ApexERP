import { format, parseISO } from 'date-fns'
import type { Task, TaskAttachment, TaskComment, TaskEvent, TaskLink, TimeEntry } from '@/modules/tasks/types'
import { taskPriorityFromLegacy, taskStatusFromLegacy } from '@/modules/tasks/enums'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Database alignment (part B): converts a task stored in the old shape to the design's shape.
 * Pure (no stores), so the seed, a restore and the unit tests share it.
 *
 *   status        'To do' | 'In progress' | 'Blocked' | 'Done' → todo | in_progress | done
 *                 Blocked → in_progress + the blocked flag: blockedAt = the last status change (the
 *                 history event that moved it to Blocked, else updatedAt), blockedReason = the last
 *                 "Blocked: …" comment (the reason the old flow recorded), else "Blocked (migrated)"
 *   priority      'Low' … 'Urgent' → low … urgent
 *   link          { type: 'project' } → link null + projectId (the project is its own column)
 *   attachments   size / type → sizeBytes / mimeType
 *   loggedHours   a number on the task → one time entry (entryDate = completion or last update day)
 *   completedAt   done without it → updatedAt; any other status → null
 *   new columns   parentTaskId, sortOrder, reminderSentAt, overdueNotifiedAt default to null / 0
 */

export const MIGRATED_BLOCKED_REASON = 'Blocked (migrated)'

interface LegacyAttachment {
  id: string
  name: string
  uploadedBy: string
  uploadedAt: string
  size?: number
  type?: string
  sizeBytes?: number
  mimeType?: string
}

export type LegacyTask = Omit<
  Partial<Task>,
  'status' | 'priority' | 'link' | 'attachments'
> & {
  companyId: string
  id: string
  title: string
  ownerId: string
  status: string
  priority: string
  link?: { type: string; id: string } | null
  attachments?: LegacyAttachment[]
  loggedHours?: number
  createdAt: string
  updatedAt?: string
}

export interface MigratedTask {
  task: Tenant<Task>
  /** Time entries created from the old loggedHours (0 or 1). */
  timeEntries: Omit<Tenant<TimeEntry>, 'id'>[]
}

const BLOCKED_PREFIX = 'Blocked: '

export function migrateLegacyTask(raw: LegacyTask): MigratedTask {
  const history: TaskEvent[] = raw.history ?? []
  const comments: TaskComment[] = raw.comments ?? []
  const updatedAt = raw.updatedAt ?? raw.createdAt
  const status = taskStatusFromLegacy(raw.status)
  const wasBlocked = raw.status === 'Blocked'

  let blockedAt: string | null = raw.blockedAt ?? null
  let blockedReason: string | null = raw.blockedReason ?? null
  if (wasBlocked) {
    const lastMove = [...history].reverse().find((e) => e.kind === 'status' && /→ Blocked/.test(e.summary))
    blockedAt = lastMove?.at ?? updatedAt
    const lastReason = [...comments].reverse().find((c) => c.body.startsWith(BLOCKED_PREFIX))
    blockedReason = lastReason ? lastReason.body.slice(BLOCKED_PREFIX.length).trim() || MIGRATED_BLOCKED_REASON : MIGRATED_BLOCKED_REASON
  }

  let link: TaskLink | null = null
  let projectId = raw.projectId ?? null
  if (raw.link) {
    if (raw.link.type === 'project') projectId = projectId ?? raw.link.id
    else if (raw.link.type === 'lead' || raw.link.type === 'customer' || raw.link.type === 'event') link = { type: raw.link.type, id: raw.link.id }
  }

  const attachments: TaskAttachment[] = (raw.attachments ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    sizeBytes: a.sizeBytes ?? a.size ?? 0,
    mimeType: a.mimeType ?? (a.type || 'application/octet-stream'),
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
  }))

  const completedAt = status === 'done' ? (raw.completedAt ?? updatedAt) : null
  const task: Tenant<Task> = {
    companyId: raw.companyId,
    id: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    ownerId: raw.ownerId,
    followerIds: raw.followerIds ?? [],
    priority: taskPriorityFromLegacy(raw.priority),
    dueDate: raw.dueDate ?? null,
    status,
    link,
    projectId,
    parentTaskId: raw.parentTaskId ?? null,
    estimatedHours: raw.estimatedHours ?? 0,
    templateTaskId: raw.templateTaskId ?? null,
    dayOffset: raw.dayOffset ?? null,
    sortOrder: raw.sortOrder ?? 0,
    blockedAt: status === 'done' || status === 'cancelled' ? null : blockedAt,
    blockedReason: status === 'done' || status === 'cancelled' ? null : blockedReason,
    reminderSentAt: raw.reminderSentAt ?? null,
    overdueNotifiedAt: raw.overdueNotifiedAt ?? null,
    attachments,
    comments,
    history,
    createdBy: raw.createdBy ?? raw.ownerId,
    createdAt: raw.createdAt,
    updatedAt,
    completedAt,
  }

  const hours = Math.max(0, Math.round((raw.loggedHours ?? 0) * 100) / 100)
  const timeEntries: MigratedTask['timeEntries'] = hours
    ? [
        {
          companyId: raw.companyId,
          projectId,
          taskId: raw.id,
          userId: raw.ownerId,
          entryDate: format(parseISO(completedAt ?? updatedAt), 'yyyy-MM-dd'),
          hours,
          description: 'Hours logged before time entries (migrated)',
          isBillable: !!projectId,
          createdAt: updatedAt,
        },
      ]
    : []
  return { task, timeEntries }
}
