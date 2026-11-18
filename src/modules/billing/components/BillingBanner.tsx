import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Lock } from 'lucide-react'
import { useBillingAccess, useEntitlements } from '@/modules/billing/hooks'
import { fmtBillingDate } from '@/modules/billing/components/UsageMeter'
import { SETTINGS_PATHS } from '@/modules/settings/components/SettingsLayout'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'

/** Opens Settings › Plan & billing with the payment dialog. */
export const BILLING_PAYMENT_PATH = `${SETTINGS_PATHS.billing}?action=payment`

type Tone = 'info' | 'warning' | 'danger'
const TONE: Record<Tone, string> = {
  info: 'border-accent-100 bg-accent-50 text-accent-700 dark:border-accent-500/20 dark:bg-accent-500/10 dark:text-accent-300',
  warning: 'border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500',
  danger: 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500',
}

/**
 * Subscription status above the page: trial countdown, payment failed (grace period), suspended
 * (read-only). Cancelled and deleted have their own screens (CancelledPage, WorkspaceDeleted).
 */
export function BillingBanner() {
  const ent = useEntitlements()
  const { canManage } = useBillingAccess()
  const navigate = useNavigate()
  const status = ent.status
  if (!status) return null

  const action = (label: string, to: string, id: string) =>
    canManage ? (
      <Button id={id} size="xs" variant="secondary" onClick={() => navigate(to)}>
        {label}
      </Button>
    ) : (
      <span className="text-xs opacity-80">Ask your admin.</span>
    )

  if (status === 'trialing' && ent.trialDaysLeft !== null) {
    const d = ent.trialDaysLeft
    return (
      <Banner tone={d <= 3 ? 'warning' : 'info'} icon={<CalendarClock />} status={status}>
        <span>{d <= 0 ? 'Your trial ends today.' : `${d} ${d === 1 ? 'day' : 'days'} left in your trial.`}</span>
        {action('Choose a plan', SETTINGS_PATHS.billing, 'billing-banner-choose-plan')}
      </Banner>
    )
  }
  if (status === 'past_due') {
    return (
      <Banner tone="warning" icon={<AlertTriangle />} status={status}>
        <span>
          Payment failed. Access continues until <span className="font-semibold">{fmtBillingDate(ent.data?.graceEndsAt)}</span>, then the
          workspace becomes read-only.
        </span>
        {action('Update payment', BILLING_PAYMENT_PATH, 'billing-banner-update-payment')}
      </Banner>
    )
  }
  if (status === 'suspended') {
    return (
      <Banner tone="danger" icon={<Lock />} status={status}>
        <span>
          <span className="font-semibold">Workspace is read-only.</span> The subscription is suspended for non-payment; you can view and export
          data, but not change it.
        </span>
        {action('Update payment', BILLING_PAYMENT_PATH, 'billing-banner-update-payment')}
      </Banner>
    )
  }
  return null
}

function Banner({ tone, icon, status, children }: { tone: Tone; icon: ReactNode; status: string; children: ReactNode }) {
  return (
    <div
      id="billing-banner"
      role="status"
      data-status={status}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-[0.8125rem] sm:px-6 [&>svg]:size-4', TONE[tone])}
    >
      <span className="shrink-0 [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  )
}
