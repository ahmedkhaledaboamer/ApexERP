import type { ReportId } from '@/modules/reports/types'
import type { HubArea } from './catalog'

/** Reports › Reports hub (docs/API.md › Reports › Reports hub). Favourites and recently viewed are per user, server-side. */

export interface HubReport {
  id: string
  area: HubArea
  title: string
  description: string
  path: string
  /** The Sales report the scheduled e-mail delivery can send (null: not schedulable yet). */
  schedule: ReportId | null
  favourite: boolean
  lastViewedAt: string | null
}

export interface HubRecent {
  reportId: string
  at: string
}

export interface ReportsHub {
  /** Only the reports the caller's role and plan can open, in catalog order. */
  reports: HubReport[]
  /** Favourite report ids, in the order they were starred (only visible ones). */
  favourites: string[]
  /** Last opened first, at most 8 (only visible ones). */
  recent: HubRecent[]
  /** Sales reports can be scheduled (ScheduleModal) by this role. */
  canSchedule: boolean
}
