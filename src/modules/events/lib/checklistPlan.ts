import type { User } from '@/shared/types'
import type { EventTemplate, EventTemplateTask } from '@/modules/events/types'
import { addDaysIso, weekdayOfIso } from '@/shared/lib/companyDay'

/**
 * Pure planning of an event template's prep checklist (no stores), shared by the mock API and the seed.
 *
 *  - due date = the event's start date (company calendar) + `offsetDays`;
 *  - a due date on the company's weekend moves to a working day: tasks BEFORE the event (offset < 0)
 *    move earlier (still before the event), tasks on / after it (offset ≥ 0) move later — like the Won
 *    flow's plan (won/plan.ts) never schedules on a weekend;
 *  - owner = `owner` → the event owner; a CRM role → the event-team member with that role who got the
 *    fewest tasks so far in this plan (ties: user id); nobody with the role → the event owner.
 */

export interface PlannedChecklistTask {
  templateTaskId: string
  title: string
  dueDate: string
  ownerId: string
  priority: EventTemplateTask['priority']
  offsetDays: number
  /** The role found nobody on the team: the event owner got it. */
  fallback: boolean
}

export function isWeekendIso(iso: string, weekend: readonly number[]): boolean {
  return weekend.length < 7 && weekend.includes(weekdayOfIso(iso))
}

/** The due date of a template task (see above). */
export function checklistDueDate(startDate: string, offsetDays: number, weekend: readonly number[]): string {
  let d = addDaysIso(startDate, offsetDays)
  const step = offsetDays < 0 ? -1 : 1
  for (let i = 0; i < 7 && isWeekendIso(d, weekend); i++) d = addDaysIso(d, step)
  return d
}

export interface ChecklistContext {
  startDate: string
  weekend: readonly number[]
  ownerId: string
  /** Active members of the event team (owner included). */
  team: Pick<User, 'id' | 'role' | 'active'>[]
}

export function planChecklist(template: Pick<EventTemplate, 'tasks'>, ctx: ChecklistContext): PlannedChecklistTask[] {
  const load = new Map<string, number>()
  return template.tasks.map((t) => {
    let ownerId = ctx.ownerId
    let fallback = false
    if (t.role !== 'owner') {
      const pool = ctx.team.filter((u) => u.active !== false && u.role === t.role)
      if (pool.length) {
        ownerId = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0].id
      } else fallback = true
    }
    load.set(ownerId, (load.get(ownerId) ?? 0) + 1)
    return {
      templateTaskId: t.id,
      title: t.title,
      dueDate: checklistDueDate(ctx.startDate, t.offsetDays, ctx.weekend),
      ownerId,
      priority: t.priority,
      offsetDays: t.offsetDays,
      fallback,
    }
  })
}
