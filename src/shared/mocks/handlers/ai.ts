import { http, type HttpHandler } from 'msw'
import * as ai from '@/shared/mocks/services/ai'
import { aiInputMapper, aiMapper, aiSettingsMapper } from '@/shared/api/aiMappers'
import { API, respondAs, userFrom } from './utils'

type Id = { id: string }
async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return mapper.fromApi(await request.json()) as T
  } catch {
    return null
  }
}

/**
 * AI assistant (docs/API.md › AI assistant). Plan module `ai` (request policy: /ai/* → `ai`). Conversations and
 * proposals are the caller's own (another user's or company's id → 404). Static paths before `:id`.
 * POST /ai/credits/consume (billing) is registered in handlers/billing.ts.
 */
export const aiHandlers: HttpHandler[] = [
  http.get(`${API}/ai/me`, ({ request }) => respondAs(aiMapper, () => ai.getAiMe(userFrom(request)))),
  http.get(`${API}/ai/settings`, ({ request }) => respondAs(aiSettingsMapper, () => ai.getAiSettings(userFrom(request)))),
  http.put(`${API}/ai/settings`, async ({ request }) => {
    const input = await body<Parameters<typeof ai.updateAiSettings>[1]>(request, aiSettingsMapper)
    return respondAs(aiSettingsMapper, () => ai.updateAiSettings(userFrom(request), input))
  }),
  http.get(`${API}/ai/usage`, ({ request }) => respondAs(aiMapper, () => ai.getAiUsage(userFrom(request)))),

  http.get(`${API}/ai/conversations`, ({ request }) => respondAs(aiMapper, () => ai.listConversations(userFrom(request)))),
  http.post(`${API}/ai/conversations`, async ({ request }) => {
    const input = await body<{ title?: unknown }>(request, aiInputMapper)
    return respondAs(aiMapper, () => ai.createConversation(userFrom(request), input))
  }),
  http.get<Id>(`${API}/ai/conversations/:id`, ({ request, params }) => respondAs(aiMapper, () => ai.getConversation(userFrom(request), params.id))),
  http.patch<Id>(`${API}/ai/conversations/:id`, async ({ request, params }) => {
    const input = await body<{ title?: unknown }>(request, aiInputMapper)
    return respondAs(aiMapper, () => ai.renameConversation(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${API}/ai/conversations/:id`, ({ request, params }) => respondAs(aiMapper, () => ai.deleteConversation(userFrom(request), params.id))),
  http.post<Id>(`${API}/ai/conversations/:id/messages`, async ({ request, params }) => {
    const input = await body<{ content?: unknown; context?: unknown }>(request, aiInputMapper)
    return respondAs(aiMapper, () => ai.postMessage(userFrom(request), params.id, input))
  }),

  http.post<Id>(`${API}/ai/actions/:id/confirm`, async ({ request, params }) => {
    const input = await body<{ input?: unknown }>(request, aiInputMapper)
    return respondAs(aiMapper, () => ai.confirmAction(userFrom(request), params.id, input))
  }),
  http.post<Id>(`${API}/ai/actions/:id/cancel`, ({ request, params }) => respondAs(aiMapper, () => ai.cancelAction(userFrom(request), params.id))),
]
