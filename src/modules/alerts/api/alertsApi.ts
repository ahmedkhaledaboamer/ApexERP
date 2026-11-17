import { http } from '@/shared/lib/axios'
import type { Alert } from '@/modules/alerts/types'

/** GET /alerts: automation reminders for the signed-in user, scoped like leads. */
export async function getAlerts(): Promise<Alert[]> {
  return (await http.get<Alert[]>('/alerts')).data
}
