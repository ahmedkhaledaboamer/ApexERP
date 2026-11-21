import type { Invoice, InvoiceStatus } from '@/modules/finance/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { round2 } from './ledger'

/**
 * The one place an invoice's paid / credited / balance and status change (contract between the
 * invoices section and the payments / credit-note sections). Payments call `applyToInvoice(inv, { paid })`
 * (negative to undo), credit notes call it with `{ credited }`.
 */
export function applyToInvoice(inv: Tenant<Invoice>, delta: { paid?: number; credited?: number }, at: string): void {
  inv.amountPaid = round2(inv.amountPaid + (delta.paid ?? 0))
  inv.amountCredited = round2(inv.amountCredited + (delta.credited ?? 0))
  inv.balanceDue = round2(inv.total - inv.amountPaid - inv.amountCredited)
  inv.status = statusFor(inv)
  inv.updatedAt = at
}

export function statusFor(inv: Pick<Invoice, 'status' | 'total' | 'amountPaid' | 'amountCredited' | 'balanceDue'>): InvoiceStatus {
  if (inv.status === 'draft' || inv.status === 'void') return inv.status
  if (inv.balanceDue <= 0) return 'paid'
  if (inv.amountPaid > 0 || inv.amountCredited > 0) return 'partially_paid'
  return 'issued'
}

/** Overdue = open, balance > 0 and due before the company's today. */
export const isOverdue = (inv: Pick<Invoice, 'status' | 'dueDate' | 'balanceDue'>, today: string): boolean =>
  (inv.status === 'issued' || inv.status === 'partially_paid') && inv.balanceDue > 0 && !!inv.dueDate && inv.dueDate < today
