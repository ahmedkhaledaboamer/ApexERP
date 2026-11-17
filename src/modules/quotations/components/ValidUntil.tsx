import type { QuotationStatus } from '@/modules/quotations/types'
import { AWAITING_STATUSES, daysUntil } from '@/modules/quotations/lib/totals'
import { cn, fmtDate } from '@/shared/lib/utils'

/** Validity date, highlighted when an open quotation is about to lapse or has lapsed. */
export function ValidUntil({ date, status, className }: { date: string; status: QuotationStatus; className?: string }) {
  const days = daysUntil(date)
  const watching = AWAITING_STATUSES.includes(status) || status === 'Draft'
  const expired = status === 'Expired' || (watching && days < 0)
  const soon = watching && !expired && days <= 7

  return (
    <span className={cn('num inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <span className={cn(expired ? 'text-danger-600 dark:text-danger-500' : soon ? 'text-warning-700 dark:text-warning-500' : 'text-ink-2')}>
        {fmtDate(date)}
      </span>
      {expired ? (
        <span className="text-xs text-danger-600 dark:text-danger-500">expired</span>
      ) : soon ? (
        <span className="text-xs text-warning-700 dark:text-warning-500">
          {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
        </span>
      ) : null}
    </span>
  )
}
