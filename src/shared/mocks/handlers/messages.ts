import { http } from 'msw'
import type { SendMessageInput } from '@/modules/leads/api/messagesApi'
import * as svc from '@/shared/mocks/services/messages'
import { sendMessageMapper, sendMessageResultMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

export const messagesHandlers = [
  http.post<Params>(`${API}/leads/:id/messages`, async ({ request, params }) => {
    const body = await bodyAs<SendMessageInput>(request, sendMessageMapper)
    return respondAs(sendMessageResultMapper, () => svc.sendMessage(userFrom(request), params.id, body))
  }),
]
