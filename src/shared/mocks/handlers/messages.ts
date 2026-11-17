import { http } from 'msw'
import type { SendMessageInput } from '@/modules/leads/api/messagesApi'
import * as svc from '@/shared/mocks/services/messages'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

export const messagesHandlers = [
  http.post<Params>(`${API}/leads/:id/messages`, async ({ request, params }) => {
    const body = (await request.json()) as SendMessageInput
    return respond(() => svc.sendMessage(userFrom(request), params.id, body))
  }),
]
