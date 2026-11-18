import { afterEach, describe, expect, it } from 'vitest'
import { addDays, format, startOfDay, subDays } from 'date-fns'
import type { Task, TaskStatus } from '@/modules/tasks/types'
import { users } from '@/shared/mocks/db'
import { automationRulesFor } from '@/shared/mocks/data/lookups'
import type { Tenant } from '@/shared/mocks/tenant'
import { nextTaskId, notifications, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { alertsFor, getAlerts, markAlertRead, markAllAlertsRead } from '@/shared/mocks/services/alerts'

const user = (id: string) => users.find((u) => u.id === id)!
/** Sales Agent reporting to u3. */
const agent = user('u4')
/** Sales Manager, u4's manager. */
const manager = user('u3')
/** Another agent (not u4's manager). */
const peer = user('u5')

const today = startOfDay(new Date())
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

const created: string[] = []
const pushed: string[] = []
const automationRules = automationRulesFor('co_apex')
const defaultDaysBefore = automationRules.taskReminderDaysBefore

function addTask(ownerId: string, dueDate: Date | null, status: TaskStatus = 'todo'): Tenant<Task> {
  const now = new Date().toISOString()
  const t: Tenant<Task> = {
    companyId: users.find((u) => u.id === ownerId)!.companyId,
    id: nextTaskId(),
    title: `Test task ${created.length + 1}`,
    description: '',
    ownerId,
    followerIds: [],
    priority: 'medium',
    dueDate: dueDate ? iso(dueDate) : null,
    status,
    link: null,
    projectId: null,
    parentTaskId: null,
    estimatedHours: 0,
    templateTaskId: null,
    dayOffset: null,
    sortOrder: 0,
    blockedAt: null,
    blockedReason: null,
    reminderSentAt: null,
    overdueNotifiedAt: null,
    attachments: [],
    comments: [],
    history: [],
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : null,
  }
  tasks.push(t)
  created.push(t.id)
  return t
}

const idsFor = (userId: string) => alertsFor(user(userId)).map((a) => a.id)
/** The stored "due soon" reminder (task-due) of a task in the user's bell. */
const reminderOf = (userId: string, taskId: string) => alertsFor(user(userId)).find((a) => a.stored && a.type === 'task' && a.taskId === taskId)
/** The stored overdue notice (task-overdue) of a task in the user's bell. */
const noticeOf = (userId: string, taskId: string) => alertsFor(user(userId)).find((a) => a.stored && a.type === 'task-overdue' && a.taskId === taskId)

afterEach(() => {
  automationRules.taskReminderDaysBefore = defaultDaysBefore
  for (const id of created.splice(0)) {
    tasks.splice(tasks.findIndex((t) => t.id === id), 1)
    // Reminders stored for the test's tasks go with them.
    for (let i = notifications.length - 1; i >= 0; i--) if (notifications[i].taskId === id) notifications.splice(i, 1)
  }
  for (const id of pushed.splice(0)) notifications.splice(notifications.findIndex((n) => n.id === id), 1)
})

describe('Task reminders (stored by the reminder tick behind GET /alerts)', () => {
  it('uses the default rule of 1 day before the due date', () => {
    expect(defaultDaysBefore).toBe(1)
  })

  it('reminds the owner 1 day before the due date, linking to the task drawer', () => {
    const t = addTask(agent.id, addDays(today, 1))
    const alert = reminderOf(agent.id, t.id)
    expect(alert).toBeDefined()
    expect(alert).toMatchObject({ type: 'task', severity: 'warning', taskId: t.id, link: `/tasks/my?task=${t.id}`, stored: true, read: false })
    expect(alert!.body).toMatch(/Due (tomorrow|today)/)
    expect(t.reminderSentAt).not.toBeNull()
  })

  it('reminds the owner on the due date itself', () => {
    const t = addTask(agent.id, today)
    expect(reminderOf(agent.id, t.id)).toBeDefined()
  })

  it('does not remind 3 days before with the default rule', () => {
    const t = addTask(agent.id, addDays(today, 3))
    expect(reminderOf(agent.id, t.id)).toBeUndefined()
    expect(t.reminderSentAt).toBeNull()
  })

  it('honours a changed taskReminderDaysBefore', () => {
    const t = addTask(agent.id, addDays(today, 4))
    expect(reminderOf(agent.id, t.id)).toBeUndefined()
    automationRules.taskReminderDaysBefore = 5
    expect(reminderOf(agent.id, t.id)).toBeDefined()
  })

  it('reminds only the owner, not followers or other users', () => {
    const t = addTask(agent.id, addDays(today, 1))
    t.followerIds = [peer.id]
    expect(reminderOf(peer.id, t.id)).toBeUndefined()
    expect(reminderOf(manager.id, t.id)).toBeUndefined()
    expect(reminderOf(agent.id, t.id)).toBeDefined()
  })

  it('tasks without a due date never alert', () => {
    const t = addTask(agent.id, null)
    expect(alertsFor(agent).filter((a) => a.taskId === t.id)).toEqual([])
    expect(alertsFor(manager).filter((a) => a.taskId === t.id)).toEqual([])
  })

  it('a stored reminder can be marked read like any notification', async () => {
    const t = addTask(agent.id, addDays(today, 1))
    const r = reminderOf(agent.id, t.id)!
    await markAlertRead(agent, r.id)
    expect(reminderOf(agent.id, t.id)?.read).toBe(true)
  })
})

describe('Overdue task alerts', () => {
  it('stores an overdue notice for the owner’s manager as soon as the task is overdue, with owner and days overdue', () => {
    const t = addTask(agent.id, subDays(today, 1))
    const alert = noticeOf(manager.id, t.id)
    expect(alert).toMatchObject({ type: 'task-overdue', severity: 'danger', taskId: t.id, stored: true })
    expect(alert!.body).toContain(agent.name)
    expect(alert!.body).toMatch(/\d+ days? overdue/)
    expect(t.overdueNotifiedAt).not.toBeNull()
    // Listed once: no computed copy next to the stored notice.
    expect(alertsFor(manager).filter((a) => a.taskId === t.id)).toHaveLength(1)
  })

  it('the owner sees their own overdue task (computed), and it is no longer a due-soon reminder', () => {
    const t = addTask(agent.id, subDays(today, 3))
    const ids = idsFor(agent.id)
    expect(ids).toContain(`task-overdue:${t.id}`)
    expect(reminderOf(agent.id, t.id)).toBeUndefined()
    expect(alertsFor(agent).find((a) => a.id === `task-overdue:${t.id}`)!.body).toMatch(/\d+ days overdue/)
  })

  it('a peer with own task scope does not get someone else’s overdue alert', () => {
    const t = addTask(agent.id, subDays(today, 2))
    expect(alertsFor(peer).filter((a) => a.taskId === t.id)).toEqual([])
  })

  it('a task due today is not overdue', () => {
    const t = addTask(agent.id, today)
    expect(noticeOf(manager.id, t.id)).toBeUndefined()
    expect(idsFor(manager.id)).not.toContain(`task-overdue:${t.id}`)
  })

  it('done and cancelled tasks never alert, for the owner or the manager', () => {
    const late = addTask(agent.id, subDays(today, 2), 'done')
    const soon = addTask(agent.id, addDays(today, 1), 'done')
    const dropped = addTask(agent.id, subDays(today, 2), 'cancelled')
    for (const id of [agent.id, manager.id]) {
      const list = alertsFor(user(id))
      for (const t of [late, soon, dropped]) expect(list.filter((a) => a.taskId === t.id)).toEqual([])
    }
  })

  it('completing a task clears the owner’s computed alert (the manager’s stored notice stays as a record)', () => {
    const t = addTask(agent.id, subDays(today, 1))
    expect(idsFor(agent.id)).toContain(`task-overdue:${t.id}`)
    expect(noticeOf(manager.id, t.id)).toBeDefined()
    t.status = 'done'
    expect(idsFor(agent.id)).not.toContain(`task-overdue:${t.id}`)
    expect(noticeOf(manager.id, t.id)).toBeDefined()
  })
})

describe('Stored notifications in the bell', () => {
  function push(userId: string, type: 'won' | 'assignment' | 'mention' = 'assignment') {
    const n = pushNotification({ userId, type, title: `Test ${type}`, body: 'Body', link: '/projects/PRJ-1' })
    pushed.push(n.id)
    return n
  }

  it('merges the user’s stored notifications as unread alerts of their type', async () => {
    const won = push(agent.id, 'won')
    const mention = push(agent.id, 'mention')
    const list = await getAlerts(agent)
    expect(list.find((a) => a.id === won.id)).toMatchObject({ type: 'won', stored: true, read: false, link: '/projects/PRJ-1', title: 'Test won' })
    expect(list.find((a) => a.id === mention.id)).toMatchObject({ type: 'mention', stored: true, read: false })
  })

  it('other users don’t see them and can’t mark them read', async () => {
    const n = push(agent.id)
    expect(idsFor(peer.id)).not.toContain(n.id)
    expect(idsFor(manager.id)).not.toContain(n.id)
    await expect(markAlertRead(peer, n.id)).rejects.toMatchObject({ status: 404 })
    expect(n.read).toBe(false)
  })

  it('can be marked read one at a time (PATCH /alerts/:id/read)', async () => {
    const a = push(agent.id)
    const b = push(agent.id)
    const res = await markAlertRead(agent, a.id)
    expect(res).toMatchObject({ id: a.id, read: true })
    const list = alertsFor(agent)
    expect(list.find((x) => x.id === a.id)?.read).toBe(true)
    expect(list.find((x) => x.id === b.id)?.read).toBe(false)
  })

  it('can all be marked read (POST /alerts/read-all) without touching other users', async () => {
    const mine = [push(agent.id), push(agent.id, 'mention')]
    const theirs = push(peer.id)
    const res = await markAllAlertsRead(agent)
    expect(res.updated).toBeGreaterThanOrEqual(2)
    expect(mine.every((n) => n.read)).toBe(true)
    expect(theirs.read).toBe(false)
    expect((await markAllAlertsRead(agent)).updated).toBe(0)
  })

  it('computed alerts can’t be marked read', async () => {
    const t = addTask(agent.id, subDays(today, 2))
    await expect(markAlertRead(agent, `task-overdue:${t.id}`)).rejects.toMatchObject({ status: 422 })
  })
})
