import type { ActivityType, LeadStatus, SourceType } from '@/shared/types'
import type { TaskLinkType, TaskPriority, TaskStatus } from '@/modules/tasks/types'

/** Ready-made sales reports (spec: Reports, phase 1). */
export type ReportId = 'status' | 'industry' | 'source' | 'funnel' | 'agents' | 'targets' | 'overdue'

/** Effective data scope of the viewer for sales reports. */
export type ReportScope = 'full' | 'team' | 'own'

/** Query for `GET /reports/sales`. Dates are local calendar days, `yyyy-MM-dd`, inclusive. */
export interface SalesReportQuery {
  from: string
  to: string
  /** Narrow to one owner; must be inside the viewer's scope. */
  ownerId?: string
  /**
   * Narrow to owners whose department (User.departmentId) is this one or a sub-department.
   * Team-scope viewers may only pick departments they head (or below); own scope can't filter.
   */
  departmentId?: string
}

export interface ReportOwner {
  id: string
  name: string
}

/** A department the viewer may filter reports by (tree order). */
export interface ReportDepartment {
  id: string
  name: string
  /** 0 = top level among the listed departments. */
  depth: number
  active: boolean
}

export interface ReportKpis {
  /** Leads created in the range. */
  leadsCreated: number
  /** Leads won in the range (by the date they moved to Won). */
  wonCount: number
  /** AED won in the range. */
  wonValue: number
  /** Leads closed (Won, Lost, Not interested) in the range. */
  closedCount: number
  /** Won ÷ closed, 0..100. */
  conversionRate: number
  /** Won value ÷ won count, AED. */
  avgDealSize: number
  /** Average days from creation to Won, for deals won in the range; null when none. */
  avgDaysToClose: number | null
  /** Activities logged in the range. */
  activitiesLogged: number
}

export interface StatusRow {
  /** Lookup key. */
  status: LeadStatus
  /** Current label from the statuses lookup. */
  label: string
  count: number
  /** Share of leads created in the range, 0..100. */
  share: number
  value: number
}

/** One step of the New → Won funnel: leads that reached this stage or beyond. */
export interface FunnelStep {
  /** Status lookup key. */
  stage: LeadStatus
  /** Current label from the statuses lookup. */
  label: string
  reached: number
  /** % of the previous step that made it here (100 for the first step). */
  fromPrevious: number
  /** % of the first step that made it here. */
  fromStart: number
}

export interface SubIndustryRow {
  subIndustry: string
  /** Current label from the industries lookup. */
  label: string
  leads: number
  value: number
  won: number
  winRate: number
}

export interface IndustryRow {
  /** Lookup key. */
  industry: string
  /** Current label from the industries lookup. */
  label: string
  leads: number
  value: number
  won: number
  wonValue: number
  /** Won ÷ closed, 0..100. */
  winRate: number
  subIndustries: SubIndustryRow[]
}

export interface SourceDetailRow {
  detail: string
  leads: number
  won: number
  value: number
}

export interface SourceRow {
  /** Lookup key. */
  source: SourceType
  /** Current label from the sources lookup. */
  label: string
  leads: number
  won: number
  lost: number
  value: number
  wonValue: number
  /** Won ÷ closed, 0..100. */
  winRate: number
  details: SourceDetailRow[]
}

export interface FunnelMonth {
  /** `yyyy-MM`. */
  month: string
  /** Short label, e.g. "Mar 26". */
  label: string
  created: number
  won: number
  wonValue: number
  /** Won ÷ created in the month, 0..100. */
  conversion: number
}

export interface AgentRow {
  userId: string
  name: string
  /** Leads created in the range. */
  leads: number
  activities: Record<ActivityType, number>
  totalActivities: number
  meetings: number
  /** Leads that reached Proposal (or Won) in the range. */
  proposals: number
  won: number
  wonValue: number
  closed: number
  /** Won ÷ closed, 0..100. */
  conversion: number
  /** Average hours from lead creation to its first activity; null when no data. */
  avgResponseHours: number | null
}

export type TargetKind = 'leads' | 'calls' | 'emails' | 'visits' | 'meetings' | 'proposals' | 'partnerships' | 'events'

export interface TargetCell {
  key: TargetKind
  label: string
  target: number
  actual: number
  /** actual ÷ target, 0..∞ (can exceed 100). */
  pct: number
}

export interface TargetRow {
  userId: string
  name: string
  cells: TargetCell[]
  /** Average completion across target kinds with a target > 0, capped per kind at 100. */
  overall: number
}

export interface TargetReport {
  /** `yyyy-MM` of the month measured (the month the range ends in). */
  month: string
  monthLabel: string
  /** Share of the month elapsed, 0..100 (100 for past months). */
  elapsed: number
  rows: TargetRow[]
}

export interface OverdueFollowUp {
  leadId: string
  company: string
  status: LeadStatus
  ownerId: string
  ownerName: string
  dueDate: string
  daysOverdue: number
  nextStep: string
}

/** An open task past its due date (from the shared overdueTasks selector), as of today. */
export interface OverdueTask {
  taskId: string
  title: string
  /** What the task is linked to; null for personal to-dos. */
  linkType: TaskLinkType | null
  linkId: string | null
  /** Resolved label of the link (project name, lead company, customer name). */
  linkLabel: string | null
  /** False when the linked record can't be opened. */
  linkAvailable: boolean
  projectId: string | null
  projectName: string | null
  ownerId: string
  ownerName: string
  dueDate: string
  daysOverdue: number
  priority: TaskPriority
  status: TaskStatus
}

/** Everything the Sales reports screen shows, in one scoped payload. */
export interface SalesReport {
  query: SalesReportQuery
  scope: ReportScope
  /** Owners the viewer may filter by (empty for "own" scope); narrowed by the department filter. */
  owners: ReportOwner[]
  /** Departments the viewer may filter by (empty for "own" scope). */
  departments: ReportDepartment[]
  generatedAt: string
  kpis: ReportKpis
  byStatus: StatusRow[]
  funnel: FunnelStep[]
  byIndustry: IndustryRow[]
  bySource: SourceRow[]
  /** Monthly created vs won; covers the range, at least the last 6 months up to `to`. */
  funnelMonthly: FunnelMonth[]
  agents: AgentRow[]
  targets: TargetReport
  /** As of today, regardless of the date range. */
  overdueFollowUps: OverdueFollowUp[]
  overdueTasks: OverdueTask[]
}

/* -------------------------------- Report builder -------------------------------- */

export type CustomDimension = 'status' | 'industry' | 'source' | 'owner' | 'month'
export type CustomMeasure = 'count' | 'value' | 'wonValue' | 'conversion'

export interface CustomReportInput extends SalesReportQuery {
  dimension: CustomDimension
  measure: CustomMeasure
}

export interface CustomReportRow {
  key: string
  label: string
  /** The chosen measure. */
  value: number
  /** Leads behind the row, for context. */
  leads: number
}

export interface CustomReport {
  input: CustomReportInput
  rows: CustomReportRow[]
  total: number
}

/* -------------------------------- Scheduled delivery -------------------------------- */

export type ScheduleFrequency = 'weekly' | 'monthly'
export type ScheduleFormat = 'excel' | 'pdf'
export type ScheduleReport = ReportId | 'all'

export interface ReportSchedule {
  id: string
  report: ScheduleReport
  frequency: ScheduleFrequency
  /** Weekly: 1 (Mon) … 7 (Sun). Monthly: day of month 1 … 28. */
  day: number
  /** `HH:mm` in the workspace timezone. */
  time: string
  recipients: string[]
  format: ScheduleFormat
  createdBy: string
  createdByName: string
  createdAt: string
  nextRunAt: string
}

export type ScheduleInput = Pick<ReportSchedule, 'report' | 'frequency' | 'day' | 'time' | 'recipients' | 'format'>
