import type { Tone } from '@/shared/components/ui/Badge'

/**
 * Status enums shared by the UI, the mock API and docs/API.md (database: string columns cast to
 * backed enums). Values on the wire are the lower-case snake values; screens show the labels.
 * Each domain exports the value tuple, the TS type, labels and badge tones.
 */

/** True when `v` is one of `values` (request validation). */
export function isOneOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

/* ---------------- Customers (customers.status) ---------------- */

export const CUSTOMER_STATUSES = ['active', 'paused', 'vip', 'churned'] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  vip: 'VIP',
  churned: 'Churned',
}

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, Tone> = {
  active: 'green',
  vip: 'brand',
  paused: 'amber',
  churned: 'neutral',
}

/** Display order in pickers, filters and sorting. */
export const CUSTOMER_STATUS_ORDER: readonly CustomerStatus[] = ['active', 'vip', 'paused', 'churned']

/* ---------------- Quotations (quotations.status) ---------------- */

export const QUOTATION_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'] as const
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
}

export const QUOTATION_STATUS_TONE: Record<QuotationStatus, Tone> = {
  draft: 'neutral',
  sent: 'blue',
  viewed: 'brand',
  accepted: 'green',
  rejected: 'red',
  expired: 'amber',
}

/** Waiting on the client's answer: the only statuses that can be accepted, rejected or expire. */
export const QUOTATION_AWAITING: readonly QuotationStatus[] = ['sent', 'viewed']
/** Still open (not decided). */
export const QUOTATION_OPEN: readonly QuotationStatus[] = ['draft', 'sent', 'viewed']
/** The client's answer (POST /quotations/:id/status). */
export const QUOTATION_DECISIONS = ['accepted', 'rejected'] as const
export type QuotationDecision = (typeof QUOTATION_DECISIONS)[number]

/* ---------------- Contracts (contracts.status) ---------------- */

export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'cancelled', 'renewed'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/**
 * What a contract row shows: the stored status, or `expiring` for an active contract inside the
 * renewal alert window (Settings > Automation). `expiring` is derived, never stored or sent.
 */
export type ContractDisplayStatus = ContractStatus | 'expiring'

export const CONTRACT_STATUS_LABEL: Record<ContractDisplayStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  expiring: 'Expiring',
  expired: 'Expired',
  cancelled: 'Cancelled',
  renewed: 'Renewed',
}

export const CONTRACT_STATUS_TONE: Record<ContractDisplayStatus, Tone> = {
  draft: 'neutral',
  active: 'green',
  expiring: 'amber',
  expired: 'red',
  cancelled: 'neutral',
  renewed: 'blue',
}

/** Display order in filters and sorting. */
export const CONTRACT_DISPLAY_ORDER: readonly ContractDisplayStatus[] = ['draft', 'active', 'expiring', 'expired', 'renewed', 'cancelled']

/** Statuses a user may set with PATCH /contracts/:id (expired is derived from the renewal date). */
export const CONTRACT_SETTABLE: readonly ContractStatus[] = ['active', 'cancelled']

/** A live contract: active (expiring included); counts toward value and renewals. */
export const isLiveContract = (s: ContractStatus) => s === 'active'

/** The row's display status from its stored status and the renewal-window flag. */
export function contractDisplayStatus(c: { status: ContractStatus; renewalDue: boolean }): ContractDisplayStatus {
  return c.status === 'active' && c.renewalDue ? 'expiring' : c.status
}
