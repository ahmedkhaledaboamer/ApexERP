import { http, type HttpHandler } from 'msw'
import type { TaskInput, TaskUpdateInput } from '@/modules/tasks/types'
import * as svc from '@/shared/mocks/services/tasks'
import { API, respond, userFrom } from './utils'

type P = { id: string }
type PA = { id: string; attachmentId: string }

/** Task Management: list/detail, assignable owners, create, update, comments and (mocked) attachments. */
export const tasksHandlers: HttpHandler[] = [
  http.get(`${API}/tasks`, ({ request }) =>
    respond(() => svc.getTasks(userFrom(request), svc.parseTaskFilter(new URL(request.url).searchParams))),
  ),
  // Before /tasks/:id so "assignable" isn't read as a task id.
  http.get(`${API}/tasks/assignable`, ({ request }) => respond(() => svc.getAssignableUsers(userFrom(request)))),
  http.get<P>(`${API}/tasks/:id`, ({ request, params }) => respond(() => svc.getTask(userFrom(request), params.id))),
  http.post(`${API}/tasks`, async ({ request }) => {
    const body = (await request.json()) as TaskInput
    return respond(() => svc.createTask(userFrom(request), body))
  }),
  http.patch<P>(`${API}/tasks/:id`, async ({ request, params }) => {
    const body = (await request.json()) as TaskUpdateInput
    return respond(() => svc.updateTask(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/tasks/:id/comments`, async ({ request, params }) => {
    const body = (await request.json()) as { body: string; mentions?: string[] }
    return respond(() => svc.addComment(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/tasks/:id/attachments`, async ({ request, params }) => {
    const body = (await request.json()) as { name: string; size: number; type: string }
    return respond(() => svc.addAttachment(userFrom(request), params.id, body))
  }),
  http.delete<PA>(`${API}/tasks/:id/attachments/:attachmentId`, ({ request, params }) =>
    respond(() => svc.removeAttachment(userFrom(request), params.id, params.attachmentId)),
  ),
]
