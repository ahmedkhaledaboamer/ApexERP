import { http, HttpResponse } from 'msw'
import type { WonInput } from '@/modules/won/types'
import { ApiError } from '@/shared/lib/apiError'
import { previewWon, winLead, WonError } from '@/shared/mocks/services/won'
import { API, errorBody, respond, userFrom } from './utils'

type P = { id: string }

/** The Won flow. Errors carry `step` (and `code` + details when coded) so the dialog can say what failed. */
export const wonHandlers = [
  http.post<P>(`${API}/leads/:id/won/preview`, async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as Parameters<typeof previewWon>[2]
    return respond(() => previewWon(userFrom(request), params.id, body ?? {}))
  }),
  http.post<P>(`${API}/leads/:id/won`, async ({ request, params }) => {
    const body = (await request.json()) as WonInput
    try {
      return HttpResponse.json(await winLead(userFrom(request), params.id, body))
    } catch (e) {
      // `{ message, code?, ...details, step }`: a plan error raised inside the flow (402 LIMIT_REACHED,
      // 403 module_not_in_plan, 423 workspace_read_only) keeps its code + details for the upgrade prompt.
      if (e instanceof WonError) return HttpResponse.json({ ...errorBody(e), step: e.step }, { status: e.status })
      // Raised before the flow (session, request policy): code + details as everywhere else.
      if (e instanceof ApiError) return HttpResponse.json(errorBody(e), { status: e.status })
      throw e
    }
  }),
]
