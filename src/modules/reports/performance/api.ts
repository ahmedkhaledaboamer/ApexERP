import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { useCurrentUser } from '@/store/hooks'
import { companyPerformanceMapper } from '@/shared/api/reportsPerformanceMappers'
import type { CompanyPerformance, PerformanceQuery } from './types'

/** Reports › Company performance (docs/API.md › Reports › Company performance). */

export async function getCompanyPerformance(q: PerformanceQuery): Promise<CompanyPerformance> {
  return companyPerformanceMapper.fromApi((await http.get<unknown>('/reports/performance', { params: { from: q.from || undefined, to: q.to || undefined } })).data)
}

export function useCompanyPerformance(q: PerformanceQuery) {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return useQuery({ queryKey: ['reports', 'performance', uid, q.from ?? '', q.to ?? ''], queryFn: () => getCompanyPerformance(q), retry: false, placeholderData: keepPreviousData })
}
