import type { TaskView } from '@/modules/tasks/types'
import { PRIORITY_RANK } from './taskMeta'

/** Same order as the API: due date ascending (no date last), then priority (Urgent first). */
export function compareTaskViews(a: TaskView, b: TaskView): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}
