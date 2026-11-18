import type { UsageItem } from '@/modules/billing/types'
import { formatLimitValue, meterWidth, usagePercent, usageTone, type UsageTone } from '@/modules/billing/gating'
import { cn } from '@/shared/lib/utils'

export const billingDate = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtBillingDate = (iso: string | null | undefined) => (iso ? billingDate.format(new Date(iso)) : '—')

const BAR: Record<UsageTone, string> = {
  unlimited: 'bg-success-500',
  ok: 'bg-brand-600 dark:bg-brand-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
}
const TEXT: Record<UsageTone, string> = {
  unlimited: 'text-muted',
  ok: 'text-muted',
  warning: 'text-warning-700 dark:text-warning-500',
  danger: 'text-danger-700 dark:text-danger-500',
}

/** One limit: used / max, percent, amber ≥ 80 %, red ≥ 100 %, "Unlimited", reset date for period limits. */
export function UsageMeter({ item, resetsOn, thresholds }: { item: UsageItem; resetsOn?: string; thresholds?: number[] }) {
  const percent = item.percent ?? usagePercent(item.used, item.limit)
  const tone = usageTone(percent, thresholds)
  return (
    <div id={`usage-meter-${item.key}`} data-limit={item.key} data-tone={tone} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[0.8125rem] font-medium text-ink">{item.label}</p>
        <p className={cn('num shrink-0 text-xs font-medium', TEXT[tone])}>{percent === null ? 'Unlimited' : `${percent}%`}</p>
      </div>
      <div
        role="progressbar"
        aria-label={`${item.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.min(100, percent)}
        aria-valuetext={
          item.limit === null
            ? `${formatLimitValue(item.key, item.used)} used, unlimited`
            : `${formatLimitValue(item.key, item.used)} of ${formatLimitValue(item.key, item.limit)}`
        }
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', BAR[tone])} style={{ width: `${meterWidth(percent)}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs text-muted">
        <span className="num">
          {formatLimitValue(item.key, item.used)}
          {item.limit !== null && <> of {formatLimitValue(item.key, item.limit)}</>}
        </span>
        {item.resets && resetsOn && <span>Resets on {fmtBillingDate(resetsOn)}</span>}
      </p>
    </div>
  )
}
