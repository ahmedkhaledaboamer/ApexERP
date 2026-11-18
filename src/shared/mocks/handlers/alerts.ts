import { http } from 'msw'
import { getAlerts, markAlertRead, markAllAlertsRead } from '@/shared/mocks/services/alerts'
import { API, respond, userFrom } from './utils'

export const alertsHandlers = [
  http.get(`${API}/alerts`, ({ request }) => respond(() => getAlerts(userFrom(request)))),
  http.post(`${API}/alerts/read-all`, ({ request }) => respond(() => markAllAlertsRead(userFrom(request)))),
  http.patch(`${API}/alerts/:id/read`, ({ request, params }) => respond(() => markAlertRead(userFrom(request), String(params.id)))),
]
