import { addDays, format, isBefore, parseISO, startOfDay, subDays } from 'date-fns'
import type { Project, ProjectStatus, StoredNotification, Task, TaskComment, TaskPriority, TaskStatus, TimeEntry } from '@/modules/tasks/types'
import { customers, leads, leadTaskSeed } from '@/shared/mocks/db'
import { projectTemplateFor, services } from '@/shared/mocks/data/services'
import { deliveryDepartmentId } from '@/shared/mocks/data/departments'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { companyOfUser, companyUsers, companyWeekend } from '@/shared/mocks/selectors/company'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'
import { planProject } from '@/modules/won/plan'
import { migrateLegacyTask, type LegacyTask } from './taskMigration'

/**
 * Unified task + project store (mock). Lead follow-up tasks, delivery project tasks and personal
 * to-dos all live in `tasks`; `projects` holds delivery projects (created by the Won flow);
 * `timeEntries` the hours logged on tasks (time_entries). Selectors over these are in
 * src/shared/mocks/selectors/tasks.ts.
 *
 * Every row carries `companyId`. Seed rows take the company of their owner (user ids are globally
 * unique); ids come from one global sequence per entity so they never collide across tenants.
 *
 * The seed is written partly in the old shape (statuses like "Blocked", hours as a number on the
 * task, project links) and goes through migrateLegacyTask, exactly like stored data would.
 */

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const today = startOfDay(new Date())
let seq = 1000
export const nextTaskId = () => `TK-${++seq}`
let pseq = 100
export const nextProjectId = () => `PRJ-${++pseq}`
let teseq = 1
export const nextTimeEntryId = () => `TE-${teseq++}`

type SeedTask = Omit<LegacyTask, 'companyId' | 'id' | 'createdAt' | 'status' | 'priority'> & {
  title: string
  ownerId: string
  status?: string
  priority?: string
  createdAt?: string
}

function baseTask(partial: SeedTask): LegacyTask {
  const createdAt = partial.createdAt ?? subDays(new Date(), 10).toISOString()
  return {
    companyId: companyOfUser(partial.ownerId) ?? APEX_ID,
    id: nextTaskId(),
    description: '',
    followerIds: [],
    dueDate: null,
    link: null,
    projectId: null,
    estimatedHours: 0,
    loggedHours: 0,
    templateTaskId: null,
    dayOffset: null,
    attachments: [],
    comments: [],
    history: [],
    createdBy: partial.ownerId,
    updatedAt: createdAt,
    completedAt: null,
    ...partial,
    status: partial.status ?? 'todo',
    priority: partial.priority ?? 'medium',
    createdAt,
  }
}

function withCreatedEvent(t: LegacyTask): LegacyTask {
  t.history = [{ id: `${t.id}-h0`, kind: 'created', userId: t.createdBy ?? t.ownerId, at: t.createdAt, summary: 'Created the task' }, ...(t.history ?? [])]
  return t
}

/** A seed row that used the old Blocked status: the reason was recorded as a "Blocked: …" comment. */
function legacyBlocked(t: LegacyTask, reason: string): LegacyTask {
  const at = subDays(new Date(), 2).toISOString()
  const comment: TaskComment = { id: `${t.id}-c0`, authorId: t.ownerId, body: `Blocked: ${reason}`, mentions: [], at }
  t.status = 'Blocked'
  t.comments = [...(t.comments ?? []), comment]
  t.history = [...(t.history ?? []), { id: `${t.id}-h1`, kind: 'status', userId: t.ownerId, at, summary: `Status: In progress → Blocked (${reason})` }]
  t.updatedAt = at
  return t
}

/* ---------------- Lead follow-up tasks (migrated from the old lead tasks) ---------------- */

const leadTasks: LegacyTask[] = leadTaskSeed.map((lt) =>
  withCreatedEvent(
    baseTask({
      title: lt.title,
      ownerId: lt.ownerId,
      priority: lt.priority,
      dueDate: iso(parseISO(lt.dueDate)),
      status: lt.status,
      link: { type: 'lead', id: lt.leadId },
      completedAt: lt.status === 'Done' ? subDays(new Date(), 2).toISOString() : null,
    }),
  ),
)

/* ---------------- Delivery projects for already-won customers (Apex Aora) ---------------- */

export const projects: Tenant<Project>[] = []
const projectTasks: LegacyTask[] = []

const apexCustomers = customers.filter((c) => c.companyId === APEX_ID)
for (const [i, c] of apexCustomers.entries()) {
  const lead = leads.find((l) => l.id === c.leadId)
  const serviceId = [lead?.recommendedServiceId, ...(lead?.serviceIds ?? [])].find((id) => id && projectTemplateFor(id).tasks.length > 0)
  const service = services.find((s) => s.id === serviceId)
  if (!lead || !service) continue
  const managerId = 'u10'
  const start = addDays(parseISO(c.wonAt), 3)
  const plan = planProject(service, projectTemplateFor(service.id), {
    users: companyUsers(APEX_ID),
    projectManagerId: managerId,
    startDate: iso(start),
    deliveryDepartmentId: deliveryDepartmentId(APEX_ID),
    weekend: companyWeekend(APEX_ID),
  })
  const id = nextProjectId()
  const ended = isBefore(parseISO(plan.endDate), today)
  const status: ProjectStatus = ended ? (i % 4 === 3 ? 'on_hold' : 'completed') : 'active'
  projects.push({
    companyId: APEX_ID,
    id,
    name: `${service.name} — ${c.name}`,
    customerId: c.id,
    serviceId: service.id,
    leadId: lead.id,
    quotationId: null,
    contractId: null,
    projectTemplateId: plan.hasTemplate ? service.id : null,
    managerId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status,
    estimatedHours: plan.estimatedHours,
    createdAt: start.toISOString(),
    createdBy: lead.ownerId,
    createdFrom: 'won',
  })
  for (const [k, p] of plan.tasks.entries()) {
    const due = parseISO(p.dueDate)
    // Past tasks are mostly done; one per project is left overdue so the overdue views have data.
    const past = isBefore(due, today)
    const tstatus: TaskStatus = past ? (k === 1 && !ended ? 'in_progress' : 'done') : k === 0 ? 'in_progress' : 'todo'
    projectTasks.push(
      withCreatedEvent(
        baseTask({
          title: p.title,
          ownerId: p.ownerId,
          priority: p.priority,
          dueDate: p.dueDate,
          status: tstatus,
          // Old shape: project tasks were "linked" to their project (migrated to projectId only).
          link: { type: 'project', id },
          projectId: id,
          estimatedHours: p.hours,
          loggedHours: tstatus === 'done' ? p.hours : tstatus === 'in_progress' ? Math.round(p.hours * 0.4) : 0,
          templateTaskId: p.templateTaskId,
          dayOffset: p.dayOffset,
          sortOrder: k + 1,
          createdBy: lead.ownerId,
          createdAt: start.toISOString(),
          completedAt: tstatus === 'done' ? due.toISOString() : null,
          followerIds: [managerId],
        }),
      ),
    )
  }
}

/* ---------------- Personal and customer tasks (Apex Aora) ---------------- */

const weeklyReview = baseTask({
  title: 'Prepare weekly pipeline review',
  ownerId: 'u3',
  priority: 'high',
  dueDate: iso(addDays(today, 1)),
  description: 'Stalled Interested leads and overdue follow-ups per agent.',
})

const misc: LegacyTask[] = [
  weeklyReview,
  // Sub-tasks (one level): they share the parent's project and company.
  baseTask({ title: 'Pull overdue follow-ups per agent', ownerId: 'u3', priority: 'medium', dueDate: iso(today), status: 'done', parentTaskId: weeklyReview.id, completedAt: subDays(new Date(), 1).toISOString() }),
  baseTask({ title: 'List stalled Interested leads', ownerId: 'u3', priority: 'medium', dueDate: iso(addDays(today, 1)), parentTaskId: weeklyReview.id }),
  baseTask({ title: 'Update CRM training deck', ownerId: 'u11', priority: 'low', dueDate: iso(addDays(today, 9)) }),
  baseTask({ title: 'Renew SSL certificates', ownerId: 'u1', priority: 'urgent', dueDate: iso(subDays(today, 1)), status: 'in_progress' }),
  baseTask({ title: 'Collect missing passport copies', ownerId: 'u9', priority: 'medium', dueDate: null }),
  legacyBlocked(baseTask({ title: 'Quarterly VAT reconciliation draft', ownerId: 'u8', priority: 'High', dueDate: iso(addDays(today, 4)), description: 'Waiting for the bank statements.' }), 'Waiting for the bank statements.'),
  ...apexCustomers.slice(0, 3).map((c, i) =>
    baseTask({
      title: i === 0 ? 'Quarterly business review' : i === 1 ? 'Renewal call ahead of contract end' : 'Collect testimonial',
      ownerId: c.ownerId,
      priority: i === 1 ? 'high' : 'medium',
      dueDate: iso(addDays(today, i * 3 - 2)),
      link: { type: 'customer', id: c.id },
    }),
  ),
].map(withCreatedEvent)

/* ---------------- Crest Logistics (co_crest) ---------------- */

/*
 * Rows that point at other modules' Crest seed (leads L-5001+, customers, services S-901..) are
 * only created when those records exist, so module load order can never crash.
 */
const crestLead = leads.find((l) => l.companyId === CREST_ID && l.id === 'L-5001') ?? leads.find((l) => l.companyId === CREST_ID)
const crestCustomer = customers.find((c) => c.companyId === CREST_ID)
const crestOwner = (id: string | undefined, fallback: string) => (id && companyOfUser(id) === CREST_ID ? id : fallback)

const crestReview = baseTask({ title: 'Review Q4 freight pipeline with the sales team', ownerId: 'u103', priority: 'high', dueDate: iso(addDays(today, 2)), description: 'Tender Portal leads first, then LinkedIn.' })

const crestMisc: LegacyTask[] = [
  crestReview,
  baseTask({ title: 'Export Tender Portal leads for the review', ownerId: 'u103', priority: 'medium', dueDate: iso(addDays(today, 1)), parentTaskId: crestReview.id }),
  baseTask({ title: 'Send revised warehousing rate card', ownerId: 'u104', priority: 'high', dueDate: iso(subDays(today, 2)), status: 'in_progress' }),
  baseTask({ title: 'Call back the Dammam distributor about customs clearance', ownerId: 'u105', priority: 'medium', dueDate: iso(today) }),
  baseTask({ title: 'Update the fleet tracking SOP', ownerId: 'u106', priority: 'medium', dueDate: iso(addDays(today, 6)) }),
  baseTask({ title: 'Collect proof-of-delivery scans for last month', ownerId: 'u107', priority: 'low', dueDate: iso(subDays(today, 1)), followerIds: ['u106'] }),
  legacyBlocked(
    baseTask({ title: 'Renew customs broker licence paperwork', ownerId: 'u107', priority: 'Urgent', dueDate: iso(addDays(today, 1)), description: 'Waiting for the commercial registration copy.' }),
    'Waiting for the commercial registration copy.',
  ),
  ...(crestLead
    ? [
        baseTask({
          title: `Prepare freight proposal for ${crestLead.company}`,
          ownerId: crestOwner(crestLead.ownerId, 'u104'),
          priority: 'high',
          dueDate: iso(addDays(today, 3)),
          link: { type: 'lead', id: crestLead.id },
        }),
      ]
    : []),
].map(withCreatedEvent)

interface SeedStep {
  title: string
  ownerId: string
  dueDate: string
  hours: number
  priority: TaskPriority
  templateTaskId: string | null
  dayOffset: number | null
}

const crestProjectTasks: LegacyTask[] = []
if (crestCustomer) {
  const lead = leads.find((l) => l.id === crestCustomer.leadId)
  const crestServices = services.filter((s) => (s as { companyId?: string }).companyId === CREST_ID)
  const wanted = [lead?.recommendedServiceId, ...(lead?.serviceIds ?? []), ...crestCustomer.serviceIds]
  const service = crestServices.find((s) => wanted.includes(s.id)) ?? crestServices[0]
  if (service) {
    const managerId = 'u106'
    const start = subDays(today, 10)
    const plan = planProject(service, projectTemplateFor(service.id), {
      users: companyUsers(CREST_ID),
      projectManagerId: managerId,
      startDate: iso(start),
      deliveryDepartmentId: deliveryDepartmentId(CREST_ID),
      weekend: companyWeekend(CREST_ID),
    })
    const id = nextProjectId()
    // Without a template, a short hand-made delivery plan so the project isn't empty.
    const planned: SeedStep[] = plan.tasks.length
      ? plan.tasks.map((p) => ({ title: p.title, ownerId: p.ownerId, dueDate: p.dueDate, hours: p.hours, priority: p.priority, templateTaskId: p.templateTaskId, dayOffset: p.dayOffset }))
      : [
          { title: 'Kick-off and site survey', ownerId: 'u106', dueDate: iso(addDays(start, 2)), hours: 6, priority: 'high', templateTaskId: null, dayOffset: null },
          { title: 'Route and capacity plan', ownerId: 'u107', dueDate: iso(addDays(start, 9)), hours: 16, priority: 'medium', templateTaskId: null, dayOffset: null },
          { title: 'First shipment go-live', ownerId: 'u106', dueDate: iso(addDays(start, 20)), hours: 8, priority: 'high', templateTaskId: null, dayOffset: null },
        ]
    const endDate = planned.reduce((m, t) => (t.dueDate > m ? t.dueDate : m), plan.endDate)
    projects.push({
      companyId: CREST_ID,
      id,
      name: `${service.name} — ${crestCustomer.name}`,
      customerId: crestCustomer.id,
      serviceId: service.id,
      leadId: lead?.id ?? null,
      quotationId: null,
      contractId: null,
      projectTemplateId: plan.hasTemplate ? service.id : null,
      managerId,
      startDate: plan.startDate,
      endDate,
      status: 'active',
      estimatedHours: planned.reduce((s, t) => s + t.hours, 0),
      createdAt: start.toISOString(),
      createdBy: 'u103',
      createdFrom: 'won',
    })
    for (const [k, p] of planned.entries()) {
      const due = parseISO(p.dueDate)
      const past = isBefore(due, today)
      const tstatus: TaskStatus = past ? (k === 1 ? 'in_progress' : 'done') : k === 0 ? 'in_progress' : 'todo'
      crestProjectTasks.push(
        withCreatedEvent(
          baseTask({
            title: p.title,
            ownerId: p.ownerId,
            priority: p.priority,
            dueDate: p.dueDate,
            status: tstatus,
            link: { type: 'project', id },
            projectId: id,
            estimatedHours: p.hours,
            loggedHours: tstatus === 'done' ? p.hours : tstatus === 'in_progress' ? Math.round(p.hours * 0.4) : 0,
            templateTaskId: p.templateTaskId,
            dayOffset: p.dayOffset,
            sortOrder: k + 1,
            createdBy: 'u103',
            createdAt: start.toISOString(),
            completedAt: tstatus === 'done' ? due.toISOString() : null,
            followerIds: p.ownerId === managerId ? [] : [managerId],
          }),
        ),
      )
    }
  }
}

/* ---------------- Migration of the seed into the design's shape ---------------- */

export const tasks: Tenant<Task>[] = []
/** time_entries: hours logged on tasks (and their project). */
export const timeEntries: Tenant<TimeEntry>[] = []

for (const raw of [...leadTasks, ...projectTasks, ...misc, ...crestMisc, ...crestProjectTasks]) {
  const { task, timeEntries: entries } = migrateLegacyTask(raw)
  tasks.push(task)
  for (const e of entries) timeEntries.push({ ...e, id: nextTimeEntryId() })
}

/* ---------------- Stored notifications (merged into GET /alerts) ---------------- */

export const notifications: Tenant<StoredNotification>[] = []
let nseq = 1

registerArray('tasks', tasks)
registerArray('projects', projects)
registerArray('timeEntries', timeEntries)
registerArray('notifications', notifications)
registerValue('tasks.seq', () => seq, (v) => { seq = v })
registerValue('projects.seq', () => pseq, (v) => { pseq = v })
registerValue('timeEntries.seq', () => teseq, (v) => { teseq = v })
registerValue('notifications.seq', () => nseq, (v) => { nseq = v })
/**
 * Stores a notification for `userId`. Its company is the recipient's (user ids are global), so a
 * notification can never land in another tenant's bell; `companyId` may also be passed explicitly.
 */
export function pushNotification(
  n: Omit<StoredNotification, 'id' | 'at' | 'read'> & { at?: string; companyId?: string },
): Tenant<StoredNotification> {
  const { companyId, ...rest } = n
  const row: Tenant<StoredNotification> = {
    id: `NT-${nseq++}`,
    at: n.at ?? new Date().toISOString(),
    read: false,
    ...rest,
    companyId: companyId ?? companyOfUser(n.userId) ?? APEX_ID,
  }
  notifications.unshift(row)
  return row
}
