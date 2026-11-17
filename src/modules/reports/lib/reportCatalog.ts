import type { CustomDimension, CustomMeasure, ReportId, ScheduleReport } from '@/modules/reports/types'

/** The ready-made sales reports, in list order. Shared by the page and the mock API. */
export const REPORT_IDS: ReportId[] = ['status', 'industry', 'source', 'funnel', 'agents', 'targets', 'overdue']

export const REPORT_TITLES: Record<ReportId, string> = {
  status: 'Leads by status',
  industry: 'Leads by industry',
  source: 'Leads by source',
  funnel: 'Conversion over time',
  agents: 'Agent performance',
  targets: 'Monthly target completion',
  overdue: 'Overdue follow-ups & tasks',
}

export const REPORT_DESCRIPTIONS: Record<ReportId, string> = {
  status: 'Where leads created in the period stand, and how far they got from New to Won.',
  industry: 'Volume, value and win rate per industry; open one for its sub-industries.',
  source: 'Which channels bring leads and which of them close.',
  funnel: 'Leads created against deals won, month by month.',
  agents: 'Activity, pipeline progress and results per owner.',
  targets: 'Actuals against each agent’s monthly targets.',
  overdue: 'Follow-up dates and tasks that have slipped, as of today.',
}

export const SCHEDULE_REPORT_TITLES: Record<ScheduleReport, string> = {
  all: 'All sales reports',
  ...REPORT_TITLES,
}

export const DIMENSION_LABELS: Record<CustomDimension, string> = {
  status: 'Status',
  industry: 'Industry',
  source: 'Source',
  owner: 'Owner',
  month: 'Month created',
}

export const MEASURE_LABELS: Record<CustomMeasure, string> = {
  count: 'Number of leads',
  value: 'Pipeline value (AED)',
  wonValue: 'Won value (AED)',
  conversion: 'Conversion rate (%)',
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
