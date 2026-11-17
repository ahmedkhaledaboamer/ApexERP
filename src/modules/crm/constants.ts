import type { Tone } from '@/shared/components/ui/Badge'
import type { ContractBilling, ContractStatus, CustomerStatus, Emirate } from '@/modules/crm/types'

export const CUSTOMER_STATUSES: CustomerStatus[] = ['Active', 'VIP', 'Paused']

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, Tone> = {
  Active: 'green',
  VIP: 'brand',
  Paused: 'amber',
}

export const CONTRACT_STATUSES: ContractStatus[] = ['Active', 'Expiring', 'Expired', 'Cancelled']

export const CONTRACT_STATUS_TONE: Record<ContractStatus, Tone> = {
  Active: 'green',
  Expiring: 'amber',
  Expired: 'red',
  Cancelled: 'neutral',
}

export const BILLINGS: ContractBilling[] = ['One-off', 'Monthly', 'Annual']

export const BILLING_SUFFIX: Record<ContractBilling, string> = {
  'One-off': '',
  Monthly: '/mo',
  Annual: '/yr',
}

export const EMIRATES: Emirate[] = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']
