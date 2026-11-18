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
} from '@/modules/tasks/types'

const enc = encodeURIComponent

/** Tasks the caller can see (tasks scope), filtered. Done tasks only with `includeDone`. */
export async function getTasks(filter: TaskFilter = {}): Promise<TaskView[]> {
  return (await http.get<TaskView[]>('/tasks', { params: filter })).data
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
  return (await http.get<AssignableUser[]>('/tasks/assignable')).data
}

export async function getTask(id: string): Promise<TaskView> {
  return (await http.get<TaskView>(`/tasks/${enc(id)}`)).data
}

export async function createTask(input: TaskInput): Promise<TaskView> {
  return (await http.post<TaskView>('/tasks', input)).data
}

export async function updateTask(id: string, input: TaskUpdateInput): Promise<TaskView> {
  return (await http.patch<TaskView>(`/tasks/${enc(id)}`, input)).data
}

/** Comment with @mentions (user ids parsed from the body by the server, or sent explicitly). */
export async function addTaskComment(id: string, input: { body: string; mentions?: string[] }): Promise<TaskView> {
  return (await http.post<TaskView>(`/tasks/${enc(id)}/comments`, input)).data
}

/** Mocked upload: only the file's metadata is stored. */
export async function addTaskAttachment(id: string, file: Pick<TaskAttachment, 'name' | 'size' | 'type'>): Promise<TaskView> {
  return (await http.post<TaskView>(`/tasks/${enc(id)}/attachments`, file)).data
}

export async function removeTaskAttachment(id: string, attachmentId: string): Promise<TaskView> {
  return (await http.delete<TaskView>(`/tasks/${enc(id)}/attachments/${enc(attachmentId)}`)).data
}

/* ---------------- Projects ---------------- */

export async function getProjects(): Promise<ProjectRow[]> {
  return (await http.get<ProjectRow[]>('/projects')).data
}

export async function getProject(id: string): Promise<ProjectRow & { tasks: TaskView[] }> {
  return (await http.get<ProjectRow & { tasks: TaskView[] }>(`/projects/${enc(id)}`)).data
}

export async function createProject(input: ProjectInput): Promise<ProjectRow> {
  return (await http.post<ProjectRow>('/projects', input)).data
}

export async function updateProject(id: string, input: ProjectUpdateInput): Promise<ProjectRow> {
  return (await http.patch<ProjectRow>(`/projects/${enc(id)}`, input)).data
}
