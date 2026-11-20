import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/events/api/eventSectionsApi'
import type { EventAnalyticsQuery } from '@/modules/events/sectionsTypes'
import { leadKeys } from '@/modules/leads/queryKeys'
import { useEntitlements } from '@/modules/billing/hooks'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { can, scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Query keys are per user (the server scopes the answers to the caller); under `events` so event writes refresh them. */
export const eventSectionKeys = {
  attendees: (uid: string) => ['events', uid, 'sections', 'attendees'] as const,
  boothLeads: (uid: string) => ['events', uid, 'sections', 'booth-leads'] as const,
  analytics: (uid: string, q: EventAnalyticsQuery) => ['events', uid, 'sections', 'analytics', q.preset, q.from ?? '', q.to ?? '', q.compare] as const,
}

const useUid = () => useCurrentUser()?.id ?? 'anonymous'

export function useAttendeeDirectory() {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: eventSectionKeys.attendees(uid), queryFn: api.getAttendeeDirectory, enabled: ent.hasModule('events') })
}

export function useBoothLeads() {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: eventSectionKeys.boothLeads(uid), queryFn: api.getBoothLeads, enabled: ent.hasModule('events') })
}

export function useAssignBoothLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ captureIds, ownerId }: { captureIds: string[]; ownerId: string }) => api.assignBoothLeads(captureIds, ownerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events'] })
      void qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}

/** Event analytics: Marketing view AND Reports full | marketing (same rule as the API). */
export function useEventAnalyticsAccess(): boolean {
  const user = useCurrentUser()
  return !!user && can(user.role, 'marketing', 'view') && canSeeMarketingReportsRole(user.role)
}

export function useEventAnalytics(q: EventAnalyticsQuery, ready = true) {
  const uid = useUid()
  const ent = useEntitlements()
  const allowed = useEventAnalyticsAccess()
  return useQuery({ queryKey: eventSectionKeys.analytics(uid, q), queryFn: () => api.getEventAnalytics(q), enabled: ent.hasModule('events') && allowed && ready })
}

/** Bulk "Assign owner" on booth leads: a Sales scope that can hand leads to someone else (mirrors the API). */
export function useCanAssignBoothLeads(): boolean {
  const user = useCurrentUser()
  return !!user && can(user.role, 'sales', 'edit') && ['full', 'team'].includes(scopeOf(user.role, 'sales'))
}
