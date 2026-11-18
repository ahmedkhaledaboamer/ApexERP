import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/marketing/api/marketingApi'
import type {
  AudienceFilter,
  BulkEmailDetail,
  BulkEmailInput,
  BulkEmailUpdateInput,
  CampaignCostInput,
  CampaignInput,
  CampaignUpdateInput,
} from '@/modules/marketing/types'
import { leadKeys } from '@/modules/leads/queryKeys'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Query keys: per signed-in user (rights differ per role), under one root for invalidation. */
export const marketingKeys = {
  all: ['marketing'] as const,
  options: (uid: string) => ['marketing', 'options', uid] as const,
  campaigns: (uid: string) => ['marketing', 'campaigns', uid] as const,
  campaign: (uid: string, id: string) => ['marketing', 'campaign', uid, id] as const,
  results: (uid: string, id: string) => ['marketing', 'results', uid, id] as const,
  emails: (uid: string, campaignId?: string) => ['marketing', 'emails', uid, campaignId ?? ''] as const,
  email: (uid: string, id: string) => ['marketing', 'email', uid, id] as const,
  preview: (uid: string, id: string, filters: AudienceFilter) => ['marketing', 'preview', uid, id, filters] as const,
  report: (uid: string, from: string, to: string) => ['marketing', 'report', uid, from, to] as const,
}

function useUid(): { uid: string; canView: boolean; canEdit: boolean } {
  const user = useCurrentUser()
  if (!user) throw new Error('Marketing hooks need a signed-in user.')
  return { uid: user.id, canView: can(user.role, 'marketing', 'view'), canEdit: can(user.role, 'marketing', 'edit') }
}

export function useMarketingAccess() {
  const { canView, canEdit } = useUid()
  return { canView, canEdit }
}

export function useMarketingOptions() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: marketingKeys.options(uid), queryFn: api.getMarketingOptions, enabled: canView, staleTime: 60_000 })
}

export function useCampaignsQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: marketingKeys.campaigns(uid), queryFn: api.getCampaigns, enabled: canView })
}

export function useCampaignResults(id: string) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: marketingKeys.results(uid, id), queryFn: () => api.getCampaignResults(id), enabled: canView && !!id })
}

/** While anything is sending, lists and details poll so progress shows up without a reload. */
const pollWhileSending = (sending: boolean) => (sending ? 2_000 : false)

export function useBulkEmailsQuery(campaignId?: string) {
  const { uid, canView } = useUid()
  return useQuery({
    queryKey: marketingKeys.emails(uid, campaignId),
    queryFn: () => api.getBulkEmails({ campaignId }),
    enabled: canView,
    refetchInterval: (q) => pollWhileSending(!!q.state.data?.some((e) => e.status === 'sending')),
  })
}

export function useBulkEmailQuery(id: string) {
  const { uid, canView } = useUid()
  return useQuery({
    queryKey: marketingKeys.email(uid, id),
    queryFn: () => api.getBulkEmail(id),
    enabled: canView && !!id,
    refetchInterval: (q) => pollWhileSending(q.state.data?.status === 'sending'),
  })
}

export function useAudiencePreview(id: string, filters: AudienceFilter, enabled = true) {
  const { uid, canView } = useUid()
  return useQuery({
    queryKey: marketingKeys.preview(uid, id, filters),
    queryFn: () => api.previewAudience(id, filters),
    enabled: canView && enabled && !!id,
    placeholderData: keepPreviousData,
  })
}

export function useMarketingReport(from: string, to: string, enabled = true) {
  const { uid } = useUid()
  return useQuery({ queryKey: marketingKeys.report(uid, from, to), queryFn: () => api.getMarketingReport(from, to), enabled })
}

/* ---------------- Mutations ---------------- */

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: marketingKeys.all })
}

export function useCreateCampaign() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: CampaignInput) => api.createCampaign(input), onSuccess: invalidate })
}

export function useUpdateCampaign() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: CampaignUpdateInput }) => api.updateCampaign(id, input), onSuccess: invalidate })
}

export function useAddCampaignCost() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: CampaignCostInput }) => api.addCampaignCost(id, input), onSuccess: invalidate })
}

function useEmailSync() {
  const { uid } = useUid()
  const qc = useQueryClient()
  return (e: BulkEmailDetail) => {
    qc.setQueryData(marketingKeys.email(uid, e.id), e)
    qc.invalidateQueries({ queryKey: ['marketing', 'emails'] })
    qc.invalidateQueries({ queryKey: ['marketing', 'results'] })
    qc.invalidateQueries({ queryKey: ['marketing', 'preview'] })
  }
}

export function useCreateBulkEmail() {
  const sync = useEmailSync()
  return useMutation({ mutationFn: (input: BulkEmailInput) => api.createBulkEmail(input), onSuccess: sync })
}

export function useUpdateBulkEmail() {
  const sync = useEmailSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: BulkEmailUpdateInput }) => api.updateBulkEmail(id, input), onSuccess: sync })
}

export function useCancelBulkEmail() {
  const sync = useEmailSync()
  return useMutation({ mutationFn: (id: string) => api.cancelBulkEmail(id), onSuccess: sync })
}

export function useScheduleBulkEmail() {
  const sync = useEmailSync()
  return useMutation({ mutationFn: ({ id, local }: { id: string; local: string }) => api.scheduleBulkEmail(id, local), onSuccess: sync })
}

/** Sending logs an email activity on every lead, so lead data is refreshed too. */
export function useSendBulkEmailNow() {
  const sync = useEmailSync()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.sendBulkEmailNow(id),
    onSuccess: (e) => {
      sync(e)
      qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}

export function useTestBulkEmail() {
  return useMutation({ mutationFn: ({ id, to }: { id: string; to: string }) => api.testBulkEmail(id, to) })
}
