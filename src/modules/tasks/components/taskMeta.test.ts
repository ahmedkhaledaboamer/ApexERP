import { afterEach, describe, expect, it } from 'vitest'
import type { TaskView } from '@/modules/tasks/types'
import { companyDay } from '@/shared/lib/companyDay'
import { DEFAULT_REGION, setRegion } from '@/shared/lib/region'
import { currentDay, dueGroupOf, dueLabel, NOT_YOUR_TASK, taskEditBlock } from './taskMeta'
import { customerTaskFilters, mergeTasks } from './taskLists'

const LATE_UTC = new Date('2026-11-18T22:30:00Z') // already Thu 19 Nov in Riyadh / Dubai
const open = (dueDate: string | null) => ({ status: 'todo' as const, dueDate })

afterEach(() => setRegion(null))

describe('My tasks groups follow the company calendar', () => {
  it('a task due on the 18th is Overdue in Riyadh but Today in UTC at 22:30 UTC', () => {
    const riyadh = companyDay({ timezone: 'Asia/Riyadh', weekStartsOn: 0 }, LATE_UTC)
    const utc = companyDay({ timezone: 'UTC', weekStartsOn: 0 }, LATE_UTC)
    expect(dueGroupOf(open('2026-11-18'), riyadh)).toBe('overdue')
    expect(dueGroupOf(open('2026-11-18'), utc)).toBe('today')
    expect(dueGroupOf(open('2026-11-19'), riyadh)).toBe('today')
    expect(dueGroupOf(open('2026-11-19'), utc)).toBe('week')
    expect(dueLabel('2026-11-19', riyadh)).toBe('Today')
    expect(dueLabel('2026-11-19', utc)).toBe('Tomorrow')
    expect(dueLabel('2026-11-18', riyadh)).toBe('Yesterday')
  })

  it('This week ends on the day before the company’s week start (Saturday-start weeks)', () => {
    const fri = new Date('2026-11-20T08:00:00Z') // Friday
    const satStart = companyDay({ timezone: 'Asia/Dubai', weekStartsOn: 6 }, fri)
    const monStart = companyDay({ timezone: 'Asia/Dubai', weekStartsOn: 1 }, fri)
    // Saturday 21st: next week for a Saturday-start company, this week for a Monday-start one.
    expect(dueGroupOf(open('2026-11-21'), satStart)).toBe('later')
    expect(dueGroupOf(open('2026-11-21'), monStart)).toBe('week')
    expect(dueGroupOf(open('2026-11-23'), monStart)).toBe('later')
  })

  it('No date and Completed', () => {
    const day = companyDay({ timezone: 'UTC', weekStartsOn: 1 }, LATE_UTC)
    expect(dueGroupOf(open(null), day)).toBe('none')
    expect(dueGroupOf({ status: 'done', dueDate: '2020-01-01' }, day)).toBe('done')
    expect(dueLabel(null, day)).toBe('No date')
    expect(dueLabel('2027-01-05', day)).toBe('5 Jan 2027')
  })

  it('currentDay reads the active tenant’s regional settings', () => {
    setRegion({ ...DEFAULT_REGION, timezone: 'Asia/Riyadh', weekStartsOn: 0 })
    expect(currentDay(LATE_UTC)).toMatchObject({ today: '2026-11-19', weekStart: '2026-11-15', weekStartsOn: 0 })
    setRegion({ ...DEFAULT_REGION, timezone: 'UTC', weekStartsOn: 6 })
    expect(currentDay(LATE_UTC)).toMatchObject({ today: '2026-11-18', weekStart: '2026-11-14', weekStartsOn: 6 })
  })
})

describe('edit refusals name the real reason', () => {
  const base = { readOnly: false, readOnlyHint: 'Workspace is read-only', roleCanEdit: true, role: 'Sales Agent' }
  it('read-only workspace first, then the role, then the task', () => {
    expect(taskEditBlock({ ...base, readOnly: true, readOnlyHint: 'Read-only support session: enable write mode to make changes' }, { canEdit: true })).toBe(
      'Read-only support session: enable write mode to make changes',
    )
    expect(taskEditBlock({ ...base, roleCanEdit: false }, { canEdit: true })).toContain('Your role (Sales Agent) can view tasks but not change them')
    expect(taskEditBlock(base, { canEdit: false })).toBe(NOT_YOUR_TASK)
    expect(taskEditBlock(base, { canEdit: true })).toBeNull()
    expect(taskEditBlock(base)).toBeNull()
  })
})

describe('Customer 360 Tasks tab queries', () => {
  const projects = [
    { id: 'PRJ-1', customerId: 'C-1', leadId: 'L-1' },
    { id: 'PRJ-2', customerId: 'C-9', leadId: 'L-1' }, // created from the same lead
    { id: 'PRJ-3', customerId: 'C-9', leadId: 'L-9' },
  ]
  it('asks for the customer’s, its original lead’s and its projects’ tasks', () => {
    expect(customerTaskFilters('C-1', 'L-1', projects)).toEqual([
      { linkType: 'customer', linkId: 'C-1', includeDone: true },
      { linkType: 'lead', linkId: 'L-1', includeDone: true },
      { projectId: 'PRJ-1', includeDone: true },
      { projectId: 'PRJ-2', includeDone: true },
    ])
    expect(customerTaskFilters('C-1', null, projects)).toEqual([
      { linkType: 'customer', linkId: 'C-1', includeDone: true },
      { projectId: 'PRJ-1', includeDone: true },
    ])
  })

  it('shows a task returned by several queries once, in the API order', () => {
    const t = (id: string, dueDate: string | null) => ({ id, dueDate, priority: 'medium' }) as TaskView
    const merged = mergeTasks([[t('A', '2026-11-20'), t('B', null)], undefined, [t('A', '2026-11-20'), t('C', '2026-11-19')]])
    expect(merged.map((x) => x.id)).toEqual(['C', 'A', 'B'])
  })
})
