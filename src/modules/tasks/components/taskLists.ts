import type { TaskFilter, TaskView } from '@/modules/tasks/types'
import { compareTaskViews } from './sortTasks'

/**
 * The task queries behind the Customer 360 Tasks tab: tasks linked to the customer, to the lead it
 * was won from (its follow-ups before the win) and the tasks of its delivery projects (projects of
 * this customer or created from that lead). mergeTasks drops the duplicates (a project task linked
 * to the customer comes back from two queries).
 */
export function customerTaskFilters(
  customerId: string,
  leadId: string | null | undefined,
  projects: { id: string; customerId: string; leadId: string | null }[],
): TaskFilter[] {
  const projectIds = [...new Set(projects.filter((p) => p.customerId === customerId || (!!leadId && p.leadId === leadId)).map((p) => p.id))]
  return [
    { linkType: 'customer', linkId: customerId, includeDone: true },
    ...(leadId ? [{ linkType: 'lead' as const, linkId: leadId, includeDone: true }] : []),
    ...projectIds.map((projectId) => ({ projectId, includeDone: true })),
  ]
}

/** Several task lists as one: each task once (the latest copy wins), in the API's order. */
export function mergeTasks(lists: (TaskView[] | undefined)[]): TaskView[] {
  const map = new Map<string, TaskView>()
  for (const list of lists) for (const t of list ?? []) map.set(t.id, t)
  return [...map.values()].sort(compareTaskViews)
}
