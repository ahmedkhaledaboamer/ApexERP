import { addDaysIso, daysBetweenIso, todayIsoIn } from '@/shared/lib/companyDay'
import type { ExpiryBucket, FunnelStage } from './types'

/**
 * Pure aggregation rules of HR › Reports, shared by the mock API (the contract) and unit-tested in
 * calc.test.ts. Everything works on company-local yyyy-MM-dd strings (UTC arithmetic), so the results
 * never depend on the machine's timezone; "today" comes from the company timezone (todayIsoIn).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDay = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

export const round1 = (n: number) => Math.round(n * 10) / 10
export const round2 = (n: number) => Math.round(n * 100) / 100

/** Share in percent with one decimal; null when there is nothing to divide by. */
export function sharePct(part: number, total: number): number | null {
  if (!total) return null
  return round1((part / total) * 100)
}

/* ---------------- Date range ---------------- */

/** The longest range a report accepts (inclusive months). */
export const MAX_RANGE_MONTHS = 36

export type RangeResult = { ok: true; from: string; to: string; asOf: string } | { ok: false; message: string }

/**
 * The report period: defaults to the company's current year (1 Jan → 31 Dec of today's year in the company
 * timezone). `asOf` = min(to, today) is the day point-in-time figures use. Invalid → a message (422).
 */
export function resolveRange(today: string, from?: unknown, to?: unknown): RangeResult {
  const year = today.slice(0, 4)
  const f = from === undefined || from === null || from === '' ? `${year}-01-01` : from
  const t = to === undefined || to === null || to === '' ? `${year}-12-31` : to
  if (!isIsoDay(f) || !isIsoDay(t)) return { ok: false, message: 'Pick valid dates (yyyy-MM-dd).' }
  if (f > t) return { ok: false, message: 'The start date must be on or before the end date.' }
  if (monthsBetween(f, t).length > MAX_RANGE_MONTHS) return { ok: false, message: `Pick a period of at most ${MAX_RANGE_MONTHS} months.` }
  return { ok: true, from: f, to: t, asOf: t < today ? t : f > today ? f : today }
}

/** The company's calendar day at an instant (re-exported for the reports: one place for "today"). */
export const companyToday = (timezone: string, at: Date) => todayIsoIn(timezone, at)

/** yyyy-MM of every month touched by [from, to]. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endY = Number(to.slice(0, 4))
  const endM = Number(to.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
    if (out.length > 1200) break
  }
  return out
}

export const monthStart = (month: string) => `${month}-01`
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

/** The part of a month inside [from, to] (null when they don't meet). */
export function clipMonth(month: string, from: string, to: string): { start: string; end: string } | null {
  const start = monthStart(month) < from ? from : monthStart(month)
  const end = monthEnd(month) > to ? to : monthEnd(month)
  return start <= end ? { start, end } : null
}

export const inRange = (date: string | null | undefined, from: string, to: string): date is string => !!date && date >= from && date <= to

/* ---------------- Headcount ---------------- */

export interface StaffLike {
  hireDate: string
  status: string
  exitDate: string | null
  updatedAt: string
}

/**
 * The last working day of an employee who left, else null. `exit_date` when set; a terminated record without
 * one counts as leaving on the day it was last updated (data entered before exit dates were required).
 */
export function leftOn(e: StaffLike): string | null {
  if (e.exitDate) return e.exitDate
  return e.status === 'terminated' ? e.updatedAt.slice(0, 10) : null
}

/** On the payroll on `date`: hired on or before it and not left before it (the exit date is a working day). */
export function employedOn(e: StaffLike, date: string): boolean {
  if (!e.hireDate || e.hireDate > date) return false
  const left = leftOn(e)
  return !left || left >= date
}

export function headcountOn(rows: readonly StaffLike[], date: string): number {
  return rows.reduce((n, e) => n + (employedOn(e, date) ? 1 : 0), 0)
}

/** Group and count (sorted by count, then label). */
export function countBy<T>(rows: readonly T[], keyOf: (r: T) => string, labelOf: (key: string) => string): { key: string; label: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1)
  return [...m.entries()].map(([key, count]) => ({ key, label: labelOf(key), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/* ---------------- Turnover ---------------- */

export interface TurnoverMonthCalc {
  month: string
  joiners: number
  leavers: number
  opening: number
  closing: number
  averageHeadcount: number
  turnoverPct: number | null
}

/**
 * Per month of [from, to] (months clipped to the range):
 *   joiners  hired inside the clipped month
 *   leavers  last working day inside the clipped month
 *   opening  headcount at the end of the day before the clipped start
 *   closing  headcount on the clipped end
 *   turnover leavers ÷ average headcount, average = (opening + closing) ÷ 2
 */
export function turnoverByMonth(rows: readonly StaffLike[], from: string, to: string): TurnoverMonthCalc[] {
  return monthsBetween(from, to).map((month) => {
    const clip = clipMonth(month, from, to)!
    const joiners = rows.filter((e) => inRange(e.hireDate, clip.start, clip.end)).length
    const leavers = rows.filter((e) => inRange(leftOn(e), clip.start, clip.end)).length
    const opening = headcountOn(rows, addDaysIso(clip.start, -1))
    const closing = headcountOn(rows, clip.end)
    const averageHeadcount = round1((opening + closing) / 2)
    return { month, joiners, leavers, opening, closing, averageHeadcount, turnoverPct: turnoverPct(leavers, averageHeadcount) }
  })
}

/** Leavers ÷ average headcount × 100 (one decimal); null with no headcount. */
export function turnoverPct(leavers: number, averageHeadcount: number): number | null {
  if (!(averageHeadcount > 0)) return null
  return round1((leavers / averageHeadcount) * 100)
}

/** Turnover of the whole period: all leavers ÷ the mean of the monthly average headcounts. */
export function periodTurnover(months: readonly TurnoverMonthCalc[]): { joiners: number; leavers: number; averageHeadcount: number; turnoverPct: number | null } {
  const joiners = months.reduce((s, m) => s + m.joiners, 0)
  const leavers = months.reduce((s, m) => s + m.leavers, 0)
  const averageHeadcount = months.length ? round1(months.reduce((s, m) => s + m.averageHeadcount, 0) / months.length) : 0
  return { joiners, leavers, averageHeadcount, turnoverPct: turnoverPct(leavers, averageHeadcount) }
}

/** Whole years between two dates (one decimal, never negative). */
export function tenureYears(hireDate: string, asOf: string): number {
  return Math.max(0, round1(daysBetweenIso(hireDate, asOf) / 365.25))
}

export function averageOf(values: readonly number[]): number | null {
  return values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null
}

/* ---------------- Nationalisation ---------------- */

/** Nationals ÷ headcount on a day (Emiratisation: AE, Saudization: SA). */
export function nationalisationOn(rows: readonly (StaffLike & { nationality: string })[], country: string, date: string): { nationals: number; total: number; pct: number | null } {
  const on = rows.filter((e) => employedOn(e, date))
  const nationals = on.filter((e) => e.nationality === country).length
  return { nationals, total: on.length, pct: sharePct(nationals, on.length) }
}

export function nationalisationLabel(country: string): string {
  if (country === 'AE') return 'Emiratisation'
  if (country === 'SA') return 'Saudization'
  return 'Nationalisation'
}

/** Percentage points to reach the target (0 when reached); null without a target or a headcount. */
export function gapToTarget(pct: number | null, target: number | null): number | null {
  if (pct === null || target === null) return null
  return Math.max(0, round1(target - pct))
}

/* ---------------- Expiries ---------------- */

/** Bucket of an expiry date relative to today; null when more than 90 days away. */
export function expiryBucket(today: string, date: string): ExpiryBucket | null {
  const days = daysBetweenIso(today, date)
  if (days < 0) return 'expired'
  if (days <= 30) return 'd30'
  if (days <= 60) return 'd60'
  if (days <= 90) return 'd90'
  return null
}

/* ---------------- Recruitment funnel ---------------- */

export const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'assessment', 'offer', 'hired'] as const
export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]

export interface FunnelInput {
  stage: string
  /** The application had an interview (so a rejected candidate still counts as having reached interview). */
  interviewed?: boolean
  /** The application had an offer. */
  offered?: boolean
}

/** How far an application got: its current stage, or the furthest stage its interviews / offers prove. */
export function furthestStage(a: FunnelInput): number {
  let idx = FUNNEL_STAGES.indexOf(a.stage as FunnelStageKey)
  if (idx < 0) idx = 0 // rejected / withdrawn: at least applied
  if (a.interviewed) idx = Math.max(idx, FUNNEL_STAGES.indexOf('interview'))
  if (a.offered) idx = Math.max(idx, FUNNEL_STAGES.indexOf('offer'))
  return idx
}

/** Applications that reached each stage, and the conversion from the previous stage (one decimal). */
export function funnel(apps: readonly FunnelInput[], labels: Record<string, string>): FunnelStage[] {
  const reached = FUNNEL_STAGES.map(() => 0)
  for (const a of apps) {
    const top = furthestStage(a)
    for (let i = 0; i <= top; i++) reached[i]++
  }
  return FUNNEL_STAGES.map((stage, i) => ({
    stage,
    label: labels[stage] ?? stage,
    reached: reached[i],
    conversionPct: i === 0 ? null : sharePct(reached[i], reached[i - 1]),
  }))
}

/** Whole days from an application to its hire (start of the application → offer accepted). */
export function daysToHire(appliedAt: string, hiredAt: string): number {
  return Math.max(0, daysBetweenIso(appliedAt.slice(0, 10), hiredAt.slice(0, 10)))
}

/* ---------------- Pay (committed) ---------------- */

export interface ContractLike {
  status: string
  startDate: string
  endDate: string | null
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowance: number
}

export const monthlyPay = (c: ContractLike) => round2(c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance)

/** A (non-draft) contract in force during some part of the month. */
export function contractCoversMonth(c: ContractLike, month: string): boolean {
  if (c.status === 'draft') return false
  return c.startDate <= monthEnd(month) && (!c.endDate || c.endDate >= monthStart(month))
}

/* ---------------- CSV ---------------- */

const FORMULA = /^[=+\-@\t\r]/

/** One CSV cell (RFC 4180 quoting; formula-looking text is prefixed with an apostrophe). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value === 'string' && FORMULA.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}
