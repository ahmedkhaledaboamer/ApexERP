import type { User } from '@/shared/types'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import { EVENTS_ENABLED } from '@/shared/lib/features'
import type { CompanyDay } from '@/shared/lib/companyDay'
import type { Project, ProjectRow, Task, TaskLinkType, TaskLinkView, TaskView } from '@/modules/tasks/types'
import { customers, leads, users } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'
import { projects, tasks } from '@/shared/mocks/data/tasks'
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

export function isOpen(t: Task): boolean {
  return t.status !== 'Done'
}

/** Open and due before today (the company's today unless one is given). */
export function isOverdue(t: Tenant<Task>, today: string = todayIsoFor(t.companyId)): boolean {
  return isOpen(t) && !!t.dueDate && t.dueDate < today
}

/** Team ids for the tasks scope (department-aware), within the user's company. */
export function taskTeamIds(user: User): string[] {
  return companyTeamIds(user)
}

/**
 * Visibility (tasks column of the permission matrix): full = everything; view = everything,
 * read-only (as `inScope` defines it); team = tasks owned by the team; own = tasks I own. In
 * those scopes you also see tasks you follow or created, and the tasks of projects you manage.
 * hidden = nothing, not even tasks you own (the list answers 403, so a single task answers 404).
 */
export function canSeeTask(user: User, t: Tenant<Task>): boolean {
  if (t.companyId !== user.companyId) return false
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'hidden') return false
  if (scope === 'full' || scope === 'view') return true
  if (t.ownerId === user.id || t.followerIds.includes(user.id) || t.createdBy === user.id) return true
  if (t.projectId && projects.some((p) => p.id === t.projectId && p.managerId === user.id)) return true
  if (scope === 'team') return taskTeamIds(user).includes(t.ownerId)
  return false
}

/**
 * May `user` change this task? Needs the tasks `edit` permission, then: owner, creator, followers,
 * the project manager, or team/full scope over the owner. The API enforces it (403) and returns it
 * as `TaskView.canEdit` so every screen applies the same rule.
 */
export function canEditTask(user: User, t: Tenant<Task>): boolean {
  if (t.companyId !== user.companyId) return false
  if (!can(user.role, 'tasks', 'edit')) return false
  if (t.ownerId === user.id || t.createdBy === user.id || t.followerIds.includes(user.id)) return true
  if (t.projectId && projects.some((p) => p.id === t.projectId && p.managerId === user.id)) return true
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'full') return true
  return scope === 'team' && taskTeamIds(user).includes(t.ownerId)
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

/** Can the viewer open a record owned by `ownerId` under their Sales & CRM scope (leads, customers)? */
function salesCanOpen(viewer: User, ownerId: string): boolean {
  return inScope(scopeOf(viewer.role, 'sales'), viewer, ownerId, companyTeamIds(viewer))
}

/**
 * The task's link with a label. A target in another company is treated as missing. With a
 * `viewer`, `available` is also false when that viewer couldn't open the record (a lead or
 * customer outside their Sales & CRM scope, a project outside their projects scope): the chip
 * shows, but isn't a link. The label stays: whoever sees the task may see what it is about.
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
  if (type === 'project') {
    const p = projects.find((x) => x.id === id && x.companyId === co)
    return { type, id, label: p?.name ?? id, available: !!p && (!viewer || projectsVisibleTo(viewer).some((x) => x.id === p.id)) }
  }
  // Events: links are stored but stay inactive until the Events module exists.
  return { type, id, label: `Event ${id}`, available: EVENTS_ENABLED }
}

/** The task as `viewer` gets it: names, the link chip (scoped to the viewer), overdue, and whether they may edit it. */
export function toTaskView(t: Tenant<Task>, viewer: User): TaskView {
  // Client-facing records carry no companyId.
  const { companyId: _co, ...rest } = t
  return {
    ...rest,
    ownerName: nameOf(t.ownerId),
    followerNames: t.followerIds.map(nameOf),
    linkView: linkView(t, viewer),
    projectName: t.projectId ? (projects.find((p) => p.id === t.projectId)?.name ?? null) : null,
    overdue: isOverdue(t),
    canEdit: canEditTask(viewer, t),
  }
}

/* ---------------- Projects ---------------- */

/** Progress = done share of the project's tasks, weighted by estimated hours when present. */
export function projectProgress(projectId: string): number {
  const list = tasksForProject(projectId)
  if (!list.length) return 0
  const totalH = list.reduce((s, t) => s + t.estimatedHours, 0)
  if (totalH > 0) return Math.round((list.filter((t) => t.status === 'Done').reduce((s, t) => s + t.estimatedHours, 0) / totalH) * 100)
  return Math.round((list.filter((t) => t.status === 'Done').length / list.length) * 100)
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
    doneCount: list.filter((t) => t.status === 'Done').length,
    overdueCount: list.filter((t) => isOverdue(t, today)).length,
    progress: projectProgress(p.id),
    loggedHours: list.reduce((s, t) => s + t.loggedHours, 0),
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
