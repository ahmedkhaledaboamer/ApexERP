import { describe, expect, it } from 'vitest'
import { customers, users } from '@/shared/mocks/db'
import { projectTemplateFor } from '@/shared/mocks/data/services'
import { projects, tasks } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { projectProgress, tasksForProject } from '@/shared/mocks/selectors/tasks'
import { createProject, getProject, listProjects, updateProject } from '@/shared/mocks/services/projects'
import type { ProjectCreateBody } from '@/shared/mocks/services/projects'

const byId = (id: string) => users.find((u) => u.id === id)!
const admin = byId('u1') // Company Admin: full
const management = byId('u2') // Management: full
const salesManager = byId('u3') // Sales Manager: team (sales department)
const agent = byId('u4') // Sales Agent: own
const deliveryHead = byId('u10') // Department Head: team (delivery)
const developer = byId('u14') // Employee: own

function body(over: Partial<ProjectCreateBody> = {}): ProjectCreateBody {
  return {
    name: 'Chatbot rollout',
    customerId: customers[0].id,
    serviceId: 'S-101',
    managerId: 'u10',
    startDate: '2026-12-07',
    endDate: '2027-01-29',
    status: 'planned',
    estimatedHours: 0,
    ...over,
  }
}

describe('Projects: scope (tasks column of the matrix)', () => {
  it('admin and management see every project', async () => {
    expect((await listProjects(admin)).length).toBe(projects.filter((p) => p.companyId === admin.companyId).length)
    expect((await listProjects(management)).length).toBe(projects.filter((p) => p.companyId === admin.companyId).length)
  })

  it('a sales agent sees only projects where they own a task; others are 403', async () => {
    const created = await createProject(admin, body({ name: 'Agent scope test', generateTasks: false }))
    expect((await listProjects(agent)).some((p) => p.id === created.id)).toBe(false)
    await expect(getProject(agent, created.id)).rejects.toMatchObject({ status: 403 })

    const t = structuredClone(tasks.find((x) => x.projectId)!)
    tasks.push({ ...t, id: 'TK-AGENT-1', ownerId: agent.id, followerIds: [], projectId: created.id, link: null })
    expect((await listProjects(agent)).some((p) => p.id === created.id)).toBe(true)
    expect((await getProject(agent, created.id)).tasks.map((x) => x.id)).toContain('TK-AGENT-1')
  })

  it('an employee sees the delivery projects they have tasks in', async () => {
    const mine = await listProjects(developer)
    expect(mine.length).toBeGreaterThan(0)
    for (const p of mine) expect(tasksForProject(p.id).some((t) => t.ownerId === developer.id || t.followerIds.includes(developer.id)) || p.managerId === developer.id).toBe(true)
  })

  it('team scope follows real department membership', async () => {
    // The delivery head manages the seeded projects; the sales manager only sees projects his team works on.
    const delivery = await listProjects(deliveryHead)
    expect(delivery.length).toBeGreaterThan(0)
    const created = await createProject(admin, body({ name: 'Team scope test', generateTasks: false }))
    expect((await listProjects(salesManager)).some((p) => p.id === created.id)).toBe(false)
    const t = structuredClone(tasks.find((x) => x.projectId)!)
    tasks.push({ ...t, id: 'TK-TEAM-1', ownerId: 'u5', followerIds: [], projectId: created.id, link: null })
    expect((await listProjects(salesManager)).some((p) => p.id === created.id)).toBe(true)
  })
})

describe('Projects: create', () => {
  it('generates tasks from the service template with due dates, linked to the project', async () => {
    const before = tasks.length
    const row = await createProject(admin, body())
    const tpl = projectTemplateFor('S-101').tasks
    const generated = tasksForProject(row.id)
    expect(generated).toHaveLength(tpl.length)
    expect(tasks.length).toBe(before + tpl.length)
    for (const t of generated) {
      expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(t.dueDate! >= '2026-12-07').toBe(true)
      expect(t.link).toBeNull()
      expect(t.projectId).toBe(row.id)
      expect(t.status).toBe('todo')
      expect(t.dayOffset).not.toBeNull()
    }
    expect(row.taskCount).toBe(tpl.length)
    expect(row.estimatedHours).toBe(tpl.reduce((s, t) => s + t.hours, 0))
    expect(row.createdFrom).toBe('manual')
    expect(auditLog[0]).toMatchObject({ entity: 'project', entityId: row.id, action: 'create' })
  })

  it('can skip the template', async () => {
    const row = await createProject(admin, body({ generateTasks: false, estimatedHours: 40 }))
    expect(row.taskCount).toBe(0)
    expect(row.estimatedHours).toBe(40)
  })

  it('validates input and role', async () => {
    await expect(createProject(admin, body({ name: '  ' }))).rejects.toMatchObject({ status: 422 })
    await expect(createProject(admin, body({ name: 'x'.repeat(161) }))).rejects.toMatchObject({ status: 422 })
    await expect(createProject(admin, body({ customerId: 'C-NOPE' }))).rejects.toMatchObject({ status: 422 })
    await expect(createProject(admin, body({ serviceId: 'S-801' }))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/inactive/) })
    await expect(createProject(admin, body({ endDate: '2026-12-01' }))).rejects.toMatchObject({ status: 422 })
    await expect(createProject(admin, body({ status: 'Bogus' as never }))).rejects.toMatchObject({ status: 422 })
    await expect(createProject(agent, body())).rejects.toMatchObject({ status: 403 })
    await expect(createProject(deliveryHead, body({ generateTasks: false }))).resolves.toBeTruthy()
  })
})

describe('Projects: progress and update', () => {
  it('progress is computed from the tasks (weighted by estimated hours)', async () => {
    const row = await createProject(admin, body({ name: 'Progress test' }))
    expect(row.progress).toBe(0)
    const list = tasksForProject(row.id)
    list[0].status = 'done'
    const total = list.reduce((s, t) => s + t.estimatedHours, 0)
    const detail = await getProject(admin, row.id)
    expect(detail.progress).toBe(Math.round((list[0].estimatedHours / total) * 100))
    expect(detail.progress).toBe(projectProgress(row.id))
    expect(detail.doneCount).toBe(1)
    for (const t of list) t.status = 'done'
    expect((await getProject(admin, row.id)).progress).toBe(100)
  })

  it('Completed is blocked while tasks are open, unless forced', async () => {
    const row = await createProject(admin, body({ name: 'Completion test' }))
    await expect(updateProject(deliveryHead, row.id, { status: 'completed' })).rejects.toMatchObject({ status: 409 })
    expect(projects.find((p) => p.id === row.id)!.status).toBe('planned')
    const forced = await updateProject(deliveryHead, row.id, { status: 'completed', force: true })
    expect(forced.status).toBe('completed')
    expect(auditLog[0]).toMatchObject({ entity: 'project', entityId: row.id, changes: [{ field: 'status', from: 'Planned', to: 'Completed' }] })

    const other = await createProject(admin, body({ name: 'Completion test 2' }))
    for (const t of tasksForProject(other.id)) t.status = 'done'
    expect((await updateProject(admin, other.id, { status: 'completed' })).status).toBe('completed')
  })

  it('only managers update; end date can’t be before start', async () => {
    const row = await createProject(admin, body({ name: 'Update rules' }))
    await expect(updateProject(developer, row.id, { status: 'active' })).rejects.toMatchObject({ status: 403 })
    await expect(updateProject(admin, row.id, { endDate: '2026-11-01' })).rejects.toMatchObject({ status: 422 })
    const moved = await updateProject(admin, row.id, { managerId: 'u3', startDate: '2026-12-08' })
    expect(moved.managerName).toBe('Karim Nasser')
    expect(auditLog[0].changes.map((c) => c.field)).toEqual(['managerId', 'startDate'])
  })
})
