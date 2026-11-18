import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TaskStatus, TaskView } from '@/modules/tasks/types'
import { useAssignableUsersQuery, useMoveTask } from '@/modules/tasks/hooks/useTasks'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { can, scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { useReadOnly, useReadOnlyHint } from '@/shared/lib/readOnly'
import { useToast } from '@/shared/components/ui/Toast'
import { BlockedReasonModal } from './BlockedReasonModal'
import { taskEditBlock } from './taskMeta'

export { NOT_YOUR_TASK, taskEditBlock } from './taskMeta'

/** Opens the task drawer for any page by setting `?task=<id>` (TaskDrawerHost reads it). */
export function useOpenTask() {
  const [, setParams] = useSearchParams()
  return useCallback(
    (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('task', id)
          return next
        },
        { replace: false },
      ),
    [setParams],
  )
}

/** The signed-in user's task permissions (UI hints; the API enforces the same rules). */
export function useTaskPermissions() {
  const user = useCurrentUser()
  // Read-only workspace (Suspended / Cancelled, read-only support session): no creating, editing, dragging or commenting.
  const readOnly = useReadOnly()
  const readOnlyHint = useReadOnlyHint()
  return useMemo(() => {
    const scope = user ? scopeOf(user.role, 'tasks') : 'hidden'
    const roleCanEdit = !!user && can(user.role, 'tasks', 'edit')
    const ctx = { readOnly, readOnlyHint, roleCanEdit, role: user?.role }
    return {
      user,
      scope,
      readOnly,
      canView: !!user && can(user.role, 'tasks', 'view'),
      canCreate: !readOnly && !!user && can(user.role, 'tasks', 'create'),
      /** Page level: the role may edit tasks and the workspace is writable (each task also has `canEdit`). */
      canEdit: !readOnly && roleCanEdit,
      /** Page-level reason nothing can be moved (null = moves are possible, task by task). */
      blockReason: taskEditBlock(ctx),
      /** Why this task can't be changed (null = it can). */
      editBlock: (task: Pick<TaskView, 'canEdit'>) => taskEditBlock(ctx, task),
    }
  }, [user, readOnly, readOnlyHint])
}

export interface AssignableOption {
  id: string
  name: string
  active?: boolean
}

/**
 * People the caller may assign tasks to: exactly the server's rule (GET /tasks/assignable: Own →
 * themselves; Team → direct reports, headed departments and their sub-departments; Full → everyone
 * active). `keepIds` (e.g. the current owner) are added from the users list so a select can still
 * show them.
 */
export function useAssignableUsers(keepIds: string[] = []) {
  const { user } = useTaskPermissions()
  const assignable = useAssignableUsersQuery(!!user)
  const usersQuery = useUsersQuery()
  const keep = keepIds.join(',')
  const users = useMemo<AssignableOption[]>(() => {
    const out: AssignableOption[] = (assignable.data ?? []).map((u) => ({ id: u.id, name: u.name, active: true }))
    for (const id of keep.split(',').filter(Boolean)) {
      if (out.some((u) => u.id === id)) continue
      const u = (usersQuery.data ?? []).find((x) => x.id === id)
      if (u) out.push({ id: u.id, name: u.name, active: u.active })
    }
    return out.sort((a, b) => (a.id === user?.id ? -1 : b.id === user?.id ? 1 : a.name.localeCompare(b.name)))
  }, [assignable.data, usersQuery.data, user, keep])
  return { users, loading: assignable.isPending, error: assignable.error }
}

/** Active users (followers, mentions, filters). */
export function useActiveUsers() {
  const usersQuery = useUsersQuery()
  const users = useMemo(
    () => ((usersQuery.data ?? [])).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [usersQuery.data],
  )
  return { users, all: (usersQuery.data ?? []), loading: usersQuery.isPending }
}

/**
 * Status change with the board rule: moving to Blocked asks for a short reason, sent with the
 * change (`blockedReason`; the server posts it as a comment and refuses Blocked without one).
 * Optimistic: every cached list shows the new status at once and goes back if the server refuses
 * (useMoveTask); the toast carries the server's message. Render `dialog` once in the page.
 * A task the caller can't change is refused here with the reason (no request).
 */
export function useTaskStatusChange() {
  const toast = useToast()
  const move = useMoveTask()
  const { editBlock } = useTaskPermissions()
  const [blocking, setBlocking] = useState<TaskView | null>(null)

  const apply = useCallback(
    async (task: TaskView, status: TaskStatus, reason?: string) => {
      try {
        await move.mutateAsync({ id: task.id, status, ...(reason ? { blockedReason: reason } : {}) })
        toast.success(status === 'Done' ? 'Task done' : `Moved to ${status}`, task.title)
      } catch (e) {
        toast.error(`“${task.title}” wasn’t moved`, (e as Error).message)
      }
    },
    [toast, move.mutateAsync],
  )

  const change = useCallback(
    (task: TaskView, status: TaskStatus) => {
      if (status === task.status) return
      const refused = editBlock(task)
      if (refused) {
        toast.error(`“${task.title}” wasn’t moved`, refused)
        return
      }
      if (status === 'Blocked') setBlocking(task)
      else void apply(task, status)
    },
    [apply, editBlock, toast],
  )

  const dialog = (
    <BlockedReasonModal
      open={!!blocking}
      taskTitle={blocking?.title ?? ''}
      onClose={() => setBlocking(null)}
      onConfirm={(reason) => {
        const t = blocking
        setBlocking(null)
        if (t) void apply(t, 'Blocked', reason)
      }}
    />
  )

  return { change, dialog, pending: move.isPending }
}
