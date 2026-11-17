import { http } from 'msw'
import { getAlerts } from '@/shared/mocks/services/alerts'
import { API, respond, userFrom } from './utils'

export const alertsHandlers = [http.get(`${API}/alerts`, ({ request }) => respond(() => getAlerts(userFrom(request))))]
