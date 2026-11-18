import { useState } from 'react'
import { Archive, Download, RotateCcw } from 'lucide-react'
import { ApiError } from '@/shared/lib/apiError'
import { useBillingAccess, useBillingOverview, useEntitlements, useExportData, useReactivate } from '@/modules/billing/hooks'
import { PaymentMethodDialog } from '@/modules/billing/components/PaymentMethodDialog'
import { fmtBillingDate } from '@/modules/billing/components/UsageMeter'
import { formatPlanPrice } from '@/modules/signup/components/PlanCard'
import { useSupportSessionBlock, useTenant } from '@/modules/tenancy/hooks'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * Shown in place of every page while the subscription is Cancelled: the data is kept until
 * `deleteAt` (retention), can be exported, and the Company Admin can reactivate.
 */
export default function CancelledPage() {
  const ent = useEntitlements()
  const tenant = useTenant()
  const { canView, canManage } = useBillingAccess()
  const exporter = useExportData()
  const support = useSupportSessionBlock()
  const toast = useToast()
  const deleteAt = ent.data?.deleteAt ?? null
  const daysLeft = deleteAt ? Math.max(0, Math.ceil((new Date(deleteAt).getTime() - new Date(ent.data?.serverNow ?? Date.now()).getTime()) / 86_400_000)) : null

  return (
    <div id="cancelled-page">
      <PageHeader
        icon={
          <IconTile>
            <Archive />
          </IconTile>
        }
        title="Export your data"
        description={
          <>
            {tenant?.branding.displayName ?? 'This workspace'}’s subscription is cancelled. The workspace is read-only
            {deleteAt ? (
              <>
                {' '}
                and its data is kept until <span className="font-medium text-ink">{fmtBillingDate(deleteAt)}</span>
                {daysLeft !== null ? ` (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'})` : ''}, then deleted for good.
              </>
            ) : (
              '.'
            )}
          </>
        }
      />
      <PageBody className="grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <CardHeader icon={<Download />} title="Download a copy" description="Leads, contacts, customers, projects, tasks, quotations and users as JSON." />
          <CardBody>
            {canView ? (
              <Button
                id="cancelled-export"
                disabled={support.blocked}
                title={support.hint}
                loading={exporter.isPending}
                onClick={() =>
                  exporter.mutate(undefined, {
                    onSuccess: (d) => toast.success('Export downloaded', `${Object.values(d.counts).reduce((a, b) => a + b, 0)} records`),
                    onError: (e) => toast.error('Export failed', e.message),
                  })
                }
              >
                <Download aria-hidden />
                Download export
              </Button>
            ) : (
              <p className="text-[0.8125rem] text-muted">Ask your company administrator for an export.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<RotateCcw />} title="Reactivate" description="Pick a plan and pay to bring the workspace back, with all its data." />
          <CardBody>{canManage ? <Reactivate /> : <p className="text-[0.8125rem] text-muted">Only the Company Admin can reactivate.</p>}</CardBody>
        </Card>
      </PageBody>
    </div>
  )
}

function Reactivate() {
  const overview = useBillingOverview()
  const reactivate = useReactivate()
  const support = useSupportSessionBlock()
  const toast = useToast()
  const [planId, setPlanId] = useState<string>('')
  const [payOpen, setPayOpen] = useState(false)
  const plans = (overview.data?.plans ?? []).filter((p) => p.active && p.checkout === 'payment').sort((a, b) => a.rank - b.rank)
  const selected = planId || (plans.find((p) => p.id === overview.data?.plan.id) ?? plans[0])?.id || ''
  const needsCard = reactivate.error instanceof ApiError && reactivate.error.code === 'payment_method_required'

  function submit() {
    if (!selected) return
    reactivate.mutate(selected, { onSuccess: () => toast.success('Workspace reactivated', 'Welcome back. Everything is editable again.') })
  }

  return (
    <div className="space-y-3">
      <Field id="reactivate-plan" label="Plan">
        <SelectInput id="reactivate-plan" value={selected} onChange={(e) => setPlanId(e.target.value)} disabled={plans.length === 0}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatPlanPrice(p).amount} {formatPlanPrice(p).suffix}
            </option>
          ))}
        </SelectInput>
      </Field>
      {overview.data?.subscription.paymentMethod ? (
        <p className="text-xs text-muted">
          Charged to the card ending <span className="num">{overview.data.subscription.paymentMethod.last4}</span>.{' '}
          <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => setPayOpen(true)}>
            Change card
          </button>
        </p>
      ) : null}
      {reactivate.isError && (
        <p role="alert" className="text-[0.8125rem] text-danger-700 dark:text-danger-500">
          {needsCard ? 'Add a payment method first.' : reactivate.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button id="cancelled-reactivate" onClick={submit} loading={reactivate.isPending} disabled={!selected || support.blocked} title={support.hint}>
          Reactivate
        </Button>
        {(needsCard || !overview.data?.subscription.paymentMethod) && (
          <Button id="cancelled-add-card" variant="secondary" disabled={support.blocked} title={support.hint} onClick={() => setPayOpen(true)}>
            Add payment method
          </Button>
        )}
      </div>
      <PaymentMethodDialog open={payOpen} onClose={() => setPayOpen(false)} onSaved={() => reactivate.reset()} />
    </div>
  )
}
