import type { CreditCheckMode, DunningStep, PaymentMethod, PaymentSource, PaymentStatus, PdcStatus } from '@/modules/finance/collections/types'
import type { Tenant } from '@/shared/mocks/tenant'
import type { RateHit } from '@/shared/mocks/services/rateLimit'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * Accounts & finance › Collections stores (payments received, post-dated cheques, payment links, customer
 * credit settings, dunning). Seeded lazily per company by services/financeCollections.ts `ensureCollectionsSeed`
 * from that company's issued invoices (the invoices section owns them). Synthetic data only; no card data is
 * ever stored (a payment-link payment keeps the brand + last 4 digits only).
 */

export interface AllocationRecord {
  id: string
  invoiceId: string
  invoiceNumber: string
  amount: number
  date: string
  kind: 'payment' | 'credit'
  /** The entry that posted it when it's not part of the payment's own entry (credit applied later). */
  journalEntryId: string | null
  reversedOn: string | null
}

export interface RefundRecord {
  id: string
  date: string
  amount: number
  accountId: string
  reference: string
  journalEntryId: string
  /** Allocations taken back off invoices by this refund (allocation id → amount). */
  deallocated: { allocationId: string; amount: number }[]
  createdBy: string | null
}

export interface PaymentRecord {
  id: string
  number: string
  customerId: string
  date: string
  method: PaymentMethod
  amount: number
  currency: string
  exchangeRate: number
  bankCharges: number
  depositAccountId: string
  reference: string
  notes: string
  allocations: AllocationRecord[]
  refunds: RefundRecord[]
  status: PaymentStatus
  source: PaymentSource
  pdcId: string | null
  paymentLinkId: string | null
  cardHint: string | null
  journalEntryIds: string[]
  createdBy: string | null
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
}

export interface PdcRecord {
  id: string
  chequeNo: string
  bankName: string
  customerId: string
  receivedDate: string
  dueDate: string
  amount: number
  currency: string
  exchangeRate: number
  allocations: { invoiceId: string; invoiceNumber: string; amount: number }[]
  status: PdcStatus
  depositAccountId: string | null
  depositedDate: string | null
  clearedDate: string | null
  bouncedDate: string | null
  bounceReason: string | null
  bounceFee: number
  paymentId: string | null
  notes: string
  /** received entry, clearing / bounce entries. */
  journalEntryIds: string[]
  /** "Deposit today" sent to the accountants (once). */
  dueNotifiedAt: string | null
  createdBy: string | null
  createdAt: string
}

export interface PaymentLinkRecord {
  id: string
  /** Unguessable public key of /pay/:token (letters only). Never served except inside `url`. */
  token: string
  invoiceId: string
  amount: number
  currency: string
  expiresAt: string
  status: 'active' | 'paid' | 'void'
  paidAt: string | null
  paymentId: string | null
  createdBy: string | null
  createdAt: string
}

/** Credit settings of a CRM customer (kept here, keyed by customer id, not on the customer record). */
export interface CustomerCreditRecord {
  customerId: string
  creditLimit: number | null
  creditHold: boolean
  dunningPaused: boolean
  bouncedCheques: number
  lastBounceDate: string | null
  updatedAt: string
}

export interface CollectionsSettingsRecord {
  dunningEnabled: boolean
  dunningSteps: DunningStep[]
  creditCheckMode: CreditCheckMode
  gatewayFeePct: number
  defaultExpiryDays: number
  updatedAt: string | null
  updatedBy: string | null
}

export interface DunningLogRecord {
  id: string
  invoiceId: string
  customerId: string
  stepId: string
  offsetDays: number
  outcome: 'sent' | 'skipped'
  sentTo: string | null
  date: string
  at: string
}

export interface InvoicePauseRecord {
  invoiceId: string
  pausedAt: string
  pausedBy: string | null
}

export const finPayments = registerArray<Tenant<PaymentRecord>>('fin.payments', [])
export const finPdcs = registerArray<Tenant<PdcRecord>>('fin.pdcs', [])
export const finPaymentLinks = registerArray<Tenant<PaymentLinkRecord>>('fin.paymentLinks', [])
export const finCustomerCredit = registerArray<Tenant<CustomerCreditRecord>>('fin.customerCredit', [])
export const finCollectionsSettings = registerArray<Tenant<CollectionsSettingsRecord>>('fin.collectionsSettings', [])
export const finDunningLog = registerArray<Tenant<DunningLogRecord>>('fin.dunningLog', [])
export const finInvoicePauses = registerArray<Tenant<InvoicePauseRecord>>('fin.invoicePauses', [])
/** Companies whose collections seed has run (lazy, once). Also the small id counters of this section. */
export const finCollectionsMeta = registerObject('fin.collectionsMeta', {
  seeded: [] as string[],
  seq: { alloc: 0, refund: 0, dunning: 0 } as Record<string, number>,
})
/** Public pay page attempts (rate limit; not company data). */
export const finPayHits: RateHit[] = []

export function nextCollectionsSeq(series: string, prefix: string): string {
  finCollectionsMeta.seq[series] = (finCollectionsMeta.seq[series] ?? 0) + 1
  return `${prefix}-${finCollectionsMeta.seq[series]}`
}

/**
 * Uses of a credit note's excess (the part over the invoice's open balance, kept as customer credit in
 * customer_advances by the invoices section): applied to another invoice, or refunded.
 */
export interface CreditNoteUseRecord {
  id: string
  creditNoteId: string
  kind: 'apply' | 'refund'
  invoiceId: string | null
  invoiceNumber: string | null
  amount: number
  date: string
  accountId: string | null
  journalEntryId: string
  createdBy: string | null
  createdAt: string
}
export const finCreditNoteUses = registerArray<Tenant<CreditNoteUseRecord>>('fin.creditNoteUses', [])
