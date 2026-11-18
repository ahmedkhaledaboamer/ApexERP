import type { User } from '@/shared/types'
import { can, scopeOf } from '@/shared/lib/permissions'
import { EVENTS_ENABLED } from '@/shared/lib/features'
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
  TaskUpdateInput,
  TaskView,
} from '@/modules/tasks/types'
import { TASK_PRIORITIES } from '@/modules/tasks/types'
import {
  blockedReasonSchema,
  firstIssue,
  taskAttachmentSchema,
  taskCommentSchema,
  taskInputSchema,
  taskUpdateSchema,
} from '@/modules/tasks/schemas'
import { customers, leads, users } from '@/shared/mocks/db'
import { nextTaskId, projects, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { canEditTask, canSeeTask, taskTeamIds, tasksVisibleTo, toTaskView } from '@/shared/mocks/selectors/tasks'
import { findInTenant, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { delay, fail } from '@/shared/mocks/server'
import { registerValue } from '@/shared/mocks/persist/registry'

/**
 * Task Management mock API. Visibility comes from the shared selectors (canSeeTask / tasksVisibleTo)
 * so the dashboard, reports and alerts count the same tasks. Everything is limited to the caller's
 * company: owners, followers, mentions and link targets of another company count as unknown, and
 * another company's task answers 404 exactly like a missing one.
 */

const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown'
const taskLink = (id: string) => `/tasks/my?task=${encodeURIComponent(id)}`
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
 * calendar's rollback can be tested. Unset (the default, also in the demo) = never fail.
 */
function taskMoveFailureRate(): number {
  const override = (globalThis as { __apexMoveFailureRate?: unknown }).__apexMoveFailureRate
  return typeof override === 'number' ? override : 0
}

/** Validates the Blocked reason when a task becomes Blocked (null = fine). */
function blockedReasonFor(next: TaskInput['status'], prev: TaskInput['status'] | null, raw: unknown): { reason: string | null; error: string | null } {
  if (next !== 'Blocked' || prev === 'Blocked') return { reason: null, error: null }
  const r = blockedReasonSchema.safeParse(raw)
  if (!r.success) return { reason: null, error: raw === undefined || raw === null || raw === '' ? 'Say why the task is blocked (blockedReason).' : firstIssue(r.error) }
  return { reason: r.data, error: null }
}

/** Does the link target exist in the user's company? Events are accepted (stored) but inactive until the module exists. */
function linkExists(user: User, link: TaskLink): boolean {
  if (link.type === 'lead') return !!findInTenant(leads, user, (l) => l.id === link.id)
  if (link.type === 'customer') return !!findInTenant(customers, user, (c) => c.id === link.id)
  if (link.type === 'project') return projectExists(user, link.id)
  return true
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

const PRIORITY_RANK: Record<TaskPriority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 }

/** Due date ascending (no date last), then priority (Urgent first), then newest first. */
export function compareTasks(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
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
    if (filter.dueFrom && (!t.dueDate || t.dueDate < filter.dueFrom)) return false
    if (filter.dueTo && (!t.dueDate || t.dueDate > filter.dueTo)) return false
    // A status filter of Done asks for done tasks explicitly.
    if (!filter.includeDone && filter.status !== 'Done' && t.status === 'Done') return false
    return true
  })
}

export async function getTasks(user: User, filter: TaskFilter = {}): Promise<TaskView[]> {
  if (scopeOf(user.role, 'tasks') === 'hidden') return fail('Tasks aren’t part of your role.', 403)
  return delay(filterTasks(user, filter).sort(compareTasks).map((t) => toTaskView(t, user)))
}

export async function getTask(user: User, id: string): Promise<TaskView> {
  return delay(toTaskView(await visibleTask(user, id), user))
}

/* ---------------- Create ---------------- */

export async function createTask(user: User, input: TaskInput): Promise<TaskView> {
  if (!can(user.role, 'tasks', 'create')) return fail('Your role can’t create tasks.', 403)
  // The tenant comes from the session, never from the body.
  const { companyId: _ignored, ...clean } = input as TaskInput & { companyId?: unknown }
  const parsed = taskInputSchema.safeParse(clean)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  const v = parsed.data

  const ownerId = v.ownerId ?? user.id
  if (!activeUser(user, ownerId)) return fail('Pick an active user as the owner.', 422)
  if (!canAssignTo(user, ownerId)) {
    return fail(scopeOf(user.role, 'tasks') === 'own' ? 'You can only assign tasks to yourself.' : 'You can only assign tasks within your team.', 403)
  }
  const followerIds = [...new Set(v.followerIds ?? [])].filter((id) => id !== ownerId)
  if (followerIds.some((id) => !activeUser(user, id))) return fail('Followers must be active users.', 422)
  const link = v.link ?? null
  if (link && !linkExists(user, link)) return fail(`That ${link.type} doesn’t exist.`, 422)
  const projectId = v.projectId ?? (link?.type === 'project' ? link.id : null)
  if (projectId && !projectExists(user, projectId)) return fail('That project doesn’t exist.', 422)
  const status = v.status ?? 'To do'
  const blocked = blockedReasonFor(status, null, v.blockedReason)
  if (blocked.error) return fail(blocked.error, 422)

  const now = new Date().toISOString()
  const t: Tenant<Task> = stamp<Task>({
    id: nextTaskId(),
    title: v.title,
    description: v.description?.trim() ?? '',
    ownerId,
    followerIds,
    priority: v.priority ?? 'Medium',
    dueDate: v.dueDate ?? null,
    status,
    link,
    projectId,
    estimatedHours: v.estimatedHours ?? 0,
    loggedHours: 0,
    templateTaskId: null,
    dayOffset: null,
    attachments: [],
    comments: [],
    history: [],
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'Done' ? now : null,
  }, user)
  event(t, user, 'created', 'Created the task', now)
  if (link?.type === 'event' && !EVENTS_ENABLED) event(t, user, 'link', 'Linked to an event (inactive until Events is enabled)', now)
  if (blocked.reason) postBlockedReason(t, user, blocked.reason, now)
  tasks.push(t)

  if (ownerId !== user.id) {
    pushNotification({ userId: ownerId, type: 'assignment', title: `${user.name} assigned you a task`, body: t.title, link: taskLink(t.id) })
  }
  return delay(toTaskView(t, user))
}

/** The Blocked reason becomes a comment, so followers see what the task waits on. */
function postBlockedReason(t: Task, user: User, reason: string, at: string): void {
  t.comments.push({ id: `${t.id}-c${cseq++}`, authorId: user.id, body: `Blocked: ${reason}`, mentions: [], at })
}

/* ---------------- Update ---------------- */

const show = (v: string | null | undefined) => (v ? v : 'none')
const fmtDue = (d: string | null) => d ?? 'no date'
const linkLabel = (l: TaskLink | null) => (l ? `${l.type} ${l.id}` : 'none')

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
  if (v.projectId && !projectExists(user, v.projectId)) return fail('That project doesn’t exist.', 422)
  const blocked = v.status !== undefined ? blockedReasonFor(v.status, t.status, v.blockedReason) : { reason: null, error: null }
  if (blocked.error) return fail(blocked.error, 422)
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
    event(t, user, 'status', `Status: ${t.status} → ${v.status}${blocked.reason ? ` (${blocked.reason})` : ''}`, now)
    t.status = v.status
    t.completedAt = v.status === 'Done' ? now : null
    if (blocked.reason) postBlockedReason(t, user, blocked.reason, now)
  }
  if (v.priority !== undefined && v.priority !== t.priority) {
    event(t, user, 'priority', `Priority: ${t.priority} → ${v.priority}`, now)
    t.priority = v.priority
  }
  if (v.dueDate !== undefined && v.dueDate !== t.dueDate) {
    event(t, user, 'due', `Due: ${fmtDue(t.dueDate)} → ${fmtDue(v.dueDate)}`, now)
    t.dueDate = v.dueDate
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
    if (v.link?.type === 'project' && v.projectId === undefined) t.projectId = v.link.id
  }
  if (v.projectId !== undefined && v.projectId !== t.projectId) {
    event(t, user, 'link', `Project: ${show(t.projectId)} → ${show(v.projectId)}`, now)
    t.projectId = v.projectId
  }
  if (v.estimatedHours !== undefined && v.estimatedHours !== t.estimatedHours) {
    event(t, user, 'hours', `Estimate: ${t.estimatedHours} h → ${v.estimatedHours} h`, now)
    t.estimatedHours = v.estimatedHours
  }
  if (v.loggedHours !== undefined && v.loggedHours !== t.loggedHours) {
    event(t, user, 'hours', `Logged: ${t.loggedHours} h → ${v.loggedHours} h`, now)
    t.loggedHours = v.loggedHours
  }
  t.updatedAt = now

  for (const uid of notifyOwner) {
    pushNotification({ userId: uid, type: 'assignment', title: `${user.name} assigned you a task`, body: t.title, link: taskLink(t.id) })
  }
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

export async function addAttachment(user: User, id: string, file: { name: string; size: number; type: string }): Promise<TaskView> {
  const t = await editableTask(user, id)
  const parsed = taskAttachmentSchema.safeParse(file)
  if (!parsed.success) return fail(firstIssue(parsed.error), 422)
  // Plan limit: storage (MB) used by uploaded files.
  assertCapacity(t.companyId, 'storageMb', parsed.data.size / (1024 * 1024))
  const now = new Date().toISOString()
  const a: TaskAttachment = {
    id: `${t.id}-a${aseq++}`,
    name: parsed.data.name,
    size: parsed.data.size,
    type: parsed.data.type || 'application/octet-stream',
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

/** Query-string → TaskFilter (handler helper). */
export function parseTaskFilter(params: URLSearchParams): TaskFilter {
  const str = (k: string) => params.get(k) || undefined
  const bool = (k: string) => params.get(k) === 'true' || undefined
  const priority = str('priority')
  return {
    mine: bool('mine'),
    ownerId: str('ownerId'),
    projectId: str('projectId'),
    linkType: str('linkType') as TaskFilter['linkType'],
    linkId: str('linkId'),
    status: str('status') as TaskFilter['status'],
    priority: priority && (TASK_PRIORITIES as string[]).includes(priority) ? (priority as TaskPriority) : undefined,
    dueFrom: str('dueFrom'),
    dueTo: str('dueTo'),
    includeDone: bool('includeDone'),
  }
}
