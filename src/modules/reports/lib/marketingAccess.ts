import type { Role } from '@/shared/types'
import { can, scopeOf } from '@/shared/lib/permissions'

/**
 * Marketing reports (cost per lead by campaign): Marketing view AND a Reports scope of `full` or
 * `marketing` (the marketing report family). Same rule as the API (services/marketing.ts).
 */
export function canSeeMarketingReportsRole(role: Role): boolean {
  const reports = scopeOf(role, 'reports')
  return can(role, 'marketing', 'view') && (reports === 'full' || reports === 'marketing')
}
