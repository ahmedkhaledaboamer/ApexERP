import { useNavigate } from 'react-router-dom'
import { ArrowRight, Lock } from 'lucide-react'
import type { PlanModule } from '@/modules/billing/types'
import { PATHS } from '@/app/paths'
import { SETTINGS_PATHS } from '@/modules/settings/components/SettingsLayout'
import { cheapestPlanWith, PLAN_MODULE_LABEL } from '@/modules/billing/gating'
import { useBillingAccess, useEntitlements } from '@/modules/billing/hooks'
import { usePlans } from '@/modules/signup/api'
import { formatPlanPrice } from '@/modules/signup/components/PlanCard'
import { useTenant } from '@/modules/tenancy/hooks'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * Upgrade page: shown instead of a module the plan doesn't include (direct URL, locked sidebar
 * item). Which module, the current plan, the cheapest plan that includes it; "View plans" for the
 * Company Admin, "ask your admin" for everyone else.
 */
export function ModuleNotIncluded({ module }: { module: PlanModule }) {
  const tenant = useTenant()
  const navigate = useNavigate()
  const ent = useEntitlements()
  const { canManage } = useBillingAccess()
  const plans = usePlans()
  const label = PLAN_MODULE_LABEL[module] ?? module
  const target = plans.data ? cheapestPlanWith(module, plans.data, ent.planId ?? undefined) : null
  const company = tenant?.branding.displayName

  return (
    <>
      <PageHeader
        icon={
          <IconTile tone="brand">
            <Lock />
          </IconTile>
        }
        title={`${label} isn’t in your plan`}
        description={
          <>
            {company ? `${company} is on the ` : 'You’re on the '}
            <span className="font-medium text-ink">{ent.planName ?? 'current'}</span> plan, which doesn’t include {label}.
          </>
        }
      />
      <PageBody>
        <Card id="upgrade-page" data-module={module} className="max-w-xl">
          <CardBody className="space-y-4 pt-5">
            {plans.isPending ? (
              <Skeleton className="h-12" />
            ) : target ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">Included from</p>
                  <p className="text-[0.875rem] font-semibold text-ink" id="upgrade-page-plan">
                    {target.name}
                    <span className="ms-2 text-xs font-normal text-muted">
                      {formatPlanPrice(target).amount} {formatPlanPrice(target).suffix}
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[0.8125rem] text-muted">Contact sales to add {label} to your workspace.</p>
            )}

            {canManage ? (
              <p className="text-[0.8125rem] text-muted">Compare plans and upgrade in Settings › Plan & billing. Upgrades apply right away.</p>
            ) : (
              <p className="text-[0.8125rem] text-muted" id="upgrade-page-ask-admin">
                Ask your company administrator to upgrade the plan if your team needs {label}.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button id="upgrade-page-view-plans" onClick={() => navigate(SETTINGS_PATHS.billing)}>
                  View plans
                  <ArrowRight className="rtl:rotate-180" aria-hidden />
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate(PATHS.dashboard)}>
                Back to dashboard
              </Button>
            </div>
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
