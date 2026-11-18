import { useState } from 'react'
import { History, Pencil, Plus } from 'lucide-react'
import type { PlatformPlan } from '@/modules/platform/types'
import type { LimitKey } from '@/modules/billing/types'
import { usePlatform, usePlatformPlans } from '@/modules/platform/hooks'
import { fmtDate, fmtMoney } from '@/modules/platform/format'
import { PlanEditDrawer } from '@/modules/platform/components/PlanEditDrawer'
import { LIMIT_LABEL, PLAN_MODULE_LABEL, formatLimitValue } from '@/modules/billing/gating'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'

export function planPriceLabel(p: Pick<PlatformPlan, 'price' | 'currency' | 'billingPeriod' | 'checkout'>): string {
  if (p.price === null) return p.checkout === 'contact' ? 'Custom pricing' : 'Free'
  return `${fmtMoney(p.price, p.currency)} / ${p.billingPeriod}`
}

/** Plans (versioned): plans:manage edits, billing:view reads. */
export default function PlansPage() {
  const { can } = usePlatform()
  const canEdit = can('plans:manage')
  const query = usePlatformPlans()
  const [editing, setEditing] = useState<PlatformPlan | 'new' | null>(null)
  const plans = query.data ? [...query.data].sort((a, b) => a.rank - b.rank) : []

  return (
    <>
      <PageHeader
        title="Plans"
        description={canEdit ? 'Price, limits and modules. Changing them creates a new version; you choose what happens to current subscribers.' : 'Read only. Plan changes need the plans:manage permission.'}
        actions={
          canEdit && (
            <Button id="plan-new" onClick={() => setEditing('new')}>
              <Plus />
              New plan
            </Button>
          )
        }
      />
      <PageBody>
        {query.isPending ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-80 rounded-card" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : plans.length === 0 ? (
          <EmptyState title="No plans" body="Create the first plan." />
        ) : (
          <div id="plans-list" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => (
              <PlanCardView key={p.id} plan={p} canEdit={canEdit} onEdit={() => setEditing(p)} />
            ))}
          </div>
        )}
      </PageBody>
      {canEdit && <PlanEditDrawer target={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function PlanCardView({ plan, canEdit, onEdit }: { plan: PlatformPlan; canEdit: boolean; onEdit: () => void }) {
  const [history, setHistory] = useState(false)
  return (
    <Card id={`plan-card-${plan.id}`} data-plan-id={plan.id} data-active={String(plan.active)} data-version={plan.version} className="flex flex-col">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-1.5">
            {plan.name}
            <Badge variant="outline">v{plan.version}</Badge>
            {!plan.active && <Badge tone="neutral">Inactive</Badge>}
          </span>
        }
        description={planPriceLabel(plan)}
        action={
          canEdit && (
            <Button id={`plan-edit-${plan.id}`} size="sm" variant="ghost" iconOnly aria-label={`Edit ${plan.name}`} onClick={onEdit}>
              <Pencil />
            </Button>
          )
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <p className="text-xs text-muted">
          <span className="num font-medium text-ink">{plan.subscribers}</span> {plan.subscribers === 1 ? 'company' : 'companies'} · id{' '}
          <span className="font-mono">{plan.id}</span>
        </p>
        <dl className="space-y-1 text-[0.8125rem]">
          {(Object.keys(LIMIT_LABEL) as LimitKey[]).map((k) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted">{LIMIT_LABEL[k]}</dt>
              <dd className="num text-ink">{formatLimitValue(k, plan.limits[k])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-1">
          {plan.modules.map((m) => (
            <Badge key={m} variant="outline">
              {PLAN_MODULE_LABEL[m] ?? m}
            </Badge>
          ))}
        </div>
        {plan.highlights.length > 0 && (
          <ul className="list-disc space-y-0.5 ps-4 text-xs text-muted">
            {plan.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        <div className="mt-auto pt-2">
          <Button size="xs" variant="ghost" id={`plan-history-${plan.id}`} aria-expanded={history} onClick={() => setHistory((v) => !v)}>
            <History />
            Version history ({plan.versions.length})
          </Button>
          {history && (
            <table id={`plan-versions-${plan.id}`} className="mt-2 w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-start font-medium">Ver.</th>
                  <th className="py-1 text-start font-medium">Created</th>
                  <th className="py-1 text-end font-medium">Price</th>
                  <th className="py-1 text-end font-medium">Subs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...plan.versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <tr key={v.version} data-version={v.version}>
                      <td className="num py-1">v{v.version}</td>
                      <td className="py-1 text-muted" title={v.createdBy}>
                        {fmtDate(v.createdAt)} · {v.createdBy}
                      </td>
                      <td className="num py-1 text-end">{v.price === null ? '—' : fmtMoney(v.price, plan.currency)}</td>
                      <td className="num py-1 text-end">{v.subscribers}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
