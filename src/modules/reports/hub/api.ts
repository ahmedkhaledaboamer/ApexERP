import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import * as m from '@/shared/api/reportsPerformanceMappers'
import type { ReportsHub } from './types'

/** Reports › Reports hub (docs/API.md › Reports › Reports hub). Favourites and recently viewed live on the server, per user. */

const enc = encodeURIComponent

export const hubApi = {
  get: async (): Promise<ReportsHub> => m.reportsHubMapper.fromApi((await http.get<unknown>('/reports/hub')).data),
  favourite: async ({ id, on }: { id: string; on: boolean }): Promise<ReportsHub> =>
    m.reportsHubMapper.fromApi((on ? await http.put<unknown>(`/reports/hub/favourites/${enc(id)}`) : await http.delete<unknown>(`/reports/hub/favourites/${enc(id)}`)).data),
  viewed: async (id: string): Promise<ReportsHub> => m.reportsHubMapper.fromApi((await http.post<unknown>('/reports/hub/recent', m.hubRecentInputMapper.toApi({ reportId: id }))).data),
}

const key = (uid: string) => ['reports', 'hub', uid] as const

export function useReportsHub() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return useQuery({ queryKey: key(uid), queryFn: hubApi.get, retry: false })
}

export function useToggleFavourite() {
  const qc = useQueryClient()
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return useMutation({ mutationFn: hubApi.favourite, onSuccess: (hub) => qc.setQueryData(key(uid), hub) })
}

/** Records "recently viewed" for a report of the hub catalog once per mount (best effort; errors are ignored). */
export function useTrackReportView(reportId: string | null) {
  const user = useCurrentUser()
  const qc = useQueryClient()
  const uid = user?.id ?? null
  const allowed = !!user && scopeOf(user.role, 'reports') !== 'hidden'
  useEffect(() => {
    if (!reportId || !allowed || !uid) return
    hubApi.viewed(reportId).then(
      (hub) => qc.setQueryData(key(uid), hub),
      () => undefined,
    )
  }, [reportId, allowed, uid, qc])
}
