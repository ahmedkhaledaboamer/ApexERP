import type { QuotationItem, QuotationStatus, QuotationTotals, QuotationUnit } from '@/modules/quotations/types'
import type { PricingType } from '@/modules/services/types'

/** UAE standard VAT rate. */
export const DEFAULT_VAT_PCT = 5

/** One currency per quotation; AED unless set otherwise. */
export const DEFAULT_QUOTE_CURRENCY = 'AED'

/** Default validity for a new quotation, in days. */

export const DEFAULT_VALIDITY_DAYS = 30

export const UNIT_FOR_PRICING: Record<PricingType, QuotationUnit> = {
  Fixed: 'project',
  Monthly: 'month',
  Hourly: 'hour',
}

export const UNIT_LABELS: Record<QuotationUnit, { one: string; many: string }> = {
  project: { one: 'project', many: 'projects' },
  month: { one: 'month', many: 'months' },
  hour: { one: 'hour', many: 'hours' },
}

export function unitLabel(unit: QuotationUnit, quantity: number): string {
  return quantity === 1 ? UNIT_LABELS[unit].one : UNIT_LABELS[unit].many
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type Line = Pick<QuotationItem, 'quantity' | 'unitPrice' | 'discountPct'>

function safe(n: number): number {
  return Number.isFinite(n) ? n : 0
}

/** Line amount after its discount, before VAT. */
export function lineTotal(item: Line): number {
  const gross = safe(item.quantity) * safe(item.unitPrice)
  const pct = Math.min(100, Math.max(0, safe(item.discountPct)))
  return round2(gross * (1 - pct / 100))
}

/** Same maths on the client (live summary) and the server (source of truth). */
export function computeTotals(items: Line[], vatPct: number): QuotationTotals {
  const subtotal = round2(items.reduce((s, i) => s + safe(i.quantity) * safe(i.unitPrice), 0))
  const net = round2(items.reduce((s, i) => s + lineTotal(i), 0))
  const discount = round2(subtotal - net)
  const vat = round2((net * safe(vatPct)) / 100)
  return { subtotal, discount, vat, total: round2(net + vat) }
}

/** Amount in a given currency (ISO code), e.g. "USD 1,200.00". */
export function fmtIn(value: number, currency: string | null | undefined): string {
  return `${currency || DEFAULT_QUOTE_CURRENCY} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

/** AED with fils, for documents and summaries: "AED 12,500.00". */

export function fmtAed(value: number): string {
  return `AED ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today as yyyy-MM-dd in local time. */
export function todayIso(): string {
  return isoDay(new Date())
}

export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return isoDay(d)
}

/** Whole days from today until a yyyy-MM-dd date (negative when past). */
export function daysUntil(dateIso: string): number {
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d).getTime()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((target - today) / 86_400_000)
}

/** Statuses still waiting on someone. */
export const OPEN_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Viewed']

/** Statuses waiting on the client's answer. */
export const AWAITING_STATUSES: QuotationStatus[] = ['Sent', 'Viewed']

export const QUOTATION_STATUSES: QuotationStatus[] = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired']
