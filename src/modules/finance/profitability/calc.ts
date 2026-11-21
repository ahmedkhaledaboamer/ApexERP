/**
 * Pure rules of Accounts & finance › Profitability and the financial KPIs of Company performance (shared by the mock
 * API and the screens; unit-tested in calc.test.ts). Money is base currency, rounded to 2 decimals.
 */

export const DEFAULT_STANDARD_HOURS = 176
export const MIN_STANDARD_HOURS = 40
export const MAX_STANDARD_HOURS = 320
export const DEFAULT_OVERDUE_AR_ALERT_PCT = 30

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
export const r1 = (n: number): number => Math.round((n + Number.EPSILON) * 10) / 10

/** Hourly cost of an employee: monthly contract pay ÷ standard hours per month (0 when either is missing). */
export function hourlyCost(monthlyPay: number | null, standardHours: number): number {
  if (!monthlyPay || monthlyPay <= 0 || !standardHours || standardHours <= 0) return 0
  return monthlyPay / standardHours
}

export interface LabourEntry {
  hours: number
  /** Monthly pay of the employee's contract in force in the entry's month; null = unknown (no employee / contract). */
  monthlyPay: number | null
}

/**
 * Labour ALLOCATION (not a ledger posting): Σ hours × hourly cost. Hours of people without a known pay are counted as
 * `unratedHours` and cost nothing (shown so the gap is visible, never guessed).
 */
export function labourCostOf(entries: readonly LabourEntry[], standardHours: number): { hours: number; cost: number; unratedHours: number } {
  let hours = 0
  let cost = 0
  let unrated = 0
  for (const e of entries) {
    hours += e.hours
    const rate = hourlyCost(e.monthlyPay, standardHours)
    if (rate > 0) cost += e.hours * rate
    else unrated += e.hours
  }
  return { hours: r2(hours), cost: r2(cost), unratedHours: r2(unrated) }
}

/** Margin % of revenue (null without revenue). */
export function marginPct(revenue: number, margin: number): number | null {
  return revenue > 0 ? r1((margin / revenue) * 100) : null
}

/** Revenue − direct costs − labour (labour left out when it's hidden from the caller: null). */
export function projectMargin(revenue: number, directCosts: number, labourCost: number | null): { totalCost: number; margin: number; marginPct: number | null } {
  const totalCost = r2(directCosts + (labourCost ?? 0))
  const margin = r2(revenue - totalCost)
  return { totalCost, margin, marginPct: marginPct(revenue, margin) }
}

/**
 * Event costs without double counting. The ledger (bills, expenses, claims tagged to the event) is the source of truth.
 * A budget line's actual typed by the event team is only added for the part NOT billed through finance against that
 * line (bills carry `budgetLineId`): extra = Σ max(0, actual − billed). Ledger costs not linked to a line count fully.
 */
export function eventCosts(ledgerCosts: number, lines: readonly { actual: number; billed: number }[]): { ledger: number; budgetLines: number; total: number } {
  const extra = r2(lines.reduce((s, l) => s + Math.max(0, l.actual - l.billed), 0))
  return { ledger: r2(ledgerCosts), budgetLines: extra, total: r2(ledgerCosts + extra) }
}

/**
 * Event revenue without double counting: event-tagged income in the ledger, plus sponsor deals (signed + paid, Events
 * module) only for the part not invoiced yet — sponsor invoices carry the event, so they're already in the ledger.
 */
export function eventRevenue(ledgerIncome: number, sponsorship: number): { ledger: number; notInvoiced: number; total: number } {
  const notInvoiced = r2(Math.max(0, sponsorship - ledgerIncome))
  return { ledger: r2(ledgerIncome), notInvoiced, total: r2(ledgerIncome + notInvoiced) }
}

/** ROI % = (revenue − cost) ÷ cost × 100; null without cost. */
export function roiPct(revenue: number, cost: number): number | null {
  return cost > 0 ? r1(((revenue - cost) / cost) * 100) : null
}

/** Per-unit cost (cost per attendee / lead); null without units or cost. */
export function perUnit(cost: number, units: number): number | null {
  return units > 0 && cost > 0 ? r2(cost / units) : null
}

/**
 * Days sales outstanding = open receivables ÷ credit sales of the period × days in the period. Null without sales.
 * `days` is the number of calendar days of the period (inclusive).
 */
export function dso(outstanding: number, creditSales: number, days: number): number | null {
  if (creditSales <= 0 || days <= 0) return null
  return r1((outstanding / creditSales) * days)
}

/** Inclusive number of calendar days between two yyyy-MM-dd dates. */
export function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86_400_000) + 1)
}

/** Signed line amount on its natural side: income (credit − debit), expense (debit − credit). */
export function naturalAmount(type: 'income' | 'expense', debit: number, credit: number): number {
  return type === 'income' ? credit - debit : debit - credit
}

/** yyyy-MM of a date. */
export const monthOf = (iso: string): string => iso.slice(0, 7)

/** The months [from, to] covers, oldest first (at most `max`, the latest ones). */
export function monthsIn(from: string, to: string, max = 36): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const ey = Number(to.slice(0, 4))
  const em = Number(to.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out.slice(-max)
}

/** The same calendar dates one year earlier (29 Feb → 28 Feb). */
export function lastYear(iso: string): string {
  const y = Number(iso.slice(0, 4)) - 1
  const md = iso.slice(5)
  if (md === '02-29') return `${y}-02-28`
  return `${y}-${md}`
}

export function sameRangeLastYear(from: string, to: string): { from: string; to: string } {
  return { from: lastYear(from), to: lastYear(to) }
}
