import { addDays, format, parseISO } from 'date-fns'
import type { User } from '@/shared/types'
import type { DeliveryRole, ProjectTemplate, Service } from '@/modules/services/types'
import { templateTotals } from '@/modules/services/types'
import type { TaskPriority } from '@/modules/tasks/types'

/**
 * Pure planning helpers for the Won flow (and the seed data): no stores, no I/O, so they are
 * shared by the mock API, the preview and the unit tests.
 */

/**
 * Default department responsible for delivery (Apex Aora); template roles resolve to people here
 * as a fallback. Each company has its own: callers pass `deliveryDepartmentId` in the context.
 */
export const DELIVERY_DEPARTMENT_ID = 'd-delivery'

/** Default weekend (days of week, 0 = Sunday): Saturday–Sunday. Pass the company's `regional.weekend`. */
export const DEFAULT_WEEKEND: readonly number[] = [0, 6]

const ISO = 'yyyy-MM-dd'

/** A working day is any day outside the company's weekend (default Saturday–Sunday). */
export function isWorkingDay(d: Date, weekend: readonly number[] = DEFAULT_WEEKEND): boolean {
  // Guard against a misconfigured all-weekend week (would loop forever below).
  if (weekend.length >= 7) return true
  return !weekend.includes(d.getDay())
}

/** The given day if it's a working day, otherwise the next one. */
export function nextWorkingDay(d: Date, weekend: readonly number[] = DEFAULT_WEEKEND): Date {
  let cur = d
  while (!isWorkingDay(cur, weekend)) cur = addDays(cur, 1)
  return cur
}

/** `start` plus `n` working days (n = 0 → start itself, moved to a working day). */
export function addWorkingDays(start: Date, n: number, weekend: readonly number[] = DEFAULT_WEEKEND): Date {
  let cur = nextWorkingDay(start, weekend)
  let left = Math.max(0, Math.floor(n))
  while (left > 0) {
    cur = addDays(cur, 1)
    if (isWorkingDay(cur, weekend)) left--
  }
  return cur
}

export function isoDate(d: Date): string {
  return format(d, ISO)
}

/** Keywords that identify each delivery role in a job title. */
const ROLE_KEYWORDS: Record<DeliveryRole, string[]> = {
  'Project manager': ['project manager', 'head of delivery', 'delivery manager', 'head of operations'],
  'Solutions consultant': ['solutions consultant', 'consultant', 'operations coordinator', 'coordinator'],
  Developer: ['developer', 'software engineer'],
  'AI engineer': ['ai engineer', 'machine learning', 'ml engineer'],
  'Data analyst': ['data analyst', 'analyst', 'bi '],
  Designer: ['designer', 'ux', 'ui '],
  QA: ['qa', 'quality', 'tester'],
  Trainer: ['trainer', 'training'],
}

/** Planning context: the company's people, delivery department and weekend. */
export interface PlanContext {
  users: User[]
  projectManagerId: string
  load?: Map<string, number>
  /** The company's delivery department (default DELIVERY_DEPARTMENT_ID). */
  deliveryDepartmentId?: string
  /** The company's weekend days (default DEFAULT_WEEKEND). */
  weekend?: readonly number[]
}

/**
 * Resolves a template role to a person: an active member (by job title) of the project
 * manager's department first, then of the delivery department; otherwise the project manager.
 * Only people of the project manager's company are considered.
 * Among several matches, picks the one with the fewest tasks assigned so far (`load`).
 */
export function resolveRoleOwner(role: DeliveryRole, ctx: PlanContext): { ownerId: string; fallback: boolean } {
  const pm = ctx.users.find((u) => u.id === ctx.projectManagerId)
  const people = pm ? ctx.users.filter((u) => u.companyId === pm.companyId) : ctx.users
  const words = ROLE_KEYWORDS[role] ?? []
  const matches = (u: User) => {
    const title = ` ${u.title.toLowerCase()} `
    return words.some((w) => title.includes(w))
  }
  const pick = (deptId: string | undefined) => {
    if (!deptId) return null
    const found = people.filter((u) => u.active !== false && u.departmentId === deptId && matches(u))
    if (!found.length) return null
    const load = ctx.load ?? new Map<string, number>()
    return [...found].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0]
  }
  const person = pick(pm?.departmentId) ?? pick(ctx.deliveryDepartmentId ?? DELIVERY_DEPARTMENT_ID)
  if (person) return { ownerId: person.id, fallback: false }
  return { ownerId: ctx.projectManagerId, fallback: true }
}

export interface PlannedTask {
  templateTaskId: string
  title: string
  role: DeliveryRole
  ownerId: string
  fallbackOwner: boolean
  dayOffset: number
  dueDate: string
  hours: number
  priority: TaskPriority
}

export interface PlannedProject {
  serviceId: string
  serviceName: string
  hasTemplate: boolean
  startDate: string
  endDate: string
  estimatedHours: number
  tasks: PlannedTask[]
}

/**
 * Plans one project for a purchased service from its template.
 * Each task is due on start + offset + its length in working days (8 h/day), so a task starts at
 * its offset and is due when its estimated effort is done. End date = latest due date (or the
 * service's delivery time / start date when there's no template).
 */
export function planProject(
  service: Pick<Service, 'id' | 'name' | 'deliveryDays'>,
  template: ProjectTemplate,
  ctx: PlanContext & { startDate: string },
): PlannedProject {
  const weekend = ctx.weekend ?? DEFAULT_WEEKEND
  const start = nextWorkingDay(parseISO(ctx.startDate), weekend)
  const load = ctx.load ?? new Map<string, number>()
  const tasks: PlannedTask[] = template.tasks.map((t, i) => {
    const { ownerId, fallback } = resolveRoleOwner(t.role, { ...ctx, load })
    load.set(ownerId, (load.get(ownerId) ?? 0) + 1)
    const lengthDays = Math.max(1, Math.ceil(t.hours / 8))
    const due = addWorkingDays(start, t.dayOffset + lengthDays - 1, weekend)
    const isLast = i === template.tasks.length - 1
    return {
      templateTaskId: t.id,
      title: t.title,
      role: t.role,
      ownerId,
      fallbackOwner: fallback,
      dayOffset: t.dayOffset,
      dueDate: isoDate(due),
      hours: t.hours,
      priority: i === 0 || isLast ? 'High' : 'Medium',
    }
  })
  const totals = templateTotals(template.tasks)
  const endDate = tasks.length
    ? tasks.reduce((m, t) => (t.dueDate > m ? t.dueDate : m), tasks[0].dueDate)
    : isoDate(addWorkingDays(start, Math.max(0, service.deliveryDays), weekend))
  return {
    serviceId: service.id,
    serviceName: service.name,
    hasTemplate: template.tasks.length > 0,
    startDate: isoDate(start),
    endDate,
    estimatedHours: totals.hours,
    tasks,
  }
}
