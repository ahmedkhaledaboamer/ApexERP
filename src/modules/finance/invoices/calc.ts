/**
 * Invoice math shared by the mock API and the editor preview (pure; no store access).
 *   gross    = round2(quantity × unitPrice)
 *   net      = round2(gross − discount)            discount is an amount, 0 ≤ discount ≤ gross
 *   tax      = round2(net × rate / 100)            rounded PER LINE (ZATCA / FTA accept line-level rounding)
 *   total    = net + tax
 * Invoice: subtotal = Σ gross, discountTotal = Σ discount, taxTotal = Σ tax, total = subtotal − discountTotal + taxTotal.
 * Base currency: amount × exchangeRate, rounded to 2 decimals (journal lines are base currency).
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export interface LineMath {
  gross: number
  discount: number
  net: number
  taxAmount: number
  total: number
}

export function lineMath(quantity: number, unitPrice: number, discount: number, ratePct: number): LineMath {
  const gross = round2(quantity * unitPrice)
  const disc = round2(Math.min(Math.max(discount || 0, 0), Math.max(gross, 0)))
  const net = round2(gross - disc)
  const taxAmount = round2((net * ratePct) / 100)
  return { gross, discount: disc, net, taxAmount, total: round2(net + taxAmount) }
}

export interface Totals {
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
}

export function totalsOf(lines: LineMath[]): Totals {
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0))
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0))
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0))
  return { subtotal, discountTotal, taxTotal, total: round2(subtotal - discountTotal + taxTotal) }
}

export const toBase = (amount: number, rate: number): number => round2(amount * rate)

/* ---------------- dates (yyyy-MM-dd, UTC arithmetic) ---------------- */

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return fmt(d)
}

/** Adds months, clamping to the month end (31 Jan + 1 → 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  const ny = Math.floor(t / 12)
  const nm = (t % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`
}

export const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 } as const

/** The n-th period date of a schedule (always from the start date, so day 31 stays 31 where it exists). */
export function periodDate(startDate: string, frequency: keyof typeof FREQUENCY_MONTHS, n: number): string {
  return addMonthsIso(startDate, FREQUENCY_MONTHS[frequency] * n)
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

/** Money for screens: 1,234.50 AED. */
export function fmtMoney(amount: number, currency?: string | null): string {
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  return currency ? `${n} ${currency}` : n
}
