/**
 * Calendar days in the company's timezone. "Today", "overdue" and "this week" are company facts,
 * not browser facts: a task due 2026-11-19 is due "today" for a Riyadh company from midnight
 * Riyadh time, wherever the viewer's laptop is. Everything here works on yyyy-MM-dd strings
 * (UTC arithmetic), so the result never depends on the machine's own timezone.
 *
 * Used by both sides: the task screens (with the tenant's regional settings, shared/lib/region.ts)
 * and the mock API's task selectors (with the company record and the mock clock).
 */

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface DayRule {
  timezone: string
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number
}

export interface CompanyDay {
  today: string
  yesterday: string
  tomorrow: string
  /** First day of the current week (by weekStartsOn), inclusive. */
  weekStart: string
  /** Last day of the current week, inclusive. */
  weekEnd: string
  weekStartsOn: WeekStart
}

const pad = (n: number) => String(n).padStart(2, '0')
const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const fromUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** The calendar date (yyyy-MM-dd) at `now` in `timezone`. An unknown zone falls back to UTC. */
export function todayIsoIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function addDaysIso(iso: string, days: number): string {
  const d = toUtc(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** Day of the week of a yyyy-MM-dd date (0 = Sunday). */
export function weekdayOfIso(iso: string): number {
  return toUtc(iso).getUTCDay()
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

export function normalizeWeekStart(n: number): WeekStart {
  return (Number.isInteger(n) && n >= 0 && n <= 6 ? n : 1) as WeekStart
}

export function weekStartIso(iso: string, weekStartsOn: number): string {
  const back = (weekdayOfIso(iso) - normalizeWeekStart(weekStartsOn) + 7) % 7
  return addDaysIso(iso, -back)
}

export function weekEndIso(iso: string, weekStartsOn: number): string {
  return addDaysIso(weekStartIso(iso, weekStartsOn), 6)
}

/** Today, yesterday, tomorrow and the current week for a company's timezone and week start. */
export function companyDay(rule: DayRule, now: Date = new Date()): CompanyDay {
  const today = todayIsoIn(rule.timezone, now)
  const weekStartsOn = normalizeWeekStart(rule.weekStartsOn)
  const weekStart = weekStartIso(today, weekStartsOn)
  return {
    today,
    yesterday: addDaysIso(today, -1),
    tomorrow: addDaysIso(today, 1),
    weekStart,
    weekEnd: addDaysIso(weekStart, 6),
    weekStartsOn,
  }
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The working week as a label from the weekend days: [0, 6] → "Mon–Fri", [5, 6] → "Sun–Thu",
 * [5] → "Sat–Thu". Non-contiguous working days are listed ("Mon, Wed, Fri").
 */
export function workingWeekLabel(weekend: readonly number[]): string {
  const off = new Set(weekend)
  const working = [0, 1, 2, 3, 4, 5, 6].filter((d) => !off.has(d))
  if (working.length === 0) return 'No working days'
  if (working.length === 7) return 'Every day'
  // Start right after a weekend day so a run that wraps past Saturday stays in one piece.
  const first = working.find((d) => off.has((d + 6) % 7)) ?? working[0]
  const week = [0, 1, 2, 3, 4, 5, 6].map((i) => (first + i) % 7)
  const ordered = week.filter((d) => !off.has(d))
  const contiguous = ordered.every((d, i) => d === week[i])
  if (contiguous && ordered.length > 1) return `${SHORT_DAY[ordered[0]]}–${SHORT_DAY[ordered[ordered.length - 1]]}`
  return ordered.map((d) => SHORT_DAY[d]).join(', ')
}
