import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import * as api from '@/modules/tasks/api/tasksApi'
import type { ProjectInput, ProjectUpdateInput, TaskFilter, TaskInput, TaskStatus, TaskUpdateInput, TaskView } from '@/modules/tasks/types'

export const taskKeys = {
  all: ['tasks'] as const,
  list: (filter: TaskFilter) => ['tasks', 'list', filter] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  assignable: () => ['tasks', 'assignable'] as const,
}

export const projectKeys = {
  all: ['projects'] as const,
  list: () => ['projects', 'list'] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
}

export function useTasksQuery(filter: TaskFilter = {}, enabled = true) {
  return useQuery({ queryKey: taskKeys.list(filter), queryFn: () => api.getTasks(filter), enabled })
}

/** People the caller may assign tasks to (the server's rule, GET /tasks/assignable). */
export function useAssignableUsersQuery(enabled = true) {
  return useQuery({ queryKey: taskKeys.assignable(), queryFn: api.getAssignableUsers, enabled, staleTime: 60_000 })
}

export function useTaskQuery(id: string | null) {
  return useQuery({ queryKey: taskKeys.detail(id ?? ''), queryFn: () => api.getTask(id!), enabled: !!id })
}

/** Task changes ripple into projects (progress), alerts (reminders), dashboard, reports and departments. */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    for (const key of [['tasks'], ['projects'], ['alerts'], ['dashboard'], ['reports'], ['departments'], ['leads']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}

export function useCreateTask() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: TaskInput) => api.createTask(input), onSuccess: done })
}

export function useUpdateTask() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskUpdateInput }) => api.updateTask(id, input),
    onSuccess: done,
  })
}

/** A board / calendar move: a status (Blocked needs `blockedReason`) or a due date. */
export interface TaskMove {
  id: string
  status?: TaskStatus
  dueDate?: string | null
  blockedReason?: string
}

/**
 * Moves a task (status on the board, due date on the calendar). Every cached task list and the
 * task's detail update at once; if the server refuses, the snapshots are put back so the card or
 * chip returns where it was, and the error (with the server's message) goes to the caller.
 */
export function useMoveTask() {
  const qc = useQueryClient()
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...input }: TaskMove) => api.updateTask(id, input),
    onMutate: async (move) => {
      await qc.cancelQueries({ queryKey: taskKeys.all })
      const snapshot: [QueryKey, unknown][] = qc.getQueriesData({ queryKey: taskKeys.all })
      const patch = (t: TaskView): TaskView =>
        t.id !== move.id
          ? t
          : {
              ...t,
              ...(move.status !== undefined ? { status: move.status, completedAt: move.status === 'Done' ? new Date().toISOString() : null } : {}),
              ...(move.dueDate !== undefined ? { dueDate: move.dueDate } : {}),
            }
      qc.setQueriesData({ queryKey: taskKeys.all }, (data: unknown) => {
        if (Array.isArray(data)) return (data as TaskView[]).map((t) => (t && typeof t === 'object' && 'status' in t ? patch(t) : t))
        if (data && typeof data === 'object' && 'status' in data && 'id' in data) return patch(data as TaskView)
        return data
      })
      return { snapshot }
    },
    onError: (_e, _move, context) => {
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data)
    },
    onSettled: done,
  })
}

export function useAddTaskComment(id: string) {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: { body: string; mentions?: string[] }) => api.addTaskComment(id, input), onSuccess: done })
}

export function useAddTaskAttachment(id: string) {
  const done = useInvalidate()
  return useMutation({ mutationFn: (file: { name: string; size: number; type: string }) => api.addTaskAttachment(id, file), onSuccess: done })
}

export function useRemoveTaskAttachment(id: string) {
  const done = useInvalidate()
  return useMutation({ mutationFn: (attachmentId: string) => api.removeTaskAttachment(id, attachmentId), onSuccess: done })
}

export function useProjectsQuery() {
  return useQuery({ queryKey: projectKeys.list(), queryFn: api.getProjects })
}

export function useProjectQuery(id: string) {
  return useQuery({ queryKey: projectKeys.detail(id), queryFn: () => api.getProject(id), enabled: !!id })
}

export function useCreateProject() {
  const done = useInvalidate()
  return useMutation({ mutationFn: (input: ProjectInput) => api.createProject(input), onSuccess: done })
}

export function useUpdateProject() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProjectUpdateInput }) => api.updateProject(id, input),
    onSuccess: done,
  })
}
