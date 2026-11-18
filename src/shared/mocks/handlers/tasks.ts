import { http, type HttpHandler } from 'msw'
import type { TaskInput, TaskUpdateInput, TimeEntryInput } from '@/modules/tasks/types'
import * as svc from '@/shared/mocks/services/tasks'
import { assignableUserMapper, TASK_QUERY, taskAttachmentMapper, taskCommentMapper, taskInputMapper, taskMapper, timeEntryMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

/** The query in the API's names (owner_id, related_type, include_done…) → the service's filter names. */
function filterParams(url: string): URLSearchParams {
  const q = new URL(url).searchParams
  const out = new URLSearchParams()
  for (const [ui, api] of Object.entries(TASK_QUERY)) {
    const v = q.get(api)
    if (v !== null) out.set(ui, v)
  }
  return out
}

type P = { id: string }
type PA = { id: string; attachmentId: string }
type PE = { id: string; entryId: string }

/**
 * Task Management: list/detail, assignable owners, create (incl. sub-tasks), update, block /
 * unblock, comments, (mocked) attachments and time entries. The tasks / comments / attachments /
 * time_entries columns on the wire (shared/api/mappers.ts).
 */
export const tasksHandlers: HttpHandler[] = [
  http.get(`${API}/tasks`, ({ request }) =>
    respondAs(taskMapper, () => svc.getTasks(userFrom(request), svc.parseTaskFilter(filterParams(request.url)))),
  ),
  // Before /tasks/:id so "assignable" isn't read as a task id.
  http.get(`${API}/tasks/assignable`, ({ request }) => respondAs(assignableUserMapper, () => svc.getAssignableUsers(userFrom(request)))),
  http.get<P>(`${API}/tasks/:id`, ({ request, params }) => respondAs(taskMapper, () => svc.getTask(userFrom(request), params.id))),
  http.post(`${API}/tasks`, async ({ request }) => {
    const body = await bodyAs<TaskInput>(request, taskInputMapper)
    return respondAs(taskMapper, () => svc.createTask(userFrom(request), body))
  }),
  http.patch<P>(`${API}/tasks/:id`, async ({ request, params }) => {
    const body = await bodyAs<TaskUpdateInput>(request, taskInputMapper)
    return respondAs(taskMapper, () => svc.updateTask(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/tasks/:id/block`, async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    return respondAs(taskMapper, () => svc.blockTask(userFrom(request), params.id, body ?? {}))
  }),
  http.post<P>(`${API}/tasks/:id/unblock`, ({ request, params }) => respondAs(taskMapper, () => svc.unblockTask(userFrom(request), params.id))),
  http.post<P>(`${API}/tasks/:id/comments`, async ({ request, params }) => {
    const body = await bodyAs<{ body: string; mentions?: string[] }>(request, taskCommentMapper)
    return respondAs(taskMapper, () => svc.addComment(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/tasks/:id/attachments`, async ({ request, params }) => {
    const body = await bodyAs<{ name: string; sizeBytes: number; mimeType?: string }>(request, taskAttachmentMapper)
    return respondAs(taskMapper, () => svc.addAttachment(userFrom(request), params.id, body))
  }),
  http.delete<PA>(`${API}/tasks/:id/attachments/:attachmentId`, ({ request, params }) =>
    respondAs(taskMapper, () => svc.removeAttachment(userFrom(request), params.id, params.attachmentId)),
  ),
  http.post<P>(`${API}/tasks/:id/time-entries`, async ({ request, params }) => {
    const body = await bodyAs<TimeEntryInput>(request, timeEntryMapper)
    return respondAs(taskMapper, () => svc.addTimeEntry(userFrom(request), params.id, body))
  }),
  http.delete<PE>(`${API}/tasks/:id/time-entries/:entryId`, ({ request, params }) =>
    respondAs(taskMapper, () => svc.removeTimeEntry(userFrom(request), params.id, params.entryId)),
  ),
]
