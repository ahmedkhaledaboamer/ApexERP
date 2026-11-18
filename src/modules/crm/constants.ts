import type { ContractBilling, Emirate } from '@/modules/crm/types'
import type { ContractDisplayStatus } from '@/shared/domain/enums'

/** Customer and contract status enums live in shared/domain/enums.ts (one copy for UI, mocks and docs). */
export {
  CONTRACT_DISPLAY_ORDER,
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  contractDisplayStatus,
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUS_TONE,
  CUSTOMER_STATUS_ORDER as CUSTOMER_STATUSES,
} from '@/shared/domain/enums'

/** Contract statuses always offered in the list filter (draft and renewed appear when present). */
export const CONTRACT_FILTER_STATUSES: readonly ContractDisplayStatus[] = ['active', 'expiring', 'expired', 'cancelled']

export const BILLINGS: ContractBilling[] = ['One-off', 'Monthly', 'Annual']

export const BILLING_SUFFIX: Record<ContractBilling, string> = {
  'One-off': '',
  Monthly: '/mo',
  Annual: '/yr',
}

export const EMIRATES: Emirate[] = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']
