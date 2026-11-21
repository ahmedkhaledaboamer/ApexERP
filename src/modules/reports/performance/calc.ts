import { lastYear, r1 } from '@/modules/finance/profitability/calc'

/**
 * KPI formulas of Reports › Company performance (shared by the mock API and the page; unit-tested in calc.test.ts).
 * Every "today" is the COMPANY's calendar day (todayIsoIn(company timezone)); periods are company-local yyyy-MM-dd.
 */

export { dso, roiPct, sameRangeLastYear } from '@/modules/finance/profitability/calc'

/** Win rate % = won ÷ (won + lost) of the deals closed in the period; null when none closed. */
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost
  return closed > 0 ? r1((won / closed) * 100) : null
}

/** Payroll cost % = payroll expense ÷ revenue of the period; null without revenue. */
export function payrollCostPct(payroll: number, revenue: number): number | null {
  return revenue > 0 ? r1((payroll / revenue) * 100) : null
}

/** Gross margin % = (revenue − cost of sales) ÷ revenue; null without revenue. */
export function grossMarginPct(revenue: number, costOfSales: number): number | null {
  return revenue > 0 ? r1(((revenue - costOfSales) / revenue) * 100) : null
}

/** % change from `prev` to `cur`; null without a base. */
export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null
  return r1(((cur - prev) / Math.abs(prev)) * 100)
}

/** Share % of a part in a whole; null without a whole. */
export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? r1((part / whole) * 100) : null
}

export interface Range {
  from: string
  to: string
}

/** First day of the fiscal year containing `day` (fiscal year starts on the 1st of `startMonth`). */
export function fiscalYearStartOf(day: string, startMonth = 1): string {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  const year = m >= startMonth ? y : y - 1
  return `${year}-${String(startMonth).padStart(2, '0')}-01`
}

/**
 * Month-to-date and year-to-date as of `asOf` (the company's today, or the end of the picked period when earlier),
 * with the same dates one year earlier for the comparison.
 */
export function toDatePeriods(asOf: string, fiscalStartMonth = 1): { mtd: Range; mtdLy: Range; ytd: Range; ytdLy: Range } {
  const mtd = { from: `${asOf.slice(0, 7)}-01`, to: asOf }
  const ytd = { from: fiscalYearStartOf(asOf, fiscalStartMonth), to: asOf }
  return { mtd, mtdLy: { from: lastYear(mtd.from), to: lastYear(mtd.to) }, ytd, ytdLy: { from: lastYear(ytd.from), to: lastYear(ytd.to) } }
}

export type PeriodPreset = 'this_month' | 'this_quarter' | 'ytd' | 'last_12' | 'last_year'
export const PERIOD_PRESETS: PeriodPreset[] = ['this_month', 'this_quarter', 'ytd', 'last_12', 'last_year']
export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  this_month: 'This month',
  this_quarter: 'This quarter',
  ytd: 'Year to date',
  last_12: 'Last 12 months',
  last_year: 'Last year',
}

/** A preset period as of the company's `today`. */
export function presetPeriod(preset: PeriodPreset, today: string): Range {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const mm = (n: number) => String(n).padStart(2, '0')
  switch (preset) {
    case 'this_month':
      return { from: `${y}-${mm(m)}-01`, to: today }
    case 'this_quarter':
      return { from: `${y}-${mm(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today }
    case 'last_12':
      return { from: m === 12 ? `${y}-01-01` : `${y - 1}-${mm(m + 1)}-01`, to: today }
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'ytd':
    default:
      return { from: `${y}-01-01`, to: today }
  }
}
