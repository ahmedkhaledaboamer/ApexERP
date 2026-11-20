import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type {
  AssetInput,
  AssetQuery,
  AttachmentInput,
  ContentInput,
  ContentItem,
  ContentQuery,
  ContentStatusInput,
  DesignInput,
  DesignQuery,
  DesignRequest,
  DesignStatus,
  SaveToAssetsInput,
} from './types'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** Query keys: per signed-in user (rights differ per role), under one root for invalidation. */
export const creativeKeys = {
  all: ['creative'] as const,
  content: (uid: string, q: ContentQuery) => ['creative', 'content', uid, q] as const,
  contentItem: (uid: string, id: string) => ['creative', 'content-item', uid, id] as const,
  designOptions: (uid: string) => ['creative', 'design-options', uid] as const,
  designs: (uid: string, q: DesignQuery) => ['creative', 'designs', uid, q] as const,
  design: (uid: string, id: string) => ['creative', 'design', uid, id] as const,
  assets: (uid: string, q: AssetQuery) => ['creative', 'assets', uid, q] as const,
}

function useUid() {
  const user = useCurrentUser()
  if (!user) throw new Error('Creative hooks need a signed-in user.')
  return { uid: user.id, user, canView: can(user.role, 'marketing', 'view'), canEdit: can(user.role, 'marketing', 'edit') }
}

export function useCreativeAccess() {
  const { canView, canEdit, user } = useUid()
  return { canView, canEdit, user }
}

/* ---- Content ---- */

export function useContentQuery(q: ContentQuery = {}, enabled = true) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: creativeKeys.content(uid, q), queryFn: () => api.getContentItems(q), enabled: canView && enabled })
}

export function useContentItem(id: string | null) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: creativeKeys.contentItem(uid, id ?? ''), queryFn: () => api.getContentItem(id!), enabled: canView && !!id })
}

function useSync() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: creativeKeys.all })
}

export function useCreateContent() {
  const sync = useSync()
  return useMutation({ mutationFn: (input: ContentInput) => api.createContentItem(input), onSuccess: sync })
}

export function useUpdateContent() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: ContentInput }) => api.updateContentItem(id, input), onSuccess: sync })
}

export function useContentStatus() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: ContentStatusInput }) => api.setContentStatus(id, input), onSuccess: sync })
}

export function useContentComment() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api.addContentComment(id, body), onSuccess: sync })
}

/**
 * Calendar drag: moves the item to `local` ("YYYY-MM-DDTHH:mm", company time) in every cached list
 * right away, and puts it back if the server refuses (e.g. a scheduled item dropped in the past).
 */
export function useRescheduleContent() {
  const qc = useQueryClient()
  type Snapshot = [readonly unknown[], ContentItem[] | undefined][]
  return useMutation<ContentItem, Error, { id: string; local: string }, { snapshot: Snapshot }>({
    mutationFn: ({ id, local }) => api.updateContentItem(id, { publishAt: local }),
    onMutate: async ({ id, local }) => {
      await qc.cancelQueries({ queryKey: ['creative', 'content'] })
      const snapshot = qc.getQueriesData<ContentItem[]>({ queryKey: ['creative', 'content'] }) as Snapshot
      for (const [key, data] of snapshot) {
        if (data) qc.setQueryData<ContentItem[]>(key, data.map((c) => (c.id === id ? { ...c, publishLocal: local } : c)))
      }
      return { snapshot }
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: creativeKeys.all }),
  })
}

/* ---- Design requests ---- */

export function useDesignOptions() {
  const { uid } = useUid()
  return useQuery({ queryKey: creativeKeys.designOptions(uid), queryFn: api.getDesignOptions, staleTime: 60_000 })
}

export function useDesignRequests(q: DesignQuery = {}) {
  const { uid } = useUid()
  return useQuery({ queryKey: creativeKeys.designs(uid, q), queryFn: () => api.getDesignRequests(q) })
}

export function useDesignRequest(id: string | null) {
  const { uid } = useUid()
  return useQuery({ queryKey: creativeKeys.design(uid, id ?? ''), queryFn: () => api.getDesignRequest(id!), enabled: !!id })
}

export function useCreateDesign() {
  const sync = useSync()
  return useMutation({ mutationFn: (input: DesignInput) => api.createDesignRequest(input), onSuccess: sync })
}

export function useUpdateDesign() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: DesignInput }) => api.updateDesignRequest(id, input), onSuccess: sync })
}

/** Board drag: optimistic column change with rollback. */
export function useDesignStatus() {
  const qc = useQueryClient()
  type Snapshot = [readonly unknown[], DesignRequest[] | undefined][]
  return useMutation<DesignRequest, Error, { id: string; status: DesignStatus; note?: string }, { snapshot: Snapshot }>({
    mutationFn: ({ id, status, note }) => api.setDesignStatus(id, status, note),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['creative', 'designs'] })
      const snapshot = qc.getQueriesData<DesignRequest[]>({ queryKey: ['creative', 'designs'] }) as Snapshot
      for (const [key, data] of snapshot) if (data) qc.setQueryData<DesignRequest[]>(key, data.map((r) => (r.id === id ? { ...r, status } : r)))
      return { snapshot }
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: creativeKeys.all }),
  })
}

export function useDesignComment() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api.addDesignComment(id, body), onSuccess: sync })
}

export function useDesignAttachment() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, file }: { id: string; file: AttachmentInput }) => api.addDesignAttachment(id, file), onSuccess: sync })
}

export function useRemoveDesignAttachment() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, attachmentId }: { id: string; attachmentId: string }) => api.removeDesignAttachment(id, attachmentId), onSuccess: sync })
}

export function useSaveToAssets() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input?: SaveToAssetsInput }) => api.saveDesignToAssets(id, input), onSuccess: sync })
}

/* ---- Brand assets ---- */

export function useBrandAssets(q: AssetQuery = {}, enabled = true) {
  const { uid, canView } = useUid()
  return useQuery({ queryKey: creativeKeys.assets(uid, q), queryFn: () => api.getBrandAssets(q), enabled: canView && enabled })
}

export function useCreateAsset() {
  const sync = useSync()
  return useMutation({ mutationFn: (input: AssetInput) => api.createBrandAsset(input), onSuccess: sync })
}

export function useUpdateAsset() {
  const sync = useSync()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: AssetInput }) => api.updateBrandAsset(id, input), onSuccess: sync })
}

export function useDeleteAsset() {
  const sync = useSync()
  return useMutation({ mutationFn: (id: string) => api.deleteBrandAsset(id), onSuccess: sync })
}
