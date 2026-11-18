import { format, parseISO } from 'date-fns'
import type { Tone } from '@/shared/components/ui/Badge'
import type { TaskLinkType, TaskPriority, TaskStatus, TaskView } from '@/modules/tasks/types'
import { TASK_PRIORITY_RANK, TASK_PRIORITY_TONE, TASK_STATUS_TONE, isClosedTaskStatus } from '@/modules/tasks/enums'
import { customerPath, eventPath, leadPath, projectPath } from '@/app/paths'
import { getRegion } from '@/shared/lib/region'
import { companyDay, type CompanyDay } from '@/shared/lib/companyDay'

/** Display constants and helpers shared by the task screens. */

export const STATUS_TONE: Record<TaskStatus, Tone> = TASK_STATUS_TONE

export const PRIORITY_TONE: Record<TaskPriority, Tone> = TASK_PRIORITY_TONE

/** Chip fill by priority (calendar). */
export const PRIORITY_CHIP: Record<TaskPriority, string> = {
  urgent: 'bg-danger-50 text-danger-700 ring-danger-100 dark:bg-danger-500/15 dark:text-danger-500 dark:ring-danger-500/25',
  high: 'bg-warning-50 text-warning-700 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/25',
  medium: 'bg-accent-50 text-accent-700 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/25',
  low: 'bg-sunken text-ink-2 ring-line',
}

export const LINK_LABEL: Record<TaskLinkType | 'project', string> = {
  lead: 'Lead',
  customer: 'Customer',
  project: 'Project',
  event: 'Event',
}

export function linkHref(type: TaskLinkType | 'project', id: string): string | null {
  if (type === 'lead') return leadPath(id)
  if (type === 'customer') return customerPath(id)
  if (type === 'project') return projectPath(id)
  if (type === 'event') return eventPath(id)
  return null
}

export const ISO = 'yyyy-MM-dd'

/**
 * Today / this week for the task screens: the active company's timezone and week start (regional
 * settings), not the browser's. The server's task selectors use the same helper, so "Today" here
 * and the API's `overdue` agree.
 */
export function currentDay(now: Date = new Date()): CompanyDay {
  const r = getRegion()
  return companyDay({ timezone: r.timezone, weekStartsOn: r.weekStartsOn }, now)
}

export const todayIso = (now: Date = new Date()) => currentDay(now).today

export type DueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done'
export const DUE_GROUPS: { id: DueGroup; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
  { id: 'done', label: 'Completed' },
]

/**
 * My tasks bucket, by the company's calendar: Overdue (before today), Today, This week (to the end
 * of the company's week, from its weekStartsOn), Later, No date; done and cancelled tasks go to Completed.
 */
export function dueGroupOf(t: Pick<TaskView, 'status' | 'dueDate'>, day: CompanyDay = currentDay()): DueGroup {
  if (isClosedTaskStatus(t.status)) return 'done'
  if (!t.dueDate) return 'none'
  if (t.dueDate < day.today) return 'overdue'
  if (t.dueDate === day.today) return 'today'
  return t.dueDate <= day.weekEnd ? 'week' : 'later'
}

/** "Today", "Tomorrow", "Yesterday" (company calendar), "Mon 3 Dec", or "3 Dec 2027" for other years. */
export function dueLabel(due: string | null, day: CompanyDay = currentDay()): string {
  if (!due) return 'No date'
  if (due === day.today) return 'Today'
  if (due === day.tomorrow) return 'Tomorrow'
  if (due === day.yesterday) return 'Yesterday'
  const d = parseISO(due)
  return due.slice(0, 4) === day.today.slice(0, 4) ? format(d, 'EEE d MMM') : format(d, 'd MMM yyyy')
}

/** Why a task the caller can see can't be changed by them (server rule: TaskView.canEdit). */
export const NOT_YOUR_TASK =
  'You can view this task but not change it: only its owner, followers, creator, the project manager or their managers can.'

/**
 * Why `task` can't be changed right now, or null when it can. Order: the workspace is read-only
 * (suspended / cancelled / read-only support session, with that hint), the role has no edit right,
 * then the per-task rule from the server (`canEdit`). The same reasons show as the board / calendar
 * hint and in the toast when a drop is refused.
 */
export function taskEditBlock(
  ctx: { readOnly: boolean; readOnlyHint: string; roleCanEdit: boolean; role: string | undefined },
  task?: Pick<TaskView, 'canEdit'>,
): string | null {
  if (ctx.readOnly) return ctx.readOnlyHint
  if (!ctx.roleCanEdit) return `Your role (${ctx.role ?? 'unknown'}) can view tasks but not change them. Ask a manager or your Company Admin.`
  if (task && !task.canEdit) return NOT_YOUR_TASK
  return null
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Priority order for sorting (urgent first). */
export const PRIORITY_RANK: Record<TaskPriority, number> = TASK_PRIORITY_RANK
