import type { CurrencyCode } from '@/modules/finance/types'

/**
 * Accounts & finance › Collections (docs/API.md › Finance › Payments, PDC, Receivables, Payment links):
 * payments received with allocations, customer credit, refunds, post-dated cheques, receivables aging,
 * customer statements, dunning reminders, credit limits and payment links. camelCase here; snake_case on
 * the wire (src/shared/api/financeCollectionsMappers.ts).
 *
 * MONEY RULES
 *   - A payment, its allocations and its credit are in the payment's currency; it may only be allocated to
 *     invoices in the same currency. Journal lines are in base currency: the bank at the payment's rate,
 *     receivables at each invoice's own rate; the difference is posted to fx_gain_loss.
 *   - Bank charges deducted by the bank: the customer settles `amount`, the bank receives
 *     `amount − bankCharges`, the charges go to Bank charges (6800).
 *   - Unallocated money is customer credit (customer_advances) until applied to invoices or refunded.
 *   - A post-dated cheque (PDC) "secures" invoices but does NOT pay them: the invoice stays open until the
 *     cheque clears (then a receipt is recorded); a bounced cheque leaves it open as before.
 */

export type PaymentMethod = 'bank_transfer' | 'cash' | 'cheque' | 'card' | 'payment_link'
export const PAYMENT_METHODS: PaymentMethod[] = ['bank_transfer', 'cash', 'cheque', 'card', 'payment_link']
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
  payment_link: 'Payment link',
}
/** Methods a user records by hand (payment links are recorded by the public pay page). */
export const MANUAL_METHODS: PaymentMethod[] = ['bank_transfer', 'cash', 'cheque', 'card']

export type PaymentStatus = 'posted' | 'void'
export type PaymentSource = 'manual' | 'pdc' | 'payment_link'

export interface PaymentAllocation {
  id: string
  invoiceId: string
  invoiceNumber: string
  /** In the payment's (= the invoice's) currency. */
  amount: number
  /** yyyy-MM-dd: the payment date, or the day credit was applied. */
  date: string
  kind: 'payment' | 'credit'
  /** Set when a refund took the money back off the invoice (the invoice re-opened). */
  reversedOn: string | null
}

export interface PaymentRefund {
  id: string
  date: string
  amount: number
  accountId: string
  reference: string
  journalEntryId: string
  createdByName: string | null
}

export interface Payment {
  id: string
  /** Receipt number, e.g. APX-RCT-2026-0001. */
  number: string
  customerId: string
  customerName: string
  date: string
  method: PaymentMethod
  /** What the customer settled, in `currency`. */
  amount: number
  currency: CurrencyCode
  exchangeRate: number
  /** Deducted by the bank (net received = amount − bankCharges). */
  bankCharges: number
  depositAccountId: string
  depositAccountName: string
  reference: string
  notes: string
  allocations: PaymentAllocation[]
  /** Active allocations (not reversed). */
  allocated: number
  refunded: number
  /** Customer credit still available (amount − allocated − refunded). */
  unallocated: number
  /** In base currency at the payment's rate. */
  amountBase: number
  status: PaymentStatus
  source: PaymentSource
  pdcId: string | null
  paymentLinkId: string | null
  /** e.g. "Visa •••• 4242" for a payment-link card (never more than the last 4 digits). */
  cardHint: string | null
  refunds: PaymentRefund[]
  journalEntryIds: string[]
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
}

export interface AllocationInput {
  invoiceId: string
  amount: number
}

export interface PaymentInput {
  customerId: string
  date: string
  method: PaymentMethod
  amount: number
  currency?: string
  /** Defaults from the company's exchange rates (1 for the base currency). */
  exchangeRate?: number
  bankCharges?: number
  depositAccountId?: string
  reference?: string
  notes?: string
  /** 'auto' = oldest due first; 'manual' = `allocations`; 'none' = all to customer credit. */
  allocationMode?: 'auto' | 'manual' | 'none'
  allocations?: AllocationInput[]
}

export interface RefundInput {
  amount: number
  date: string
  accountId?: string
  reference?: string
}

export interface ApplyCreditInput {
  date?: string
  /** Empty / missing = auto (oldest due first). */
  allocations?: AllocationInput[]
}

/* ---------------- receipt ---------------- */

export interface ReceiptView {
  payment: Payment
  company: { name: string; legalName: string; logoUrl: string | null; monogram: string; addressLines: string[]; taxLabel: string; taxNumber: string; email: string; phone: string }
  customer: { id: string; name: string; address: string }
  /** e.g. "One thousand and fifty dirhams" — mock: digits only. */
  amountText: string
}

/* ---------------- post-dated cheques ---------------- */

export type PdcStatus = 'received' | 'deposited' | 'cleared' | 'bounced'
export const PDC_STATUSES: PdcStatus[] = ['received', 'deposited', 'cleared', 'bounced']
export const PDC_STATUS_LABEL: Record<PdcStatus, string> = { received: 'Received (held)', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced' }

export interface Pdc {
  id: string
  chequeNo: string
  bankName: string
  customerId: string
  customerName: string
  receivedDate: string
  /** The date written on the cheque: it can be deposited from this day. */
  dueDate: string
  amount: number
  currency: CurrencyCode
  exchangeRate: number
  allocations: { invoiceId: string; invoiceNumber: string; amount: number }[]
  status: PdcStatus
  depositAccountId: string | null
  depositedDate: string | null
  clearedDate: string | null
  bouncedDate: string | null
  bounceReason: string | null
  bounceFee: number
  /** The receipt recorded when the cheque cleared. */
  paymentId: string | null
  paymentNumber: string | null
  notes: string
  journalEntryIds: string[]
  /** Due within the next 7 days (company calendar) and still held. */
  maturingSoon: boolean
  /** Held and due today or earlier: deposit it. */
  depositDue: boolean
  createdByName: string | null
  createdAt: string
}

export interface PdcInput {
  customerId: string
  chequeNo: string
  bankName: string
  receivedDate: string
  dueDate: string
  amount: number
  currency?: string
  exchangeRate?: number
  allocations?: AllocationInput[]
  notes?: string
}

export interface PdcActionInput {
  date?: string
  depositAccountId?: string
  reason?: string
  /** Bounce: the bank's returned-cheque fee (expense, paid from the deposit account). */
  bounceFee?: number
}

/* ---------------- payment links ---------------- */

export type PaymentLinkStatus = 'active' | 'paid' | 'expired' | 'void'
export const PAYMENT_LINK_STATUS_LABEL: Record<PaymentLinkStatus, string> = { active: 'Active', paid: 'Paid', expired: 'Expired', void: 'Void' }

export interface PaymentLink {
  id: string
  invoiceId: string
  invoiceNumber: string
  customerId: string
  customerName: string
  amount: number
  currency: CurrencyCode
  /** In-app path of the public page, e.g. /pay/abc… (share as an absolute URL). */
  url: string
  expiresAt: string // yyyy-MM-dd (last valid day, company calendar)
  status: PaymentLinkStatus
  paidAt: string | null
  paymentId: string | null
  createdByName: string | null
  createdAt: string
}

export interface PaymentLinkInput {
  invoiceId: string
  /** 1–90, default 14. */
  expiresInDays?: number
}

/** GET /public/pay/:token — nothing but the invoice number, amount due, currency and the company's name / logo. */
export interface PublicPayment {
  state: 'payable' | 'paid' | 'expired' | 'unavailable'
  message: string | null
  invoiceNumber: string
  amountDue: number
  currency: CurrencyCode
  companyName: string
  logoUrl: string | null
  monogram: string
  testMode: boolean
}

export interface PublicPayInput {
  cardholderName: string
  cardNumber: string
  expiry: string // MM/YY
  cvc: string
}

export interface PublicPayResult {
  paid: boolean
  message: string
  receiptNumber: string | null
  amount: number
  currency: CurrencyCode
}

/* ---------------- receivables ---------------- */

export type AgingBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90'
export const AGING_BUCKETS: AgingBucket[] = ['current', 'd30', 'd60', 'd90', 'over90']
export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = { current: 'Current', d30: '1–30', d60: '31–60', d90: '61–90', over90: '90+' }

export type AgingAmounts = Record<AgingBucket, number> & { total: number }

export interface AgingRow extends AgingAmounts {
  customerId: string
  customerName: string
  ownerName: string
  invoiceCount: number
  /** Open balance secured by cheques held (base currency). */
  pdcSecured: number
  /** Unapplied customer credit (base currency). */
  credit: number
  creditHold: boolean
}

export interface AgingReport {
  asOf: string
  baseCurrency: CurrencyCode
  rows: AgingRow[]
  totals: AgingAmounts & { pdcSecured: number; credit: number }
}

export interface AgingInvoice {
  invoiceId: string
  number: string
  issueDate: string
  dueDate: string
  currency: CurrencyCode
  /** Open balance as of the date, in the invoice currency and in base. */
  balance: number
  balanceBase: number
  daysOverdue: number
  bucket: AgingBucket
  pdcSecured: number
  dunningPaused: boolean
  lastReminder: string | null
}

export interface AgingDetail {
  asOf: string
  baseCurrency: CurrencyCode
  customerId: string
  customerName: string
  invoices: AgingInvoice[]
  totals: AgingAmounts
}

export type StatementLineType = 'invoice' | 'payment' | 'refund' | 'credit_note'

export interface StatementLine {
  date: string
  type: StatementLineType
  reference: string
  description: string
  /** Base currency: debit raises what the customer owes, credit lowers it. */
  debit: number
  credit: number
  balance: number
}

export interface Statement {
  customerId: string
  customerName: string
  customerAddress: string
  company: { name: string; logoUrl: string | null; monogram: string; addressLines: string[] }
  baseCurrency: CurrencyCode
  from: string
  to: string
  openingBalance: number
  lines: StatementLine[]
  closingBalance: number
  /** Cheques held (not yet cleared) at `to`, informational. */
  pdcHeld: number
}

/* ---------------- credit limits ---------------- */

export type CreditCheckMode = 'warn' | 'block'

export interface CustomerCredit {
  customerId: string
  customerName: string
  ownerName: string
  baseCurrency: CurrencyCode
  /** null = no limit. */
  creditLimit: number | null
  creditHold: boolean
  /** Open invoice balances (base). */
  openAr: number
  overdue: number
  /** Cheques held, informational (they don't reduce exposure until they clear). */
  pdcHeld: number
  /** Unapplied customer credit (base). */
  unappliedCredit: number
  /** exposure = openAr − unappliedCredit (never below 0). */
  exposure: number
  /** creditLimit − exposure (null without a limit). */
  available: number | null
  overLimit: boolean
  bouncedCheques: number
  lastBounceDate: string | null
  dunningPaused: boolean
}

export interface CustomerCreditInput {
  creditLimit?: number | null
  creditHold?: boolean
  dunningPaused?: boolean
}

/** GET /finance/credit-check: the quotation form's warning (amounts only for accounting view / full). */
export interface CreditCheck {
  customerId: string | null
  level: 'ok' | 'warning' | 'blocked'
  mode: CreditCheckMode
  message: string | null
  /** Accounting view / full only; null otherwise. */
  detail: Pick<CustomerCredit, 'creditLimit' | 'exposure' | 'available' | 'creditHold' | 'baseCurrency'> | null
}

/* ---------------- dunning & settings ---------------- */

export interface DunningStep {
  id: string
  /** Days relative to the due date (−3 = three days before, 0 = on the due date, 7 = a week late). */
  offsetDays: number
  active: boolean
  /** Also notify the customer's owner (internal). */
  notifyOwner: boolean
}

export interface CollectionsSettings {
  dunningEnabled: boolean
  dunningSteps: DunningStep[]
  creditCheckMode: CreditCheckMode
  /** Simulated gateway fee in percent of a payment-link payment (bank charges). */
  gatewayFeePct: number
  defaultExpiryDays: number
  canEdit: boolean
  updatedAt: string | null
}

export interface CollectionsSettingsInput {
  dunningEnabled?: boolean
  dunningSteps?: { id?: string; offsetDays: number; active?: boolean; notifyOwner?: boolean }[]
  creditCheckMode?: CreditCheckMode
  gatewayFeePct?: number
  defaultExpiryDays?: number
}

export interface DunningLogEntry {
  id: string
  invoiceId: string
  invoiceNumber: string
  customerId: string
  customerName: string
  stepId: string
  offsetDays: number
  /** sent = emailed; skipped = a later step was already due when dunning first saw the invoice. */
  outcome: 'sent' | 'skipped'
  sentTo: string | null
  date: string
  at: string
}

export interface DunningPauseInput {
  targetType: 'invoice' | 'customer'
  targetId: string
  paused: boolean
}

/* ---------------- customer pickers ---------------- */

export interface OpenInvoice {
  id: string
  number: string
  issueDate: string
  dueDate: string
  currency: CurrencyCode
  exchangeRate: number
  total: number
  balanceDue: number
  /** Held by uncleared cheques. */
  pdcHeld: number
  /** balanceDue − pdcHeld: what a payment can still be allocated. */
  available: number
  overdue: boolean
}

export interface CustomerOpenItems {
  customerId: string
  customerName: string
  invoices: OpenInvoice[]
  /** Customer credit left: posted payments' unallocated money and credit-note excess (invoices section). */
  credits: { kind: 'payment' | 'credit_note'; sourceId: string; number: string; date: string; currency: CurrencyCode; unallocated: number }[]
}

export interface DepositAccount {
  id: string
  code: string
  name: string
  role: string | null
}

/** POST /finance/credit-note-credits/:id/apply | refund: a credit note's excess (customer credit). */
export interface CreditNoteCredit {
  creditNoteId: string
  number: string
  customerId: string
  currency: CurrencyCode
  excess: number
  remaining: number
}
