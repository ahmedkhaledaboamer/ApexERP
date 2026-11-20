import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type {
  AudienceInput,
  AudienceRules,
  AudienceUpdateInput,
  KeywordImportRow,
  KeywordInput,
  KeywordUpdateInput,
  LandingPageInput,
  LandingPageUpdateInput,
  LeadFormInput,
  LeadFormUpdateInput,
  SitePageInput,
  SitePageUpdateInput,
  UtmLinkInput,
} from './types'
import { leadKeys } from '@/modules/leads/queryKeys'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Query keys: per signed-in user, under the marketing root (so marketing mutations refresh them too). */
export const growthKeys = {
  all: ['marketing', 'growth'] as const,
  forms: (uid: string) => ['marketing', 'growth', 'forms', uid] as const,
  form: (uid: string, id: string) => ['marketing', 'growth', 'form', uid, id] as const,
  submissions: (uid: string, id: string) => ['marketing', 'growth', 'submissions', uid, id] as const,
  pages: (uid: string) => ['marketing', 'growth', 'landing', uid] as const,
  links: (uid: string) => ['marketing', 'growth', 'utm', uid] as const,
  audiences: (uid: string) => ['marketing', 'growth', 'audiences', uid] as const,
  audience: (uid: string, id: string) => ['marketing', 'growth', 'audience', uid, id] as const,
  audienceOptions: (uid: string) => ['marketing', 'growth', 'audience-options', uid] as const,
  rulesPreview: (uid: string, rules: AudienceRules) => ['marketing', 'growth', 'rules-preview', uid, rules] as const,
  sitePages: (uid: string) => ['marketing', 'growth', 'seo-pages', uid] as const,
  keywords: (uid: string) => ['marketing', 'growth', 'keywords', uid] as const,
  websiteLeads: (uid: string, from: string, to: string) => ['marketing', 'growth', 'website-leads', uid, from, to] as const,
}

function useUid() {
  const user = useCurrentUser()
  if (!user) throw new Error('Marketing hooks need a signed-in user.')
  return { uid: user.id, canView: can(user.role, 'marketing', 'view'), canEdit: can(user.role, 'marketing', 'edit') }
}

export function useGrowthAccess() {
  const { canView, canEdit } = useUid()
  return { canView, canEdit }
}

export function useFormsQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.forms(uid), queryFn: api.getForms, enabled: canView })
}
export function useFormQuery(id: string) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.form(uid, id), queryFn: () => api.getForm(id), enabled: canView && !!id })
}
export function useSubmissionsQuery(id: string) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.submissions(uid, id), queryFn: () => api.getSubmissions(id), enabled: canView && !!id })
}
export function useLandingPagesQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.pages(uid), queryFn: api.getLandingPages, enabled: canView })
}
export function useUtmLinksQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.links(uid), queryFn: api.getUtmLinks, enabled: canView })
}
export function useAudiencesQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.audiences(uid), queryFn: api.getAudiences, enabled: canView })
}
export function useAudienceQuery(id: string) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.audience(uid, id), queryFn: () => api.getAudience(id), enabled: canView && !!id })
}
export function useAudienceOptions() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.audienceOptions(uid), queryFn: api.getAudienceOptions, enabled: canView, staleTime: 60_000 })
}
export function useRulesPreview(rules: AudienceRules, enabled = true) {
  const { uid, canView } = useUid()
  return useQuery({
    queryKey: growthKeys.rulesPreview(uid, rules),
    queryFn: () => api.previewAudienceRules(rules),
    enabled: canView && enabled,
    placeholderData: keepPreviousData,
  })
}
export function useSitePagesQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.sitePages(uid), queryFn: api.getSitePages, enabled: canView })
}
export function useKeywordsQuery() {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.keywords(uid), queryFn: api.getKeywords, enabled: canView })
}
export function useWebsiteLeads(from: string, to: string) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: growthKeys.websiteLeads(uid, from, to), queryFn: () => api.getWebsiteLeads(from, to), enabled: canView, placeholderData: keepPreviousData })
}

/* ---------------- Mutations ---------------- */

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['marketing'] })
}

function useMut<A, R>(fn: (a: A) => Promise<R>, alsoLeads = false) {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate()
      if (alsoLeads) qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}

export const useCreateForm = () => useMut((input: LeadFormInput) => api.createForm(input))
export const useUpdateForm = () => useMut(({ id, input }: { id: string; input: LeadFormUpdateInput }) => api.updateForm(id, input))
export const useDeleteForm = () => useMut((id: string) => api.deleteForm(id))
export const useCreateLandingPage = () => useMut((input: LandingPageInput) => api.createLandingPage(input))
export const useUpdateLandingPage = () => useMut(({ id, input }: { id: string; input: LandingPageUpdateInput }) => api.updateLandingPage(id, input))
export const useDeleteLandingPage = () => useMut((id: string) => api.deleteLandingPage(id))
export const useCreateUtmLink = () => useMut((input: UtmLinkInput) => api.createUtmLink(input))
export const useDeleteUtmLink = () => useMut((id: string) => api.deleteUtmLink(id))
export const useCreateAudience = () => useMut((input: AudienceInput) => api.createAudience(input))
export const useUpdateAudience = () => useMut(({ id, input }: { id: string; input: AudienceUpdateInput }) => api.updateAudience(id, input))
export const useDeleteAudience = () => useMut((id: string) => api.deleteAudience(id))
export const useFreezeAudience = () => useMut((id: string) => api.freezeAudience(id))
export const useCreateSitePage = () => useMut((input: SitePageInput) => api.createSitePage(input))
export const useUpdateSitePage = () => useMut(({ id, input }: { id: string; input: SitePageUpdateInput }) => api.updateSitePage(id, input))
export const useDeleteSitePage = () => useMut((id: string) => api.deleteSitePage(id))
export const useCreateKeyword = () => useMut((input: KeywordInput) => api.createKeyword(input))
export const useUpdateKeyword = () => useMut(({ id, input }: { id: string; input: KeywordUpdateInput }) => api.updateKeyword(id, input))
export const useDeleteKeyword = () => useMut((id: string) => api.deleteKeyword(id))
export const useAddKeywordPosition = () => useMut(({ id, date, position }: { id: string; date: string; position: number | null }) => api.addKeywordPosition(id, date, position))
export const useImportKeywords = () => useMut(({ rows, fileName }: { rows: KeywordImportRow[]; fileName: string }) => api.importKeywordPositions(rows, fileName))
