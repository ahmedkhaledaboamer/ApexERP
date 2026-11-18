/** Quotations (spec: Sales > Proposal). Money is AED; totals are always computed by the server. */

/**
 * quotations.status: draft | sent | viewed | accepted | rejected | expired (labels and tones in
 * shared/domain/enums.ts). viewed = the client opened the document / link; expired = past
 * valid_until while still sent or viewed (set by the server, never for accepted / rejected).
 */
export type QuotationStatus = import('@/shared/domain/enums').QuotationStatus

/** Billing unit; set from the service's pricing type (Fixed → project, Monthly → month, Hourly → hour). */
export type QuotationUnit = 'project' | 'month' | 'hour'

export interface QuotationItem {
  id: string
  /** Catalog service the line came from; null for a custom line. */
  serviceId: string | null
  description: string
  quantity: number
  unit: QuotationUnit
  unitPrice: number
  /** Line discount, 0–100. */
  discountPct: number
  /**
   * Currency the line was priced in (prefilled from the catalog service; ISO code). Informational:
   * totals always use the quotation's currency, and the editor warns when the two differ.
   */
  currency?: string
  /** Lines added together from a service package share a group id (null/absent = standalone line). */
  groupId?: string | null
  /** Package name shown on the grouped block. */
  groupLabel?: string | null
}

export interface QuotationTotals {
  /** Sum of quantity × unit price, before discounts. */
  subtotal: number
  /** Sum of line discounts. */
  discount: number
  vat: number
  total: number
}

/** What the mock db stores. */
export interface QuotationRecord {
  id: string
  /** Human number, e.g. QT-2026-0012. */
  number: string
  leadId: string
  customerId: string | null
  /** Client details, copied from the lead when the quotation is created. */
  company: string
  contactName: string
  contactEmail: string
  title: string
  /** Stored status. The server marks sent / viewed quotations past `validUntil` (company day) expired. */
  status: QuotationStatus
  items: QuotationItem[]
  /** VAT percent; the workspace rate (Settings > Company) by default. */
  vatPct: number
  /** One currency per quotation (ISO code); AED by default. Totals use it whatever the lines say. */
  currency: string
  notes: string
  terms: string
  /** Last valid day, yyyy-MM-dd. */
  validUntil: string
  /** User id of the author. */
  createdBy: string
  createdAt: string
  updatedAt: string
  sentAt: string | null
  /** When it was marked Accepted or Rejected. */
  decidedAt: string | null
  /** When the client first opened the shared document (status sent → viewed). */
  viewedAt: string | null
  /** quotations.accepted_at: when it was accepted (set by the Won flow at the latest). */
  acceptedAt?: string | null
}

/** A quotation as the API returns it. */
export interface Quotation extends QuotationRecord {
  /** Owner of the lead; scoping follows the lead. */
  ownerId: string
  ownerName: string
  createdByName: string
  totals: QuotationTotals
}

export type QuotationItemInput = Omit<QuotationItem, 'id'> & { id?: string }

export interface QuotationInput {
  leadId: string
  title: string
  validUntil: string
  items: QuotationItemInput[]
  notes: string
  terms: string
  vatPct?: number
  /** ISO code; defaults to AED. */
  currency?: string
}


export type QuotationUpdateInput = Partial<Omit<QuotationInput, 'leadId'>>

export type QuotationDecision = import('@/shared/domain/enums').QuotationDecision
