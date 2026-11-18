import { http } from '@/shared/lib/axios'
import type {
  ProjectInput,
  ProjectRow,
  ProjectUpdateInput,
  TaskAttachment,
  TaskFilter,
  TaskInput,
  TaskUpdateInput,
  TaskView,
  TimeEntryInput,
} from '@/modules/tasks/types'

import { assignableUserMapper, TASK_QUERY, taskAttachmentMapper, taskCommentMapper, taskInputMapper, taskMapper, timeEntryMapper, projectDetailMapper, projectInputMapper, projectRowMapper } from '@/shared/api/mappers'

/**
 * Tasks API: the tasks / comments / attachments / time_entries columns on the wire (owner_id,
 * due_date, related_type…); every function maps both ways (shared/api/mappers.ts).
 */

const enc = encodeURIComponent

/** The filter in the API's query names. */
function filterQuery(filter: TaskFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filter)) if (v !== undefined) out[TASK_QUERY[k as keyof TaskFilter] ?? k] = v
  return out
}

/** Tasks the caller can see (tasks scope), filtered. Done tasks only with `includeDone`. */
export async function getTasks(filter: TaskFilter = {}): Promise<TaskView[]> {
  return taskMapper.fromApiList((await http.get<unknown>('/tasks', { params: filterQuery(filter) })).data)
}

/** Who the caller may pick as a task owner (the server's team rule): GET /tasks/assignable. */
export interface AssignableUser {
  id: string
  name: string
  title: string
  role: string
  departmentId: string
}

export async function getAssignableUsers(): Promise<AssignableUser[]> {
  return assignableUserMapper.fromApiList((await http.get<unknown>('/tasks/assignable')).data)
}

export async function getTask(id: string): Promise<TaskView> {
  return taskMapper.fromApi((await http.get<unknown>(`/tasks/${enc(id)}`)).data)
}

export async function createTask(input: TaskInput): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>('/tasks', taskInputMapper.toApi(input))).data)
}

export async function updateTask(id: string, input: TaskUpdateInput): Promise<TaskView> {
  return taskMapper.fromApi((await http.patch<unknown>(`/tasks/${enc(id)}`, taskInputMapper.toApi(input))).data)
}

/** Comment with @mentions (user ids parsed from the body by the server, or sent explicitly). */
export async function addTaskComment(id: string, input: { body: string; mentions?: string[] }): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>(`/tasks/${enc(id)}/comments`, taskCommentMapper.toApi(input))).data)
}

/** Blocked flag: POST /tasks/:id/block { reason } (3–280 characters). The status doesn't change. */
export async function blockTask(id: string, reason: string): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>(`/tasks/${enc(id)}/block`, { reason })).data)
}

/** Clears the blocked flag: POST /tasks/:id/unblock. */
export async function unblockTask(id: string): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>(`/tasks/${enc(id)}/unblock`, {})).data)
}

/** Mocked upload: only the file's metadata is stored (attachments.original_name, size_bytes, mime_type). */
export async function addTaskAttachment(id: string, file: Pick<TaskAttachment, 'name' | 'sizeBytes' | 'mimeType'>): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>(`/tasks/${enc(id)}/attachments`, taskAttachmentMapper.toApi(file))).data)
}

/** Logs hours on the task: POST /tasks/:id/time-entries. */
export async function addTimeEntry(id: string, input: TimeEntryInput): Promise<TaskView> {
  return taskMapper.fromApi((await http.post<unknown>(`/tasks/${enc(id)}/time-entries`, timeEntryMapper.toApi(input as never))).data)
}

export async function removeTimeEntry(id: string, entryId: string): Promise<TaskView> {
  return taskMapper.fromApi((await http.delete<unknown>(`/tasks/${enc(id)}/time-entries/${enc(entryId)}`)).data)
}

export async function removeTaskAttachment(id: string, attachmentId: string): Promise<TaskView> {
  return taskMapper.fromApi((await http.delete<unknown>(`/tasks/${enc(id)}/attachments/${enc(attachmentId)}`)).data)
}

/* ---------------- Projects ---------------- */

export async function getProjects(): Promise<ProjectRow[]> {
  return projectRowMapper.fromApiList((await http.get<unknown>('/projects')).data)
}

export async function getProject(id: string): Promise<ProjectRow & { tasks: TaskView[] }> {
  return projectDetailMapper.fromApi((await http.get<unknown>(`/projects/${enc(id)}`)).data)
}

export async function createProject(input: ProjectInput): Promise<ProjectRow> {
  return projectRowMapper.fromApi((await http.post<unknown>('/projects', projectInputMapper.toApi(input))).data)
}

export async function updateProject(id: string, input: ProjectUpdateInput): Promise<ProjectRow> {
  return projectRowMapper.fromApi((await http.patch<unknown>(`/projects/${enc(id)}`, projectInputMapper.toApi(input))).data)
}
