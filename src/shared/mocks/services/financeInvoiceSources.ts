import type { Contract } from '@/modules/crm/types'
import type { QuotationRecord } from '@/modules/quotations/types'
import type { InvoiceLineInput } from '@/modules/finance/invoices/types'
import { lineMath, round2 } from '@/modules/finance/invoices/calc'
import type { Tenant } from '@/shared/mocks/tenant'
import { financeTaxCodes } from '@/shared/mocks/data/finance'
import { invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { invoiceSettingsFor } from './financeInvoiceSettings'

/**
 * Invoicing from a quotation / contract / won deal (prefilled lines, link kept).
 *   - A quotation (or a one-off contract) can be invoiced up to 100% in total: every non-void invoice
 *     linked to it counts its `billingPct` (drafts too, so two drafts can't both bill the same 100%).
 *   - 100% at once copies the quotation lines; a partial % / milestone is one line for that share of
 *     the quotation's net total; the invoice that reaches 100% takes the exact remainder (no rounding drift).
 *   - Monthly / annual contracts bill one period per invoice (no cap); recurring schedules automate them.
 */

/** Quotation net total (after line discounts, before VAT), in the quotation currency. */
export function quotationNet(q: QuotationRecord): number {
  return round2(q.items.reduce((s, it) => s + lineMath(it.quantity, it.unitPrice, (it.quantity * it.unitPrice * it.discountPct) / 100, 0).net, 0))
}

const live = (co: string) => invoiceRecords.filter((i) => i.companyId === co && i.status !== 'void')

export function quotationInvoices(co: string, quotationId: string) {
  return live(co).filter((i) => i.quotationId === quotationId)
}

export function invoicedPctOfQuotation(co: string, quotationId: string): number {
  return round2(Math.min(100, quotationInvoices(co, quotationId).reduce((s, i) => s + (i.billingPct ?? 0), 0)))
}

export function contractInvoices(co: string, c: Contract) {
  return live(co).filter((i) => i.contractId === c.id || (!!c.quotationId && i.quotationId === c.quotationId))
}

export function invoicedPctOfContract(co: string, c: Contract): number {
  if (c.billing !== 'One-off') return 0
  return round2(Math.min(100, contractInvoices(co, c).reduce((s, i) => s + (i.billingPct ?? 0), 0)))
}

/** The company tax code for a quotation VAT %: the standard code at that rate, zero-rated for 0. */
export function taxCodeForPct(co: string, pct: number): string {
  const codes = financeTaxCodes.filter((t) => t.companyId === co && t.active)
  if (pct === 0) return codes.find((t) => t.category === 'zero_rated')?.id ?? codes[0].id
  return codes.find((t) => t.category === 'standard' && t.rate === pct)?.id ?? codes.find((t) => t.category === 'standard')!.id
}

export interface SourceLines {
  lines: InvoiceLineInput[]
  currency: string
  billingPct: number | null
  milestone: string
}

/** Lines for `pct` % of a quotation (already invoiced: `invoiced` %). */
export function linesFromQuotation(co: string, q: Tenant<QuotationRecord>, pct: number, milestone: string): SourceLines {
  const invoiced = invoicedPctOfQuotation(co, q.id)
  const tax = taxCodeForPct(co, q.vatPct)
  if (pct >= 100 && invoiced === 0) {
    return {
      currency: q.currency,
      billingPct: 100,
      milestone,
      lines: q.items.map((it) => ({
        description: it.description,
        serviceId: it.serviceId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: round2((it.quantity * it.unitPrice * it.discountPct) / 100),
        taxCodeId: tax,
      })),
    }
  }
  const net = quotationNet(q)
  const closes = round2(invoiced + pct) >= 100
  const billedNet = round2(quotationInvoices(co, q.id).reduce((s, i) => s + i.lines.reduce((x, l) => x + l.net, 0), 0))
  const amount = closes ? round2(Math.max(0, net - billedNet)) : round2((net * pct) / 100)
  const label = milestone || `${pct}% of quotation ${q.number}`
  return {
    currency: q.currency,
    billingPct: pct,
    milestone,
    lines: [{ description: `${label} — ${q.title}`, serviceId: null, quantity: 1, unitPrice: amount, discount: 0, taxCodeId: tax }],
  }
}

/** Lines for a contract: one-off → `pct` % of its value; monthly / annual → one period. */
export function linesFromContract(co: string, c: Tenant<Contract>, pct: number, milestone: string, quotation: Tenant<QuotationRecord> | undefined): SourceLines {
  const s = invoiceSettingsFor(co)
  const tax = taxCodeForPct(co, s.country === 'SA' ? 15 : 5)
  if (c.billing !== 'One-off') {
    const period = c.billing === 'Monthly' ? 'monthly fee' : 'annual fee'
    return {
      currency: s.baseCurrency,
      billingPct: null,
      milestone,
      lines: [{ description: milestone ? `${c.title} — ${milestone}` : `${c.title} — ${period}`, serviceId: c.serviceIds[0] ?? null, quantity: 1, unitPrice: c.value, discount: 0, taxCodeId: tax }],
    }
  }
  if (quotation && invoicedPctOfContract(co, c) === 0 && pct >= 100) return { ...linesFromQuotation(co, quotation, 100, milestone), billingPct: 100 }
  const invoiced = invoicedPctOfContract(co, c)
  const closes = round2(invoiced + pct) >= 100
  const billedNet = round2(contractInvoices(co, c).reduce((x, i) => x + i.lines.reduce((y, l) => y + l.net, 0), 0))
  const amount = closes ? round2(Math.max(0, c.value - billedNet)) : round2((c.value * pct) / 100)
  const label = milestone || (pct >= 100 ? 'Contract' : `${pct}% of contract`)
  return {
    currency: s.baseCurrency,
    billingPct: pct,
    milestone,
    lines: [{ description: `${label} — ${c.title}`, serviceId: c.serviceIds.length === 1 ? c.serviceIds[0] : null, quantity: 1, unitPrice: amount, discount: 0, taxCodeId: tax }],
  }
}
