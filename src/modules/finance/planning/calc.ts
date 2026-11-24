import type { AgingBucket, BvaStatus, ForecastBucket, ForecastCategory, ForecastItem, SpreadPattern } from './types'
import { AGING_BUCKETS } from './types'

/**
 * Pure planning rules (no store access): budget spreads, copying actuals ± %, variance, the 90 % / 100 % alert
 * levels, and the cash-flow forecast buckets.
 */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const sum = (xs: readonly number[]) => r2(xs.reduce((s, x) => s + x, 0))

/* ---------------- budgets ---------------- */

const WEIGHTS: Record<Exclude<SpreadPattern, 'last_year'>, number[]> = {
  even: Array(12).fill(1),
  front_loaded: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  back_loaded: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}

/**
 * Spreads an annual amount over 12 months by weights (rounded to 2 decimals; the rounding difference goes to the last
 * month, so the months always add up to the annual amount). `profile` (e.g. last year's actuals) is used when its
 * total is positive, else the spread is even.
 */
export function spreadAnnual(annual: number, pattern: SpreadPattern = 'even', profile?: readonly number[]): number[] {
  const a = r2(annual)
  let w: number[] = pattern === 'last_year' ? [...(profile ?? [])].map((x) => Math.max(0, x)) : WEIGHTS[pattern]
  if (w.length !== 12 || sum(w) <= 0) w = WEIGHTS.even
  const total = w.reduce((s, x) => s + x, 0)
  const months = w.map((x) => r2((a * x) / total))
  months[11] = r2(a - sum(months.slice(0, 11)))
  return months
}

/** Last year's monthly actuals × (1 + pct / 100), rounded. */
export function copyWithAdjustment(actuals: readonly number[], pct: number): number[] {
  return actuals.map((x) => r2(Math.max(0, x) * (1 + pct / 100)))
}

/** Favourable variance (positive = good): expense budget − actual; income actual − budget. */
export function variance(type: 'income' | 'expense', budget: number, actual: number): number {
  return r2(type === 'expense' ? budget - actual : actual - budget)
}
export const pctOf = (part: number, whole: number): number | null => (whole > 0 ? r2((part / whole) * 100) : null)

/** Alert levels: ≥ 100 % over, ≥ 90 % warning (expense budgets). */
export const ALERT_LEVELS = [90, 100] as const
export function statusOf(pct: number | null): BvaStatus {
  if (pct === null) return 'ok'
  return pct >= 100 ? 'over' : pct >= 90 ? 'warning' : 'ok'
}
/** The highest alert level reached (null below 90 %). */
export function levelReached(actual: number, budget: number): 90 | 100 | null {
  if (budget <= 0 || actual <= 0) return null
  const p = (actual / budget) * 100
  return p >= 100 ? 100 : p >= 90 ? 90 : null
}

/* ---------------- forecast ---------------- */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
const pad = (n: number) => String(n).padStart(2, '0')
export function monthEndOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
/** The same day-of-month in month `ym` (clamped to the month's last day). */
export function dayInMonth(ym: string, day: number): string {
  const last = Number(monthEndOf(ym).slice(8, 10))
  return `${ym}-${pad(Math.min(Math.max(1, day), last))}`
}

/** Aging bucket of an invoice at `today` (by days past the due date). */
export function agingBucketOf(dueDate: string, today: string): AgingBucket {
  const d = daysBetween(dueDate, today)
  if (d <= 0) return 'current'
  if (d <= 30) return 'd1_30'
  if (d <= 60) return 'd31_60'
  if (d <= 90) return 'd61_90'
  return 'd90_plus'
}

export const DEFAULT_PROBABILITIES: Record<AgingBucket, number> = { current: 95, d1_30: 85, d31_60: 70, d61_90: 50, d90_plus: 20 }

/**
 * When an invoice's cash is expected: its due date when not yet due; overdue ones are expected 7 days later per
 * aging bucket (1–30 → +7, 31–60 → +14, 61–90 → +21, 90+ → +28 days from today).
 */
export function expectedInvoiceDate(dueDate: string, today: string): string {
  if (dueDate >= today) return dueDate
  const i = AGING_BUCKETS.indexOf(agingBucketOf(dueDate, today))
  return addDays(today, 7 * i)
}

/** 13 weekly buckets starting today (week 1 = today … today + 6). */
export function weekRanges(today: string, weeks = 13): { key: string; label: string; from: string; to: string }[] {
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(today, i * 7)
    const to = addDays(from, 6)
    return { key: `W${i + 1}`, label: `Week ${i + 1}`, from, to }
  })
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 6 monthly buckets: the rest of this month, then the next 5 months. */
export function monthRanges(today: string, months = 6): { key: string; label: string; from: string; to: string }[] {
  return Array.from({ length: months }, (_, i) => {
    const ym = addMonths(today.slice(0, 7), i)
    return { key: ym, label: `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`, from: i === 0 ? today : `${ym}-01`, to: monthEndOf(ym) }
  })
}

/** Sums the items into buckets with running opening / closing balances. Items outside every bucket are ignored. */
export function bucketize(opening: number, items: readonly ForecastItem[], ranges: readonly { key: string; label: string; from: string; to: string }[]): ForecastBucket[] {
  let bal = r2(opening)
  return ranges.map((r) => {
    const inRange = items.filter((i) => i.date >= r.from && i.date <= r.to)
    const inflows = sum(inRange.filter((i) => i.amount > 0).map((i) => i.amount))
    const outflows = sum(inRange.filter((i) => i.amount < 0).map((i) => i.amount))
    const byCat = new Map<ForecastCategory, number>()
    for (const i of inRange) byCat.set(i.category, r2((byCat.get(i.category) ?? 0) + i.amount))
    const net = r2(inflows + outflows)
    const b: ForecastBucket = { key: r.key, label: r.label, from: r.from, to: r.to, opening: bal, inflows, outflows, net, closing: r2(bal + net), byCategory: [...byCat].map(([category, amount]) => ({ category, amount })) }
    bal = b.closing
    return b
  })
}

/** The bucket with the lowest closing balance (the first one on a tie). */
export function lowestOf(buckets: readonly ForecastBucket[]): ForecastBucket {
  return buckets.reduce((lo, b) => (b.closing < lo.closing ? b : lo), buckets[0])
}

/** Expected amount: gross × probability % × (1 + scenario %). */
export const expected = (gross: number, probability: number, scenarioPct: number) => r2(gross * (probability / 100) * (1 + scenarioPct / 100))
