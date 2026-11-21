import type { CurrencyCode, Invoice, InvoiceLine, InvoiceStatus, JournalStatus, TaxCategory } from '@/modules/finance/types'

/**
 * Accounts & finance › Invoices, credit notes, recurring invoices and KSA ZATCA data
 * (docs/API.md › Finance › Invoices / Credit notes / Recurring invoices / ZATCA).
 * The core Invoice / InvoiceLine shapes are the finance contract (../types.ts); these are the section's
 * own records and the API views. camelCase here, snake_case on the wire (financeInvoicesMappers).
 */

export type InvoiceKind = Invoice['kind']
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
}

/* ---------------- ZATCA (KSA FATOORA) ---------------- */

/** Submission to ZATCA (clearance for B2B, reporting for B2C) needs the backend + CSID onboarding. */
export type ZatcaStatus = 'not_submitted' | 'cleared' | 'reported' | 'rejected'

/** The e-invoicing data every issued KSA invoice / credit note carries (phase 2 fields, not yet stamped). */
export interface ZatcaStamp {
  uuid: string
  /** Invoice Counter Value: per company, +1 for every issued invoice and credit note, never reused. */
  icv: number
  /** Previous Invoice Hash: the `invoiceHash` of the company's previous document (the spec's seed for the first). */
  pih: string
  /** base64(SHA-256) over the canonical XML (without the QR, signature and UBL extensions). */
  invoiceHash: string
  /** base64 of the TLV (1 seller, 2 VAT no., 3 timestamp, 4 total incl. VAT, 5 VAT total). */
  qr: string
  /** ISO timestamp printed in the QR (tag 3). */
  timestamp: string
  /** 388 tax invoice, 381 credit note. */
  typeCode: '388' | '381'
  /** InvoiceTypeCode@name: 0100000 standard (B2B), 0200000 simplified (B2C). */
  subtype: '0100000' | '0200000'
  status: ZatcaStatus
}

/* ---------------- invoices ---------------- */

export interface InvoiceSendEntry {
  at: string
  byName: string
  to: string
  subject: string
}

export interface InvoiceHistoryEntry {
  at: string
  byName: string
  action: 'created' | 'updated' | 'issued' | 'sent' | 'voided' | 'credited' | 'xml' | 'generated'
  summary: string
}

/** The list row (GET /finance/invoices). Base amounts are in the company's base currency. */
export interface InvoiceRow {
  id: string
  number: string
  kind: InvoiceKind
  status: InvoiceStatus
  overdue: boolean
  daysOverdue: number
  customerId: string
  customerName: string
  issueDate: string | null
  dueDate: string | null
  currency: CurrencyCode
  exchangeRate: number
  total: number
  taxTotal: number
  amountPaid: number
  amountCredited: number
  balanceDue: number
  baseTotal: number
  baseBalanceDue: number
  quotationId: string | null
  contractId: string | null
  recurringId: string | null
  milestone: string
  createdAt: string
}

export interface InvoiceJournalLine {
  accountId: string
  accountCode: string
  accountName: string
  debit: number
  credit: number
  description: string
}
export interface InvoiceJournal {
  id: string
  number: string
  date: string
  status: JournalStatus
  memo: string
  lines: InvoiceJournalLine[]
}

/** The issuer as printed (finance settings → company profile fallback). */
export interface InvoiceSeller {
  legalName: string
  /** Arabic registered name (KSA print); '' when not set. */
  legalNameAr: string
  vatNumber: string
  taxLabel: string
  addressLines: string[]
  commercialRegistration: string
  country: string
  baseCurrency: CurrencyCode
}

export interface CreditNoteSummary {
  id: string
  number: string
  date: string
  total: number
  reason: string
}

export interface InvoiceDetail extends Omit<Invoice, never> {
  customerName: string
  customerEmail: string
  customerAddress: string
  customerVatNumber: string
  paymentTermsDays: number
  billingPct: number | null
  milestone: string
  overdue: boolean
  /** "Tax Invoice" / "Simplified Tax Invoice" (+ Arabic for KSA). */
  title: string
  titleAr: string
  /** Base-currency amounts (UAE: VAT in AED on every tax invoice). */
  baseSubtotal: number
  baseTaxTotal: number
  baseTotal: number
  baseCurrency: CurrencyCode
  /** Net and VAT per tax code (document currency). */
  taxSummary: { taxCodeId: string; name: string; rate: number; category: TaxCategory; net: number; tax: number }[]
  quotationNumber: string | null
  contractTitle: string | null
  projectName: string | null
  eventName: string | null
  createdByName: string
  seller: InvoiceSeller
  zatca: ZatcaStamp | null
  sendLog: InvoiceSendEntry[]
  history: InvoiceHistoryEntry[]
  creditNotes: CreditNoteSummary[]
  /** Net still creditable per line id (issued invoices). */
  creditable: Record<string, number>
  journal: InvoiceJournal | null
  voidJournal: InvoiceJournal | null
  can: { edit: boolean; issue: boolean; void: boolean; credit: boolean; send: boolean; xml: boolean }
}

export interface InvoiceLineInput {
  id?: string
  description: string
  serviceId?: string | null
  quantity: number
  unitPrice: number
  /** Amount, not percent. */
  discount?: number
  taxCodeId?: string | null
  revenueAccountId?: string | null
}

export interface InvoiceInput {
  customerId: string
  customerVatNumber?: string
  currency?: string
  exchangeRate?: number | null
  issueDate?: string | null
  dueDate?: string | null
  paymentTermsDays?: number | null
  lines: InvoiceLineInput[]
  notes?: string
  terms?: string
  projectId?: string | null
  eventId?: string | null
}

export interface InvoiceFromSourceInput {
  quotationId?: string | null
  contractId?: string | null
  /** A won lead: its accepted quotation, else the contract the Won flow created. */
  leadId?: string | null
  /** Share of the source to bill, 1–100 (milestone / partial invoicing); the rest left by default. */
  percent?: number | null
  milestone?: string | null
}

export interface InvoiceListQuery {
  status?: string
  customerId?: string
  from?: string
  to?: string
  overdue?: boolean
  q?: string
}

export interface InvoiceSourceQuotation {
  id: string
  number: string
  title: string
  customerId: string | null
  customerName: string
  leadId: string
  currency: string
  netTotal: number
  invoicedPct: number
}
export interface InvoiceSourceContract {
  id: string
  title: string
  customerId: string
  customerName: string
  value: number
  billing: string
  status: string
  quotationId: string | null
  invoicedPct: number
}
export interface InvoiceSources {
  quotations: InvoiceSourceQuotation[]
  contracts: InvoiceSourceContract[]
}

export interface InvoiceMeta {
  country: string
  baseCurrency: CurrencyCode
  zatcaEnabled: boolean
  vatNumber: string
  paymentTermsDays: number
  defaultRevenueAccountId: string
  serviceRevenueAccountId: string
  currencies: CurrencyCode[]
  /** Default rate to base per currency (finance settings; built-in pegs as fallback). */
  rates: Record<string, number>
  taxCodes: { id: string; name: string; rate: number; category: TaxCategory }[]
  standardTaxCodeId: string
  revenueAccounts: { id: string; code: string; name: string }[]
  customers: { id: string; name: string; vatNumber: string }[]
  services: { id: string; name: string; price: number; currency: string; pricingType: string }[]
  projects: { id: string; name: string; customerId: string }[]
  events: { id: string; name: string }[]
  canWrite: boolean
}

export interface SendInput {
  to?: string
  message?: string
}

export interface XmlFile {
  filename: string
  mimeType: string
  content: string
}

/* ---------------- credit notes ---------------- */

export interface CreditNoteLine {
  invoiceLineId: string
  description: string
  taxCodeId: string
  taxRate: number
  net: number
  taxAmount: number
  total: number
  revenueAccountId: string
}

export interface CreditNote {
  id: string
  number: string
  invoiceId: string
  invoiceNumber: string
  customerId: string
  customerName: string
  date: string
  reason: string
  currency: CurrencyCode
  exchangeRate: number
  lines: CreditNoteLine[]
  subtotal: number
  taxTotal: number
  total: number
  /** Reduced the invoice balance (applyToInvoice { credited }). */
  appliedAmount: number
  /** Above the open balance: customer credit (customer_advances), for Collections to refund / apply. */
  excessAmount: number
  journalEntryId: string | null
  zatca: ZatcaStamp | null
  createdByName: string
  createdAt: string
}

export interface CreditNoteInput {
  invoiceId: string
  reason: string
  date?: string | null
  /** Credit everything still creditable. */
  full?: boolean
  /** Net amounts (excl. VAT) per invoice line. */
  lines?: { invoiceLineId: string; amount: number }[]
}

/* ---------------- recurring ---------------- */

export type RecurringFrequency = 'monthly' | 'quarterly' | 'yearly'
export const RECURRING_FREQUENCY_LABEL: Record<RecurringFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }
export type RecurringMode = 'draft' | 'auto_issue'
export type RecurringStatus = 'active' | 'paused' | 'ended'

export interface RecurringTemplate {
  currency: CurrencyCode
  customerVatNumber: string
  paymentTermsDays: number
  lines: InvoiceLineInput[]
  notes: string
  terms: string
  projectId: string | null
}

export interface RecurringSchedule {
  id: string
  customerId: string
  customerName: string
  sourceInvoiceId: string | null
  contractId: string | null
  frequency: RecurringFrequency
  startDate: string
  endDate: string | null
  nextDate: string | null
  mode: RecurringMode
  status: RecurringStatus
  template: RecurringTemplate
  /** Net + VAT of one generated invoice (template currency). */
  amount: number
  generated: { period: string; invoiceId: string; at: string }[]
  lastError: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface RecurringInput {
  sourceInvoiceId?: string | null
  contractId?: string | null
  frequency?: RecurringFrequency
  startDate?: string
  endDate?: string | null
  mode?: RecurringMode
}

export interface RecurringUpdate {
  frequency?: RecurringFrequency
  endDate?: string | null
  nextDate?: string
  mode?: RecurringMode
  status?: RecurringStatus
}

export type { InvoiceLine }
