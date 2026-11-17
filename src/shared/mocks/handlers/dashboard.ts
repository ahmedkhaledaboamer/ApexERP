import { http } from 'msw'
import type { DashboardPeriod } from '@/shared/types'
import { getDashboardSummary } from '@/shared/mocks/services/dashboard'
import { API, respond, userFrom } from './utils'

export const dashboardHandlers = [
  http.get(`${API}/dashboard/summary`, ({ request }) => {
    const period = (new URL(request.url).searchParams.get('period') ?? '12m') as DashboardPeriod
    return respond(() => getDashboardSummary(userFrom(request), period))
  }),
]
