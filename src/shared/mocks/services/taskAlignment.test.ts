import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from '@/modules/tasks/enums'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { automationRulesFor } from '@/shared/mocks/data/lookups'
import { notifications, projects, tasks, timeEntries } from '@/shared/mocks/data/tasks'
import { MIGRATED_BLOCKED_REASON, migrateLegacyTask, type LegacyTask } from '@/shared/mocks/data/taskMigration'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { projectActualHours } from '@/shared/mocks/selectors/tasks'
import { usedOf } from '@/shared/mocks/services/billing'
import { getProject, listProjects } from '@/shared/mocks/services/projects'
import { runTaskReminders } from '@/shared/mocks/services/taskReminders'
import {
  addAttachment,
  addTimeEntry,
  blockTask,
  createTask,
  getTask,
  getTasks,
  removeTimeEntry,
  updateTask,
} from '@/shared/mocks/services/tasks'

/**
 * Database alignment, part B (docs/DB-ALIGNMENT.md): task statuses and priorities, the
 * blocked flag migration, sub-tasks, completed_at, stored once-only reminders, time entries and
 * attachment fields.
 */

const byId = (id: string) => users.find((u) => u.id === id)!
const admin = byId('u1') // Apex Company Admin (tasks full)
const manager = byId('u3') // Sales Manager, u4's manager (tasks team)
const agent = byId('u4') // Sales Agent (tasks own)
const colleague = byId('u5') // another Sales Agent
const crestAdmin = byId('u101')
const crestAgent = byId('u104') // reports to u103

const seed = takeSnapshot(true)
beforeEach(() => restoreSnapshot(seed))
afterEach(() => restoreSnapshot(seed))

async function rejects(p: Promise<unknown>, status: number): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(status)
    return (e as ApiError).message
  }
  throw new Error(`expected a ${status} error`)
}

/* ---------------- Enums and the migration ---------------- */

describe('task / project enums are the design’s values', () => {
  it('the value tuples', () => {
    expect(TASK_STATUSES).toEqual(['todo', 'in_progress', 'review', 'done', 'cancelled'])
    expect(TASK_PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent'])
    expect(PROJECT_STATUSES).toEqual(['planned', 'active', 'on_hold', 'completed', 'cancelled'])
  })

  it('every seeded task and project uses them (no legacy value is left)', () => {
    for (const t of tasks) {
      expect(TASK_STATUSES).toContain(t.status)
      expect(TASK_PRIORITIES).toContain(t.priority)
      expect(t.link === null || ['lead', 'customer', 'event'].includes(t.link.type)).toBe(true)
      for (const a of t.attachments) expect(Object.keys(a).sort()).toEqual(['id', 'mimeType', 'name', 'sizeBytes', 'uploadedAt', 'uploadedBy'])
    }
    for (const p of projects) expect(PROJECT_STATUSES).toContain(p.status)
  })

  it('the old Blocked seed tasks are in_progress with the flag and their recorded reason', () => {
    const blocked = tasks.filter((t) => t.blockedAt)
    expect(blocked.map((t) => t.title).sort()).toEqual(['Quarterly VAT reconciliation draft', 'Renew customs broker licence paperwork'])
    for (const t of blocked) {
      expect(t.status).toBe('in_progress')
      expect(t.blockedReason).toMatch(/^Waiting for/)
    }
  })

  it('the API refuses the old values (422)', async () => {
    await rejects(createTask(admin, { title: 'Old priority', priority: 'High' as never }), 422)
    const t = await createTask(admin, { title: 'Old status' })
    await rejects(updateTask(admin, t.id, { status: 'In progress' as never }), 422)
    await rejects(createTask(admin, { title: 'Project link', link: { type: 'project' as never, id: projects[0].id } }), 422)
  })
})

describe('migrateLegacyTask (old stored shape → design shape)', () => {
  const legacy = (over: Partial<LegacyTask> = {}): LegacyTask => ({
    companyId: 'co_apex',
    id: 'TK-OLD-1',
    title: 'Old task',
    ownerId: 'u4',
    status: 'To do',
    priority: 'Urgent',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    ...over,
  })

  it('maps statuses and priorities', () => {
    expect(migrateLegacyTask(legacy({ status: 'To do' })).task.status).toBe('todo')
    expect(migrateLegacyTask(legacy({ status: 'In progress' })).task.status).toBe('in_progress')
    expect(migrateLegacyTask(legacy({ status: 'Done' })).task.status).toBe('done')
    expect(migrateLegacyTask(legacy({ priority: 'Low' })).task.priority).toBe('low')
    expect(migrateLegacyTask(legacy({ priority: 'Urgent' })).task.priority).toBe('urgent')
    // Already migrated values pass through.
    expect(migrateLegacyTask(legacy({ status: 'review', priority: 'high' })).task).toMatchObject({ status: 'review', priority: 'high' })
  })

  it('Blocked → in_progress + blocked_at (the last move to Blocked) + blocked_reason (the recorded reason)', () => {
    const { task } = migrateLegacyTask(
      legacy({
        status: 'Blocked',
        history: [
          { id: 'h1', kind: 'status', userId: 'u4', at: '2026-10-02T09:00:00.000Z', summary: 'Status: To do → Blocked (Waiting for the bank)' },
          { id: 'h2', kind: 'edited', userId: 'u4', at: '2026-10-04T09:00:00.000Z', summary: 'Updated the description' },
        ],
        comments: [{ id: 'c1', authorId: 'u4', body: 'Blocked: Waiting for the bank', mentions: [], at: '2026-10-02T09:00:00.000Z' }],
      }),
    )
    expect(task).toMatchObject({ status: 'in_progress', blockedAt: '2026-10-02T09:00:00.000Z', blockedReason: 'Waiting for the bank' })
  })

  it('Blocked without a recorded reason → "Blocked (migrated)" at the last update', () => {
    const { task } = migrateLegacyTask(legacy({ status: 'Blocked' }))
    expect(task).toMatchObject({ status: 'in_progress', blockedAt: '2026-10-05T08:00:00.000Z', blockedReason: MIGRATED_BLOCKED_REASON })
  })

  it('a project link becomes projectId; attachments get sizeBytes / mimeType; loggedHours becomes a time entry', () => {
    const { task, timeEntries: entries } = migrateLegacyTask(
      legacy({
        status: 'Done',
        link: { type: 'project', id: 'PRJ-9' },
        attachments: [{ id: 'a1', name: 'brief.pdf', size: 1200, type: 'application/pdf', uploadedBy: 'u4', uploadedAt: '2026-10-02T09:00:00.000Z' }],
        loggedHours: 6.5,
      }),
    )
    expect(task.link).toBeNull()
    expect(task.projectId).toBe('PRJ-9')
    expect(task.attachments[0]).toEqual({ id: 'a1', name: 'brief.pdf', sizeBytes: 1200, mimeType: 'application/pdf', uploadedBy: 'u4', uploadedAt: '2026-10-02T09:00:00.000Z' })
    expect(task.completedAt).toBe('2026-10-05T08:00:00.000Z')
    expect(entries).toEqual([
      expect.objectContaining({ taskId: 'TK-OLD-1', projectId: 'PRJ-9', userId: 'u4', entryDate: '2026-10-05', hours: 6.5, isBillable: true }),
    ])
  })
})

/* ---------------- Blocked flag on the board columns ---------------- */

describe('blocked is a flag, not a status', () => {
  it('a blocked task keeps its status and can move between columns while blocked', async () => {
    const t = await createTask(admin, { title: 'Flag probe' })
    await blockTask(admin, t.id, { reason: 'Waiting for the customer' })
    const moved = await updateTask(admin, t.id, { status: 'review' })
    expect(moved).toMatchObject({ status: 'review', blocked: true })
    expect((await getTasks(admin, { blocked: true })).map((x) => x.id)).toContain(t.id)
    expect((await getTasks(admin, { blocked: false })).map((x) => x.id)).not.toContain(t.id)
  })
})

/* ---------------- completed_at ---------------- */

describe('completed_at', () => {
  it('is set when the status becomes done and cleared on reopen; cancelled is not completed', async () => {
    const t = await createTask(admin, { title: 'Complete me' })
    expect(t.completedAt).toBeNull()
    const done = await updateTask(admin, t.id, { status: 'done' })
    expect(done.completedAt).not.toBeNull()
    const reopened = await updateTask(admin, t.id, { status: 'in_progress' })
    expect(reopened.completedAt).toBeNull()
    const cancelled = await updateTask(admin, t.id, { status: 'cancelled' })
    expect(cancelled.completedAt).toBeNull()
    expect((await createTask(admin, { title: 'Born done', status: 'done' })).completedAt).not.toBeNull()
  })
})

/* ---------------- Sub-tasks ---------------- */

describe('sub-tasks (parent_task_id, one level)', () => {
  it('inherit the parent’s project and company and show as progress on the parent', async () => {
    const project = projects.find((p) => p.companyId === 'co_apex')!
    const parent = await createTask(admin, { title: 'Parent', projectId: project.id })
    const a = await createTask(admin, { title: 'Sub A', parentTaskId: parent.id })
    const b = await createTask(admin, { title: 'Sub B', parentTaskId: parent.id, ownerId: agent.id })
    expect(a).toMatchObject({ parentTaskId: parent.id, projectId: project.id, parentTitle: 'Parent' })
    expect(tasks.find((t) => t.id === b.id)!.companyId).toBe('co_apex')
    let view = await getTask(admin, parent.id)
    expect(view.subtasks.map((s) => s.id)).toEqual([a.id, b.id])
    expect(view.subtaskProgress).toEqual({ done: 0, total: 2 })
    await updateTask(admin, a.id, { status: 'done' })
    view = await getTask(admin, parent.id)
    expect(view.subtaskProgress).toEqual({ done: 1, total: 2 })
    // A cancelled sub-task leaves the count.
    await updateTask(admin, b.id, { status: 'cancelled' })
    expect((await getTask(admin, parent.id)).subtaskProgress).toEqual({ done: 1, total: 1 })
  })

  it('one level only, same project, and the parent must be changeable', async () => {
    const parent = await createTask(admin, { title: 'Parent' })
    const sub = await createTask(admin, { title: 'Sub', parentTaskId: parent.id })
    expect(await rejects(createTask(admin, { title: 'Sub-sub', parentTaskId: sub.id }), 422)).toContain('sub-task')
    const project = projects.find((p) => p.companyId === 'co_apex')!
    await rejects(createTask(admin, { title: 'Other project', parentTaskId: parent.id, projectId: project.id }), 422)
    await rejects(updateTask(admin, sub.id, { projectId: project.id }), 422)
    // A colleague's task the agent can't see: 404; another company's: 404.
    const theirs = await createTask(admin, { title: 'Colleague parent', ownerId: colleague.id })
    await rejects(createTask(agent, { title: 'Sneaky', parentTaskId: theirs.id }), 404)
    const crest = await createTask(crestAdmin, { title: 'Crest parent' })
    await rejects(createTask(admin, { title: 'Cross company', parentTaskId: crest.id }), 404)
  })

  it('the parent’s project change moves its sub-tasks; done needs closed sub-tasks (409 unless forced); cancel cascades', async () => {
    const [p1, p2] = projects.filter((p) => p.companyId === 'co_apex')
    const parent = await createTask(admin, { title: 'Parent', projectId: p1.id })
    const sub = await createTask(admin, { title: 'Sub', parentTaskId: parent.id })
    await updateTask(admin, parent.id, { projectId: p2.id })
    expect((await getTask(admin, sub.id)).projectId).toBe(p2.id)

    expect(await rejects(updateTask(admin, parent.id, { status: 'done' }), 409)).toContain('sub-task')
    expect((await updateTask(admin, parent.id, { status: 'done', force: true })).status).toBe('done')
    await updateTask(admin, parent.id, { status: 'in_progress' })

    const other = await createTask(admin, { title: 'Sub 2', parentTaskId: parent.id })
    await updateTask(admin, sub.id, { status: 'done' })
    await updateTask(admin, parent.id, { status: 'cancelled' })
    expect((await getTask(admin, other.id)).status).toBe('cancelled')
    expect((await getTask(admin, sub.id)).status).toBe('done') // closed ones stay as they were
    // A closed parent takes no new sub-tasks, and its sub-tasks can't be reopened first.
    await rejects(createTask(admin, { title: 'Late sub', parentTaskId: parent.id }), 422)
    await rejects(updateTask(admin, other.id, { status: 'todo' }), 422)
  })

  it('scope = the parent’s: whoever sees the parent sees (and may change) its sub-tasks', async () => {
    const parent = await createTask(admin, { title: 'Agent’s parent', ownerId: agent.id })
    const sub = await createTask(admin, { title: 'Admin-owned sub', parentTaskId: parent.id, ownerId: admin.id })
    const view = await getTask(agent, sub.id)
    expect(view.canEdit).toBe(true)
    expect((await getTasks(agent, { includeDone: true })).map((t) => t.id)).toContain(sub.id)
    await rejects(getTask(colleague, sub.id), 404)
  })
})

/* ---------------- Time entries ---------------- */

describe('time entries (entry_date, hours, description, is_billable)', () => {
  it('logs, sums into loggedHours and projects.actual_hours, and defaults is_billable to the project', async () => {
    const project = projects.find((p) => p.companyId === 'co_apex')!
    const before = projectActualHours(project)
    const t = await createTask(admin, { title: 'Billable work', projectId: project.id })
    await addTimeEntry(admin, t.id, { entryDate: '2026-11-17', hours: 1.5, description: 'Workshop' })
    const view = await addTimeEntry(admin, t.id, { entryDate: '2026-11-18', hours: 2, isBillable: false })
    expect(view.loggedHours).toBe(3.5)
    expect(view.timeEntries.map((e) => [e.entryDate, e.hours, e.isBillable, e.description])).toEqual([
      ['2026-11-18', 2, false, null],
      ['2026-11-17', 1.5, true, 'Workshop'],
    ])
    expect(view.timeEntries[0]).toMatchObject({ userId: admin.id, userName: admin.name, taskId: t.id, projectId: project.id })
    expect(projectActualHours(project)).toBe(before + 3.5)
    expect((await listProjects(admin)).find((p) => p.id === project.id)!.loggedHours).toBe(before + 3.5)
    expect((await getProject(admin, project.id)).tasks.find((x) => x.id === t.id)!.loggedHours).toBe(3.5)

    const personal = await createTask(admin, { title: 'Personal hours' })
    expect((await addTimeEntry(admin, personal.id, { entryDate: '2026-11-18', hours: 1 })).timeEntries[0].isBillable).toBe(false)
  })

  it('validates: positive hours up to 24 with two decimals, a real date, a short description', async () => {
    const t = await createTask(admin, { title: 'Validation' })
    await rejects(addTimeEntry(admin, t.id, { entryDate: '2026-11-18', hours: 0 }), 422)
    await rejects(addTimeEntry(admin, t.id, { entryDate: '2026-11-18', hours: 24.5 }), 422)
    await rejects(addTimeEntry(admin, t.id, { entryDate: '2026-11-18', hours: 1.234 }), 422)
    await rejects(addTimeEntry(admin, t.id, { entryDate: '18/11/2026', hours: 1 }), 422)
    await rejects(addTimeEntry(admin, t.id, { entryDate: '2026-11-18', hours: 1, description: 'x'.repeat(256) }), 422)
  })

  it('only the person who logged an entry (or full scope) removes it; others can’t log on tasks they can’t change', async () => {
    const t = await createTask(manager, { title: 'Team task', ownerId: agent.id })
    const mine = await addTimeEntry(agent, t.id, { entryDate: '2026-11-18', hours: 1 })
    const entryId = mine.timeEntries[0].id
    await rejects(removeTimeEntry(manager, t.id, entryId), 403)
    expect((await removeTimeEntry(admin, t.id, entryId)).timeEntries).toEqual([])
    await rejects(addTimeEntry(colleague, t.id, { entryDate: '2026-11-18', hours: 1 }), 404)
    expect(timeEntries.some((e) => e.id === entryId)).toBe(false)
  })
})

/* ---------------- Attachments ---------------- */

describe('attachments carry size_bytes and mime_type and count against storage', () => {
  it('stores the design’s fields and adds to storageMb', async () => {
    const t = await createTask(admin, { title: 'Files' })
    const before = usedOf('co_apex', 'storageMb')
    const view = await addAttachment(admin, t.id, { name: 'scan.png', sizeBytes: 3 * 1024 * 1024, mimeType: 'image/png' })
    expect(view.attachments[0]).toMatchObject({ name: 'scan.png', sizeBytes: 3 * 1024 * 1024, mimeType: 'image/png' })
    expect(usedOf('co_apex', 'storageMb')).toBeCloseTo(before + 3, 1)
    const noType = await addAttachment(admin, t.id, { name: 'blob', sizeBytes: 10 })
    expect(noType.attachments[1].mimeType).toBe('application/octet-stream')
    await rejects(addAttachment(admin, t.id, { name: 'old.pdf', size: 10, type: 'application/pdf' } as never), 422)
  })
})

/* ---------------- Stored reminders, once only ---------------- */

describe('task reminders are stored once (reminder_sent_at / overdue_notified_at)', () => {
  const reminders = (taskId: string) => notifications.filter((n) => n.taskId === taskId && n.type === 'task-due')
  const notices = (taskId: string) => notifications.filter((n) => n.taskId === taskId && n.type === 'task-overdue')

  it('the owner’s reminder is sent once across many ticks and requests', async () => {
    const at = new Date('2030-01-09T08:00:00Z') // 9 Jan in Dubai
    const t = await createTask(admin, { title: 'Once only', ownerId: agent.id, dueDate: '2030-01-10' })
    for (let i = 0; i < 5; i++) runTaskReminders('co_apex', at)
    await getTasks(agent)
    await getTask(agent, t.id)
    runTaskReminders('co_apex', new Date('2030-01-10T08:00:00Z'))
    expect(reminders(t.id)).toHaveLength(1)
    expect(reminders(t.id)[0]).toMatchObject({ userId: agent.id, companyId: 'co_apex', body: 'Due tomorrow', link: `/tasks/my?task=${t.id}` })
    expect(tasks.find((x) => x.id === t.id)!.reminderSentAt).toBe(at.toISOString())
  })

  it('the manager’s overdue notice is sent once, and only to the owner’s manager', async () => {
    const t = await createTask(admin, { title: 'Late once', ownerId: agent.id, dueDate: '2030-01-10' })
    for (const day of ['2030-01-11', '2030-01-12', '2030-01-20']) runTaskReminders('co_apex', new Date(`${day}T08:00:00Z`))
    expect(notices(t.id)).toHaveLength(1)
    expect(notices(t.id)[0]).toMatchObject({ userId: manager.id, body: expect.stringContaining('1 day overdue') })
    expect(tasks.find((x) => x.id === t.id)!.overdueNotifiedAt).toBe('2030-01-11T08:00:00.000Z')
  })

  it('changing the due date re-arms both', async () => {
    const t = await createTask(admin, { title: 'Re-armed', ownerId: agent.id, dueDate: '2030-01-10' })
    runTaskReminders('co_apex', new Date('2030-01-09T08:00:00Z'))
    runTaskReminders('co_apex', new Date('2030-01-11T08:00:00Z'))
    expect([reminders(t.id).length, notices(t.id).length]).toEqual([1, 1])
    const moved = await updateTask(admin, t.id, { dueDate: '2030-02-10' })
    expect(moved).toMatchObject({ reminderSentAt: null, overdueNotifiedAt: null })
    runTaskReminders('co_apex', new Date('2030-02-09T08:00:00Z'))
    runTaskReminders('co_apex', new Date('2030-02-12T08:00:00Z'))
    expect([reminders(t.id).length, notices(t.id).length]).toEqual([2, 2])
    // Other edits don't re-arm.
    await updateTask(admin, t.id, { title: 'Re-armed (renamed)' })
    runTaskReminders('co_apex', new Date('2030-02-13T08:00:00Z'))
    expect([reminders(t.id).length, notices(t.id).length]).toEqual([2, 2])
  })

  it('done and cancelled tasks get neither', async () => {
    const done = await createTask(admin, { title: 'Done early', ownerId: agent.id, dueDate: '2030-01-10', status: 'done' })
    const dropped = await createTask(admin, { title: 'Dropped', ownerId: agent.id, dueDate: '2030-01-10', status: 'cancelled' })
    runTaskReminders('co_apex', new Date('2030-01-09T08:00:00Z'))
    runTaskReminders('co_apex', new Date('2030-01-12T08:00:00Z'))
    for (const t of [done, dropped]) expect(notifications.filter((n) => n.taskId === t.id)).toEqual([])
  })

  it('per company: an Apex tick never touches Crest tasks or notifications', async () => {
    const crest = await createTask(crestAdmin, { title: 'Crest due', ownerId: crestAgent.id, dueDate: '2030-01-10' })
    const crestNotes = notifications.filter((n) => n.companyId === 'co_crest').length
    runTaskReminders('co_apex', new Date('2030-01-09T08:00:00Z'))
    runTaskReminders('co_apex', new Date('2030-01-12T08:00:00Z'))
    expect(notifications.filter((n) => n.companyId === 'co_crest')).toHaveLength(crestNotes)
    expect(tasks.find((x) => x.id === crest.id)).toMatchObject({ reminderSentAt: null, overdueNotifiedAt: null })
    runTaskReminders('co_crest', new Date('2030-01-09T08:00:00Z'))
    expect(reminders(crest.id)).toEqual([expect.objectContaining({ companyId: 'co_crest', userId: crestAgent.id })])
    // Every stored reminder lands in its task's company.
    for (const n of notifications.filter((x) => x.taskId)) expect(n.companyId).toBe(tasks.find((t) => t.id === n.taskId)?.companyId ?? n.companyId)
  })

  it('days are the company’s: the reminder fires at midnight in Dubai, not UTC', async () => {
    const t = await createTask(admin, { title: 'Midnight', ownerId: agent.id, dueDate: '2030-01-10' })
    expect(automationRulesFor('co_apex').taskReminderDaysBefore).toBe(1)
    // 23:59 on 8 Jan in Dubai (19:59 UTC): two days before, nothing yet.
    runTaskReminders('co_apex', new Date('2030-01-08T19:59:00Z'))
    expect(reminders(t.id)).toHaveLength(0)
    // 00:01 on 9 Jan in Dubai (still 8 Jan in UTC): one day before, the reminder goes out.
    runTaskReminders('co_apex', new Date('2030-01-08T20:01:00Z'))
    expect(reminders(t.id)).toHaveLength(1)
    // Overdue from 00:00 on 11 Jan Dubai (20:00 UTC on the 10th).
    runTaskReminders('co_apex', new Date('2030-01-10T19:59:00Z'))
    expect(notices(t.id)).toHaveLength(0)
    runTaskReminders('co_apex', new Date('2030-01-10T20:01:00Z'))
    expect(notices(t.id)).toHaveLength(1)
  })
})
