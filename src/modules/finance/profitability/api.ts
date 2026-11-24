import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import * as m from '@/shared/api/financeProfitabilityMappers'
import type {
  CustomerProfitability,
  DepartmentPnl,
  EventProfitability,
  ProfitExport,
  ProfitOptions,
  ProfitQuery,
  ProfitReport,
  ProfitSettings,
  ProfitSettingsInput,
  ProjectProfitability,
  ProjectProfitDetail,
} from './types'

/** Accounts & finance › Profitability (docs/API.md › Finance › Profitability). Server state under ['finance', uid, 'profitability', …]. */

const P = '/finance/profitability'
const params = (q: ProfitQuery) => ({
  from: q.from || undefined,
  to: q.to || undefined,
  department_id: q.departmentId || undefined,
  project_id: q.projectId || undefined,
  event_id: q.eventId || undefined,
  customer_id: q.customerId || undefined,
})

export interface ProfitData {
  projects: ProjectProfitability
  events: EventProfitability
  customers: CustomerProfitability
  departments: DepartmentPnl
}

const MAPPERS = {
  projects: m.projectProfitabilityMapper,
  events: m.eventProfitabilityMapper,
  customers: m.customerProfitabilityMapper,
  departments: m.departmentPnlMapper,
}

export const profitabilityApi = {
  options: async (): Promise<ProfitOptions> => m.profitOptionsMapper.fromApi((await http.get<unknown>(`${P}/options`)).data),
  report: async <K extends ProfitReport>(key: K, q: ProfitQuery): Promise<ProfitData[K]> =>
    MAPPERS[key].fromApi((await http.get<unknown>(`${P}/${key}`, { params: params(q) })).data) as ProfitData[K],
  project: async (id: string, q: ProfitQuery): Promise<ProjectProfitDetail> =>
    m.projectProfitDetailMapper.fromApi((await http.get<unknown>(`${P}/projects/${encodeURIComponent(id)}`, { params: params(q) })).data),
  exportRows: async (key: ProfitReport, q: ProfitQuery): Promise<ProfitExport> => m.profitExportMapper.fromApi((await http.get<unknown>(`${P}/${key}/export`, { params: params(q) })).data),
  saveSettings: async (input: ProfitSettingsInput): Promise<ProfitSettings> =>
    m.profitSettingsMapper.fromApi((await http.put<unknown>(`${P}/settings`, m.profitSettingsInputMapper.toApi(input))).data),
}

const useUid = () => useCurrentUser()?.id ?? 'anonymous'

export function useProfitOptions() {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: ['finance', uid, 'profitability', 'options'], queryFn: profitabilityApi.options, enabled: ent.hasModule('accounting'), retry: false })
}

export function useProfitReport<K extends ProfitReport>(key: K, q: ProfitQuery, enabled = true) {
  const uid = useUid()
  return useQuery({
    queryKey: ['finance', uid, 'profitability', key, q],
    queryFn: () => profitabilityApi.report(key, q),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useProjectProfit(id: string, q: ProfitQuery) {
  const uid = useUid()
  return useQuery({ queryKey: ['finance', uid, 'profitability', 'project', id, q], queryFn: () => profitabilityApi.project(id, q), retry: false, placeholderData: keepPreviousData })
}

export function useSaveProfitSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: profitabilityApi.saveSettings, onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }) })
}
