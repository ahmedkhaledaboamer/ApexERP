import { todayIsoIn } from '@/shared/lib/companyDay'
import { getRegion } from '@/shared/lib/region'

/**
 * Today (yyyy-MM-dd) in the active tenant's timezone (Settings > Company > Regional). Lead
 * follow-ups are company-local calendar dates; compare them with this, never with the browser's day.
 */
export function companyTodayIso(now: Date = new Date()): string {
  return todayIsoIn(getRegion().timezone, now)
}
