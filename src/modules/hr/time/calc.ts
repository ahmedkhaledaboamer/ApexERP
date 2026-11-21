import { addDaysIso, weekdayOfIso } from '@/shared/lib/companyDay'
import { zonedParts } from '@/shared/lib/zonedTime'
import type { Accrual, AttendanceEntry, DailyRecord, DayStatus, HalfDay, MonthSummary, Shift } from './types'

/**
 * Pure attendance and leave arithmetic, shared by the mock API (the contract) and the screens.
 * Every date is a company-local calendar date (yyyy-MM-dd); instants are UTC ISO strings converted
 * with the company timezone (shared/lib/zonedTime.ts), never with the machine's own zone.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100

/** "08:30" → 510. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 510 → "8h 30m" (0 → "0h"). */
export function fmtMinutes(min: number): string {
  const h = Math.floor(Math.abs(min) / 60)
  const m = Math.abs(min) % 60
  return `${min < 0 ? '-' : ''}${h}h${m ? ` ${m}m` : ''}`
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Every date of a month ("2026-11" → 2026-11-01 … 2026-11-30). */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Every date from `from` to `to`, inclusive (empty when to < from). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 800; d = addDaysIso(d, 1)) out.push(d)
  return out
}

/** Working days between two dates: the company weekend and the public holidays are excluded. */
export function workingDates(from: string, to: string, weekend: readonly number[], holidays: ReadonlyMap<string, string> | ReadonlySet<string>): string[] {
  const off = new Set(weekend)
  return datesBetween(from, to).filter((d) => !off.has(weekdayOfIso(d)) && !holidays.has(d))
}

/** Leave days of a request: working days, or 0.5 for a half day on a working day. */
export function leaveDayCount(from: string, to: string, halfDay: HalfDay | null, weekend: readonly number[], holidays: ReadonlyMap<string, string> | ReadonlySet<string>): { days: number; dates: string[] } {
  const dates = workingDates(from, to, weekend, holidays)
  if (halfDay) return { days: dates.length ? 0.5 : 0, dates }
  return { days: dates.length, dates }
}

/** Do two leave ranges overlap? Two half days of the same date overlap only when they take the same half. */
export function rangesOverlap(
  a: { startDate: string; endDate: string; halfDay: HalfDay | null },
  b: { startDate: string; endDate: string; halfDay: HalfDay | null },
): boolean {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false
  if (a.halfDay && b.halfDay && a.startDate === b.startDate && a.halfDay !== b.halfDay) return false
  return true
}

/* ---------------- Accrual ---------------- */

const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]

/** Months of service credited in `year`: the hire month counts when hired on or before the 15th. */
function firstCreditedMonth(hireDate: string, year: number): number | null {
  const [hy, hm, hd] = ymd(hireDate)
  if (hy > year) return null
  if (hy < year) return 1
  const m = hd <= 15 ? hm : hm + 1
  return m > 12 ? null : m
}

/** The year's entitlement: the full days per year, prorated by month for the hire year (0.5-day steps). */
export function entitledDays(daysPerYear: number, hireDate: string, year: number): number {
  const first = firstCreditedMonth(hireDate, year)
  if (first === null) return 0
  const months = 12 - first + 1
  return months === 12 ? daysPerYear : Math.round(((daysPerYear * months) / 12) * 2) / 2
}

/**
 * Days accrued in `year` as of `asOf` (company-local date).
 *  - yearly: the whole (prorated) entitlement is credited upfront on 1 January (or the hire month);
 *  - monthly: daysPerYear / 12 is credited at the start of each month of service, up to asOf's month.
 */
export function accruedDays(rule: { daysPerYear: number; accrual: Accrual }, hireDate: string, year: number, asOf: string): number {
  const first = firstCreditedMonth(hireDate, year)
  const [ay, am] = ymd(asOf)
  if (first === null || ay < year) return 0
  if (rule.accrual === 'yearly') return entitledDays(rule.daysPerYear, hireDate, year)
  const last = ay > year ? 12 : am
  const months = Math.max(0, last - first + 1)
  return r2((rule.daysPerYear * months) / 12)
}

/** Carry-over into `year`: what was left of the previous year's full accrual, capped. */
export function carriedDays(rule: { daysPerYear: number; accrual: Accrual; carryOverMax: number }, hireDate: string, year: number, usedPrevYear: number): number {
  if (rule.carryOverMax <= 0) return 0
  const prev = year - 1
  if (ymd(hireDate)[0] > prev) return 0
  const left = accruedDays(rule, hireDate, prev, `${prev}-12-31`) - usedPrevYear
  return r2(Math.min(rule.carryOverMax, Math.max(0, left)))
}

/* ---------------- Daily attendance ---------------- */

export interface DayInput {
  employeeId: string
  date: string
  timezone: string
  shift: Pick<Shift, 'id' | 'startTime' | 'endTime' | 'breakMinutes' | 'graceMinutes' | 'workingDays'>
  /** The employee's entries whose workDate is `date`. */
  entries: Pick<AttendanceEntry, 'id' | 'checkInAt' | 'checkOutAt'>[]
  holidayName: string | null
  leave: { typeName: string; halfDay: HalfDay | null } | null
  now: Date
}

/** The break is deducted once the day's worked time reaches 5 hours. */
export const BREAK_AFTER_MINUTES = 300

const minutesOf = (iso: string, tz: string) => toMinutes(zonedParts(iso, tz).time)

/**
 * One employee day in the company timezone:
 *   full-day approved leave → on_leave · public holiday → holiday · not a shift day → weekend
 *   half-day leave → half_day · no clock-in → absent (in progress while today's shift hasn't ended,
 *   or the date is in the future) · first clock-in after start + grace → late (late minutes counted
 *   from the shift start) · else present.
 * Worked minutes = closed entries (break deducted from 5 h); overtime = worked beyond the scheduled
 * minutes (everything on a weekend / holiday); early leave = shift end − last clock-out.
 * A clock-in without a clock-out on a past day is a missing clock-out (not counted as worked).
 */
export function computeDay(input: DayInput): DailyRecord {
  const { date, timezone: tz, shift, now } = input
  const nowLocal = zonedParts(now, tz)
  const isToday = date === nowLocal.date
  const isFuture = date > nowLocal.date
  const entries = [...input.entries].sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
  const closed = entries.filter((e) => e.checkOutAt)
  const open = isToday && entries.some((e) => !e.checkOutAt)
  const missingCheckOut = !isToday && !isFuture && entries.some((e) => !e.checkOutAt)
  const total = closed.reduce((s, e) => s + Math.max(0, Math.round((Date.parse(e.checkOutAt!) - Date.parse(e.checkInAt)) / 60_000)), 0)
  const worked = total >= BREAK_AFTER_MINUTES ? Math.max(0, total - shift.breakMinutes) : total
  const start = toMinutes(shift.startTime)
  const end = toMinutes(shift.endTime)
  const scheduled = Math.max(0, end - start - shift.breakMinutes)
  const first = entries[0] ?? null
  const lastClosed = closed.length ? closed.reduce((a, b) => (a.checkOutAt! > b.checkOutAt! ? a : b)) : null
  const isShiftDay = shift.workingDays.includes(weekdayOfIso(date))

  let status: DayStatus
  let late = 0
  let early = 0
  let overtime = 0
  let inProgress = false
  if (input.leave && !input.leave.halfDay) {
    status = 'on_leave'
  } else if (input.holidayName) {
    status = 'holiday'
    overtime = worked
  } else if (!isShiftDay) {
    status = 'weekend'
    overtime = worked
  } else if (input.leave?.halfDay) {
    status = 'half_day'
  } else if (!first) {
    status = 'absent'
    inProgress = isFuture || (isToday && toMinutes(nowLocal.time) < end)
  } else {
    const firstIn = minutesOf(first.checkInAt, tz)
    late = firstIn > start + shift.graceMinutes ? firstIn - start : 0
    status = late > 0 ? 'late' : 'present'
    if (lastClosed && !open) early = Math.max(0, end - minutesOf(lastClosed.checkOutAt!, tz))
    overtime = Math.max(0, worked - scheduled)
  }

  return {
    employeeId: input.employeeId,
    workDate: date,
    status,
    checkInAt: first?.checkInAt ?? null,
    checkOutAt: lastClosed?.checkOutAt ?? null,
    checkInLocal: first ? zonedParts(first.checkInAt, tz).time : null,
    checkOutLocal: lastClosed ? zonedParts(lastClosed.checkOutAt!, tz).time : null,
    minutesWorked: worked,
    lateMinutes: late,
    earlyLeaveMinutes: early,
    overtimeMinutes: overtime,
    missingCheckOut,
    open,
    shiftId: shift.id,
    holidayName: input.holidayName,
    leaveTypeName: input.leave?.typeName ?? null,
    inProgress,
    entryIds: entries.map((e) => e.id),
  }
}

export function summarize(days: readonly DailyRecord[]): MonthSummary {
  const s: MonthSummary = { workingDays: 0, present: 0, late: 0, absent: 0, onLeave: 0, halfDays: 0, holidays: 0, minutesWorked: 0, lateMinutes: 0, overtimeMinutes: 0, missingCheckOuts: 0 }
  for (const d of days) {
    if (d.status !== 'weekend' && d.status !== 'holiday') s.workingDays++
    if (d.status === 'present' || d.status === 'late') s.present++
    if (d.status === 'late') s.late++
    if (d.status === 'absent' && !d.inProgress) s.absent++
    if (d.status === 'on_leave') s.onLeave++
    if (d.status === 'half_day') s.halfDays++
    if (d.status === 'holiday') s.holidays++
    if (d.missingCheckOut) s.missingCheckOuts++
    s.minutesWorked += d.minutesWorked
    s.lateMinutes += d.lateMinutes
    s.overtimeMinutes += d.overtimeMinutes
  }
  return s
}

/** The working weekdays of a company weekend ([0, 6] → Mon–Fri = [1, 2, 3, 4, 5]). */
export function workingDaysFromWeekend(weekend: readonly number[]): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d))
}
