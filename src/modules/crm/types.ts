import type { Contact, Customer, LeadStatus, SourceType } from '@/shared/types'
import type { ActivityView, NoteView } from '@/modules/leads/types'

/** API shapes for the CRM module (customers, contacts, contracts) — the backend returns exactly these. */

export type CustomerStatus = Customer['status']
export type Emirate = Exclude<Customer['emirate'], ''>

export type ContractBilling = 'One-off' | 'Monthly' | 'Annual'
export type ContractStatus = 'Active' | 'Expiring' | 'Expired' | 'Cancelled'

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
  /** Stored as Active or Cancelled; the API derives Expiring (within the renewal alert window, Settings > Automation) and Expired (past). */
  status: ContractStatus
  ownerId: string
}

export interface ContractRow extends Contract {
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
  /** Only Active (reinstate) or Cancelled can be set; Expiring/Expired are derived. */
  status?: 'Active' | 'Cancelled'
}
