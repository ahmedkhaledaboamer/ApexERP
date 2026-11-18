import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ListTodo } from 'lucide-react'
import type { TaskFilter, TaskLinkView } from '@/modules/tasks/types'
import { getTasks } from '@/modules/tasks/api/tasksApi'
import { taskKeys } from '@/modules/tasks/hooks/useTasks'
import { mergeTasks } from './taskLists'
import { Can } from '@/shared/components/permissions'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { QuickAddTask } from './QuickAddTask'
import { TaskGroups } from './TaskGroups'
import { useOpenTask, useTaskPermissions, useTaskStatusChange } from './useTaskActions'

interface LinkedTasksPanelProps {
  /** Record the quick add links new tasks to. */
  link: TaskLinkView
  /** Task queries to merge (e.g. the customer's own tasks + its projects' tasks). */
  filters: TaskFilter[]
  /** Hide the link chip on rows (every task links to this record). */
  hideLink?: boolean
  emptyBody: string
}

/** Tasks linked to a record (lead / customer), with quick add and the drawer (via `?task=`). */
export function LinkedTasksPanel({ link, filters, hideLink, emptyBody }: LinkedTasksPanelProps) {
  const { canView, canEdit } = useTaskPermissions()
  const openTask = useOpenTask()
  const status = useTaskStatusChange()
  const results = useQueries({
    queries: filters.map((f) => ({ queryKey: taskKeys.list(f), queryFn: () => getTasks(f), enabled: canView })),
  })

  const pending = results.some((r) => r.isPending)
  const failed = results.find((r) => r.isError)
  const tasks = useMemo(
    () => mergeTasks(results.map((r) => r.data)),
    // `results` is a new array every render; its data members are stable.
    [results.map((r) => r.dataUpdatedAt).join(',')],
  )

  if (!canView) {
    return <EmptyState icon={<ListTodo />} title="Tasks aren’t part of your role" body="Ask a Company Admin if you need access to Tasks." />
  }

  return (
    <div className="space-y-4">
      <Can module="tasks" action="create">
        <QuickAddTask link={link} placeholder={`Add a task for ${link.label} and press Enter`} />
      </Can>
      {pending ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : failed ? (
        <ErrorState message={failed.error?.message ?? 'Couldn’t load tasks.'} onRetry={() => results.forEach((r) => void r.refetch())} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={<ListTodo />} title="No tasks yet" body={emptyBody} />
      ) : (
        <TaskGroups tasks={tasks} onOpen={openTask} onStatus={status.change} canEdit={canEdit} hideLink={hideLink} />
      )}
      {status.dialog}
    </div>
  )
}
