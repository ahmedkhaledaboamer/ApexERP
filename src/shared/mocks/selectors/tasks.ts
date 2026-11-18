import type { User } from '@/shared/types'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import { canSeeEvent, eventsEnabledIn } from '@/shared/mocks/selectors/events'
import { events } from '@/shared/mocks/data/events'
import type { CompanyDay } from '@/shared/lib/companyDay'
import type { Project, ProjectRow, SubtaskView, Task, TaskLinkType, TaskLinkView, TaskView, TimeEntryView } from '@/modules/tasks/types'
import { isClosedTaskStatus } from '@/modules/tasks/enums'
import { customers, leads, users } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'
import { projects, tasks, timeEntries } from '@/shared/mocks/data/tasks'
import { scoped, type Tenant } from '@/shared/mocks/tenant'
import { companyDayOf, companyTeamIds } from '@/shared/mocks/selectors/company'

/**
 * The single set of task selectors. The tasks API, the dashboard, reports, alerts (reminders)
 * and the departments module all read tasks through these, so their numbers always agree.
 * Every list is limited to the caller's company first (tenant isolation), then by role scope.
 *
 * Dates: "today" and "this week" are the company's (regional timezone + week start, at the mock
 * clock's time: companyDayOf), never the machine's.
 */

/** Today (yyyy-MM-dd) in the company's timezone, at the mock clock. */
export const todayIsoFor = (companyId: string) => companyDayOf(companyId).today

const nameOf = (id: string | null | undefined) => (id ? (users.find((u) => u.id === id)?.name ?? 'Unknown') : '—')
const round2 = (n: number) => Math.round(n * 100) / 100

/** Open = neither done nor cancelled. */
export function isOpen(t: Pick<Task, 'status'>): boolean {
  return !isClosedTaskStatus(t.status)
}

/** Open and due before today (the company's today unless one is given). */
export function isOverdue(t: Tenant<Task>, today: string = todayIsoFor(t.companyId)): boolean {
  return isOpen(t) && !!t.dueDate && t.dueDate < today
}

/** Team ids for the tasks scope (department-aware), within the user's company. */
export function taskTeamIds(user: User): string[] {
  return companyTeamIds(user)
}

/** The parent of a sub-task (same company), if any. */
export function parentOf(t: Tenant<Task>): Tenant<Task> | undefined {
  return t.parentTaskId ? tasks.find((p) => p.id === t.parentTaskId && p.companyId === t.companyId) : undefined
}

/** A task's sub-tasks (one level). */
export function subtasksOf(t: Pick<Tenant<Task>, 'id' | 'companyId'>): Tenant<Task>[] {
  return tasks.filter((s) => s.parentTaskId === t.id && s.companyId === t.companyId)
}

/** The visibility rule of the task itself (no parent). */
function seesOwn(user: User, t: Tenant<Task>): boolean {
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'full' || scope === 'view') return true
  if (t.ownerId === user.id || t.followerIds.includes(user.id) || t.createdBy === user.id) return true
  if (t.projectId && projects.some((p) => p.id === t.projectId && p.managerId === user.id)) return true
  if (scope === 'team') return taskTeamIds(user).includes(t.ownerId)
  return false
}

/**
 * Visibility (tasks column of the permission matrix): full = everything; view = everything,
 * read-only (as `inScope` defines it); team = tasks owned by the team; own = tasks I own. In
 * those scopes you also see tasks you follow or created, and the tasks of projects you manage.
 * A sub-task has the same scope as its parent: whoever sees the parent sees its sub-tasks.
 * hidden = nothing, not even tasks you own (the list answers 403, so a single task answers 404).
 */
export function canSeeTask(user: User, t: Tenant<Task>): boolean {
  if (t.companyId !== user.companyId) return false
  if (scopeOf(user.role, 'tasks') === 'hidden') return false
  if (seesOwn(user, t)) return true
  const parent = parentOf(t)
  return !!parent && seesOwn(user, parent)
}

function editsOwn(user: User, t: Tenant<Task>): boolean {
  if (t.ownerId === user.id || t.createdBy === user.id || t.followerIds.includes(user.id)) return true
  if (t.projectId && projects.some((p) => p.id === t.projectId && p.managerId === user.id)) return true
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'full') return true
  return scope === 'team' && taskTeamIds(user).includes(t.ownerId)
}

/**
 * May `user` change this task? Needs the tasks `edit` permission, then: owner, creator, followers,
 * the project manager, or team/full scope over the owner. A sub-task may also be changed by whoever
 * may change its parent. The API enforces it (403) and returns it as `TaskView.canEdit`.
 */
export function canEditTask(user: User, t: Tenant<Task>): boolean {
  if (t.companyId !== user.companyId) return false
  if (!can(user.role, 'tasks', 'edit')) return false
  if (editsOwn(user, t)) return true
  const parent = parentOf(t)
  return !!parent && editsOwn(user, parent)
}

export function tasksVisibleTo(user: User): Tenant<Task>[] {
  if (scopeOf(user.role, 'tasks') === 'hidden') return []
  return scoped(tasks, user).filter((t) => canSeeTask(user, t))
}

/** Tasks the user owns or follows (My tasks). */
export function myTasks(user: User, includeDone = false): Tenant<Task>[] {
  return scoped(tasks, user).filter((t) => (t.ownerId === user.id || t.followerIds.includes(user.id)) && (includeDone || isOpen(t)))
}

/** Overdue tasks the user can see (dashboard / reports / alerts). */
export function overdueTasks(user: User, day: CompanyDay = companyDayOf(user.companyId)): Tenant<Task>[] {
  return tasksVisibleTo(user).filter((t) => isOverdue(t, day.today))
}

/** My open tasks due from today to the end of the company's current week (its weekStartsOn). */
export function dueThisWeek(user: User, day: CompanyDay = companyDayOf(user.companyId)): Tenant<Task>[] {
  return myTasks(user).filter((t) => !!t.dueDate && t.dueDate >= day.today && t.dueDate <= day.weekEnd)
}

/** Tasks linked to a record (ids are globally unique, so this never crosses companies). */
export function tasksForLink(type: TaskLinkType, id: string): Tenant<Task>[] {
  return tasks.filter((t) => t.link?.type === type && t.link.id === id)
}

export function tasksForProject(projectId: string): Tenant<Task>[] {
  return tasks.filter((t) => t.projectId === projectId)
}

/** Open tasks owned by the given people (departments module; user ids are globally unique). */
export function openTasksOwnedBy(ownerIds: Set<string>): Tenant<Task>[] {
  return tasks.filter((t) => ownerIds.has(t.ownerId) && isOpen(t))
}

/* ---------------- Time entries ---------------- */

export function timeEntriesForTask(t: Pick<Tenant<Task>, 'id' | 'companyId'>): TimeEntryView[] {
  return timeEntries
    .filter((e) => e.taskId === t.id && e.companyId === t.companyId)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt))
    .map(({ companyId: _co, ...e }) => ({ ...e, userName: nameOf(e.userId) }))
}

/** Sum of the task's time entries. */
export function loggedHoursOf(t: Pick<Tenant<Task>, 'id' | 'companyId'>): number {
  return round2(timeEntries.reduce((s, e) => (e.taskId === t.id && e.companyId === t.companyId ? s + e.hours : s), 0))
}

/** projects.actual_hours: sum of the project's time entries. */
export function projectActualHours(p: Pick<Tenant<Project>, 'id' | 'companyId'>): number {
  return round2(timeEntries.reduce((s, e) => (e.projectId === p.id && e.companyId === p.companyId ? s + e.hours : s), 0))
}

/** Can the viewer open a record owned by `ownerId` under their Sales & CRM scope (leads, customers)? */
function salesCanOpen(viewer: User, ownerId: string): boolean {
  return inScope(scopeOf(viewer.role, 'sales'), viewer, ownerId, companyTeamIds(viewer))
}

/**
 * The task's link with a label. A target in another company is treated as missing. With a
 * `viewer`, `available` is also false when that viewer couldn't open the record (a lead or
 * customer outside their Sales & CRM scope): the chip shows, but isn't a link. The label stays:
 * whoever sees the task may see what it is about. The project is not a link (see projectName).
 */
export function linkView(t: Tenant<Task>, viewer?: User): TaskLinkView | null {
  if (!t.link) return null
  const { type, id } = t.link
  const co = t.companyId
  if (type === 'lead') {
    const l = leads.find((x) => x.id === id && x.companyId === co)
    return { type, id, label: l?.company ?? id, available: !!l && (!viewer || salesCanOpen(viewer, l.ownerId)) }
  }
  if (type === 'customer') {
    const c = customers.find((x) => x.id === id && x.companyId === co)
    return { type, id, label: c?.name ?? id, available: !!c && (!viewer || salesCanOpen(viewer, c.ownerId)) }
  }
  // Events: usable while the plan includes the module and the viewer can see the event.
  const ev = events.find((x) => x.id === id && x.companyId === co)
  return { type, id, label: ev?.name ?? `Event ${id}`, available: !!ev && eventsEnabledIn(co) && (!viewer || canSeeEvent(viewer, ev)) }
}

/** The label a reminder or report shows for what the task is about: its link, else its project. */
export function subjectOf(t: Tenant<Task>, viewer?: User): string | null {
  const l = linkView(t, viewer)
  if (l) return l.label
  return t.projectId ? (projects.find((p) => p.id === t.projectId && p.companyId === t.companyId)?.name ?? null) : null
}

function toSubtaskView(s: Tenant<Task>): SubtaskView {
  return { id: s.id, title: s.title, status: s.status, ownerId: s.ownerId, ownerName: nameOf(s.ownerId), dueDate: s.dueDate, blocked: !!s.blockedAt }
}

/** Done / total sub-tasks (cancelled ones don't count). */
export function subtaskProgress(t: Pick<Tenant<Task>, 'id' | 'companyId'>): { done: number; total: number } {
  const list = subtasksOf(t).filter((s) => s.status !== 'cancelled')
  return { done: list.filter((s) => s.status === 'done').length, total: list.length }
}

/** The task as `viewer` gets it: names, the link chip (scoped to the viewer), overdue, hours, sub-tasks, and whether they may edit it. */
export function toTaskView(t: Tenant<Task>, viewer: User): TaskView {
  // Client-facing records carry no companyId.
  const { companyId: _co, ...rest } = t
  const parent = parentOf(t)
  return {
    ...rest,
    ownerName: nameOf(t.ownerId),
    followerNames: t.followerIds.map(nameOf),
    linkView: linkView(t, viewer),
    projectName: t.projectId ? (projects.find((p) => p.id === t.projectId)?.name ?? null) : null,
    overdue: isOverdue(t),
    blocked: !!t.blockedAt,
    canEdit: canEditTask(viewer, t),
    loggedHours: loggedHoursOf(t),
    timeEntries: timeEntriesForTask(t),
    parentTitle: parent?.title ?? null,
    subtasks: subtasksOf(t)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(toSubtaskView),
    subtaskProgress: subtaskProgress(t),
  }
}

/* ---------------- Projects ---------------- */

/** Progress = done share of the project's tasks (cancelled ones left out), weighted by estimated hours when present. */
export function projectProgress(projectId: string): number {
  const list = tasksForProject(projectId).filter((t) => t.status !== 'cancelled')
  if (!list.length) return 0
  const totalH = list.reduce((s, t) => s + t.estimatedHours, 0)
  if (totalH > 0) return Math.round((list.filter((t) => t.status === 'done').reduce((s, t) => s + t.estimatedHours, 0) / totalH) * 100)
  return Math.round((list.filter((t) => t.status === 'done').length / list.length) * 100)
}

export function toProjectRow(p: Tenant<Project>): ProjectRow {
  const list = tasksForProject(p.id)
  const today = todayIsoFor(p.companyId)
  const { companyId: _co, ...rest } = p
  return {
    ...rest,
    customerName: customers.find((c) => c.id === p.customerId)?.name ?? p.customerId,
    serviceName: services.find((s) => s.id === p.serviceId)?.name ?? p.serviceId,
    managerName: nameOf(p.managerId),
    taskCount: list.length,
    doneCount: list.filter((t) => t.status === 'done').length,
    overdueCount: list.filter((t) => isOverdue(t, today)).length,
    progress: projectProgress(p.id),
    loggedHours: projectActualHours(p),
  }
}

/** Projects visible to the user: full scope, the manager, the manager's team, or anyone with a task in it. */
export function projectsVisibleTo(user: User): Tenant<Project>[] {
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'hidden') return []
  const mine = scoped(projects, user)
  // Same reading as canSeeTask: view sees every project of the company, read-only.
  if (scope === 'full' || scope === 'view') return mine
  const team = scope === 'team' ? new Set(taskTeamIds(user)) : new Set([user.id])
  return mine.filter((p) => team.has(p.managerId) || tasksForProject(p.id).some((t) => team.has(t.ownerId) || t.followerIds.includes(user.id)))
}
