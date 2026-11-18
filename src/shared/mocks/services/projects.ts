import { isValid, parseISO } from 'date-fns'
import type { User } from '@/shared/types'
import type { AuditChange, AuditEntry } from '@/modules/settings/types'
import type { Project, ProjectInput, ProjectRow, ProjectStatus, ProjectUpdateInput, Task, TaskView } from '@/modules/tasks/types'
import { PROJECT_STATUSES } from '@/modules/tasks/types'
import { planProject } from '@/modules/won/plan'
import { can, scopeOf } from '@/shared/lib/permissions'
import { customers, leads, users } from '@/shared/mocks/db'
import { projectTemplateFor, services } from '@/shared/mocks/data/services'
import { deliveryDepartmentId } from '@/shared/mocks/data/departments'
import { nextProjectId, nextTaskId, projects, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { auditLog, recordAudit } from '@/shared/mocks/data/audit'
import { projectsVisibleTo, taskTeamIds, tasksForProject, toProjectRow, toTaskView } from '@/shared/mocks/selectors/tasks'
import { companyUsers, companyWeekend, userInCompany } from '@/shared/mocks/selectors/company'
import { findInTenant, scoped, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { delay, fail } from '@/shared/mocks/server'

/**
 * Delivery projects (Task Management › Projects). Scope follows the tasks column of the
 * permission matrix through `projectsVisibleTo`; figures (progress, hours, overdue) come from the
 * shared selectors so the list, the dashboard and the reports always agree. Projects, customers,
 * services and managers are all looked up inside the caller's company; another company's project
 * answers 404 like a missing one.
 */

/** Extra fields on GET /projects/:id (a superset of `ProjectRow & { tasks }`). */
export interface ProjectDetailResponse extends ProjectRow {
  tasks: TaskView[]
  /** Audit entries for this project, newest first. */
  audit: AuditEntry[]
  /** Caller may change status, manager, dates (project manager, team head of the manager, full scope). */
  canManage: boolean
}

/** POST /projects body: ProjectInput + whether to generate tasks from the service template (default true). */
export type ProjectCreateBody = ProjectInput & { generateTasks?: boolean }
/** PATCH /projects/:id body: `force` completes a project with open tasks. */
export type ProjectUpdateBody = ProjectUpdateInput & { force?: boolean }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s) && isValid(parseISO(s))
const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id

function noAccess(user: User): boolean {
  return scopeOf(user.role, 'tasks') === 'hidden'
}

/**
 * Can the user change this project? Needs the tasks `edit` right (a view-scope role is read-only,
 * even as the manager), then: full scope, its manager, or team scope whose team includes the manager.
 */
export function canManageProject(user: User, p: Project): boolean {
  if (!can(user.role, 'tasks', 'edit')) return false
  const scope = scopeOf(user.role, 'tasks')
  if (scope === 'full') return true
  if (p.managerId === user.id) return true
  return scope === 'team' && taskTeamIds(user).includes(p.managerId)
}

/** Only full and team scope create projects (Own-scope roles work inside them). */
export function canCreateProject(user: User): boolean {
  const scope = scopeOf(user.role, 'tasks')
  return scope === 'full' || scope === 'team'
}

async function visibleProject(user: User, id: string): Promise<Tenant<Project>> {
  if (noAccess(user)) return fail('Your role has no access to projects.', 403)
  const p = findInTenant(projects, user, (x) => x.id === id)
  if (!p) return fail('That project doesn’t exist.', 404)
  if (!projectsVisibleTo(user).some((x) => x.id === id)) return fail('This project is outside your access.', 403)
  return p
}

/* ---------------- Reads ---------------- */

export async function listProjects(user: User): Promise<ProjectRow[]> {
  if (noAccess(user)) return fail('Your role has no access to projects.', 403)
  const rows = projectsVisibleTo(user)
    .map(toProjectRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(rows)
}

export async function getProject(user: User, id: string): Promise<ProjectDetailResponse> {
  const p = await visibleProject(user, id)
  const list = tasksForProject(p.id)
    .map((t) => toTaskView(t, user))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id))
  return delay({
    ...toProjectRow(p),
    tasks: list,
    audit: scoped(auditLog, user)
      .filter((e) => e.entity === 'project' && e.entityId === p.id)
      .map(({ companyId: _co, ...e }) => e),
    canManage: canManageProject(user, p),
  })
}

/* ---------------- Validation ---------------- */

function checkName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give the project a name.'
  if (name.trim().length > 160) return 'Keep the name under 160 characters.'
  return null
}

/** The manager must be an active user of the caller's company. */
function checkManager(user: User, id: unknown): string | null {
  const u = typeof id === 'string' ? userInCompany(tenantOf(user), id) : undefined
  return !u || u.active === false ? 'Pick an active project manager.' : null
}

function checkHours(h: unknown): string | null {
  return h !== undefined && (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h > 100_000) ? 'Estimated hours must be a number from 0.' : null
}

/* ---------------- Create ---------------- */

export async function createProject(user: User, body: ProjectCreateBody): Promise<ProjectRow> {
  if (noAccess(user) || !canCreateProject(user)) return fail('Your role can work on projects but not create them.', 403)
  // The tenant comes from the session, never from the body.
  const { companyId: _ignored, ...input } = body as ProjectCreateBody & { companyId?: unknown }
  const co = tenantOf(user)
  const problems: string[] = []
  const nameErr = checkName(input.name)
  if (nameErr) problems.push(nameErr)
  const customer = findInTenant(customers, user, (c) => c.id === input.customerId)
  if (!customer) problems.push('Pick an existing customer.')
  const service = findInTenant(services, user, (s) => s.id === input.serviceId)
  if (!service) problems.push('Pick an existing service.')
  else if (!service.active) problems.push(`“${service.name}” is inactive and can’t start new projects.`)
  const mgrErr = checkManager(user, input.managerId)
  if (mgrErr) problems.push(mgrErr)
  if (input.leadId && !findInTenant(leads, user, (l) => l.id === input.leadId)) problems.push('That lead doesn’t exist.')
  if (!validDate(input.startDate)) problems.push('Pick a start date.')
  if (!validDate(input.endDate)) problems.push('Pick an end date.')
  if (validDate(input.startDate) && validDate(input.endDate) && input.endDate < input.startDate) problems.push('The end date can’t be before the start date.')
  if (!PROJECT_STATUSES.includes(input.status)) problems.push('Pick a valid status.')
  const hoursErr = checkHours(input.estimatedHours)
  if (hoursErr) problems.push(hoursErr)
  if (problems.length) return fail(problems.join(' '), 422)

  const now = new Date().toISOString()
  const generate = input.generateTasks !== false
  const plan = generate
    ? planProject(service!, projectTemplateFor(service!.id), {
        users: companyUsers(co),
        projectManagerId: input.managerId,
        startDate: input.startDate,
        deliveryDepartmentId: deliveryDepartmentId(co),
        weekend: companyWeekend(co),
      })
    : null
  const id = nextProjectId()
  const project: Tenant<Project> = {
    companyId: co,
    id,
    name: input.name.trim(),
    customerId: customer!.id,
    serviceId: service!.id,
    leadId: input.leadId ?? null,
    quotationId: null,
    managerId: input.managerId,
    startDate: input.startDate,
    endDate: input.endDate,
    status: input.status,
    // An explicit estimate wins; otherwise the template's total.
    estimatedHours: input.estimatedHours && input.estimatedHours > 0 ? input.estimatedHours : (plan?.estimatedHours ?? 0),
    createdAt: now,
    createdBy: user.id,
    createdFrom: 'manual',
  }
  projects.push(project)

  const created: Tenant<Task>[] = []
  for (const p of plan?.tasks ?? []) {
    const taskId = nextTaskId()
    const t: Tenant<Task> = {
      companyId: co,
      id: taskId,
      title: p.title,
      description: `${p.role} · from the ${service!.name} template`,
      ownerId: p.ownerId,
      followerIds: p.ownerId === input.managerId ? [] : [input.managerId],
      priority: p.priority,
      dueDate: p.dueDate,
      status: 'To do',
      link: { type: 'project', id },
      projectId: id,
      estimatedHours: p.hours,
      loggedHours: 0,
      templateTaskId: p.templateTaskId,
      dayOffset: p.dayOffset,
      attachments: [],
      comments: [],
      history: [{ id: `${taskId}-h0`, kind: 'created', userId: user.id, at: now, summary: `Created from the ${service!.name} template` }],
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }
    tasks.push(t)
    created.push(t)
  }

  const link = `/projects/${id}`
  if (input.managerId !== user.id) {
    pushNotification({ userId: input.managerId, type: 'assignment', title: 'You manage a new project', body: project.name, link })
  }
  const perOwner = new Map<string, number>()
  for (const t of created) perOwner.set(t.ownerId, (perOwner.get(t.ownerId) ?? 0) + 1)
  for (const [ownerId, n] of perOwner) {
    if (ownerId === input.managerId || ownerId === user.id) continue
    pushNotification({ userId: ownerId, type: 'assignment', title: `${n} new task${n === 1 ? '' : 's'} on ${project.name}`, body: 'Delivery tasks from the project template', link })
  }

  recordAudit(user, {
    action: 'create',
    entity: 'project',
    entityId: id,
    summary: `Created project “${project.name}” for ${customer!.name}${created.length ? ` with ${created.length} template task${created.length === 1 ? '' : 's'}` : ''}`,
  })
  return delay(toProjectRow(project))
}

/* ---------------- Update ---------------- */

export async function updateProject(user: User, id: string, input: ProjectUpdateBody): Promise<ProjectRow> {
  const p = await visibleProject(user, id)
  if (!canManageProject(user, p)) return fail('Only the project manager or their managers can change this project.', 403)

  const problems: string[] = []
  if (input.name !== undefined) {
    const e = checkName(input.name)
    if (e) problems.push(e)
  }
  if (input.managerId !== undefined) {
    const e = checkManager(user, input.managerId)
    if (e) problems.push(e)
  }
  if (input.startDate !== undefined && !validDate(input.startDate)) problems.push('Pick a valid start date.')
  if (input.endDate !== undefined && !validDate(input.endDate)) problems.push('Pick a valid end date.')
  if (input.status !== undefined && !PROJECT_STATUSES.includes(input.status)) problems.push('Pick a valid status.')
  const hoursErr = checkHours(input.estimatedHours)
  if (hoursErr) problems.push(hoursErr)
  const start = input.startDate ?? p.startDate
  const end = input.endDate ?? p.endDate
  if (!problems.length && end < start) problems.push('The end date can’t be before the start date.')
  if (problems.length) return fail(problems.join(' '), 422)

  if (input.status === 'Completed' && p.status !== 'Completed') {
    const open = tasksForProject(p.id).filter((t) => t.status !== 'Done').length
    if (open && !input.force) {
      return fail(`${open} task${open === 1 ? ' is' : 's are'} still open. Finish ${open === 1 ? 'it' : 'them'} first, or complete the project anyway.`, 409)
    }
  }

  const changes: AuditChange[] = []
  const set = <K extends keyof Project>(key: K, value: Project[K] | undefined, show: (v: Project[K]) => string = String) => {
    if (value === undefined || value === p[key]) return
    changes.push({ field: key, from: show(p[key]), to: show(value) })
    ;(p as Project)[key] = value
  }
  set('name', input.name?.trim())
  set('status', input.status as ProjectStatus | undefined)
  set('managerId', input.managerId, userName)
  set('startDate', input.startDate)
  set('endDate', input.endDate)
  set('estimatedHours', input.estimatedHours)

  if (changes.length) {
    const forced = input.force && input.status === 'Completed' && tasksForProject(p.id).some((t) => t.status !== 'Done')
    recordAudit(user, {
      action: 'update',
      entity: 'project',
      entityId: p.id,
      summary: `Updated project “${p.name}”: ${changes.map((c) => c.field).join(', ')}${forced ? ' (completed with open tasks)' : ''}`,
      changes,
    })
    if (input.managerId && input.managerId !== user.id && changes.some((c) => c.field === 'managerId')) {
      pushNotification({ userId: input.managerId, type: 'assignment', title: 'You now manage a project', body: p.name, link: `/projects/${p.id}` })
    }
  }
  return delay(toProjectRow(p))
}
