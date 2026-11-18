import { Crown } from 'lucide-react'
import type { CustomerStatus } from '@/modules/crm/types'
import type { ContractDisplayStatus } from '@/shared/domain/enums'
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, CUSTOMER_STATUS_LABEL, CUSTOMER_STATUS_TONE } from '@/modules/crm/constants'
import { useAutomationRules } from '@/shared/hooks/useAutomationRules'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'

/** Customer status as a dot chip; `soft` gives the tinted pill for headers. */
export function CustomerStatusBadge({ status, soft = false }: { status: CustomerStatus; soft?: boolean }) {
  return (
    <Badge tone={CUSTOMER_STATUS_TONE[status]} variant={soft ? 'soft' : 'dot'} icon={soft && status === 'vip' ? <Crown /> : undefined}>
      {CUSTOMER_STATUS_LABEL[status]}
    </Badge>
  )
}

/** A contract's display status (`contractDisplayStatus(row)`: stored status, or expiring). */
export function ContractStatusBadge({ status }: { status: ContractDisplayStatus }) {
  return (
    <Badge tone={CONTRACT_STATUS_TONE[status]} variant="dot">
      {CONTRACT_STATUS_LABEL[status]}
    </Badge>
  )
}

/**
 * "in 12 days" with amber inside the renewal alert window (Settings > Automation, 30 days by
 * default) and red once passed. Cancelled contracts stay muted.
 */
export function RenewsIn({ days, cancelled = false, className }: { days: number | null; cancelled?: boolean; className?: string }) {
  const { rules } = useAutomationRules()
  if (days === null) return <span className={cn('text-muted', className)}>—</span>
  const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? '' : 's'} ago`
  const tone = cancelled
    ? 'text-muted'
    : days < 0
      ? 'font-medium text-danger-600 dark:text-danger-500'
      : days <= rules.renewalAlertDays
        ? 'font-medium text-warning-700 dark:text-warning-500'
        : 'text-ink-2'
  return <span className={cn('num whitespace-nowrap', tone, className)}>{label}</span>
}
