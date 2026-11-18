import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { customers, leads, users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { tasks } from '@/shared/mocks/data/tasks'
import { advanceClock, resetClock } from '@/shared/mocks/clock'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyTeamIds } from '@/shared/mocks/selectors/company'
import { dueThisWeek, overdueTasks, todayIsoFor } from '@/shared/mocks/selectors/tasks'
import { alertsFor } from '@/shared/mocks/services/alerts'
import { createTask, getAssignableUsers, getTask, getTasks, updateTask } from '@/shared/mocks/services/tasks'
import { addDaysIso } from '@/shared/lib/companyDay'

/**
 * Task rules the screens rely on: company-timezone days (with the mock clock), the Blocked reason,
 * per-task edit rights (canEdit), the assignable owners list and scope-aware link chips.
 */

const byId = (id: string) => users.find((u) => u.id === id)!
const admin = byId('u1') // Apex Company Admin: tasks full, sales full
const manager = byId('u3') // Sales Manager: tasks team
const agent = byId('u4') // Sales Agent: tasks own, sales own
const colleague = byId('u5') // another Sales Agent
const crestAdmin = byId('u101')

const seed = takeSnapshot(true)
beforeEach(() => restoreSnapshot(seed))
afterEach(() => {
  vi.useRealTimers()
  resetClock()
  restoreSnapshot(seed)
})

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

/** Freezes Date (not timers: the mock's delay stays a microtask). */
function freeze(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('days are the company’s (timezone + week start), at the mock clock', () => {
  it('22:30 UTC on the 18th: a task due the 18th is overdue in Riyadh, not in a UTC company', async () => {
    freeze('2026-11-18T22:30:00Z')
    const t = await createTask(crestAdmin, { title: 'Customs paperwork', dueDate: '2026-11-18' })
    expect(todayIsoFor('co_crest')).toBe('2026-11-19')
    expect((await getTask(crestAdmin, t.id)).overdue).toBe(true)
    expect(overdueTasks(crestAdmin).some((x) => x.id === t.id)).toBe(true)

    companyById('co_crest')!.regional.timezone = 'UTC'
    expect(todayIsoFor('co_crest')).toBe('2026-11-18')
    expect((await getTask(crestAdmin, t.id)).overdue).toBe(false)
    expect(overdueTasks(crestAdmin).some((x) => x.id === t.id)).toBe(false)
  })

  it('reads the simulated clock: advancing a day makes today’s task overdue', async () => {
    const today = todayIsoFor('co_apex')
    const t = await createTask(admin, { title: 'Due today', dueDate: today })
    expect((await getTask(admin, t.id)).overdue).toBe(false)
    advanceClock(1)
    expect(todayIsoFor('co_apex')).toBe(addDaysIso(today, 1))
    expect((await getTask(admin, t.id)).overdue).toBe(true)
    expect(overdueTasks(admin).some((x) => x.id === t.id)).toBe(true)
  })

  it('due this week ends on the company’s week end (Saturday-start weeks)', async () => {
    freeze('2026-11-20T08:00:00Z') // Friday
    const sat = await createTask(admin, { title: 'Saturday task', dueDate: '2026-11-21' })
    const fri = await createTask(admin, { title: 'Friday task', dueDate: '2026-11-20' })
    const regional = companyById('co_apex')!.regional
    regional.weekStartsOn = 6
    let ids = dueThisWeek(admin).map((t) => t.id)
    expect(ids).toContain(fri.id)
    expect(ids).not.toContain(sat.id)
    regional.weekStartsOn = 1
    ids = dueThisWeek(admin).map((t) => t.id)
    expect(ids).toContain(fri.id)
    expect(ids).toContain(sat.id)
  })

  it('task reminders say "Due today" or "Due tomorrow" by the company’s date', async () => {
    freeze('2026-11-18T22:30:00Z')
    const t = await createTask(admin, { title: 'Reminder probe', dueDate: '2026-11-19' })
    const now = new Date()
    const alert = () => alertsFor(admin, now).find((a) => a.id === `task:${t.id}`)
    expect(alert()?.body).toContain('Due today') // already the 19th in Dubai
    companyById('co_apex')!.regional.timezone = 'UTC'
    expect(alert()?.body).toContain('Due tomorrow')
    // Overdue alerts too: the 18th is overdue in Dubai at this instant.
    companyById('co_apex')!.regional.timezone = 'Asia/Dubai'
    const late = await createTask(admin, { title: 'Late probe', dueDate: '2026-11-18' })
    expect(alertsFor(admin, now).some((a) => a.id === `task-overdue:${late.id}`)).toBe(true)
    companyById('co_apex')!.regional.timezone = 'UTC'
    expect(alertsFor(admin, now).some((a) => a.id === `task-overdue:${late.id}`)).toBe(false)
  })
})

describe('Blocked needs a reason on the server', () => {
  it('moving to Blocked without a reason is a 422; with one it is stored as a comment', async () => {
    const t = await createTask(admin, { title: 'Needs docs' })
    expect(await rejects(updateTask(admin, t.id, { status: 'Blocked' }), 422)).toContain('blocked')
    await rejects(updateTask(admin, t.id, { status: 'Blocked', blockedReason: '  ' }), 422)
    await rejects(updateTask(admin, t.id, { status: 'Blocked', blockedReason: 'x'.repeat(281) }), 422)
    expect((await getTask(admin, t.id)).status).toBe('To do')

    const next = await updateTask(admin, t.id, { status: 'Blocked', blockedReason: 'Waiting for the trade licence' })
    expect(next.status).toBe('Blocked')
    expect(next.comments.at(-1)?.body).toBe('Blocked: Waiting for the trade licence')
    expect(next.history.at(-1)?.summary).toContain('Waiting for the trade licence')
    // Already Blocked: other edits need no new reason.
    expect((await updateTask(admin, t.id, { title: 'Needs the licence' })).title).toBe('Needs the licence')
    expect((await updateTask(admin, t.id, { status: 'Blocked' })).status).toBe('Blocked')
  })

  it('creating a task as Blocked needs a reason too', async () => {
    await rejects(createTask(admin, { title: 'Blocked from the start', status: 'Blocked' }), 422)
    const t = await createTask(admin, { title: 'Blocked from the start', status: 'Blocked', blockedReason: 'Waiting for the bank' })
    expect(t.comments.map((c) => c.body)).toEqual(['Blocked: Waiting for the bank'])
  })
})

describe('canEdit on every task mirrors what PATCH accepts', () => {
  it('for every visible task of every Apex role, canEdit = PATCH is allowed', async () => {
    for (const u of [admin, manager, agent, byId('u7'), byId('u8')]) {
      const list = await getTasks(u, { includeDone: true })
      for (const t of list.slice(0, 6)) {
        if (t.canEdit) expect((await updateTask(u, t.id, { title: t.title })).id).toBe(t.id)
        else await rejects(updateTask(u, t.id, { title: t.title }), 403)
      }
    }
  })

  it('a view-only role sees tasks with canEdit false and gets a role message', async () => {
    const saved = PERMISSION_MATRIX['Sales Agent'].tasks
    PERMISSION_MATRIX['Sales Agent'].tasks = 'view'
    try {
      const list = await getTasks(agent, { includeDone: true })
      expect(list.length).toBeGreaterThan(0)
      expect(list.every((t) => t.canEdit === false)).toBe(true)
      expect(await rejects(updateTask(agent, list[0].id, { status: 'Done' }), 403)).toContain('Your role (Sales Agent) can view tasks')
    } finally {
      PERMISSION_MATRIX['Sales Agent'].tasks = saved
    }
  })

  it('an admin can edit every task; an agent their own', async () => {
    expect((await getTasks(admin, { includeDone: true })).every((t) => t.canEdit)).toBe(true)
    const mine = await createTask(agent, { title: 'Agent task' })
    expect(mine.canEdit).toBe(true)
  })
})

describe('GET /tasks/assignable = whom create / update accept as owner', () => {
  const activeIn = (co: string) => users.filter((u) => u.companyId === co && u.active !== false)

  it('full scope: every active user of the company (and nobody else)', async () => {
    const list = await getAssignableUsers(admin)
    expect(list.map((u) => u.id).sort()).toEqual(activeIn('co_apex').map((u) => u.id).sort())
    expect(list[0].id).toBe(admin.id)
    expect(Object.keys(list[0]).sort()).toEqual(['departmentId', 'id', 'name', 'role', 'title'])
  })

  it('team scope: direct reports + headed departments and their sub-departments (the server team rule)', async () => {
    const list = (await getAssignableUsers(manager)).map((u) => u.id).sort()
    const team = new Set(companyTeamIds(manager))
    expect(list).toEqual(activeIn('co_apex').filter((u) => team.has(u.id)).map((u) => u.id).sort())
    // Every listed person is accepted, everyone else refused.
    for (const id of list.slice(0, 4)) expect((await createTask(manager, { title: `For ${id}`, ownerId: id })).ownerId).toBe(id)
    const outsider = activeIn('co_apex').find((u) => !team.has(u.id))!
    await rejects(createTask(manager, { title: 'Outside', ownerId: outsider.id }), 403)
  })

  it('own scope: only themselves; hidden: 403; never another company', async () => {
    expect((await getAssignableUsers(agent)).map((u) => u.id)).toEqual([agent.id])
    expect((await getAssignableUsers(crestAdmin)).every((u) => byId(u.id).companyId === 'co_crest')).toBe(true)
    const saved = PERMISSION_MATRIX.Employee.tasks
    PERMISSION_MATRIX.Employee.tasks = 'hidden'
    try {
      const employee = users.find((u) => u.companyId === 'co_apex' && u.role === 'Employee' && u.active)!
      await rejects(getAssignableUsers(employee), 403)
    } finally {
      PERMISSION_MATRIX.Employee.tasks = saved
    }
  })
})

describe('link chips are only links when the viewer could open the record', () => {
  it('an agent’s task linked to a colleague’s lead / customer: chip shown, not available', async () => {
    const lead = leads.find((l) => l.companyId === 'co_apex' && l.ownerId === colleague.id)!
    const customer = customers.find((c) => c.companyId === 'co_apex' && c.ownerId !== agent.id)!
    const onLead = await createTask(admin, { title: 'Lead probe', ownerId: agent.id, link: { type: 'lead', id: lead.id } })
    const onCustomer = await createTask(admin, { title: 'Customer probe', ownerId: agent.id, link: { type: 'customer', id: customer.id } })

    const asAgent = await getTask(agent, onLead.id)
    expect(asAgent.linkView).toMatchObject({ type: 'lead', id: lead.id, label: lead.company, available: false })
    expect((await getTask(agent, onCustomer.id)).linkView).toMatchObject({ type: 'customer', available: false })
    // The admin (sales full) can open both.
    expect((await getTask(admin, onLead.id)).linkView?.available).toBe(true)
    expect((await getTask(admin, onCustomer.id)).linkView?.available).toBe(true)
  })

  it('the agent’s own lead stays a link', async () => {
    const lead = leads.find((l) => l.companyId === 'co_apex' && l.ownerId === agent.id)!
    const t = await createTask(agent, { title: 'Own lead probe', link: { type: 'lead', id: lead.id } })
    expect(t.linkView?.available).toBe(true)
  })

  it('a project chip follows the projects scope', async () => {
    const t = tasks.find((x) => x.companyId === 'co_apex' && x.link?.type === 'project')!
    expect((await getTask(admin, t.id)).linkView?.available).toBe(true)
  })
})
