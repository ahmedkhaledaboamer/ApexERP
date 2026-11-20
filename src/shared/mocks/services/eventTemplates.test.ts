import { describe, expect, it } from 'vitest'
import { checklistDueDate, planChecklist } from '@/modules/events/lib/checklistPlan'
import { tasks } from '@/shared/mocks/data/tasks'
import { eventTemplates } from '@/shared/mocks/data/eventExtras'
import { events } from '@/shared/mocks/data/events'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Event templates + prep checklist: offsets, weekends, role resolution, idempotency, permissions. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
const crestAdmin = as('u101')

describe('checklist planning (pure)', () => {
  // 2027-03-10 is a Wednesday.
  it('due date = start ± offset; weekends move before-tasks earlier and after-tasks later', () => {
    const satSun = [0, 6]
    expect(checklistDueDate('2027-03-10', -2, satSun)).toBe('2027-03-08') // Monday
    expect(checklistDueDate('2027-03-10', -4, satSun)).toBe('2027-03-05') // Saturday → Friday
    expect(checklistDueDate('2027-03-10', 3, satSun)).toBe('2027-03-15') // Saturday → Monday
    const friSat = [5, 6]
    expect(checklistDueDate('2027-03-10', -5, friSat)).toBe('2027-03-04') // Friday → Thursday
    expect(checklistDueDate('2027-03-10', 2, friSat)).toBe('2027-03-14') // Friday → Sunday
    expect(checklistDueDate('2027-03-10', 0, satSun)).toBe('2027-03-10')
  })

  it('roles resolve among the team (fewest tasks first), else the event owner', () => {
    const plan = planChecklist(
      {
        tasks: [
          { id: 'a', title: 'A', offsetDays: -3, role: 'Sales Agent', priority: 'high' },
          { id: 'b', title: 'B', offsetDays: -2, role: 'Sales Agent', priority: 'high' },
          { id: 'c', title: 'C', offsetDays: -1, role: 'HR Manager', priority: 'low' },
          { id: 'd', title: 'D', offsetDays: 1, role: 'owner', priority: 'low' },
        ],
      },
      { startDate: '2027-03-10', weekend: [0, 6], ownerId: 'own', team: [{ id: 'own', role: 'Marketing Manager', active: true }, { id: 's1', role: 'Sales Agent', active: true }, { id: 's2', role: 'Sales Agent', active: true }] },
    )
    expect(plan.map((p) => p.ownerId)).toEqual(['s1', 's2', 'own', 'own'])
    expect(plan[2].fallback).toBe(true)
  })
})

describe('templates API', () => {
  it('lists only the own company’s templates (2 seeded each), marketing full manages them', async () => {
    const a = await apexAdmin('GET', '/event-templates')
    expect(a.status).toBe(200)
    expect(a.body.map((t: { id: string }) => t.id).sort()).toEqual(['ETP-1001', 'ETP-1002'])
    expect(a.body[0].tasks[0]).toHaveProperty('offset_days')
    expect((await crestAdmin('GET', '/event-templates/ETP-1001')).status).toBe(404)
    // A Sales Agent (marketing hidden) can read but not manage.
    expect((await as('u4')('GET', '/event-templates')).status).toBe(200)
    expect((await as('u4')('POST', '/event-templates', { name: 'X template', event_type: 'meeting', tasks: [] })).status).toBe(403)
    const created = await apexAdmin('POST', '/event-templates', { name: 'Roadshow', event_type: 'other', default_duration_days: 2, tasks: [{ title: 'Book the van', offset_days: -5, role: 'Sales Agent', priority: 'medium' }] })
    expect(created.status).toBe(200)
    expect(created.body.tasks[0].id).toMatch(/^ETT-/)
    expect((await apexAdmin('POST', '/event-templates', { name: 'roadshow', event_type: 'other', tasks: [] })).status).toBe(409)
    expect((await apexAdmin('POST', '/event-templates', { name: 'Bad', event_type: 'other', tasks: [{ title: 'x', offset_days: 1.5 }] })).status).toBe(422)
    // Editing keeps existing task ids (idempotency of re-applying).
    const keep = created.body.tasks[0].id
    const upd = await apexAdmin('PATCH', `/event-templates/${created.body.id}`, { tasks: [{ id: keep, title: 'Book the van', offset_days: -6, role: 'Sales Agent', priority: 'high' }, { title: 'New one', offset_days: 1, role: 'owner', priority: 'low' }] })
    expect(upd.body.tasks[0].id).toBe(keep)
    expect(upd.body.tasks[1].id).not.toBe(keep)
  })
})

describe('apply a template to an event', () => {
  it('generates linked tasks with company-calendar due dates and team owners; re-applying never duplicates', async () => {
    const ev = await apexAdmin('POST', '/events', { name: 'Template expo', type: 'exhibition', start_date: '2027-03-10', team_ids: ['u4'] })
    expect(ev.status).toBe(200)
    const id = ev.body.id
    const r = await apexAdmin('POST', `/events/${id}/apply-template`, { template_id: 'ETP-1001' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ created: 6, skipped: 0 })
    const mine = tasks.filter((t) => t.link?.type === 'event' && t.link.id === id)
    expect(mine).toHaveLength(6)
    const byTitle = (s: string) => mine.find((t) => t.title.startsWith(s))!
    // -60 → 2027-01-09 (Saturday) → Friday 2027-01-08; owner = event owner (the creator u1).
    expect(byTitle('Book the stand')).toMatchObject({ dueDate: '2027-01-08', ownerId: 'u1', templateTaskId: 'ETP-1001-T1' })
    // Sales Agent role → u4 on the team; Marketing Manager role → nobody on the team → the owner.
    expect(byTitle('Schedule meetings').ownerId).toBe('u4')
    expect(byTitle('Order banners').ownerId).toBe('u1')
    // +1 → Thursday 2027-03-11.
    expect(byTitle('Import the badge').dueDate).toBe('2027-03-11')
    const again = await apexAdmin('POST', `/events/${id}/apply-template`, { template_id: 'ETP-1001' })
    expect(again.body).toMatchObject({ created: 0, skipped: 6 })
    expect(tasks.filter((t) => t.link?.type === 'event' && t.link.id === id)).toHaveLength(6)
    expect(again.body.checklist).toMatchObject({ total: 6, done: 0, applied_template_ids: ['ETP-1001'] })
  })

  it('optional on create; checklist progress follows the tasks; Crest uses its own weekend', async () => {
    const ev = await crestAdmin('POST', '/events', { name: 'Crest panel', type: 'conference', start_date: '2027-03-10', template_id: 'ETP-5002' })
    expect(ev.status).toBe(200)
    const list = await crestAdmin('GET', `/events/${ev.body.id}/checklist`)
    expect(list.body.total).toBe(3)
    // -21 → 2027-02-17 (Wednesday); +1 → Thursday 2027-03-11 (Crest weekend Fri–Sat).
    expect(list.body.items.map((i: { due_date: string }) => i.due_date)).toEqual(['2027-02-17', '2027-03-03', '2027-03-11'])
    const t = tasks.find((x) => x.id === list.body.items[0].task_id)!
    t.status = 'done'
    expect((await crestAdmin('GET', `/events/${ev.body.id}/checklist`)).body.done).toBe(1)
    // Another company's template id answers like a missing one.
    expect((await crestAdmin('POST', '/events', { name: 'Crest x', type: 'meeting', start_date: '2027-03-10', template_id: 'ETP-1001' })).status).toBe(422)
    expect((await crestAdmin('POST', `/events/${ev.body.id}/apply-template`, { template_id: 'ETP-1001' })).status).toBe(422)
  })

  it('applying needs the manage right (owner or marketing full); a team member can’t', async () => {
    // EV-1003: owner u3; u6 is on the team.
    expect((await as('u6')('POST', '/events/EV-1003/apply-template', { template_id: 'ETP-1002' })).status).toBe(403)
    const r = await as('u3')('POST', '/events/EV-1003/apply-template', { template_id: 'ETP-1002' })
    expect(r.status).toBe(200)
    // The seed already applied ETP-1002 to EV-1003: idempotent.
    expect(r.body.created).toBe(0)
    expect(r.body.checklist.done).toBe(2)
  })

  it('seed: 2 templates per company, one checklist per company', () => {
    expect(eventTemplates.filter((t) => t.companyId === 'co_apex')).toHaveLength(2)
    expect(eventTemplates.filter((t) => t.companyId === 'co_crest')).toHaveLength(2)
    for (const id of ['EV-1003', 'EV-5002']) {
      const e = events.find((x) => x.id === id)!
      expect(tasks.filter((t) => t.companyId === e.companyId && t.link?.type === 'event' && t.link.id === id && t.templateTaskId).length).toBeGreaterThan(0)
    }
  })
})
