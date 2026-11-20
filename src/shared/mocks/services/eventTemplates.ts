import type { User } from '@/shared/types'
import type { Task } from '@/modules/tasks/types'
import { TASK_PRIORITIES } from '@/modules/tasks/enums'
import type { ApplyTemplateResult, ChecklistItem, EventChecklist, EventDetail, EventInput, EventTemplate, EventTemplateInput, EventTemplateTask } from '@/modules/events/types'
import { EVENT_TYPES, TEMPLATE_TASK_ROLES } from '@/modules/events/types'
import { planChecklist } from '@/modules/events/lib/checklistPlan'
import { scopeOf } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { events, type EventRecord } from '@/shared/mocks/data/events'
import { eventTemplates, type EventTemplateRecord } from '@/shared/mocks/data/eventExtras'
import { nextTaskId, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { teamIdsOf } from '@/shared/mocks/selectors/events'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { findInTenant, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertModule } from '@/shared/mocks/services/billing'
import { createEvent, eventFor, localOf, log, toDetail } from '@/shared/mocks/services/events'

/**
 * Event templates + prep checklist (docs/API.md › Events › Templates & checklist).
 * Templates are company settings: everyone with the Events module may read them (to pick one);
 * only marketing `full` manages them. Applying a template to an event needs the event's *manage*
 * right (marketing full or the event owner). Generated tasks link to the event (related_type event)
 * and carry the template task id: re-applying never duplicates (idempotent per template task).
 */

const NOT_FOUND = 'That event template doesn’t exist.'
const MAX_TASKS = 60
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
let seq = 0
const nextId = (prefix: string) => `${prefix}-${nowMs().toString(36)}${(++seq).toString(36)}`

function toTemplate(t: Tenant<EventTemplateRecord>): EventTemplate {
  return { id: t.id, name: t.name, eventType: t.eventType, defaultDurationDays: t.defaultDurationDays, tasks: t.tasks.map((x) => ({ ...x })), createdAt: t.createdAt, updatedAt: t.updatedAt }
}

function requireManageTemplates(user: User): string {
  const co = tenantOf(user)
  assertModule(co, 'events')
  if (scopeOf(user.role, 'marketing') !== 'full') throw new ApiError('Only marketing managers and admins can manage event templates.', 403)
  return co
}

function templateFor(user: User, id: string): Tenant<EventTemplateRecord> {
  const t = findInTenant(eventTemplates, user, (x) => x.id === id)
  if (!t) throw new ApiError(NOT_FOUND, 404)
  return t
}

function cleanTemplate(input: Partial<EventTemplateInput> | null, existing?: EventTemplateRecord): Omit<EventTemplateRecord, 'createdBy' | 'createdAt' | 'updatedAt' | 'id'> | string {
  const v = input ?? {}
  const name = v.name === undefined && existing ? existing.name : str(v.name)
  if (name.length < 2 || name.length > 120) return 'Give the template a name (2–120 characters).'
  const eventType = (v.eventType ?? existing?.eventType) as EventTemplateRecord['eventType']
  if (!EVENT_TYPES.includes(eventType)) return `Event type must be one of: ${EVENT_TYPES.join(', ')}.`
  const days = v.defaultDurationDays === undefined ? (existing?.defaultDurationDays ?? 1) : Number(v.defaultDurationDays)
  if (!Number.isInteger(days) || days < 1 || days > 60) return 'Default duration is 1–60 days.'
  const rawTasks = v.tasks === undefined ? existing?.tasks : v.tasks
  if (!Array.isArray(rawTasks)) return 'Add the template’s tasks as a list.'
  if (rawTasks.length > MAX_TASKS) return `Keep a template under ${MAX_TASKS} tasks.`
  const ids = new Set<string>()
  const out: EventTemplateTask[] = []
  for (const [i, raw] of rawTasks.entries()) {
    const r = (raw ?? {}) as Partial<EventTemplateTask>
    const title = str(r.title)
    if (title.length < 2 || title.length > 255) return `Task ${i + 1}: give it a title (2–255 characters).`
    const offset = Number(r.offsetDays)
    if (!Number.isInteger(offset) || offset < -365 || offset > 365) return `Task ${i + 1}: days before / after must be a whole number from −365 to 365.`
    const role = (r.role ?? 'owner') as EventTemplateTask['role']
    if (!TEMPLATE_TASK_ROLES.includes(role)) return `Task ${i + 1}: pick a role or “event owner”.`
    const priority = (r.priority ?? 'medium') as EventTemplateTask['priority']
    if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) return `Task ${i + 1}: priority is low, medium, high or urgent.`
    // Existing task ids are kept (they make re-applying idempotent); unknown / new ones get a fresh id.
    const keep = typeof r.id === 'string' && existing?.tasks.some((x) => x.id === r.id) && !ids.has(r.id) ? r.id : null
    const id = keep ?? nextId('ETT')
    ids.add(id)
    out.push({ id, title, offsetDays: offset, role, priority })
  }
  return { name, eventType, defaultDurationDays: days, tasks: out }
}

/* ---------------- Templates ---------------- */

export async function listTemplates(user: User): Promise<EventTemplate[]> {
  assertModule(tenantOf(user), 'events')
  const co = tenantOf(user)
  return delay(eventTemplates.filter((t) => t.companyId === co).sort((a, b) => a.name.localeCompare(b.name)).map(toTemplate))
}

export async function getTemplate(user: User, id: string): Promise<EventTemplate> {
  assertModule(tenantOf(user), 'events')
  return delay(toTemplate(templateFor(user, id)))
}

export async function createTemplate(user: User, input: EventTemplateInput | null): Promise<EventTemplate> {
  const co = requireManageTemplates(user)
  const clean = cleanTemplate(input)
  if (typeof clean === 'string') return fail(clean, 422)
  if (eventTemplates.some((t) => t.companyId === co && t.name.toLowerCase() === clean.name.toLowerCase())) return fail(`A template named “${clean.name}” already exists.`, 409)
  const now = nowIso()
  const row = stamp<EventTemplateRecord>({ id: nextId('ETP'), ...clean, createdBy: user.id, createdAt: now, updatedAt: now }, user)
  eventTemplates.push(row)
  return delay(toTemplate(row))
}

export async function updateTemplate(user: User, id: string, input: Partial<EventTemplateInput> | null): Promise<EventTemplate> {
  const co = requireManageTemplates(user)
  const t = templateFor(user, id)
  const clean = cleanTemplate(input, t)
  if (typeof clean === 'string') return fail(clean, 422)
  if (eventTemplates.some((x) => x.companyId === co && x.id !== t.id && x.name.toLowerCase() === clean.name.toLowerCase())) return fail(`A template named “${clean.name}” already exists.`, 409)
  Object.assign(t, clean, { updatedAt: nowIso() })
  return delay(toTemplate(t))
}

/** Deleting a template keeps the tasks it generated (they are ordinary tasks of the event). */
export async function deleteTemplate(user: User, id: string): Promise<{ deleted: true }> {
  requireManageTemplates(user)
  const t = templateFor(user, id)
  eventTemplates.splice(eventTemplates.indexOf(t), 1)
  return delay({ deleted: true as const })
}

/* ---------------- Checklist ---------------- */

const isChecklistTask = (t: Tenant<Task>, e: Tenant<EventRecord>) =>
  t.companyId === e.companyId && t.link?.type === 'event' && t.link.id === e.id && !!t.templateTaskId && !t.parentTaskId

function templateOfTask(companyId: string, templateTaskId: string): Tenant<EventTemplateRecord> | undefined {
  return eventTemplates.find((t) => t.companyId === companyId && t.tasks.some((x) => x.id === templateTaskId))
}

export function checklistOf(e: Tenant<EventRecord>): EventChecklist {
  const rows = tasks.filter((t) => isChecklistTask(t, e) && templateOfTask(e.companyId, t.templateTaskId!))
  const items: ChecklistItem[] = rows
    .map((t) => {
      const tpl = templateOfTask(e.companyId, t.templateTaskId!)
      return {
        taskId: t.id,
        title: t.title,
        dueDate: t.dueDate,
        ownerId: t.ownerId,
        ownerName: ownerName(t.ownerId),
        status: t.status,
        priority: t.priority,
        templateTaskId: t.templateTaskId!,
        templateName: tpl?.name ?? '',
        offsetDays: t.dayOffset,
        done: t.status === 'done',
      }
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title))
  const counted = items.filter((i) => i.status !== 'cancelled')
  const applied = new Set(rows.map((t) => templateOfTask(e.companyId, t.templateTaskId!)?.id).filter((x): x is string => !!x))
  return { items, done: counted.filter((i) => i.done).length, total: counted.length, appliedTemplateIds: [...applied] }
}

export async function getChecklist(user: User, id: string): Promise<EventChecklist> {
  const e = await eventFor(user, id)
  return delay(checklistOf(e))
}

/**
 * Generates the template's tasks on the event (see modules/events/lib/checklistPlan.ts for dates and
 * owners). A template task that already has a task on this event is skipped (idempotent). Owners other
 * than the caller get an assignment notification.
 */
export function applyTemplateTo(e: Tenant<EventRecord>, t: Tenant<EventTemplateRecord>, actor: User): { created: number; skipped: number } {
  const co = companyById(e.companyId)
  const ownerId = e.ownerId ?? actor.id
  const team = teamIdsOf(e)
    .map((uid) => users.find((u) => u.id === uid && u.companyId === e.companyId))
    .filter((u): u is User => !!u && u.active !== false)
  const plan = planChecklist(t, { startDate: localOf(e).startDate, weekend: co?.regional.weekend ?? [0, 6], ownerId, team })
  const now = nowIso()
  let created = 0
  let skipped = 0
  for (const [i, p] of plan.entries()) {
    if (tasks.some((x) => x.companyId === e.companyId && x.link?.type === 'event' && x.link.id === e.id && x.templateTaskId === p.templateTaskId)) {
      skipped++
      continue
    }
    const id = nextTaskId()
    tasks.push({
      companyId: e.companyId,
      id,
      title: p.title,
      description: `Prep checklist · from the “${t.name}” event template${p.fallback ? ' (no one with the role on the team: assigned to the event owner)' : ''}`,
      ownerId: p.ownerId,
      followerIds: p.ownerId === ownerId ? [] : [ownerId],
      priority: p.priority,
      dueDate: p.dueDate,
      status: 'todo',
      link: { type: 'event', id: e.id },
      projectId: null,
      parentTaskId: null,
      estimatedHours: 0,
      templateTaskId: p.templateTaskId,
      dayOffset: p.offsetDays,
      sortOrder: i + 1,
      blockedAt: null,
      blockedReason: null,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      attachments: [],
      comments: [],
      history: [{ id: `${id}-h0`, kind: 'created', userId: actor.id, at: now, summary: `Created from the “${t.name}” event template` }],
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    })
    created++
    if (p.ownerId !== actor.id) {
      pushNotification({ companyId: e.companyId, userId: p.ownerId, type: 'assignment', title: `${actor.name} assigned you a task`, body: `${p.title} · ${e.name}`, link: `/tasks/my?task=${encodeURIComponent(id)}` })
    }
  }
  if (created) log(e, actor, `Applied the “${t.name}” template (${created} task${created === 1 ? '' : 's'}${skipped ? `, ${skipped} already there` : ''})`)
  return { created, skipped }
}

/** POST /events/:id/apply-template { template_id } — event owner or marketing full. */
export async function applyTemplate(user: User, id: string, input: { templateId?: unknown } | null): Promise<ApplyTemplateResult> {
  const e = await eventFor(user, id, 'manage')
  if (e.status === 'cancelled') return fail('This event is cancelled; reopen it to plan it.', 409)
  const templateId = str(input?.templateId)
  if (!templateId) return fail('Pick a template.', 422)
  const t = findInTenant(eventTemplates, user, (x) => x.id === templateId)
  if (!t) return fail(NOT_FOUND, 422)
  const r = applyTemplateTo(e, t, user)
  return delay({ ...r, checklist: checklistOf(e) })
}

/**
 * POST /events with an optional `template_id`: the template is checked first (another company's id
 * answers like a missing one: 422), then the event is created and the template applied.
 */
export async function createEventWithTemplate(user: User, input: EventInput | null): Promise<EventDetail> {
  const templateId = str((input as { templateId?: unknown } | null)?.templateId)
  const t = templateId ? findInTenant(eventTemplates, user, (x) => x.id === templateId) : undefined
  if (templateId) {
    assertModule(tenantOf(user), 'events')
    if (!t) return fail(NOT_FOUND, 422)
  }
  const created = await createEvent(user, input as EventInput)
  if (!t) return created
  const e = findInTenant(events, user, (x) => x.id === created.id)!
  applyTemplateTo(e, t, user)
  return delay(toDetail(e, user))
}

/** Tests: the template of a company by id. */
export function templateRecord(id: string): Tenant<EventTemplateRecord> | undefined {
  return eventTemplates.find((t) => t.id === id)
}
