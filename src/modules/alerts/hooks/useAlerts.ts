import { useMemo, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAlerts, markAlertRead, markAllAlertsRead } from '@/modules/alerts/api/alertsApi'
import { ALERT_TYPES, type Alert, type AlertType } from '@/modules/alerts/types'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { useCurrentUser } from '@/store/hooks'
import { userStorage } from '@/shared/lib/storage'
import { getActiveCompanyId } from '@/shared/lib/tenantContext'

export const alertKeys = {
  /**
   * Nested under ['leads'] so every lead mutation (which invalidates ['leads']) refreshes the
   * alerts too; task and Won mutations invalidate ['leads'] as well. The automation rules are part
   * of the key, so saving Settings > Automation refetches.
   */
  all: ['leads', 'alerts'] as const,
  list: (userId: string, rulesVersion: string) => ['leads', 'alerts', userId, rulesVersion] as const,
}

/** Every alert for the signed-in user (computed reminders + stored notifications), newest first. Polls every minute. */
export function useAlerts() {
  const user = useCurrentUser()
  const { rules } = useAutomationRules()
  return useQuery({
    queryKey: alertKeys.list(user?.id ?? '', JSON.stringify(rules)),
    queryFn: getAlerts,
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/* ---------------- Read state ---------------- */

/**
 * Computed reminders can't be marked read on the server (they clear when their cause does), so
 * "seen" is kept per browser session. The key includes `at`, so a reminder that comes back for a
 * new date (e.g. a moved follow-up) counts as unread again.
 */
const SEEN_KEY = 'alerts.seen'
const seenKey = (a: Alert) => `${a.id}@${a.at}`
/** Tenant-scoped (session area): reloaded when the active company changes. */
let seenFor: string | null = null
let seen: Set<string> = new Set()
const listeners = new Set<() => void>()

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(userStorage.data.get(SEEN_KEY, 'session') ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function currentSeen(): Set<string> {
  const companyId = getActiveCompanyId()
  if (companyId !== seenFor) {
    seenFor = companyId
    seen = loadSeen()
  }
  return seen
}

function markSeen(alerts: Alert[]) {
  const prev = currentSeen()
  const next = new Set(prev)
  for (const a of alerts) if (!a.stored) next.add(seenKey(a))
  if (next.size === prev.size) return
  seen = next
  // Storage blocked: the in-memory set lasts for this tab.
  userStorage.data.set(SEEN_KEY, JSON.stringify([...seen]), 'session')
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isUnread(a: Alert, seenSet: Set<string>): boolean {
  return a.stored ? !a.read : !seenSet.has(seenKey(a))
}

/** Unread state + "mark read" actions for the bell. */
export function useAlertReadState(alerts: Alert[]) {
  const qc = useQueryClient()
  const seenSet = useSyncExternalStore(subscribe, currentSeen)
  const unread = useMemo(() => alerts.filter((a) => isUnread(a, seenSet)), [alerts, seenSet])

  const patch = (update: (a: Alert) => Alert) =>
    qc.setQueriesData<Alert[]>({ queryKey: alertKeys.all }, (prev) => (Array.isArray(prev) ? prev.map(update) : prev))

  const markOne = useMutation({
    mutationFn: markAlertRead,
    onMutate: (id) => patch((a) => (a.id === id ? { ...a, read: true } : a)),
    onSettled: () => qc.invalidateQueries({ queryKey: alertKeys.all }),
  })
  const markAll = useMutation({
    mutationFn: markAllAlertsRead,
    onMutate: () => patch((a) => (a.stored ? { ...a, read: true } : a)),
    onSettled: () => qc.invalidateQueries({ queryKey: alertKeys.all }),
  })

  return {
    unread,
    isUnread: (a: Alert) => isUnread(a, seenSet),
    /** Opening an alert marks it read (stored) or seen (computed). */
    open(a: Alert) {
      if (a.stored) {
        if (!a.read) markOne.mutate(a.id)
      } else markSeen([a])
    },
    markAllRead() {
      markSeen(alerts)
      if (alerts.some((a) => a.stored && !a.read)) markAll.mutate()
    },
    markingAll: markAll.isPending,
  }
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
