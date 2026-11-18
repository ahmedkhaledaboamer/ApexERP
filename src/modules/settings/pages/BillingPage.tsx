import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CalendarClock, Check, CreditCard, Download, Lock, Receipt, Sparkles, X } from 'lucide-react'
import type {
  BillingInvoice,
  BillingOverview,
  DowngradeBlock,
  InvoiceStatus,
  Plan,
  PlanModule,
  SubscriptionStatus,
} from '@/modules/billing/types'
import {
  useBillingAccess,
  useBillingOverview,
  useCancelScheduledChange,
  useCancelSubscription,
  useChangePlan,
  useExportData,
  useSetTrialPlan,
  useResumeSubscription,
} from '@/modules/billing/hooks'
import { LIMIT_LABEL, PLAN_MODULE_LABEL, downgradeBlockMessage, formatLimitValue } from '@/modules/billing/gating'
import { UsageMeter, fmtBillingDate } from '@/modules/billing/components/UsageMeter'
import { PaymentMethodDialog } from '@/modules/billing/components/PaymentMethodDialog'
import { useContactSales } from '@/modules/signup/api'
import { formatPlanPrice } from '@/modules/signup/components/PlanCard'
import { useCurrentUser } from '@/store/hooks'
import { useSupportSessionBlock, useTenant } from '@/modules/tenancy/hooks'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, SelectInput, TextArea } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  trialing: { label: 'Trial', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  past_due: { label: 'Past due', tone: 'amber' },
  suspended: { label: 'Suspended', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  deleted: { label: 'Deleted', tone: 'red' },
}

const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'green' },
  open: { label: 'Open', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  void: { label: 'Void', tone: 'neutral' },
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)

type ChangeTarget = { plan: Plan; kind: 'upgrade' | 'downgrade' }

/**
 * Settings › Plan & billing. Plans, usage, invoices and the subscription all come from
 * GET /billing/overview. Company Admin manages; Management reads. Billing actions stay available
 * while the workspace is read-only (paying is how it comes back).
 */
export default function BillingPage() {
  const { canManage } = useBillingAccess()
  const support = useSupportSessionBlock()
  const query = useBillingOverview()
  const [params, setParams] = useSearchParams()
  const [payOpen, setPayOpen] = useState(false)
  const [change, setChange] = useState<ChangeTarget | null>(null)
  const [contactPlan, setContactPlan] = useState<Plan | null>(null)
  const closeChange = useCallback(() => setChange(null), [])
  const closeContact = useCallback(() => setContactPlan(null), [])
  const closePay = useCallback(() => setPayOpen(false), [])

  // ?action=payment (from the banner) opens the card dialog.
  useEffect(() => {
    if (params.get('action') === 'payment') {
      if (canManage) setPayOpen(true)
      const next = new URLSearchParams(params)
      next.delete('action')
      setParams(next, { replace: true })
    }
  }, [params, setParams, canManage])

  return (
    <div className="space-y-5" id="billing-page">
      <div>
        <h2 className="text-base font-semibold text-ink">Plan & billing</h2>
        <p className="mt-0.5 text-[0.8125rem] text-muted">Your subscription, usage against plan limits, invoices and payment method.</p>
      </div>

      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : (
        <>
          {!canManage && (
            <p id="billing-read-only-note" className="flex items-center gap-2 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden /> View only. The Company Admin changes the plan and payment details.
            </p>
          )}
          {support.blocked && (
            <p
              id="billing-support-blocked"
              className="flex items-center gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500"
            >
              <Lock className="size-3.5" aria-hidden /> Billing and payment changes aren’t available during a support session.
            </p>
          )}
          <CurrentPlan overview={query.data} canManage={canManage} />
          {query.data.subscription.status === 'trialing' && <TrialPlanCard overview={query.data} canManage={canManage} />}
          <UsageSection overview={query.data} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <PaymentSection overview={query.data} canManage={canManage} onUpdate={() => setPayOpen(true)} />
            <InvoicesSection invoices={query.data.invoices} />
          </div>
          <PlansSection
            overview={query.data}
            canManage={canManage}
            onChange={(plan, kind) => setChange({ plan, kind })}
            onContact={setContactPlan}
          />
          <SubscriptionActions overview={query.data} canManage={canManage} />
        </>
      )}

      <PaymentMethodDialog open={payOpen} onClose={closePay} />
      {query.data && <ChangePlanDialog target={change} overview={query.data} onClose={closeChange} onAddCard={() => setPayOpen(true)} />}
      <ContactSalesDialog plan={contactPlan} onClose={closeContact} />
    </div>
  )
}

/* ---------------- Current plan ---------------- */

function CurrentPlan({ overview, canManage }: { overview: BillingOverview; canManage: boolean }) {
  const { subscription: sub, plan, settings } = overview
  const status = STATUS[sub.status]
  const price = formatPlanPrice(plan, settings.trialDays)
  const cancelScheduled = useCancelScheduledChange()
  const support = useSupportSessionBlock()
  const toast = useToast()
  const scheduledPlan = sub.scheduledChange ? overview.plans.find((p) => p.id === sub.scheduledChange!.toPlan) : null

  const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - new Date(overview.serverNow).getTime()) / 86_400_000)) : null
  const trialPct = daysLeft !== null ? Math.min(100, Math.max(0, Math.round(((settings.trialDays - daysLeft) / settings.trialDays) * 100))) : 0

  return (
    <Card id="billing-current" data-plan-id={plan.id} data-status={sub.status}>
      <CardHeader
        icon={<CreditCard />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span id="billing-current-plan">{plan.name} plan</span>
            <span id="billing-status" data-status={sub.status}>
              <Badge tone={status.tone} variant="dot">
                {status.label}
              </Badge>
            </span>
            {sub.cancelAtPeriodEnd && <Badge tone="red">Cancels {fmtBillingDate(sub.currentPeriodEnd)}</Badge>}
          </span>
        }
        description={`${price.amount}${price.suffix ? ` ${price.suffix}` : ''} · since ${fmtBillingDate(sub.startedAt)}`}
      />
      <CardBody className="space-y-4">
        {daysLeft !== null && trialEnd ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
              <span className="flex items-center gap-1.5 font-medium text-ink">
                <CalendarClock className="size-4 text-muted" aria-hidden />
                {daysLeft === 0 ? 'Your trial ends today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your trial`}
              </span>
              <span className="text-xs text-muted" id="billing-trial-end">
                Ends {fmtBillingDate(sub.trialEndsAt)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Trial used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={trialPct}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
            >
              <div
                className={daysLeft <= 3 ? 'h-full rounded-full bg-warning-500' : 'h-full rounded-full bg-brand-600'}
                style={{ width: `${trialPct}%` }}
              />
            </div>
          </div>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 text-[0.8125rem] sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">{sub.status === 'trialing' ? 'Trial ends' : sub.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}</dt>
            <dd className="mt-0.5 font-medium text-ink" id="billing-renewal">
              {fmtBillingDate(sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Current period</dt>
            <dd className="mt-0.5 text-ink">
              {fmtBillingDate(sub.currentPeriodStart)} – {fmtBillingDate(sub.currentPeriodEnd)}
            </dd>
          </div>
          {sub.status === 'past_due' && (
            <div>
              <dt className="text-xs text-muted">Read-only from</dt>
              <dd className="mt-0.5 font-medium text-warning-700 dark:text-warning-500">{fmtBillingDate(sub.graceEndsAt)}</dd>
            </div>
          )}
          {sub.status === 'cancelled' && (
            <div>
              <dt className="text-xs text-muted">Data deleted on</dt>
              <dd className="mt-0.5 font-medium text-danger-700 dark:text-danger-500">{fmtBillingDate(sub.deleteAt)}</dd>
            </div>
          )}
        </dl>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Included modules</p>
          <div className="flex flex-wrap gap-1">
            {plan.modules.map((m) => (
              <Badge key={m} variant="outline">
                {PLAN_MODULE_LABEL[m] ?? m}
              </Badge>
            ))}
          </div>
        </div>

        {sub.scheduledChange && (
          <div
            id="billing-scheduled-change"
            data-to-plan={sub.scheduledChange.toPlan}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-100 bg-accent-50 px-3 py-2.5 text-[0.8125rem] text-accent-700 dark:border-accent-500/20 dark:bg-accent-500/10 dark:text-accent-300"
          >
            <ArrowDownRight className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              Moves to <span className="font-semibold">{scheduledPlan?.name ?? sub.scheduledChange.toPlan}</span> on{' '}
              {fmtBillingDate(sub.scheduledChange.effectiveAt)}. You keep {plan.name} until then.
            </span>
            {canManage && (
              <Button
                id="billing-cancel-scheduled"
                size="sm"
                variant="secondary"
                disabled={support.blocked}
                title={support.hint}
                loading={cancelScheduled.isPending}
                onClick={() =>
                  cancelScheduled.mutate(undefined, {
                    onSuccess: () => toast.success('Change cancelled', `You stay on ${plan.name}.`),
                    onError: (e) => toast.error('Couldn’t cancel the change', e.message),
                  })
                }
              >
                Cancel change
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- After the trial ---------------- */

/**
 * Trialing: which paid plan the trial converts to (subscription.selectedPlanId; null = the lowest
 * active paid plan). Company Admin changes it (POST /billing/trial-plan); the saved card is charged
 * for it when the trial ends.
 */
function TrialPlanCard({ overview, canManage }: { overview: BillingOverview; canManage: boolean }) {
  const sub = overview.subscription
  const setPlan = useSetTrialPlan()
  const support = useSupportSessionBlock()
  const toast = useToast()
  const paid = [...overview.plans].filter((p) => p.active && p.checkout === 'payment').sort((a, b) => a.rank - b.rank)
  const selected = paid.find((p) => p.id === sub.selectedPlanId) ?? paid[0] ?? null
  const pm = sub.paymentMethod
  if (!selected) return null
  const price = formatPlanPrice(selected)

  return (
    <Card id="billing-trial-plan" data-selected-plan={selected.id}>
      <CardHeader
        icon={<CalendarClock />}
        title="After your trial"
        description={`Your trial ends ${fmtBillingDate(sub.trialEndsAt)}. Choose the plan it continues on.`}
      />
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field id="billing-trial-plan-select" label="Continue on" className="sm:w-72">
          <SelectInput
            id="billing-trial-plan-select"
            value={selected.id}
            disabled={!canManage || support.blocked || setPlan.isPending}
            title={support.hint}
            onChange={(e) => {
              const next = paid.find((p) => p.id === e.target.value)
              if (!next) return
              setPlan.mutate(next.id, {
                onSuccess: () => toast.success('Plan after the trial saved', `${next.name} starts when the trial ends.`),
                onError: (err) => toast.error('Couldn’t save the plan', err.message),
              })
            }}
          >
            {paid.map((p) => {
              const pr = formatPlanPrice(p)
              return (
                <option key={p.id} value={p.id}>
                  {p.name} · {pr.amount} {pr.suffix}
                </option>
              )
            })}
          </SelectInput>
        </Field>
        <p id="billing-trial-plan-note" className="min-w-0 flex-1 text-[0.8125rem] text-muted">
          {pm ? (
            <>
              On {fmtBillingDate(sub.trialEndsAt)} your saved card ending <span className="num font-medium text-ink">{pm.last4}</span> is charged{' '}
              <span className="font-medium text-ink">
                {price.amount} {price.suffix}
              </span>{' '}
              for {selected.name}.
            </>
          ) : (
            <>
              Add a payment method before {fmtBillingDate(sub.trialEndsAt)}: it’s charged{' '}
              <span className="font-medium text-ink">
                {price.amount} {price.suffix}
              </span>{' '}
              for {selected.name} when the trial ends.
            </>
          )}
          {!canManage && ' Only the Company Admin can change it.'}
        </p>
      </CardBody>
    </Card>
  )
}

/* ---------------- Usage ---------------- */

function UsageSection({ overview }: { overview: BillingOverview }) {
  const { usage, settings } = overview
  return (
    <Card id="billing-usage">
      <CardHeader
        icon={<Sparkles />}
        title="Usage"
        description={`Against your plan’s limits. Monthly counters reset on ${fmtBillingDate(usage.periodEnd)}.`}
      />
      <CardBody className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {usage.items.map((item) => (
          <UsageMeter key={item.key} item={item} resetsOn={usage.periodEnd} thresholds={settings.usageWarningThresholds} />
        ))}
      </CardBody>
    </Card>
  )
}

/* ---------------- Payment method ---------------- */

function PaymentSection({ overview, canManage, onUpdate }: { overview: BillingOverview; canManage: boolean; onUpdate: () => void }) {
  const pm = overview.subscription.paymentMethod
  const support = useSupportSessionBlock()
  return (
    <Card id="billing-payment">
      <CardHeader icon={<CreditCard />} title="Payment method" />
      <CardBody className="space-y-3">
        {pm ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3">
            <span
              aria-label={pm.brand === 'visa' ? 'Visa' : 'Mastercard'}
              className="grid h-8 w-12 shrink-0 place-items-center rounded-md bg-ink text-[0.625rem] font-bold tracking-wider text-canvas uppercase"
            >
              {pm.brand === 'visa' ? 'Visa' : 'MC'}
            </span>
            <div className="min-w-0 text-[0.8125rem]">
              <p className="num font-medium text-ink" id="billing-card-last4">
                •••• {pm.last4}
              </p>
              <p className="text-xs text-muted">
                {pm.holder} · expires {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted">No card on file. Add one before the trial ends to keep your workspace.</p>
        )}
        {canManage && (
          <Button id="billing-update-payment" variant="secondary" disabled={support.blocked} title={support.hint} data-support-blocked={support.blocked || undefined} onClick={onUpdate}>
            {pm ? 'Update payment method' : 'Add payment method'}
          </Button>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- Invoices ---------------- */

function InvoicesSection({ invoices }: { invoices: BillingInvoice[] }) {
  return (
    <Card id="billing-invoices">
      <CardHeader icon={<Receipt />} title="Invoices" />
      {invoices.length === 0 ? (
        <CardBody>
          <p className="text-[0.8125rem] text-muted">No invoices yet.</p>
        </CardBody>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="text-start text-xs text-muted">
                <th scope="col" className="px-5 py-2 text-start font-medium">
                  Invoice
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  Amount
                </th>
                <th scope="col" className="px-5 py-2 text-start font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...invoices]
                .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
                .map((inv) => (
                  <tr key={inv.id} data-invoice-status={inv.status}>
                    <td className="num px-5 py-2.5 font-medium whitespace-nowrap text-ink">{inv.number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{fmtBillingDate(inv.issuedAt)}</td>
                    <td className="min-w-48 px-3 py-2.5 text-ink-2">{inv.description}</td>
                    <td className="num px-3 py-2.5 text-end whitespace-nowrap">{money(inv.amount, inv.currency)}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={INVOICE_STATUS[inv.status].tone} variant="dot">
                        {INVOICE_STATUS[inv.status].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ---------------- Plan comparison ---------------- */

function PlansSection({
  overview,
  canManage,
  onChange,
  onContact,
}: {
  overview: BillingOverview
  canManage: boolean
  onChange: (plan: Plan, kind: 'upgrade' | 'downgrade') => void
  onContact: (plan: Plan) => void
}) {
  const current = overview.plan
  const plans = [...overview.plans].sort((a, b) => a.rank - b.rank)
  const allModules = Array.from(new Set(plans.flatMap((p) => p.modules))) as PlanModule[]
  const limitKeys = overview.usage.items.map((i) => i.key)
  const scheduledTo = overview.subscription.scheduledChange?.toPlan
  const blocked = overview.subscription.status === 'cancelled' || overview.subscription.status === 'deleted'
  const support = useSupportSessionBlock()

  function action(plan: Plan) {
    if (plan.id === current.id) return <Badge tone="brand">Current plan</Badge>
    if (plan.id === scheduledTo) return <Badge tone="blue">Scheduled</Badge>
    if (!canManage || blocked || plan.checkout === 'none' || !plan.active) return null
    if (plan.checkout === 'contact')
      return (
        <Button id={`plan-action-${plan.id}`} data-kind="contact" size="sm" variant="secondary" className="w-full" disabled={support.blocked} title={support.hint} onClick={() => onContact(plan)}>
          Contact sales
        </Button>
      )
    const kind = plan.rank > current.rank || current.checkout === 'none' ? 'upgrade' : 'downgrade'
    return (
      <Button
        id={`plan-action-${plan.id}`}
        data-kind={kind}
        size="sm"
        variant={kind === 'upgrade' ? 'primary' : 'secondary'}
        className="w-full"
        disabled={support.blocked}
        title={support.hint}
        onClick={() => onChange(plan, kind)}
      >
        {kind === 'upgrade' ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
        {kind === 'upgrade' ? 'Upgrade' : 'Downgrade'}
      </Button>
    )
  }

  return (
    <Card id="billing-plans">
      <CardHeader
        title="Compare plans"
        description="Upgrades apply now (you pay the prorated difference). Downgrades take effect at the end of the billing period."
      />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[40rem] text-[0.8125rem]">
          <thead>
            <tr>
              <th scope="col" className="w-48 px-5 py-3 text-start text-xs font-medium text-muted">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((p) => {
                const price = formatPlanPrice(p, overview.settings.trialDays)
                return (
                  <th
                    key={p.id}
                    scope="col"
                    data-plan-id={p.id}
                    aria-current={p.id === current.id ? 'true' : undefined}
                    className={cn('px-3 py-3 text-start align-top font-normal', p.id === current.id && 'bg-brand-50/60 dark:bg-brand-500/5')}
                  >
                    <p className="text-sm font-semibold text-ink">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-semibold text-ink">{price.amount}</span> {price.suffix}
                    </p>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {limitKeys.map((key) => (
              <tr key={key}>
                <th scope="row" className="px-5 py-2 text-start font-normal text-muted">
                  {overview.usage.items.find((i) => i.key === key)?.label ?? LIMIT_LABEL[key]}
                </th>
                {plans.map((p) => (
                  <td key={p.id} className={cn('num px-3 py-2 text-ink', p.id === current.id && 'bg-brand-50/60 dark:bg-brand-500/5')}>
                    {formatLimitValue(key, p.limits[key])}
                  </td>
                ))}
              </tr>
            ))}
            {allModules.map((m) => (
              <tr key={m}>
                <th scope="row" className="px-5 py-2 text-start font-normal text-muted">
                  {PLAN_MODULE_LABEL[m] ?? m}
                </th>
                {plans.map((p) => (
                  <td key={p.id} className={cn('px-3 py-2', p.id === current.id && 'bg-brand-50/60 dark:bg-brand-500/5')}>
                    {p.modules.includes(m) ? (
                      <Check className="size-4 text-success-600" aria-label="Included" />
                    ) : (
                      <X className="size-4 text-subtle" aria-label="Not included" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-5 py-3">
                <span className="sr-only">Action</span>
              </th>
              {plans.map((p) => (
                <td key={p.id} className={cn('px-3 py-3', p.id === current.id && 'bg-brand-50/60 dark:bg-brand-500/5')}>
                  {action(p)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {!canManage && <p className="px-5 py-3 text-xs text-muted">Only the Company Admin can change the plan.</p>}
    </Card>
  )
}

function ChangePlanDialog({
  target,
  overview,
  onClose,
  onAddCard,
}: {
  target: ChangeTarget | null
  overview: BillingOverview
  onClose: () => void
  onAddCard: () => void
}) {
  const change = useChangePlan()
  const toast = useToast()
  const { reset } = change
  const close = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const plan = target?.plan
  const upgrade = target?.kind === 'upgrade'
  const err = change.error instanceof ApiError ? change.error : null
  const blocks: DowngradeBlock[] =
    err?.code === 'downgrade_blocked' ? (((err as ApiError & { details?: { blocks?: DowngradeBlock[] } }).details?.blocks ?? []) as DowngradeBlock[]) : []
  const needsCard = err?.code === 'payment_method_required'
  const price = plan ? formatPlanPrice(plan) : null

  function confirm() {
    if (!plan) return
    change.mutate(plan.id, {
      onSuccess: (res) => {
        if (res.kind === 'upgraded') {
          toast.success(
            `You’re on ${plan.name}`,
            res.invoice ? `${money(res.invoice.amount, res.invoice.currency)} charged (invoice ${res.invoice.number}).` : 'The new limits apply now.',
          )
        } else {
          toast.success('Downgrade scheduled', `${plan.name} starts on ${fmtBillingDate(overview.subscription.currentPeriodEnd)}.`)
        }
        close()
      },
    })
  }

  return (
    <Modal
      open={!!target}
      onClose={close}
      title={plan ? (upgrade ? `Upgrade to ${plan.name}` : `Downgrade to ${plan.name}`) : 'Change plan'}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {needsCard ? (
            <Button
              id="change-plan-add-card"
              onClick={() => {
                close()
                onAddCard()
              }}
            >
              Add payment method
            </Button>
          ) : (
            <Button id="change-plan-confirm" onClick={confirm} loading={change.isPending} disabled={blocks.length > 0}>
              {upgrade ? `Upgrade and pay` : 'Schedule downgrade'}
            </Button>
          )}
        </>
      }
    >
      {plan && price && (
        <div id="change-plan-dialog" data-plan-id={plan.id} data-kind={target?.kind} className="space-y-3 text-[0.8125rem]">
          {upgrade ? (
            <>
              <p className="text-ink-2">
                {plan.name} starts now. You’re charged the prorated difference for the rest of this period (to{' '}
                {fmtBillingDate(overview.subscription.currentPeriodEnd)}), then{' '}
                <span className="font-semibold text-ink">
                  {price.amount} {price.suffix}
                </span>
                .
              </p>
              {overview.subscription.paymentMethod && (
                <p className="text-xs text-muted">
                  Charged to the card ending <span className="num">{overview.subscription.paymentMethod.last4}</span>.
                </p>
              )}
            </>
          ) : (
            <p className="text-ink-2">
              You keep {overview.plan.name} until {fmtBillingDate(overview.subscription.currentPeriodEnd)}. Then {plan.name} applies at{' '}
              {price.amount} {price.suffix}. Modules not in {plan.name} become locked.
            </p>
          )}
          {blocks.length > 0 && (
            <div
              role="alert"
              id="change-plan-blocks"
              className="space-y-1.5 rounded-lg border border-danger-100 bg-danger-50 p-3 text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500"
            >
              <p className="font-semibold">Can’t schedule this downgrade yet</p>
              <ul className="list-disc space-y-1 ps-4">
                {blocks.map((b) => (
                  <li key={b.key} data-limit={b.key}>
                    {downgradeBlockMessage(b, plan.name)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {needsCard && (
            <p role="alert" className="text-danger-700 dark:text-danger-500">
              Add a payment method to upgrade.
            </p>
          )}
          {err && !blocks.length && !needsCard && (
            <p role="alert" className="text-danger-700 dark:text-danger-500">
              {err.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ---------------- Cancel / resume / export ---------------- */

function SubscriptionActions({ overview, canManage }: { overview: BillingOverview; canManage: boolean }) {
  const sub = overview.subscription
  const cancel = useCancelSubscription()
  const resume = useResumeSubscription()
  const exporter = useExportData()
  const support = useSupportSessionBlock()
  const toast = useToast()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const canCancel = canManage && !sub.cancelAtPeriodEnd && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due')

  return (
    <Card id="billing-subscription">
      <CardHeader title="Subscription" description={`Data is kept for ${overview.settings.retentionDays} days after cancellation, then deleted.`} />
      <CardBody className="flex flex-wrap items-center gap-2">
        <Button
          id="billing-export"
          variant="secondary"
          disabled={support.blocked}
          title={support.hint}
          data-support-blocked={support.blocked || undefined}
          loading={exporter.isPending}
          onClick={() =>
            exporter.mutate(undefined, {
              onSuccess: () => toast.success('Export downloaded'),
              onError: (e) => toast.error('Export failed', e.message),
            })
          }
        >
          <Download aria-hidden />
          Export data
        </Button>
        {canManage && sub.cancelAtPeriodEnd && (
          <Button
            id="billing-resume"
            disabled={support.blocked}
            title={support.hint}
            loading={resume.isPending}
            onClick={() =>
              resume.mutate(undefined, {
                onSuccess: () => toast.success('Subscription resumed', `Renews on ${fmtBillingDate(sub.currentPeriodEnd)}.`),
                onError: (e) => toast.error('Couldn’t resume', e.message),
              })
            }
          >
            Resume subscription
          </Button>
        )}
        {canCancel && (
          <Button
            id="billing-cancel-subscription"
            variant="ghost"
            className="text-danger-700 dark:text-danger-500"
            disabled={support.blocked}
            title={support.hint}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel subscription
          </Button>
        )}
      </CardBody>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        size="sm"
        title="Cancel subscription?"
        description={`You keep full access until ${fmtBillingDate(sub.currentPeriodEnd)}. Then the workspace becomes read-only and its data is deleted after ${overview.settings.retentionDays} days. You can resume any time before ${fmtBillingDate(sub.currentPeriodEnd)}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Keep subscription
            </Button>
            <Button
              id="billing-cancel-confirm"
              variant="danger"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    toast.success('Subscription will end', `Access continues until ${fmtBillingDate(sub.currentPeriodEnd)}.`)
                    setConfirmCancel(false)
                  },
                  onError: (e) => toast.error('Couldn’t cancel', e.message),
                })
              }
            >
              Cancel subscription
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">Export your data first if you might need it later.</p>
      </Modal>
    </Card>
  )
}

/* ---------------- Contact sales (plans with checkout: contact) ---------------- */

function ContactSalesDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const user = useCurrentUser()
  const tenant = useTenant()
  const [message, setMessage] = useState('')
  const send = useContactSales()
  const toast = useToast()
  const { reset } = send
  const close = useCallback(() => {
    setMessage('')
    reset()
    onClose()
  }, [reset, onClose])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!plan || !user || !tenant) return
    send.mutate(
      {
        companyName: tenant.name,
        name: user.name,
        email: user.email,
        country: tenant.regional.country,
        message: `Plan change to ${plan.name} for ${tenant.subdomain}.${message.trim() ? `\n\n${message.trim()}` : ''}`,
      },
      {
        onSuccess: () => {
          toast.success('Request sent', `Our sales team will contact you at ${user.email} about ${plan.name}.`)
          close()
        },
      },
    )
  }

  return (
    <Modal
      open={!!plan}
      onClose={close}
      title={plan ? `Talk to sales about ${plan.name}` : 'Contact sales'}
      description="Custom plans are set up by our sales team. We reply within one business day."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="contact-sales-form" loading={send.isPending}>
            <Sparkles aria-hidden />
            Contact sales
          </Button>
        </>
      }
    >
      <form id="contact-sales-form" noValidate onSubmit={onSubmit} className="space-y-4">
        <Field id="contact-sales-message" label="Anything we should know?" hint="Optional: team size, timing, billing details.">
          <TextArea id="contact-sales-message" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {send.isError && (
          <p role="alert" className="text-xs text-danger-600 dark:text-danger-500">
            {send.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}
