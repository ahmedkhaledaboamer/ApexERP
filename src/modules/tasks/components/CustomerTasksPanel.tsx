import { useMemo } from 'react'
import type { TaskLinkView } from '@/modules/tasks/types'
import { useProjectsQuery } from '@/modules/tasks/hooks/useTasks'
import { LinkedTasksPanel } from './LinkedTasksPanel'
import { customerTaskFilters } from './taskLists'

/** Customer 360 Tasks tab: the customer's tasks, its original lead's tasks and its projects' tasks, once each. */
export function CustomerTasksPanel({ customerId, customerName, leadId }: { customerId: string; customerName: string; leadId?: string | null }) {
  const projects = useProjectsQuery()
  const filters = useMemo(() => customerTaskFilters(customerId, leadId, projects.data ?? []), [customerId, leadId, projects.data])
  const link = useMemo<TaskLinkView>(() => ({ type: 'customer', id: customerId, label: customerName, available: true }), [customerId, customerName])
  return (
    <LinkedTasksPanel
      link={link}
      filters={filters}
      emptyBody={
        projects.isError
          ? 'No tasks linked to this customer or its lead. Project tasks couldn’t be loaded.'
          : 'Tasks linked to this customer, the lead it was won from and its delivery projects show here.'
      }
    />
  )
}
