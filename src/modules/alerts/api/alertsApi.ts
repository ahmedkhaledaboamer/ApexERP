import { http } from '@/shared/lib/axios'
import type { Alert } from '@/modules/alerts/types'

/** GET /alerts: computed reminders + stored notifications for the signed-in user. */
export async function getAlerts(): Promise<Alert[]> {
  return (await http.get<Alert[]>('/alerts')).data
}

/** PATCH /alerts/:id/read: marks one stored notification read. */
export async function markAlertRead(id: string): Promise<Alert> {
  return (await http.patch<Alert>(`/alerts/${encodeURIComponent(id)}/read`)).data
}

/** POST /alerts/read-all: marks every stored notification of the caller read. */
export async function markAllAlertsRead(): Promise<{ updated: number }> {
  return (await http.post<{ updated: number }>('/alerts/read-all')).data
}
