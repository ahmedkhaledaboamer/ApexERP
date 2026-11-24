import { Link } from 'react-router-dom'
import { PATHS } from '@/app/paths'
import { EngagementOverviewView } from './OverviewView'

/** The tab id HR Reports uses for Engagement (outside its own ReportKey list). */
export const ENGAGEMENT_TAB = 'engagement' as const

/**
 * HR Reports › Engagement: the engagement overview (latest eNPS, trend, drivers, open surveys) for the caller's scope
 * (HR full: company; Department Head: their departments, groups under 5 hidden). The period / department filters of
 * HR Reports don't apply: survey waves carry their own dates. Per-survey results and CSV live in Engagement.
 */
export function EngagementReportTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Survey waves carry their own dates, so the period and department filters above don’t apply here. Per-survey results and CSV exports are in{' '}
        <Link className="text-brand-600 hover:underline" to={`${PATHS.hrEngagement}?tab=surveys`}>
          Engagement
        </Link>
        .
      </p>
      <EngagementOverviewView />
    </div>
  )
}
