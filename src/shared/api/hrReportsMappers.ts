import { defineMapper } from './mapping'
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
  ReportOptions,
  ReportSettings,
  ReportSettingsInput,
  TrainingReport,
  TurnoverReport,
} from '@/modules/hr/reports/types'

/**
 * HR › Reports (docs/API.md › HR › HR reports). Mechanical snake_case at any depth (`deep`): every answer
 * holds arrays only (no data-keyed maps), so no data value is ever renamed. Export `rows` are arrays of cells.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const reportOptionsMapper = deep<ReportOptions>()
export const overviewReportMapper = deep<OverviewReport>()
export const headcountReportMapper = deep<HeadcountReport>()
export const turnoverReportMapper = deep<TurnoverReport>()
export const nationalisationReportMapper = deep<NationalisationReport>()
export const attendanceReportMapper = deep<AttendanceReport>()
export const leaveReportMapper = deep<LeaveReport>()
export const complianceReportMapper = deep<ComplianceReport>()
export const assetsReportMapper = deep<AssetsReport>()
export const recruitmentReportMapper = deep<RecruitmentReport>()
export const trainingReportMapper = deep<TrainingReport>()
export const payrollCostReportMapper = deep<PayrollCostReport>()
export const reportExportMapper = deep<ReportExport>()
export const reportSettingsMapper = deep<ReportSettings>()
export const reportSettingsInputMapper = deep<ReportSettingsInput>()
