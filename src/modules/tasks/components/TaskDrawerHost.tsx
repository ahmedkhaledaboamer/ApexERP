import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCurrentUser } from '@/store/hooks'
import { can } from '@/shared/lib/permissions'
import { TaskDrawer } from './TaskDrawer'

/**
 * Opens the task drawer for `?task=<id>` on any page, so links like `/leads/L-1?task=TK-1001`
 * and notifications work everywhere. Mounted once in the app layout.
 */
export function TaskDrawerHost() {
  const user = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const taskId = params.get('task')
  const close = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('task')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  if (!user || !can(user.role, 'tasks', 'view') || !taskId) return null
  return <TaskDrawer taskId={taskId} onClose={close} />
}
