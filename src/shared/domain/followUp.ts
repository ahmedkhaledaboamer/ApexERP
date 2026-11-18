import { addDaysIso, daysBetweenIso, todayIsoIn } from '@/shared/lib/companyDay'

/**
 * Lead follow-ups are company-local CALENDAR DATES (yyyy-MM-dd), never datetimes: "due today" means
 * today in the company's timezone (Settings > Company > Regional), whatever the viewer's laptop says.
 * Pure string arithmetic, shared by the screens (with the tenant region) and the mock API (with the
 * company record and the mock clock, selectors/company.ts `companyDayOf`).
 */

export type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'none'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in yyyy-MM-dd form (2026-02-30 is not). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Where a follow-up date stands on `today` (both yyyy-MM-dd, company-local). Closed leads have none. */
export function followUpStateOn(date: string | null | undefined, today: string, closed = false): FollowUpState {
  if (!date || closed || !isIsoDate(date)) return 'none'
  if (date === today) return 'today'
  return date < today ? 'overdue' : 'upcoming'
}

/** Whole days a follow-up is late on `today` (0 when not late). */
export function daysLate(date: string | null | undefined, today: string): number {
  return date && isIsoDate(date) ? Math.max(0, daysBetweenIso(date, today)) : 0
}

/** `days` after `today` (No response: +noResponseFollowUpDays; reopen: +1). */
export function followUpInDays(today: string, days: number): string {
  return addDaysIso(today, days)
}

/**
 * Migration helper: a stored value that may still be an ISO datetime (older data, seeds) as the
 * company-local date it falls on. yyyy-MM-dd values pass through unchanged; junk gives null.
 */
export function toFollowUpDate(value: string | null | undefined, timezone: string): string | null {
  if (!value) return null
  if (isIsoDate(value)) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : todayIsoIn(timezone, d)
}
