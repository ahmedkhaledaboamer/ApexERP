import { users } from '@/shared/mocks/db'
import { automationRulesFor } from '@/shared/mocks/data/lookups'
import { pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { companyDayOf, userInCompany } from '@/shared/mocks/selectors/company'
import { isOpen, subjectOf } from '@/shared/mocks/selectors/tasks'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'

/**
 * Task reminders as STORED notifications (database alignment, part B), sent once per task:
 *
 *   task-due      to the owner, N days before the due date (N = Settings › Automation
 *                 taskReminderDaysBefore; due − N ≤ today ≤ due), marks tasks.reminder_sent_at
 *   task-overdue  to the owner's manager (users.manager_id, active, same company) from the first
 *                 day after the due date, marks tasks.overdue_notified_at (also set when the owner
 *                 has no manager, so the task is never re-checked)
 *
 * Days are the company's calendar (regional timezone, at the mock clock). Changing the due date
 * clears both marks (services/tasks.ts updateTask), so the reminder and the notice are re-armed.
 * Done and cancelled tasks never get either.
 *
 * Runs lazily per company, like billing's runLifecycle: GET /alerts, GET /tasks and GET /tasks/:id
 * call it for the caller's company before answering. A real backend runs it from the scheduler.
 */

const taskLink = (id: string) => `/tasks/my?task=${encodeURIComponent(id)}`
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export interface ReminderTick {
  reminders: number
  overdue: number
}

export function runTaskReminders(companyId: string, at: Date = clockNow()): ReminderTick {
  const day = companyDayOf(companyId, at)
  const before = Math.max(0, automationRulesFor(companyId).taskReminderDaysBefore)
  const stamp = at.toISOString()
  const out: ReminderTick = { reminders: 0, overdue: 0 }

  for (const t of tasks) {
    if (t.companyId !== companyId || !t.dueDate || !isOpen(t)) continue
    const left = daysBetweenIso(day.today, t.dueDate)
    const subject = subjectOf(t)

    if (!t.reminderSentAt && left >= 0 && left <= before) {
      const owner = userInCompany(companyId, t.ownerId)
      if (owner && owner.active !== false) {
        pushNotification({
          companyId,
          userId: owner.id,
          type: 'task-due',
          title: t.title,
          body: (subject ? `${subject} · ` : '') + (left === 0 ? 'Due today' : left === 1 ? 'Due tomorrow' : `Due in ${plural(left, 'day')}`),
          link: taskLink(t.id),
          taskId: t.id,
          at: stamp,
        })
        out.reminders++
      }
      t.reminderSentAt = stamp
    }

    if (!t.overdueNotifiedAt && left < 0) {
      const owner = userInCompany(companyId, t.ownerId)
      const manager = owner?.managerId ? users.find((u) => u.id === owner.managerId && u.companyId === companyId && u.active !== false) : undefined
      if (manager && manager.id !== t.ownerId) {
        pushNotification({
          companyId,
          userId: manager.id,
          type: 'task-overdue',
          title: t.title,
          body: [owner?.name ?? 'Unknown', `${plural(-left, 'day')} overdue`, subject].filter(Boolean).join(' · '),
          link: `/tasks/list?task=${encodeURIComponent(t.id)}`,
          taskId: t.id,
          at: stamp,
        })
        out.overdue++
      }
      t.overdueNotifiedAt = stamp
    }
  }
  return out
}
