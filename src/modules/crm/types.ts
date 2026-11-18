import type { Contact, Customer, LeadStatus, SourceType } from '@/shared/types'
import type { ActivityView, NoteView } from '@/modules/leads/types'

/** API shapes for the CRM module (customers, contacts, contracts) — the backend returns exactly these. */

export type CustomerStatus = Customer['status']
export type Emirate = Exclude<Customer['emirate'], ''>

export type ContractBilling = 'One-off' | 'Monthly' | 'Annual'
/** contracts.status: draft | active | expired | cancelled | renewed (shared/domain/enums.ts). */
export type ContractStatus = import('@/shared/domain/enums').ContractStatus

/**
 * A signed contract for a customer. `value` is the amount per billing cycle in AED
 * (One-off: total, Monthly: per month, Annual: per year).
 */
export interface Contract {
  id: string
  customerId: string
  title: string
  serviceIds: string[]
  value: number
  billing: ContractBilling
  startDate: string
  renewalDate: string
  /** Stored as active or cancelled (draft / renewed reserved); the API reads an active contract past its renewal date as expired. */
  status: ContractStatus
  ownerId: string
  /** contracts.quotation_id: the accepted quotation it was created from (Won flow), if any. */
  quotationId?: string | null
  /** contracts.created_by. */
  createdBy?: string | null
}

export interface ContractRow extends Contract {
  /** Active and within the renewal alert window (Settings > Automation): shown as "Expiring". */
  renewalDue: boolean
  customerName: string
  ownerName: string
  serviceNames: string[]
  /** Whole days until the renewal date; negative once it has passed. */
  daysToRenewal: number
  /** Value over a year: Monthly × 12, Annual and One-off as is. */
  annualValue: number
  /** Monthly recurring revenue: Monthly value, Annual / 12, One-off 0. */
  mrr: number
}

export interface CustomerRow extends Customer {
  ownerName: string
  contactsCount: number
  /** Annual value of Active and Expiring contracts. */
  activeContractValue: number
  activeContracts: number
  /** Earliest upcoming renewal of a live contract, or null. */
  nextRenewal: string | null
  daysToRenewal: number | null
  lastActivityAt: string | null
}

export interface CustomerLeadSummary {
  id: string
  status: LeadStatus
  sourceType: SourceType
  sourceDetail: string
  createdAt: string
  value: number
  ownerName: string
  /** Catalog services of interest on the won lead. */
  serviceIds: string[]
  doNotContact: boolean

}

/** The 360° customer profile. */
export interface CustomerDetail extends CustomerRow {
  lead: CustomerLeadSummary
  contacts: Contact[]
  contracts: ContractRow[]
  /** Latest 10, newest first. */
  recentActivities: ActivityView[]
  notes: NoteView[]
  /** Billed to date across all contracts; the won deal value when there are no contracts yet. */
  lifetimeValue: number
}

export interface CustomerUpdateInput {
  status?: CustomerStatus
  website?: string
  address?: string
  emirate?: Emirate | ''
  ownerId?: string
}

export type ContactRecordType = 'Lead' | 'Customer'

export interface ContactRow extends Contact {
  company: string
  recordType: ContactRecordType
  /** Lead id or customer id, depending on `recordType`. */
  recordId: string
  ownerName: string
}

export interface ContactInput {
  recordType: ContactRecordType
  recordId: string
  name: string
  title: string
  mobile: string
  email: string
  isDecisionMaker: boolean
}

export type ContactUpdateInput = Partial<Pick<Contact, 'name' | 'title' | 'mobile' | 'email' | 'isDecisionMaker'>>

export interface ContractInput {
  customerId: string
  title: string
  serviceIds: string[]
  value: number
  billing: ContractBilling
  startDate: string
  renewalDate: string
  ownerId?: string
}

export type ContractUpdateInput = Partial<Omit<ContractInput, 'customerId'>> & {
  /** Only active (reinstate) or cancelled can be set; expired is derived from the renewal date. */
  status?: 'active' | 'cancelled'
}
