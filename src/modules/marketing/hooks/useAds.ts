import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/marketing/api/adsApi'
import type { AdConnectInput, AdProvider } from '@/modules/marketing/adsTypes'
import type { AnalyticsQuery } from '@/modules/marketing/analyticsTypes'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { leadKeys } from '@/modules/leads/queryKeys'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Query keys: per signed-in user, under the marketing root (so marketing mutations refresh them too). */
export const adsKeys = {
  connections: (uid: string) => ['marketing', 'ads', 'connections', uid] as const,
  connection: (uid: string, id: string) => ['marketing', 'ads', 'connection', uid, id] as const,
  accounts: (uid: string, provider: string) => ['marketing', 'ads', 'accounts', uid, provider] as const,
  analytics: (uid: string, q: AnalyticsQuery) => ['marketing', 'analytics', uid, q] as const,
}

function useAccess() {
  const user = useCurrentUser()
  if (!user) throw new Error('Ads hooks need a signed-in user.')
  return {
    uid: user.id,
    canView: can(user.role, 'marketing', 'view'),
    canEdit: can(user.role, 'marketing', 'edit'),
    canAnalytics: canSeeMarketingReportsRole(user.role),
  }
}

export function useAdsAccess() {
  const { canView, canEdit, canAnalytics } = useAccess()
  return { canView, canEdit, canAnalytics }
}

export function useAdConnections() {
  const { uid, canView } = useAccess()
  return useQuery({ queryKey: adsKeys.connections(uid), queryFn: api.getAdConnections, enabled: canView })
}

export function useAdConnection(id: string | null) {
  const { uid, canView } = useAccess()
  return useQuery({ queryKey: adsKeys.connection(uid, id ?? ''), queryFn: () => api.getAdConnection(id!), enabled: canView && !!id })
}

export function useAdAccounts(provider: AdProvider | null, enabled: boolean) {
  const { uid, canEdit } = useAccess()
  return useQuery({ queryKey: adsKeys.accounts(uid, provider ?? ''), queryFn: () => api.getAdAccounts(provider!), enabled: canEdit && enabled && !!provider, retry: false })
}

export function useMarketingAnalytics(q: AnalyticsQuery, enabled = true) {
  const { uid, canAnalytics } = useAccess()
  return useQuery({
    queryKey: adsKeys.analytics(uid, q),
    queryFn: () => api.getMarketingAnalytics(q),
    enabled: canAnalytics && enabled,
    placeholderData: keepPreviousData,
  })
}

/** Ad writes change campaigns (costs), leads (lead ads) and analytics: refresh all of marketing and leads. */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['marketing'] })
    void qc.invalidateQueries({ queryKey: leadKeys.all })
  }
}

export function useConnectAdAccount() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: AdConnectInput) => api.connectAdAccount(input), onSuccess: invalidate })
}

export function useDisconnectAdAccount() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.disconnectAdAccount(id), onSuccess: invalidate })
}

export function useSyncAdConnection() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.syncAdConnection(id), onSuccess: invalidate })
}

export function useMapAdCampaign() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, campaignId }: { id: string; campaignId: string | null }) => api.mapAdCampaign(id, campaignId), onSuccess: invalidate })
}
