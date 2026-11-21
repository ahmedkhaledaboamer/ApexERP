import { lineMath, round2 } from '@/modules/finance/invoices/calc'
import type { ApBucket, BillStatus, MatchIssue } from './types'

/**
 * Purchases & payables math shared by the mock API and the screens (pure; no store access).
 *   line   net = round2(qty × unit price), tax = round2(net × rate / 100) per line, total = net + tax (no discounts on purchases)
 *   bill   cost per line = net + (VAT recoverable ? 0 : tax) — non-recoverable VAT is part of the expense
 *   base   amount × exchange rate, rounded to 2 decimals
 */

export { round2 }

export function purchaseLine(quantity: number, unitPrice: number, ratePct: number): { net: number; taxAmount: number; total: number } {
  const m = lineMath(quantity, unitPrice, 0, ratePct)
  return { net: m.net, taxAmount: m.taxAmount, total: m.total }
}

export function purchaseTotals(lines: { net: number; taxAmount: number }[]): { subtotal: number; taxTotal: number; total: number } {
  const subtotal = round2(lines.reduce((s, l) => s + l.net, 0))
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0))
  return { subtotal, taxTotal, total: round2(subtotal + taxTotal) }
}

/** VAT is recoverable (Dr VAT input) only for a supplier with a VAT number on a standard-rated line. */
export function isVatRecoverable(supplierVatNumber: string, taxCategory: string | undefined): boolean {
  return !!supplierVatNumber.trim() && taxCategory === 'standard'
}

/**
 * 2-/3-way match of one bill line against its PO line. Price: the unit price may differ from the PO by at most
 * `tolerancePct` percent. Quantity: everything billed so far (other bills + this one) may not exceed what was
 * ordered (2-way) or, once the PO has goods receipts (3-way), what was received.
 */
export function matchLine(
  bill: { lineId: string; description: string; quantity: number; unitPrice: number },
  po: { quantity: number; unitPrice: number; receivedQty: number; billedElsewhere: number },
  threeWay: boolean,
  tolerancePct: number,
): MatchIssue[] {
  const out: MatchIssue[] = []
  const base = { lineId: bill.lineId, description: bill.description }
  if (po.unitPrice > 0) {
    const diffPct = (Math.abs(bill.unitPrice - po.unitPrice) / po.unitPrice) * 100
    if (diffPct > tolerancePct + 1e-9) out.push({ ...base, kind: 'price', message: `Unit price ${bill.unitPrice} differs from the PO (${po.unitPrice}) by ${round2(diffPct)}% (tolerance ${tolerancePct}%).` })
  } else if (bill.unitPrice > 0) {
    out.push({ ...base, kind: 'price', message: `The PO line has no price; the bill charges ${bill.unitPrice}.` })
  }
  const billed = round2(po.billedElsewhere + bill.quantity)
  if (threeWay && billed > po.receivedQty + 1e-9) {
    out.push({ ...base, kind: 'not_received', message: `Billed ${billed} but only ${po.receivedQty} received.` })
  } else if (billed > po.quantity + 1e-9) {
    out.push({ ...base, kind: 'quantity', message: `Billed ${billed} but ${po.quantity} ordered.` })
  }
  return out
}

/** Aging bucket by days past due (≤ 0 = current). */
export function apBucketOf(daysOverdue: number): ApBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd30'
  if (daysOverdue <= 60) return 'd60'
  if (daysOverdue <= 90) return 'd90'
  return 'over90'
}

/** Status of a posted bill from its balance (drafts / pending / rejected / void keep theirs). */
export function billStatusFor(b: { status: BillStatus; balanceDue: number; amountPaid: number; amountCredited: number }): BillStatus {
  if (b.status === 'draft' || b.status === 'pending_approval' || b.status === 'rejected' || b.status === 'void') return b.status
  if (b.balanceDue <= 0) return 'paid'
  if (b.amountPaid > 0 || b.amountCredited > 0) return 'partially_paid'
  return 'open'
}

export const isOpenBill = (s: BillStatus) => s === 'open' || s === 'partially_paid'

/** "•••• 1234" for a stored IBAN ('' when none). */
export const maskIban = (iban: string): string => (iban ? `•••• ${iban.slice(-4)}` : '')

/** IBAN shape (2 letters, 2 check digits, 11–30 alphanumerics) and the mod-97 check. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const moved = iban.slice(4) + iban.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}
