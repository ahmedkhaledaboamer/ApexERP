import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type { Mapper } from '@/shared/api/mapping'
import * as m from '@/shared/api/hrReportsMappers'
import type {
  AssetsReport,
  AttendanceReport,
  ComplianceReport,
  HeadcountReport,
  LeaveReport,
  NationalisationReport,
  OverviewReport,
  PayrollCostReport,
  RecruitmentReport,
  ReportExport,
  ReportKey,
  ReportOptions,
  ReportQuery,
  ReportSettings,
  ReportSettingsInput,
  TrainingReport,
  TurnoverReport,
} from './types'

/** HR › Reports (docs/API.md › HR › HR reports). Server state only, under ['hr', uid, 'reports', …]. */

export interface ReportData {
  overview: OverviewReport
  headcount: HeadcountReport
  turnover: TurnoverReport
  nationalisation: NationalisationReport
  attendance: AttendanceReport
  leave: LeaveReport
  compliance: ComplianceReport
  assets: AssetsReport
  recruitment: RecruitmentReport
  training: TrainingReport
  'payroll-cost': PayrollCostReport
}

const MAPPERS: { [K in ReportKey]: Mapper<ReportData[K]> } = {
  overview: m.overviewReportMapper,
  headcount: m.headcountReportMapper,
  turnover: m.turnoverReportMapper,
  nationalisation: m.nationalisationReportMapper,
  attendance: m.attendanceReportMapper,
  leave: m.leaveReportMapper,
  compliance: m.complianceReportMapper,
  assets: m.assetsReportMapper,
  recruitment: m.recruitmentReportMapper,
  training: m.trainingReportMapper,
  'payroll-cost': m.payrollCostReportMapper,
}

const params = (q: ReportQuery) => ({ from: q.from || undefined, to: q.to || undefined, department_id: q.departmentId || undefined })

export const hrReportsApi = {
  async options(): Promise<ReportOptions> {
    return m.reportOptionsMapper.fromApi((await http.get<unknown>('/hr/reports/options')).data)
  },
  async report<K extends ReportKey>(key: K, q: ReportQuery): Promise<ReportData[K]> {
    return MAPPERS[key].fromApi((await http.get<unknown>(`/hr/reports/${key}`, { params: params(q) })).data)
  },
  async exportRows(key: ReportKey, q: ReportQuery): Promise<ReportExport> {
    return m.reportExportMapper.fromApi((await http.get<unknown>(`/hr/reports/${key}/export`, { params: params(q) })).data)
  },
  async saveSettings(input: ReportSettingsInput): Promise<ReportSettings> {
    return m.reportSettingsMapper.fromApi((await http.put<unknown>('/hr/reports/settings', m.reportSettingsInputMapper.toApi(input))).data)
  },
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** Reports are for HR full and Department Heads (the API answers 403 to everyone else). */
export function useReportsScope(): 'full' | 'team' | null {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'hr') : 'hidden'
  return scope === 'full' || scope === 'team' ? scope : null
}

export function useReportOptions(enabled = true) {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: ['hr', uid, 'reports', 'options'], queryFn: hrReportsApi.options, enabled: enabled && ent.hasModule('hr'), retry: false })
}

export function useReport<K extends ReportKey>(key: K, q: ReportQuery, enabled = true) {
  const uid = useUid()
  return useQuery({
    queryKey: ['hr', uid, 'reports', key, q],
    queryFn: () => hrReportsApi.report(key, q),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useSaveReportSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: hrReportsApi.saveSettings,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['hr'] }),
  })
}
