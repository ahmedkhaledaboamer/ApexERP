import type { Invoice } from '@/modules/finance/types'
import type {
  CreditNoteLine,
  InvoiceHistoryEntry,
  InvoiceSendEntry,
  RecurringFrequency,
  RecurringMode,
  RecurringStatus,
  RecurringTemplate,
  ZatcaStamp,
} from '@/modules/finance/invoices/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { financeInvoices } from './finance'

/**
 * Accounts & finance › Invoices section stores (the invoices themselves live in `financeInvoices`,
 * data/finance.ts — the finance contract). Seeded by data/financeInvoicesSeed.ts.
 * Synthetic data only.
 */

/** Section fields stored on an invoice row next to the contract fields (Invoice, modules/finance/types.ts). */
export interface InvoiceExtra {
  /** Buyer VAT / TRN as printed (KSA: set → standard tax invoice, empty → simplified). */
  customerVatNumber: string
  paymentTermsDays: number
  /** Share of the quotation / contract this invoice bills (partial / milestone invoicing); null = free invoice. */
  billingPct: number | null
  milestone: string
  sendLog: InvoiceSendEntry[]
  history: InvoiceHistoryEntry[]
  zatca: ZatcaStamp | null
  /** The reversing journal entry once voided. */
  voidJournalEntryId: string | null
}
export type InvoiceRecord = Tenant<Invoice> & InvoiceExtra

/** The contract store seen with the section fields (every row is created by this section). */
export const invoiceRecords = financeInvoices as InvoiceRecord[]

export interface CreditNoteRecord {
  id: string
  number: string
  invoiceId: string
  customerId: string
  date: string
  reason: string
  currency: string
  exchangeRate: number
  lines: CreditNoteLine[]
  subtotal: number
  taxTotal: number
  total: number
  appliedAmount: number
  excessAmount: number
  journalEntryId: string | null
  zatca: ZatcaStamp | null
  createdBy: string
  createdAt: string
}

export interface RecurringRecord {
  id: string
  customerId: string
  sourceInvoiceId: string | null
  contractId: string | null
  frequency: RecurringFrequency
  startDate: string
  endDate: string | null
  /** Next period to generate (null once ended). */
  nextDate: string | null
  /** Number of periods already generated from the start date (the next period is start + n × frequency). */
  periodIndex: number
  mode: RecurringMode
  status: RecurringStatus
  template: RecurringTemplate
  generated: { period: string; invoiceId: string; at: string }[]
  lastError: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export const financeCreditNotes = registerArray<Tenant<CreditNoteRecord>>('fin.creditNotes', [])
export const financeRecurring = registerArray<Tenant<RecurringRecord>>('fin.recurring', [])
/** ZATCA chain per company: last Invoice Counter Value and the hash of the last stamped document. */
export const financeZatcaChain = registerObject('fin.zatcaChain', {} as Record<string, { icv: number; lastHash: string }>)
