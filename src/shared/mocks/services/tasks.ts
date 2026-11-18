import type { User } from '@/shared/types'
import { can, scopeOf } from '@/shared/lib/permissions'
import { eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { events } from '@/shared/mocks/data/events'
import type {
  Task,
  TaskAttachment,
  TaskComment,
  TaskEvent,
  TaskEventKind,
  TaskFilter,
  TaskInput,
  TaskLink,
  TaskPriority,
  TaskStatus,
  TaskUpdateInput,
  TaskView,
  TimeEntry,
  TimeEntryInput,
} from '@/modules/tasks/types'
import { TASK_PRIORITIES, TASK_PRIORITY_RANK, TASK_STATUSES, TASK_STATUS_LABEL, TASK_PRIORITY_LABEL, isClosedTaskStatus } from '@/modules/tasks/enums'
import {
  blockedReasonSchema,
  firstIssue,
  taskAttachmentSchema,
  taskCommentSchema,
  taskInputSchema,
  taskUpdateSchema,
  timeEntrySchema,
} from '@/modules/tasks/schemas'
import { customers, leads, users } from '@/shared/mocks/db'
import { nextTaskId, nextTimeEntryId, projects, pushNotification, tasks, timeEntries } from '@/shared/mocks/data/tasks'
import { canEditTask, canSeeTask, parentOf, subtasksOf, taskTeamIds, tasksVisibleTo, toTaskView } from '@/shared/mocks/selectors/tasks'
import { findInTenant, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { runTaskReminders } from '@/shared/mocks/services/taskReminders'
import { delay, fail } from '@/shared/mocks/server'
import { registerValue } from '@/shared/mocks/persist/registry'

/**
 * Task Management mock API. Visibility comes from the shared selectors (canSeeTask / tasksVisibleTo)
 * so the dashboard, reports and alerts count the same tasks. Everything is limited to the caller's
 * company: owners, followers, mentions and link targets of another company count as unknown, and
 * another company's task answers 404 exactly like a missing one.
 *
 * Database alignment (docs/DB-ALIGNMENT.md): statuses todo | in_progress | review | done |
 * cancelled; "blocked" is a flag (blockedAt + blockedReason) set by POST /tasks/:id/block and
 * cleared by POST /tasks/:id/unblock; sub-tasks via parentTaskId (one level); hours are time
 * entries (POST /tasks/:id/time-entries); attachments carry sizeBytes + mimeType.
 */

const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown'
const taskLink = (id: string) => `/tasks/my?task=${encodeURIComponent(id)}`
const statusLabel = (s: TaskStatus) => TASK_STATUS_LABEL[s]
let eseq = 1
let cseq = 1
let aseq = 1
registerValue('tasks.eventSeq', () => eseq, (v) => { eseq = v })
registerValue('tasks.commentSeq', () => cseq, (v) => { cseq = v })
registerValue('tasks.attachmentSeq', () => aseq, (v) => { aseq = v })

/* ---------------- Rules ---------------- */

/**
 * May `user` assign a task to `ownerId`? Own: themselves; Team: their team (direct reports, the
 * departments they head and those departments' sub-departments: taskTeamIds); Full: anyone.
 * GET /tasks/assignable lists exactly the people this accepts.
 */
function canAssignTo(user: User, ownerId: string): boolean {
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'full') return true
  if (scope === 'team') return taskTeamIds(user).includes(ownerId)
  return ownerId === user.id
}

// The edit rule lives with the selectors (it is also returned as TaskView.canEdit).
export { canEditTask }

/** Who the caller may pick as a task owner (GET /tasks/assignable). */
export interface AssignableUser {
  id: string
  name: string
  title: string
  role: User['role']
  departmentId: string
}

/**
 * GET /tasks/assignable: the active users of the caller's company that createTask / updateTask
 * accept as the owner (canAssignTo), caller first. A role that can't create or edit tasks gets
 * only themselves (or nobody when Tasks is hidden: 403).
 */
export async function getAssignableUsers(user: User): Promise<AssignableUser[]> {
  if (scopeOf(user.role, 'tasks') === 'hidden') return fail('Tasks aren’t part of your role.', 403)
  const co = tenantOf(user)
  const writer = can(user.role, 'tasks', 'create') || can(user.role, 'tasks', 'edit')
  const rows = users
    .filter((u) => u.companyId === co && u.active !== false && (writer ? canAssignTo(user, u.id) : u.id === user.id))
    .sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name)))
    .map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.role, departmentId: u.departmentId }))
  return delay(rows)
}

/**
 * Deterministic failure hook for browser tests: `window.__apexMoveFailureRate` (shared with the
 * leads pipeline) = 1 makes every task status / due-date change fail with a 503, so the board's and
 * calendar's rollback can be tested. Unset (the default, also in the demo) = never fail. Read only
 * in dev and tests: a production build drops the hook entirely (docs/DB-ALIGNMENT.md).
 */
function taskMoveFailureRate(): number {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return 0
  const override = (globalThis as { __apexMoveFailureRate?: unknown }).__apexMoveFailureRate
  return typeof override === 'number' ? override : 0
}

/**
 * Does the link target exist in the user's company? Events: only while the plan includes the Events
 * module (otherwise the link is refused like a missing record).
 */
function linkExists(user: User, link: TaskLink): boolean {
  if (link.type === 'lead') return !!findInTenant(leads, user, (l) => l.id === link.id)
  if (link.type === 'customer') return !!findInTenant(customers, user, (c) => c.id === link.id)
  if (link.type === 'event') return eventsEnabledIn(tenantOf(user)) && !!findInTenant(events, user, (e) => e.id === link.id)
  return false
}

function projectExists(user: User, id: string): boolean {
  return !!findInTenant(projects, user, (p) => p.id === id)
}

/** An active user of the caller's company (another company's user counts as unknown). */
function activeUser(user: User, id: string): User | undefined {
  const co = tenantOf(user)
  return users.find((u) => u.id === id && u.companyId === co && u.active !== false)
}

async function visibleTask(user: User, id: string): Promise<Tenant<Task>> {
  const t = findInTenant(tasks, user, (x) => x.id === id)
  if (!t || !canSeeTask(user, t)) return fail('Task not found, or it isn’t visible to you.', 404)
  return t
}

async function editableTask(user: User, id: string): Promise<Tenant<Task>> {
  const t = await visibleTask(user, id)
  if (!canEditTask(user, t)) {
    if (!can(user.role, 'tasks', 'edit')) return fail(`Your role (${user.role}) can view tasks but not change them.`, 403)
    return fail('You can view this task but not change it: only its owner, followers, creator, the project manager or their managers can.', 403)
  }
  return t
}

function event(t: Task, user: User, kind: TaskEventKind, summary: string, at: string): TaskEvent {
  const e: TaskEvent = { id: `${t.id}-e${eseq++}`, kind, userId: user.id, at, summary }
  t.history.push(e)
  return e
}

function postComment(t: Task, user: User, body: string, at: string): TaskComment {
  const c: TaskComment = { id: `${t.id}-c${cseq++}`, authorId: user.id, body, mentions: [], at }
  t.comments.push(c)
  return c
}

/** Clears the blocked flag (unblock, or the task was closed), with a history line. */
function clearBlocked(t: Task, user: User, at: string, why: string): void {
  if (!t.blockedAt) return
  t.blockedAt = null
  t.blockedReason = null
  event(t, user, 'blocked', why, at)
}

/**
 * Turns `@Full Name` (or a unique `@First` name) in a comment into user ids. With `companyId`,
 * only people of that company can be mentioned.
 */
export function parseMentions(body: string, companyId?: string): string[] {
  const out = new Set<string>()
  const lower = body.toLowerCase()
  const active = users.filter((u) => u.active !== false && (!companyId || u.companyId === companyId))
  // Longest names first so "@Omar Siddiqui" isn't read as "@Omar".
  const byLength = [...active].sort((a, b) => b.name.length - a.name.length)
  const taken: [number, number][] = []
  for (const u of byLength) {
    const needle = `@${u.name.toLowerCase()}`
    let from = 0
    for (;;) {
      const at = lower.indexOf(needle, from)
      if (at < 0) break
      from = at + needle.length
      if (taken.some(([s, e]) => at >= s && at < e)) continue
      taken.push([at, from])
      out.add(u.id)
    }
  }
  // "@First" only when exactly one active user has that first name.
  for (const m of body.matchAll(/@([A-Za-zÀ-ɏ'-]+)/g)) {
    const at = m.index ?? 0
    if (taken.some(([s, e]) => at >= s && at < e)) continue
    const first = m[1].toLowerCase()
    const hits = active.filter((u) => u.name.split(' ')[0].toLowerCase() === first)
    if (hits.length === 1) out.add(hits[0].id)
  }
  return [...out]
}

/* ---------------- Queries ---------------- */

/** Due date ascending (no date last), then priority (urgent first), then newest first. */
export function compareTasks(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  const p = TASK_PRIORITY_RANK[a.priority] - TASK_PRIORITY_RANK[b.priority]
  if (p) return p
  return b.createdAt.localeCompare(a.createdAt)
}

export function filterTasks(user: User, filter: TaskFilter = {}): Tenant<Task>[] {
  return tasksVisibleTo(user).filter((t) => {
    if (filter.mine && t.ownerId !== user.id && !t.followerIds.includes(user.id)) return false
    if (filter.ownerId && t.ownerId !== filter.ownerId) return false
    if (filter.projectId && t.projectId !== filter.projectId) return false
    if (filter.linkType && t.link?.type !== filter.linkType) return false
    if (filter.linkId && t.link?.id !== filter.linkId) return false
    if (filter.status && t.status !== filter.status) return false
    if (filter.priority && t.priority !== filter.priority) return false
    if (filter.blocked !== undefined && !!t.blockedAt !== filter.blocked) return false
    if (filter.dueFrom && (!t.dueDate || t.dueDate < filter.dueFrom)) return false
    if (filter.dueTo && (!t.dueDate || t.dueDate > filter.dueTo)) return false
    // A status filter of done / cancelled asks for those tasks explicitly.
    if (!filter.includeDone && filter.status !== t.status && isClosedTaskStatus(t.status)) return false
    return true
  })
}

export async function getTasks(user: User, filter: TaskFilter = {}): Promise<TaskView[]> {
  if (scopeOf(user.role, 'tasks') === 'hidden') return fail('Tasks aren’t part of your role.', 403)
  runTaskReminders(tenantOf(user))
  return delay(filterTasks(user, filter).sort(compareTasks).map((t) => toTaskView(t, user)))
}

export async function getTask(user: User, id: string): Promise<TaskView> {
  const t = await visibleTask(user, id)
  runTaskReminders(t.companyId)
  return delay(toTaskView(t, user))
}

/* ---------------- Create ---------------- */

export async function createTask(user: User, input: TaskInput): Promise<TaskView> {
  if (!can(user.role, 'tasks', 'create')) return fail('Your role can’t create tasks.', 403)
  // The tenant comes from the session, never from the body.
  const { companyId: _ignored, ...clean } = input as TaskInput & { companyId?: unknown }
  const parsed = taskInputSchema.safeParse(clean)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  const v = parsed.data

  // Sub-task: the parent must be a task the caller can change, and itself not a sub-task.
  let parent: Tenant<Task> | null = null
  if (v.parentTaskId) {
    parent = (await editableTask(user, v.parentTaskId)) ?? null
    if (parent.parentTaskId) return fail('A sub-task can’t have sub-tasks: add it to the parent task instead.', 422)
    if (isClosedTaskStatus(parent.status)) return fail(`“${parent.title}” is ${statusLabel(parent.status).toLowerCase()}: reopen it to add sub-tasks.`, 422)
    if (v.projectId !== undefined && v.projectId !== parent.projectId) return fail('A sub-task belongs to its parent’s project.', 422)
  }

  const ownerId = v.ownerId ?? user.id
  if (!activeUser(user, ownerId)) return fail('Pick an active user as the owner.', 422)
  if (!canAssignTo(user, ownerId)) {
    return fail(scopeOf(user.role, 'tasks') === 'own' ? 'You can only assign tasks to yourself.' : 'You can only assign tasks within your team.', 403)
  }
  const followerIds = [...new Set(v.followerIds ?? [])].filter((id) => id !== ownerId)
  if (followerIds.some((id) => !activeUser(user, id))) return fail('Followers must be active users.', 422)
  const link = v.link ?? null
  if (link && !linkExists(user, link)) return fail(`That ${link.type} doesn’t exist.`, 422)
  const projectId = parent ? parent.projectId : (v.projectId ?? null)
  if (projectId && !projectExists(user, projectId)) return fail('That project doesn’t exist.', 422)
  const status = v.status ?? 'todo'

  const now = new Date().toISOString()
  const t: Tenant<Task> = stamp<Task>({
    id: nextTaskId(),
    title: v.title,
    description: v.description?.trim() ?? '',
    ownerId,
    followerIds,
    priority: v.priority ?? 'medium',
    dueDate: v.dueDate ?? null,
    status,
    link,
    projectId,
    parentTaskId: parent?.id ?? null,
    estimatedHours: v.estimatedHours ?? 0,
    templateTaskId: null,
    dayOffset: null,
    sortOrder: parent ? subtasksOf(parent).reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1 : 0,
    blockedAt: null,
    blockedReason: null,
    reminderSentAt: null,
    overdueNotifiedAt: null,
    attachments: [],
    comments: [],
    history: [],
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : null,
  }, user)
  event(t, user, 'created', parent ? `Created as a sub-task of “${parent.title}”` : 'Created the task', now)
  tasks.push(t)
  if (parent) {
    event(parent, user, 'subtask', `Added sub-task “${t.title}”`, now)
    parent.updatedAt = now
  }

  if (ownerId !== user.id) {
    pushNotification({ userId: ownerId, type: 'assignment', title: `${user.name} assigned you a task`, body: t.title, link: taskLink(t.id) })
  }
  return delay(toTaskView(t, user))
}

/* ---------------- Update ---------------- */

const show = (v: string | null | undefined) => (v ? v : 'none')
const fmtDue = (d: string | null) => d ?? 'no date'
const linkLabel = (l: TaskLink | null) => (l ? `${l.type} ${l.id}` : 'none')

/**
 * Status rules:
 *   - done sets completedAt, any other status clears it (reopen);
 *   - done or cancelled clears the blocked flag;
 *   - a parent moves to done only when its sub-tasks are done or cancelled (409, unless `force`);
 *   - cancelling a parent cancels its open sub-tasks.
 * A due-date change re-arms the reminder and the overdue notice (reminderSentAt / overdueNotifiedAt).
 */
export async function updateTask(user: User, id: string, input: TaskUpdateInput): Promise<TaskView> {
  const t = await editableTask(user, id)
  const { companyId: _ignored, ...clean } = input as TaskUpdateInput & { companyId?: unknown }
  const parsed = taskUpdateSchema.safeParse(clean)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  const v = parsed.data
  const now = new Date().toISOString()
  const notifyOwner: string[] = []

  // Validate everything before changing anything.
  if (v.ownerId !== undefined && v.ownerId !== t.ownerId) {
    if (!activeUser(user, v.ownerId)) return fail('Pick an active user as the owner.', 422)
    if (!canAssignTo(user, v.ownerId)) {
      return fail(scopeOf(user.role, 'tasks') === 'own' ? 'You can only assign tasks to yourself.' : 'You can only assign tasks within your team.', 403)
    }
  }
  if (v.followerIds?.some((fid) => !activeUser(user, fid) && !t.followerIds.includes(fid))) return fail('Followers must be active users.', 422)
  if (v.link && !linkExists(user, v.link)) return fail(`That ${v.link.type} doesn’t exist.`, 422)
  if (v.projectId !== undefined && v.projectId !== t.projectId) {
    if (t.parentTaskId) return fail('A sub-task belongs to its parent’s project: change the parent’s project instead.', 422)
    if (v.projectId && !projectExists(user, v.projectId)) return fail('That project doesn’t exist.', 422)
  }
  const kids = subtasksOf(t)
  if (v.status === 'done' && t.status !== 'done' && !v.force) {
    const open = kids.filter((s) => !isClosedTaskStatus(s.status)).length
    if (open) return fail(`${open} sub-task${open === 1 ? ' is' : 's are'} still open. Finish or cancel ${open === 1 ? 'it' : 'them'} first, or complete anyway.`, 409)
  }
  if (v.status !== undefined && v.status !== t.status && !isClosedTaskStatus(v.status) && t.parentTaskId) {
    const parent = parentOf(t)
    if (parent && isClosedTaskStatus(parent.status)) return fail(`“${parent.title}” is ${statusLabel(parent.status).toLowerCase()}: reopen it first.`, 422)
  }
  if ((v.status !== undefined && v.status !== t.status) || (v.dueDate !== undefined && v.dueDate !== t.dueDate)) {
    if (Math.random() < taskMoveFailureRate()) return fail(`The server didn’t save the change to “${t.title}”. It’s back where it was.`, 503)
  }

  if (v.title !== undefined && v.title !== t.title) {
    event(t, user, 'edited', `Title: “${t.title}” → “${v.title}”`, now)
    t.title = v.title
  }
  if (v.description !== undefined && v.description.trim() !== t.description) {
    event(t, user, 'edited', 'Updated the description', now)
    t.description = v.description.trim()
  }
  if (v.status !== undefined && v.status !== t.status) {
    event(t, user, 'status', `Status: ${statusLabel(t.status)} → ${statusLabel(v.status)}`, now)
    t.status = v.status
    t.completedAt = v.status === 'done' ? now : null
    if (isClosedTaskStatus(v.status)) clearBlocked(t, user, now, `Unblocked (${statusLabel(v.status).toLowerCase()})`)
    if (v.status === 'cancelled') {
      for (const s of kids.filter((k) => !isClosedTaskStatus(k.status))) {
        event(s, user, 'status', `Status: ${statusLabel(s.status)} → Cancelled (parent cancelled)`, now)
        s.status = 'cancelled'
        s.completedAt = null
        clearBlocked(s, user, now, 'Unblocked (cancelled)')
        s.updatedAt = now
      }
    }
    const parent = parentOf(t)
    if (parent) {
      event(parent, user, 'subtask', `Sub-task “${t.title}”: ${statusLabel(v.status)}`, now)
      parent.updatedAt = now
    }
  }
  if (v.priority !== undefined && v.priority !== t.priority) {
    event(t, user, 'priority', `Priority: ${TASK_PRIORITY_LABEL[t.priority]} → ${TASK_PRIORITY_LABEL[v.priority]}`, now)
    t.priority = v.priority
  }
  if (v.dueDate !== undefined && v.dueDate !== t.dueDate) {
    event(t, user, 'due', `Due: ${fmtDue(t.dueDate)} → ${fmtDue(v.dueDate)}`, now)
    t.dueDate = v.dueDate
    // A new due date re-arms the once-only reminder and overdue notice.
    t.reminderSentAt = null
    t.overdueNotifiedAt = null
  }
  if (v.ownerId !== undefined && v.ownerId !== t.ownerId) {
    event(t, user, 'owner', `Owner: ${nameOf(t.ownerId)} → ${nameOf(v.ownerId)}`, now)
    t.ownerId = v.ownerId
    t.followerIds = t.followerIds.filter((f) => f !== v.ownerId)
    if (v.ownerId !== user.id) notifyOwner.push(v.ownerId)
  }
  if (v.followerIds !== undefined) {
    const next = [...new Set(v.followerIds)].filter((f) => f !== t.ownerId)
    const added = next.filter((f) => !t.followerIds.includes(f))
    const removed = t.followerIds.filter((f) => !next.includes(f))
    if (added.length || removed.length) {
      const parts = [
        added.length ? `added ${added.map(nameOf).join(', ')}` : '',
        removed.length ? `removed ${removed.map(nameOf).join(', ')}` : '',
      ].filter(Boolean)
      event(t, user, 'follower', `Followers: ${parts.join('; ')}`, now)
      t.followerIds = next
    }
  }
  if (v.link !== undefined && linkLabel(v.link) !== linkLabel(t.link)) {
    event(t, user, 'link', `Link: ${linkLabel(t.link)} → ${linkLabel(v.link)}`, now)
    t.link = v.link
  }
  if (v.projectId !== undefined && v.projectId !== t.projectId) {
    event(t, user, 'link', `Project: ${show(t.projectId)} → ${show(v.projectId)}`, now)
    t.projectId = v.projectId
    // Sub-tasks follow their parent's project.
    for (const s of kids) {
      s.projectId = v.projectId
      s.updatedAt = now
    }
  }
  if (v.estimatedHours !== undefined && v.estimatedHours !== t.estimatedHours) {
    event(t, user, 'hours', `Estimate: ${t.estimatedHours} h → ${v.estimatedHours} h`, now)
    t.estimatedHours = v.estimatedHours
  }
  t.updatedAt = now

  for (const uid of notifyOwner) {
    pushNotification({ userId: uid, type: 'assignment', title: `${user.name} assigned you a task`, body: t.title, link: taskLink(t.id) })
  }
  return delay(toTaskView(t, user))
}

/* ---------------- Blocked flag ---------------- */

/**
 * POST /tasks/:id/block { reason }: sets blockedAt + blockedReason (3–280 characters, required:
 * 422 otherwise) and posts the reason as a comment ("Blocked: …"). The status stays what it was.
 * Only open tasks can be blocked (422); an already blocked task answers 409.
 */
export async function blockTask(user: User, id: string, body: { reason?: unknown }): Promise<TaskView> {
  const t = await editableTask(user, id)
  const raw = body?.reason
  const r = blockedReasonSchema.safeParse(raw)
  if (!r.success) return fail(raw === undefined || raw === null || raw === '' ? 'Say why the task is blocked (reason).' : firstIssue(r.error), 422)
  if (isClosedTaskStatus(t.status)) return fail(`“${t.title}” is ${statusLabel(t.status).toLowerCase()}: only open tasks can be blocked.`, 422)
  if (t.blockedAt) return fail(`“${t.title}” is already blocked: ${t.blockedReason ?? ''}`.trim(), 409)
  const now = new Date().toISOString()
  t.blockedAt = now
  t.blockedReason = r.data
  postComment(t, user, `Blocked: ${r.data}`, now)
  event(t, user, 'blocked', `Blocked (${r.data})`, now)
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

/** POST /tasks/:id/unblock: clears both fields and posts "Unblocked" (comment + history). Not blocked → 409. */
export async function unblockTask(user: User, id: string): Promise<TaskView> {
  const t = await editableTask(user, id)
  if (!t.blockedAt) return fail(`“${t.title}” isn’t blocked.`, 409)
  const now = new Date().toISOString()
  postComment(t, user, 'Unblocked', now)
  clearBlocked(t, user, now, 'Unblocked')
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

/* ---------------- Comments ---------------- */

/** Any user who can see the task may comment. Mentions notify the mentioned people (not the author). */
export async function addComment(user: User, id: string, input: { body: string; mentions?: string[] }): Promise<TaskView> {
  const t = await visibleTask(user, id)
  const parsed = taskCommentSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  const body = parsed.data.body
  const explicit = (parsed.data.mentions ?? []).filter((uid) => activeUser(user, uid))
  const mentions = [...new Set([...parseMentions(body, tenantOf(user)), ...explicit])]
  const now = new Date().toISOString()
  const comment: TaskComment = { id: `${t.id}-c${cseq++}`, authorId: user.id, body, mentions, at: now }
  t.comments.push(comment)
  event(t, user, 'comment', mentions.length ? `Commented and mentioned ${mentions.map(nameOf).join(', ')}` : 'Commented', now)
  t.updatedAt = now
  for (const uid of mentions) {
    if (uid === user.id) continue
    pushNotification({
      userId: uid,
      type: 'mention',
      title: `${user.name} mentioned you`,
      body: `${t.title}: ${body.length > 120 ? `${body.slice(0, 117)}…` : body}`,
      link: taskLink(t.id),
    })
  }
  return delay(toTaskView(t, user))
}

/* ---------------- Attachments (mocked upload: metadata only) ---------------- */

/** POST /tasks/:id/attachments { name, sizeBytes, mimeType }: counted against the plan's storageMb. */
export async function addAttachment(user: User, id: string, file: { name: string; sizeBytes: number; mimeType?: string }): Promise<TaskView> {
  const t = await editableTask(user, id)
  const parsed = taskAttachmentSchema.safeParse(file)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  // Plan limit: storage (MB) used by uploaded files.
  assertCapacity(t.companyId, 'storageMb', parsed.data.sizeBytes / (1024 * 1024))
  const now = new Date().toISOString()
  const a: TaskAttachment = {
    id: `${t.id}-a${aseq++}`,
    name: parsed.data.name,
    sizeBytes: parsed.data.sizeBytes,
    mimeType: parsed.data.mimeType || 'application/octet-stream',
    uploadedBy: user.id,
    uploadedAt: now,
  }
  t.attachments.push(a)
  noteUsage(t.companyId)
  event(t, user, 'attachment', `Attached ${a.name}`, now)
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

export async function removeAttachment(user: User, id: string, attachmentId: string): Promise<TaskView> {
  const t = await editableTask(user, id)
  const a = t.attachments.find((x) => x.id === attachmentId)
  if (!a) return fail('That attachment was already removed.', 404)
  const now = new Date().toISOString()
  t.attachments = t.attachments.filter((x) => x.id !== attachmentId)
  event(t, user, 'attachment', `Removed ${a.name}`, now)
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

/* ---------------- Time entries ---------------- */

/**
 * POST /tasks/:id/time-entries { entryDate, hours, description?, isBillable? }: logs the caller's
 * hours on the task (and its project). Anyone who may change the task may log time on it.
 * isBillable defaults to true for project tasks and false otherwise.
 */
export async function addTimeEntry(user: User, id: string, input: TimeEntryInput): Promise<TaskView> {
  const t = await editableTask(user, id)
  const parsed = timeEntrySchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  const v = parsed.data
  const now = new Date().toISOString()
  const entry: Tenant<TimeEntry> = {
    companyId: t.companyId,
    id: nextTimeEntryId(),
    projectId: t.projectId,
    taskId: t.id,
    userId: user.id,
    entryDate: v.entryDate,
    hours: v.hours,
    description: v.description?.trim() || null,
    isBillable: v.isBillable ?? !!t.projectId,
    createdAt: now,
  }
  timeEntries.push(entry)
  event(t, user, 'hours', `Logged ${v.hours} h on ${v.entryDate}${entry.isBillable ? ' (billable)' : ''}`, now)
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

/**
 * DELETE /tasks/:id/time-entries/:entryId: the person who logged it, or a full-scope user, may
 * remove an entry (others 403).
 */
export async function removeTimeEntry(user: User, id: string, entryId: string): Promise<TaskView> {
  const t = await editableTask(user, id)
  const i = timeEntries.findIndex((e) => e.id === entryId && e.taskId === t.id && e.companyId === t.companyId)
  if (i < 0) return fail('That time entry doesn’t exist.', 404)
  const e = timeEntries[i]
  if (e.userId !== user.id && scopeOf(user.role, 'tasks') !== 'full') return fail('Only the person who logged these hours can remove them.', 403)
  timeEntries.splice(i, 1)
  const now = new Date().toISOString()
  event(t, user, 'hours', `Removed ${e.hours} h logged on ${e.entryDate}`, now)
  t.updatedAt = now
  return delay(toTaskView(t, user))
}

/** Query-string → TaskFilter (handler helper). */
export function parseTaskFilter(params: URLSearchParams): TaskFilter {
  const str = (k: string) => params.get(k) || undefined
  const bool = (k: string) => params.get(k) === 'true' || undefined
  const priority = str('priority')
  const status = str('status')
  const blocked = params.get('blocked')
  return {
    mine: bool('mine'),
    ownerId: str('ownerId'),
    projectId: str('projectId'),
    linkType: str('linkType') as TaskFilter['linkType'],
    linkId: str('linkId'),
    status: status && (TASK_STATUSES as readonly string[]).includes(status) ? (status as TaskStatus) : undefined,
    priority: priority && (TASK_PRIORITIES as readonly string[]).includes(priority) ? (priority as TaskPriority) : undefined,
    dueFrom: str('dueFrom'),
    dueTo: str('dueTo'),
    includeDone: bool('includeDone'),
    blocked: blocked === 'true' ? true : blocked === 'false' ? false : undefined,
  }
}
