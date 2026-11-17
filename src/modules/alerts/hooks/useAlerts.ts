import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAlerts } from '@/modules/alerts/api/alertsApi'
import { ALERT_TYPES, type Alert, type AlertType } from '@/modules/alerts/types'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

export const alertKeys = {
  /**
   * Nested under ['leads'] so every lead mutation (which invalidates ['leads']) refreshes the
   * alerts too; the automation rules are part of the key, so saving Settings > Automation refetches.
   */
  list: (userId: string, rulesVersion: string) => ['leads', 'alerts', userId, rulesVersion] as const,
}

/** Every alert for the signed-in user, newest first. Polls every minute. */
export function useAlerts() {
  const user = useCurrentUser()
  const { rules } = useAutomationRules()
  return useQuery({
    queryKey: alertKeys.list(user?.id ?? '', JSON.stringify(rules)),
    queryFn: getAlerts,
    enabled: !!user && scopeOf(user.role, 'sales') !== 'hidden',
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** Alerts grouped by type, in display order, with only non-empty groups. */
export function groupAlerts(alerts: Alert[]): { type: AlertType; items: Alert[] }[] {
  return ALERT_TYPES.map((type) => ({ type, items: alerts.filter((a) => a.type === type) })).filter((g) => g.items.length > 0)
}

/** Lead-level alerts (no first contact, stalled interest) by lead id, for badges on rows and cards. */
export function useLeadAlerts(): Map<string, Alert[]> {
  const { data } = useAlerts()
  return useMemo(() => {
    const map = new Map<string, Alert[]>()
    for (const a of data ?? []) {
      if (!a.leadId || (a.type !== 'no-contact' && a.type !== 'stalled')) continue
      map.set(a.leadId, [...(map.get(a.leadId) ?? []), a])
    }
    return map
  }, [data])
}
