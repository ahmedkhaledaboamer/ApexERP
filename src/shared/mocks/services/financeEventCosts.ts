import { toBase } from '@/modules/finance/invoices/calc'
import { round2 } from '@/modules/finance/purchases/calc'
import { eventBudgetLines } from '@/shared/mocks/data/events'
import { finBills, type BillRecord } from '@/shared/mocks/data/financePurchases'
import type { BillLine } from '@/modules/finance/purchases/types'

/**
 * SEAM(event-costs) between Accounts & finance › Purchases and Events › budget (docs/DB-ALIGNMENT.md F-P14 / F-PR4):
 * what POSTED supplier bills charged to an event, per budget line, in base currency (cost = net + VAT the company can't
 * recover). Data-only imports so the Events services and selectors can read it without loading the finance services.
 *
 * NO DOUBLE COUNTING (the same rule as Profitability, services/financeProfitability.ts): a budget line's cost is
 * max(actual, billed) — the bill replaces the typed actual up to its amount, and an actual above the billed amount is
 * still counted (costs not billed through finance yet). Bills charged to the event without a budget line are reported
 * apart (`unlinkedBilled`); the Events ROI leaves them out (they are in the ledger-based Profitability view).
 */

const postedBill = (b: BillRecord) => b.status === 'open' || b.status === 'partially_paid' || b.status === 'paid'
const lineCost = (l: BillLine) => round2(l.net + (l.vatRecoverable ? 0 : l.taxAmount))

export interface LineBilled {
  billed: number
  bills: { id: string; number: string; amount: number }[]
}

/** Billed cost per budget line of an event (lines without bills are absent), plus the event's unlinked billed cost. */
export function billedByLine(co: string, eventId: string): { perLine: Map<string, LineBilled>; unlinked: number } {
  const perLine = new Map<string, LineBilled>()
  let unlinked = 0
  for (const b of finBills) {
    if (b.companyId !== co || !postedBill(b)) continue
    for (const l of b.lines) {
      if (l.eventId !== eventId) continue
      const cost = toBase(lineCost(l), b.exchangeRate)
      if (!l.budgetLineId) {
        unlinked = round2(unlinked + cost)
        continue
      }
      const row = perLine.get(l.budgetLineId) ?? { billed: 0, bills: [] }
      row.billed = round2(row.billed + cost)
      const ref = row.bills.find((x) => x.id === b.id)
      if (ref) ref.amount = round2(ref.amount + cost)
      else row.bills.push({ id: b.id, number: b.number, amount: cost })
      perLine.set(l.budgetLineId, row)
    }
  }
  return { perLine, unlinked }
}

/** A budget line's cost without double counting: max(actual typed by the event team, billed through finance). */
export const lineCostOf = (actual: number, billed: number): number => round2(Math.max(actual, billed))

/** The event's cost from its budget lines (null without lines): Σ max(actual, billed). */
export function budgetLinesCost(co: string, eventId: string): number | null {
  const lines = eventBudgetLines.filter((l) => l.companyId === co && l.eventId === eventId)
  if (!lines.length) return null
  const { perLine } = billedByLine(co, eventId)
  return round2(lines.reduce((s, l) => s + lineCostOf(l.actual, perLine.get(l.id)?.billed ?? 0), 0))
}
