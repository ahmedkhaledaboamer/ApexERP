import type { RegionalSettings } from '@/modules/tenancy/types'

/**
 * The active tenant's regional settings (currency, timezone, date format, country), read by the
 * formatters in shared/lib/utils.ts. TenantProvider sets it when the tenant resolves; before
 * that (login screen, tests) the defaults apply.
 */

export const DEFAULT_REGION: RegionalSettings = {
  country: 'AE',
  currency: 'AED',
  timezone: 'Asia/Dubai',
  language: 'en',
  dateFormat: 'd MMM yyyy',
  weekStartsOn: 1,
  weekend: [0, 6],
  vatPct: 5,
}

let current: RegionalSettings = DEFAULT_REGION
const listeners = new Set<() => void>()

export function getRegion(): RegionalSettings {
  return current
}

export function setRegion(next: RegionalSettings | null): void {
  current = next ?? DEFAULT_REGION
  listeners.forEach((l) => l())
}

/** For useSyncExternalStore (see modules/tenancy/hooks.ts). */
export function subscribeRegion(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Wall-clock time of `date` in the tenant timezone, as a local Date for date-fns `format`.
 * Date-only values (yyyy-MM-dd) are calendar dates and are never shifted.
 */
export function inTenantZone(date: Date, timezone = current.timezone): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  } catch {
    return date
  }
}
