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

function addTask(ownerId: string, dueDate: Date | null, status: TaskStatus = 'To do'): Tenant<Task> {
  const now = new Date().toISOString()
  const t: Tenant<Task> = {
    companyId: users.find((u) => u.id === ownerId)!.companyId,
    id: nextTaskId(),
    title: `Test task ${created.length + 1}`,
    description: '',
    ownerId,
    followerIds: [],
    priority: 'Medium',
    dueDate: dueDate ? iso(dueDate) : null,
    status,
    link: null,
    projectId: null,
    estimatedHours: 0,
    loggedHours: 0,
    templateTaskId: null,
    dayOffset: null,
    attachments: [],
    comments: [],
    history: [],
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'Done' ? now : null,
  }
  tasks.push(t)
  created.push(t.id)
  return t
}

const idsFor = (userId: string) => alertsFor(user(userId)).map((a) => a.id)

afterEach(() => {
  automationRules.taskReminderDaysBefore = defaultDaysBefore
  for (const id of created.splice(0)) tasks.splice(tasks.findIndex((t) => t.id === id), 1)
  for (const id of pushed.splice(0)) notifications.splice(notifications.findIndex((n) => n.id === id), 1)
})

describe('Task reminders (GET /alerts)', () => {
  it('uses the default rule of 1 day before the due date', () => {
    expect(defaultDaysBefore).toBe(1)
  })

  it('reminds the owner 1 day before the due date, linking to the task drawer', () => {
    const t = addTask(agent.id, addDays(today, 1))
    const alert = alertsFor(agent).find((a) => a.id === `task:${t.id}`)
    expect(alert).toBeDefined()
    expect(alert).toMatchObject({ type: 'task', severity: 'info', taskId: t.id, link: `/tasks/my?task=${t.id}` })
    expect(alert!.body).toContain('Due tomorrow')
  })

  it('reminds the owner on the due date itself (warning)', () => {
    const t = addTask(agent.id, today)
    expect(alertsFor(agent).find((a) => a.id === `task:${t.id}`)?.severity).toBe('warning')
  })

  it('does not remind 2 days before with the default rule', () => {
    const t = addTask(agent.id, addDays(today, 2))
    expect(idsFor(agent.id)).not.toContain(`task:${t.id}`)
  })

  it('honours a changed taskReminderDaysBefore', () => {
    const t = addTask(agent.id, addDays(today, 3))
    expect(idsFor(agent.id)).not.toContain(`task:${t.id}`)
    automationRules.taskReminderDaysBefore = 3
    expect(idsFor(agent.id)).toContain(`task:${t.id}`)
    automationRules.taskReminderDaysBefore = 2
    expect(idsFor(agent.id)).not.toContain(`task:${t.id}`)
  })

  it('reminds only the owner, not followers or other users', () => {
    const t = addTask(agent.id, addDays(today, 1))
    t.followerIds = [peer.id]
    expect(idsFor(peer.id)).not.toContain(`task:${t.id}`)
    expect(idsFor(manager.id)).not.toContain(`task:${t.id}`)
  })

  it('tasks without a due date never alert', () => {
    const t = addTask(agent.id, null)
    expect(idsFor(agent.id).filter((id) => id.endsWith(t.id))).toEqual([])
  })
})

describe('Overdue task alerts', () => {
  it('alerts the manager as soon as a direct report’s task is overdue, with owner and days overdue', () => {
    const t = addTask(agent.id, subDays(today, 1))
    const alert = alertsFor(manager).find((a) => a.id === `task-overdue:${t.id}`)
    expect(alert).toMatchObject({ type: 'task-overdue', severity: 'danger', taskId: t.id })
    expect(alert!.body).toContain(agent.name)
    expect(alert!.body).toContain('1 day overdue')
  })

  it('the owner sees their own overdue task, and it is no longer a due-soon reminder', () => {
    const t = addTask(agent.id, subDays(today, 3))
    const ids = idsFor(agent.id)
    expect(ids).toContain(`task-overdue:${t.id}`)
    expect(ids).not.toContain(`task:${t.id}`)
    expect(alertsFor(agent).find((a) => a.id === `task-overdue:${t.id}`)!.body).toContain('3 days overdue')
  })

  it('a peer with own task scope does not get someone else’s overdue alert', () => {
    const t = addTask(agent.id, subDays(today, 2))
    expect(idsFor(peer.id)).not.toContain(`task-overdue:${t.id}`)
  })

  it('a task due today is not overdue', () => {
    const t = addTask(agent.id, today)
    expect(idsFor(manager.id)).not.toContain(`task-overdue:${t.id}`)
  })

  it('Done tasks never alert, for the owner or the manager', () => {
    const late = addTask(agent.id, subDays(today, 2), 'Done')
    const soon = addTask(agent.id, addDays(today, 1), 'Done')
    for (const id of [agent.id, manager.id]) {
      const ids = idsFor(id)
      for (const t of [late, soon]) {
        expect(ids).not.toContain(`task:${t.id}`)
        expect(ids).not.toContain(`task-overdue:${t.id}`)
      }
    }
  })

  it('completing a task clears its alert', () => {
    const t = addTask(agent.id, subDays(today, 1))
    expect(idsFor(manager.id)).toContain(`task-overdue:${t.id}`)
    t.status = 'Done'
    expect(idsFor(manager.id)).not.toContain(`task-overdue:${t.id}`)
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

  it('computed reminders can’t be marked read', async () => {
    const t = addTask(agent.id, addDays(today, 1))
    await expect(markAlertRead(agent, `task:${t.id}`)).rejects.toMatchObject({ status: 422 })
  })
})
