import { Link, useLocation } from 'react-router-dom'
import { CalendarRange, CalendarX, CheckSquare, ListTodo } from 'lucide-react'
import type { DashboardSummary } from '@/shared/types'
import { PATHS } from '@/app/paths'
import { cn, fmtDate } from '@/shared/lib/utils'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { currentDay } from '@/modules/tasks/components/taskMeta'
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from '@/modules/tasks/enums'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'

type TaskFigures = DashboardSummary['tasks']
type NextTask = TaskFigures['next'][number]

const PRIORITY_TONE: Record<NextTask['priority'], string> = {
  low: 'text-muted',
  medium: 'text-accent-700 dark:text-accent-300',
  high: 'text-warning-700 dark:text-warning-500',
  urgent: 'text-danger-600 dark:text-danger-500',
}

/** Current URL with `?task=<id>` set: opens the global task drawer over the dashboard. */
function useTaskHref() {
  const { pathname, search } = useLocation()
  return (id: string) => {
    const q = new URLSearchParams(search)
    q.set('task', id)
    return `${pathname}?${q.toString()}`
  }
}

function dueLabel(t: NextTask): { text: string; tone: string } {
  if (!t.dueDate) return { text: 'No due date', tone: 'text-subtle' }
  // Days from the company's today (regional timezone), like the API's overdue flag.
  const days = daysBetweenIso(currentDay().today, t.dueDate)
  if (days < 0) return { text: `${-days}d overdue`, tone: 'font-medium text-danger-600 dark:text-danger-500' }
  if (days === 0) return { text: 'Today', tone: 'font-medium text-warning-700 dark:text-warning-500' }
  if (days === 1) return { text: 'Tomorrow', tone: 'text-ink-2' }
  return { text: fmtDate(t.dueDate, 'd MMM'), tone: 'text-ink-2' }
}

const TEAM_LABEL: Record<TaskFigures['scope'], string> = {
  full: 'Overdue tasks · company',
  team: 'Overdue tasks · team',
  own: 'Overdue tasks',
  hidden: 'Overdue tasks',
}

/** Stat tiles: overdue tasks (scope) and my tasks due this week. */
export function TaskStats({ data }: { data: TaskFigures }) {
  const overdue = data.scope === 'own' ? data.myOverdueTasks : data.teamOverdueTasks
  return (
    <>
      <StatCard
        label={TEAM_LABEL[data.scope]}
        icon={<CalendarX />}
        value={overdue}
        alert={overdue > 0}
        hint={overdue > 0 ? 'Owners and their managers are alerted' : 'Nothing overdue'}
        to={data.scope === 'own' ? PATHS.myTasks : PATHS.taskList}
      />
      <StatCard
        label="Due this week"
        icon={<CalendarRange />}
        value={data.dueThisWeek}
        hint={`${data.myOpenTasks} open ${data.myOpenTasks === 1 ? 'task' : 'tasks'} in total`}
        to={PATHS.myTasks}
      />
    </>
  )
}

/** "My tasks": counts plus my next five open tasks; each opens the task drawer. */
export function MyTasksCard({ data }: { data: TaskFigures }) {
  const href = useTaskHref()
  const counts: [string, number, boolean][] = [
    ['Open', data.myOpenTasks, false],
    ['Overdue', data.myOverdueTasks, data.myOverdueTasks > 0],
    ['This week', data.dueThisWeek, false],
  ]
  return (
    <Card className="p-1">
      <CardHeader
        className="px-5 pt-5"
        icon={<CheckSquare />}
        title={<span className="text-[1.0625rem]">My tasks</span>}
        description={<span className="text-[0.8125rem]">Tasks you own or follow</span>}
        action={
          <Link to={PATHS.myTasks} className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
            View all
          </Link>
        }
      />
      <div className="grid grid-cols-3 gap-2 px-5 pb-3 text-center">
        {counts.map(([label, value, alert]) => (
          <div key={label} className="rounded-lg bg-sunken/70 px-2 py-2.5">
            <p className="text-xs text-muted">{label}</p>
            <p className={cn('num mt-0.5 text-[0.9375rem] font-semibold', alert && 'text-danger-600 dark:text-danger-500')}>{value}</p>
          </div>
        ))}
      </div>
      {data.next.length === 0 ? (
        <EmptyState icon={<ListTodo aria-hidden />} title="No open tasks" body="New tasks assigned to you will show up here." className="py-8" />
      ) : (
        <ul className="divide-y divide-line px-1 pb-1" aria-label="Next tasks">
          {data.next.map((t) => {
            const due = dueLabel(t)
            return (
              <li key={t.id}>
                <Link to={href(t.id)} className="flex min-h-14 items-center gap-3 rounded-lg px-4 py-2 text-[0.875rem] hover:bg-hover/70">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      <span className={PRIORITY_TONE[t.priority]}>{TASK_PRIORITY_LABEL[t.priority]}</span>
                      {' · '}
                      {TASK_STATUS_LABEL[t.status]}
                      {t.blocked && ' · Blocked'}
                      {t.linkLabel && ` · ${t.linkLabel}`}
                    </span>
                  </span>
                  <span className={cn('num shrink-0 text-end text-[0.8125rem]', due.tone)}>{due.text}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
