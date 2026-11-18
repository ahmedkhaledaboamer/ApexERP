import { NavLink } from 'react-router-dom'
import { CalendarDays, List, ListTodo, SquareKanban } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { cn } from '@/shared/lib/utils'

const VIEWS = [
  { to: PATHS.myTasks, label: 'My tasks', icon: ListTodo },
  { to: PATHS.taskBoard, label: 'Board', icon: SquareKanban },
  { to: PATHS.taskList, label: 'List', icon: List },
  { to: PATHS.taskCalendar, label: 'Calendar', icon: CalendarDays },
] as const

/** Switch between the task views. */
export function TaskViewSwitch({ className }: { className?: string }) {
  return (
    <nav aria-label="Task views" className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-sunken p-0.5', className)}>
      {VIEWS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
              isActive ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink',
            )
          }
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
