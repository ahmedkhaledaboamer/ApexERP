import type { BillRecord } from '@/shared/mocks/data/financePurchases'
import { billStatusFor, isOpenBill } from '@/modules/finance/purchases/calc'
import { round2 } from './ledger'

/**
 * The ONE place a supplier bill's paid / credited / balance and status change (Purchases & payables). Bill
 * payments call `applyToBill(bill, { paid })` (negative to undo on a void); debit notes call it with `{ credited }`;
 * posting sets the opening balance with `openBill`.
 */
export function applyToBill(bill: BillRecord, delta: { paid?: number; credited?: number }, at: string): void {
  bill.amountPaid = round2(bill.amountPaid + (delta.paid ?? 0))
  bill.amountCredited = round2(bill.amountCredited + (delta.credited ?? 0))
  bill.balanceDue = round2(bill.total - bill.amountPaid - bill.amountCredited)
  bill.status = billStatusFor(bill)
  bill.updatedAt = at
}

/** A bill that was just posted: open with its full total. */
export function openBill(bill: BillRecord, at: string): void {
  bill.status = 'open'
  bill.amountPaid = 0
  bill.amountCredited = 0
  applyToBill(bill, {}, at)
}

/** Overdue = open / partially paid with a balance, due before the company's today. */
export const isBillOverdue = (b: Pick<BillRecord, 'status' | 'dueDate' | 'balanceDue'>, today: string): boolean =>
  isOpenBill(b.status) && b.balanceDue > 0 && b.dueDate < today
