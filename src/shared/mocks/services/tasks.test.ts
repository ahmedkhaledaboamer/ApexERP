import { describe, expect, it } from 'vitest'
import { customers, leads, users } from '@/shared/mocks/db'
import { notifications, tasks } from '@/shared/mocks/data/tasks'
import { ApiError } from '@/shared/lib/apiError'
import {
  addAttachment,
  addComment,
  compareTasks,
  createTask,
  getTask,
  getTasks,
  parseMentions,
  removeAttachment,
  updateTask,
} from '@/shared/mocks/services/tasks'

const byId = (id: string) => users.find((u) => u.id === id)!
const admin = byId('u1') // Company Admin: full
const manager = byId('u3') // Sales Manager, heads d-sales: team
const agent = byId('u4') // Sales Agent: own
const otherAgent = byId('u5')
const hassan = byId('u12') // Sales Agent in d-sales, but reports to u10 (department membership only)
const delivery = byId('u14') // Employee in d-delivery
const inactive = users.find((u) => u.active === false)!

async function rejects(p: Promise<unknown>, status: number) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(status)
    return (e as ApiError).message
  }
  throw new Error(`expected a ${status} error`)
}

describe('Tasks scope', () => {
  it('an agent sees only tasks they own, follow or created', async () => {
    const list = await getTasks(agent, { includeDone: true })
    expect(list.length).toBeGreaterThan(0)
    for (const t of list) {
      expect(t.ownerId === agent.id || t.followerIds.includes(agent.id) || t.createdBy === agent.id).toBe(true)
    }
  })

  it('an agent can’t open a colleague’s task', async () => {
    const theirs = tasks.find((t) => t.ownerId === otherAgent.id && !t.followerIds.includes(agent.id) && t.createdBy !== agent.id)!
    await rejects(getTask(agent, theirs.id), 404)
  })

  it('a Sales Manager sees the team by department membership, not only direct reports', async () => {
    const mine = await createTask(admin, { title: 'Partner deck refresh', ownerId: hassan.id })
    const list = await getTasks(manager, { includeDone: true })
    const owners = new Set(list.map((t) => t.ownerId))
    expect(list.some((t) => t.id === mine.id)).toBe(true)
    // Delivery staff are outside the sales department.
    const deliveryOnly = list.filter((t) => t.ownerId === delivery.id && !t.followerIds.includes(manager.id) && t.createdBy !== manager.id)
    expect(deliveryOnly).toHaveLength(0)
    expect(owners.has(agent.id)).toBe(true)
  })

  it('an admin sees everything; Done only with includeDone', async () => {
    const open = await getTasks(admin)
    const all = await getTasks(admin, { includeDone: true })
    expect(all).toHaveLength(tasks.filter((t) => t.companyId === admin.companyId).length)
    expect(open.every((t) => t.status !== 'Done')).toBe(true)
    expect(open.length).toBeLessThan(all.length)
  })

  it('filters by link and sorts by due date (no date last) then priority', async () => {
    const lead = leads.find((l) => tasks.some((t) => t.link?.type === 'lead' && t.link.id === l.id))!
    const list = await getTasks(admin, { linkType: 'lead', linkId: lead.id, includeDone: true })
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((t) => t.link?.id === lead.id)).toBe(true)
    const all = await getTasks(admin, { includeDone: true })
    for (let i = 1; i < all.length; i++) expect(compareTasks(all[i - 1], all[i])).toBeLessThanOrEqual(0)
    const firstNull = all.findIndex((t) => !t.dueDate)
    if (firstNull >= 0) expect(all.slice(firstNull).every((t) => !t.dueDate)).toBe(true)
  })
})

describe('Create validation', () => {
  it('requires a title of at most 160 characters', async () => {
    await rejects(createTask(agent, { title: '   ' }), 422)
    await rejects(createTask(agent, { title: 'x'.repeat(161) }), 422)
  })

  it('defaults the owner to the caller and records a created event', async () => {
    const t = await createTask(agent, { title: 'Call back about the proposal', dueDate: '2026-12-01' })
    expect(t.ownerId).toBe(agent.id)
    expect(t.status).toBe('To do')
    expect(t.priority).toBe('Medium')
    expect(t.history[0].kind).toBe('created')
  })

  it('agents may only assign to themselves; managers within their team', async () => {
    await rejects(createTask(agent, { title: 'Hand off', ownerId: otherAgent.id }), 403)
    const ok = await createTask(manager, { title: 'Review the pitch', ownerId: hassan.id })
    expect(ok.ownerId).toBe(hassan.id)
    await rejects(createTask(manager, { title: 'Out of team', ownerId: delivery.id }), 403)
    await rejects(createTask(admin, { title: 'Inactive owner', ownerId: inactive.id }), 422)
  })

  it('validates enums, the due date and the link target', async () => {
    await rejects(createTask(agent, { title: 'Bad priority', priority: 'Huge' as never }), 422)
    await rejects(createTask(agent, { title: 'Bad status', status: 'Later' as never }), 422)
    await rejects(createTask(agent, { title: 'Bad date', dueDate: '31/12/2026' }), 422)
    await rejects(createTask(agent, { title: 'Ghost lead', link: { type: 'lead', id: 'L-NOPE' } }), 422)
    const c = await createTask(admin, { title: 'QBR prep', link: { type: 'customer', id: customers[0].id } })
    expect(c.linkView).toMatchObject({ type: 'customer', available: true })
    const ev = await createTask(admin, { title: 'Booth setup', link: { type: 'event', id: 'EV-1' } })
    expect(ev.linkView?.available).toBe(false)
  })

  it('notifies the owner when someone else assigns the task', async () => {
    const before = notifications.length
    const t = await createTask(manager, { title: 'Prepare quote', ownerId: agent.id })
    expect(notifications.length).toBe(before + 1)
    expect(notifications[0]).toMatchObject({ userId: agent.id, type: 'assignment' })
    expect(notifications[0].link).toContain(t.id)
  })
})

describe('Update history', () => {
  it('records one event per changed field and sets completedAt on Done', async () => {
    const t = await createTask(agent, { title: 'Send brochure', priority: 'Low' })
    const u = await updateTask(agent, t.id, { status: 'In progress', priority: 'High', dueDate: '2026-12-10', loggedHours: 2 })
    const summaries = u.history.map((h) => h.summary)
    expect(summaries).toContain('Status: To do → In progress')
    expect(summaries).toContain('Priority: Low → High')
    expect(summaries).toContain('Due: no date → 2026-12-10')
    expect(summaries).toContain('Logged: 0 h → 2 h')
    expect(u.completedAt).toBeNull()
    const done = await updateTask(agent, t.id, { status: 'Done' })
    expect(done.completedAt).not.toBeNull()
    const reopened = await updateTask(agent, t.id, { status: 'To do' })
    expect(reopened.completedAt).toBeNull()
  })

  it('unchanged fields add no events', async () => {
    const t = await createTask(agent, { title: 'Same same' })
    const u = await updateTask(agent, t.id, { title: 'Same same', priority: 'Medium' })
    expect(u.history).toHaveLength(1)
  })

  it('only owner, creator, followers or scope over the owner may edit', async () => {
    const t = await createTask(admin, { title: 'Agent-owned', ownerId: agent.id })
    await rejects(updateTask(otherAgent, t.id, { status: 'Done' }), 404) // not even visible
    const followed = await createTask(admin, { title: 'Followed', ownerId: agent.id, followerIds: [otherAgent.id] })
    const u = await updateTask(otherAgent, followed.id, { status: 'In progress' })
    expect(u.status).toBe('In progress')
    const m = await updateTask(manager, t.id, { priority: 'Urgent' })
    expect(m.priority).toBe('Urgent')
  })

  it('reassigning notifies the new owner', async () => {
    const t = await createTask(manager, { title: 'Reassign me' })
    await updateTask(manager, t.id, { ownerId: agent.id })
    expect(notifications[0]).toMatchObject({ userId: agent.id, type: 'assignment' })
    const after = await getTask(admin, t.id)
    expect(after.history.at(-1)?.summary).toBe(`Owner: ${manager.name} → ${agent.name}`)
  })
})

describe('Comments and @mentions', () => {
  it('parses @Full Name and unique @First names', () => {
    expect(parseMentions(`Ping @${manager.name} and @Priya please`)).toEqual(expect.arrayContaining([manager.id, 'u6']))
    // Two active "Omar"s: a bare @Omar is ambiguous and ignored, full names resolve.
    expect(parseMentions('@Omar can you check')).toEqual([])
    expect(parseMentions('@Omar Siddiqui can you check')).toEqual(['u16'])
  })

  it('stores mentions and notifies mentioned users (not the author)', async () => {
    const t = await createTask(agent, { title: 'Need a second opinion' })
    const before = notifications.length
    const u = await addComment(agent, t.id, { body: `@${manager.name} can you review? cc @${agent.name}` })
    const c = u.comments.at(-1)!
    expect(c.mentions).toEqual(expect.arrayContaining([manager.id, agent.id]))
    expect(notifications.length).toBe(before + 1)
    expect(notifications[0]).toMatchObject({ userId: manager.id, type: 'mention' })
    expect(u.history.at(-1)?.kind).toBe('comment')
  })

  it('rejects empty and over-long comments', async () => {
    const t = await createTask(agent, { title: 'Quiet task' })
    await rejects(addComment(agent, t.id, { body: '  ' }), 422)
    await rejects(addComment(agent, t.id, { body: 'x'.repeat(2001) }), 422)
  })
})

describe('Attachments (mocked)', () => {
  it('adds and removes metadata with history, max 25 MB', async () => {
    const t = await createTask(agent, { title: 'Collect docs' })
    const a = await addAttachment(agent, t.id, { name: 'trade-licence.pdf', size: 120_000, type: 'application/pdf' })
    expect(a.attachments).toHaveLength(1)
    expect(a.history.at(-1)?.summary).toBe('Attached trade-licence.pdf')
    await rejects(addAttachment(agent, t.id, { name: 'huge.zip', size: 26 * 1024 * 1024, type: 'application/zip' }), 422)
    const r = await removeAttachment(agent, t.id, a.attachments[0].id)
    expect(r.attachments).toHaveLength(0)
    expect(r.history.at(-1)?.summary).toBe('Removed trade-licence.pdf')
  })
})
