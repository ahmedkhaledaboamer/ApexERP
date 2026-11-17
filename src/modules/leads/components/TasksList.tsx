import { isBefore, startOfDay } from 'date-fns'
import { CheckCircle2, Circle, CircleDot, Flag } from 'lucide-react'
import type { TaskStatus } from '@/shared/types'
import { useLeadTasksQuery } from '@/modules/leads/hooks/useLeads'
import { PRIORITY_STYLES } from '@/shared/lib/constants'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  'To do': <Circle className="size-4 text-subtle" aria-label="To do" />,
  'In progress': <CircleDot className="size-4 text-accent-600" aria-label="In progress" />,
  Done: <CheckCircle2 className="size-4 text-success-600" aria-label="Done" />,
}

/** Linear-style task rows: status icon, title, priority flag, due date, owner. */
export function TasksList({ leadId }: { leadId: string }) {
  const query = useLeadTasksQuery(leadId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    )
  }
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
  if (query.data.length === 0) {
    return <EmptyState title="No tasks on this lead" body="Tasks linked to this lead, like preparing a proposal, show here." />
  }

  const today = startOfDay(new Date())
  return (
    <ul className="-mx-2">
      {query.data.map((t) => {
        const overdue = t.status !== 'Done' && isBefore(new Date(t.dueDate), today)
        return (
          <li key={t.id} className="flex h-10 items-center gap-3 rounded-md px-2 hover:bg-hover">
            {STATUS_ICON[t.status]}
            <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem]', t.status === 'Done' ? 'text-muted line-through' : 'text-ink')}>
              {t.title}
            </span>
            <Flag className={cn('size-3.5 shrink-0', PRIORITY_STYLES[t.priority])} aria-label={`${t.priority} priority`} />
            <span className={cn('num w-16 text-end text-xs whitespace-nowrap', overdue ? 'font-medium text-danger-600' : 'text-muted')}>
              {fmtDate(t.dueDate, 'd MMM')}
            </span>
            <span title={t.ownerName}>
              <Avatar name={t.ownerName} size="xs" />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
