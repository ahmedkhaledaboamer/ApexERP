import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowLeft,
  Ban,
  Building2,
  CalendarPlus,
  CreditCard,
  Gauge,
  LifeBuoy,
  Lock,
  PlayCircle,
  Puzzle,
  Repeat,
  StickyNote,
  Users,
  XCircle,
} from 'lucide-react'
import type { CompanyAction, CompanyModuleState, PlatformCompanyDetail, TimelineEvent } from '@/modules/platform/types'
import type { PlanModule } from '@/modules/billing/types'
import type { PlatformCompanyUser } from '@/modules/platform/types'
import { addCompanyNote, companyAction, setModuleOverride } from '@/modules/platform/api'
import {
  platformKeys,
  useCompany,
  useCompanyCaps,
  useCompanyNotes,
  useCompanyTimeline,
  useCompanyUsers,
  usePlatform,
  usePlatformPlans,
} from '@/modules/platform/hooks'
import { PLATFORM_PATHS, type CompanyCapabilities } from '@/modules/platform/permissions'
import { COUNTRY_LABEL, SUB_STATUS, fmtDate, fmtDateTime, fmtMoney, fmtRelative } from '@/modules/platform/format'
import { ConfirmReasonDialog } from '@/modules/platform/components/ConfirmReasonDialog'
import { ImpersonateDialog } from '@/modules/platform/components/ImpersonateDialog'
import { SubdomainCard } from '@/modules/platform/components/SubdomainCard'
import { PLAN_MODULE_LABEL } from '@/modules/billing/gating'
import { UsageMeter } from '@/modules/billing/components/UsageMeter'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { useToast } from '@/shared/components/ui/Toast'

/** One company, for support and billing staff (reads are audited as company.viewed). */
export default function CompanyPage() {
  const { id = '' } = useParams()
  const query = useCompany(id)

  if (query.isPending) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </PageBody>
    )
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <PageBody>
        <BackLink />
        {notFound ? (
          <EmptyState title="Company not found" body="It may have been deleted, or the link is wrong." />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }
  return <CompanyView detail={query.data} />
}

function BackLink() {
  return (
    <Link to={PLATFORM_PATHS.companies} className="mb-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
      <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
      Companies
    </Link>
  )
}

type ActionKind = CompanyAction['action']

function CompanyView({ detail }: { detail: PlatformCompanyDetail }) {
  const caps = useCompanyCaps()
  const { company, subscription: sub } = detail
  const status = SUB_STATUS[sub.status]
  const locked = company.companyStatus === 'suspended'
  const [action, setAction] = useState<ActionKind | null>(null)

  return (
    <>
      <div className="mx-auto max-w-[100rem] px-4 pt-5 sm:px-6 lg:px-10">
        <BackLink />
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span id="pc-name">{company.name}</span>
            <span id="pc-status" data-status={sub.status} data-locked={locked || undefined} className="flex items-center gap-1.5">
              <Badge tone={status.tone} variant="dot">
                {status.label}
              </Badge>
              {locked && (
                <Badge tone="red" icon={<Lock aria-hidden />}>
                  Locked by platform
                </Badge>
              )}
            </span>
          </span>
        }
        description={
          <span>
            <span className="font-mono">{company.subdomain}</span> · {detail.plan.name} plan · {COUNTRY_LABEL[company.country] ?? company.country}
          </span>
        }
        className="pt-2 lg:pt-2"
      />
      <PageBody className="space-y-5">
        <ActionsCard detail={detail} caps={caps} onAction={setAction} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="min-w-0 space-y-5">
            <SubscriptionCard detail={detail} caps={caps} />
            <UsageCard detail={detail} />
            <ModulesCard detail={detail} canManage={caps.manage} />
            <UsersCard detail={detail} canImpersonate={caps.impersonate} />
          </div>
          <div className="min-w-0 space-y-5">
            <ProfileCard detail={detail} />
            <SubdomainCard detail={detail} canChange={caps.subdomain} />
            <NotesCard companyId={company.id} canWrite={caps.notes} />
            <TimelineCard companyId={company.id} />
          </div>
        </div>
      </PageBody>
      <ActionDialog detail={detail} action={action} onClose={() => setAction(null)} />
    </>
  )
}

/* ---------------- Shared mutation helper ---------------- */

function useCompanyWrite<T>(companyId: string, fn: (token: string, vars: T) => Promise<unknown>, done: { title: string; body?: string } | ((vars: T) => { title: string; body?: string })) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (vars: T) => fn(token, vars),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: platformKeys.company(companyId) })
      void qc.invalidateQueries({ queryKey: platformKeys.companies })
      void qc.invalidateQueries({ queryKey: platformKeys.overview })
      const msg = typeof done === 'function' ? done(vars) : done
      toast.success(msg.title, msg.body)
    },
  })
}

/* ---------------- Actions ---------------- */

function ActionsCard({ detail, caps, onAction }: { detail: PlatformCompanyDetail; caps: CompanyCapabilities; onAction: (a: ActionKind) => void }) {
  const { company, subscription: sub } = detail
  const locked = company.companyStatus === 'suspended'
  const ended = sub.status === 'cancelled' || sub.status === 'deleted'
  const buttons: { id: string; kind: ActionKind; label: string; icon: ReactNode; show: boolean; danger?: boolean; disabledReason?: string }[] = [
    { id: 'action-change-plan', kind: 'change_plan', label: 'Change plan', icon: <Repeat />, show: caps.billingManage, disabledReason: sub.status === 'deleted' ? 'Deleted' : undefined },
    {
      id: 'action-extend-trial',
      kind: 'extend_trial',
      label: 'Extend trial',
      icon: <CalendarPlus />,
      show: caps.billingManage,
      disabledReason: sub.status !== 'trialing' ? 'Only for companies on a trial' : undefined,
    },
    { id: 'action-suspend', kind: 'suspend', label: 'Suspend', icon: <Ban />, show: caps.manage && !locked, danger: true },
    {
      id: 'action-reactivate',
      kind: 'reactivate',
      label: 'Reactivate',
      icon: <PlayCircle />,
      show: caps.manage && (locked || sub.status === 'suspended' || sub.status === 'cancelled'),
    },
    {
      id: 'action-cancel',
      kind: 'cancel',
      label: 'Cancel subscription',
      icon: <XCircle />,
      show: caps.manage && !ended,
      danger: true,
    },
  ]
  const visible = buttons.filter((b) => b.show)
  return (
    <section id="pc-actions" aria-label="Company actions" className="flex flex-wrap items-center gap-2">
      {visible.length === 0 ? (
        <p className="text-xs text-muted">Your role can view this company but not change it.</p>
      ) : (
        visible.map((b) => {
          const btn = (
            <Button
              key={b.id}
              id={b.id}
              size="sm"
              variant="secondary"
              disabled={!!b.disabledReason}
              className={b.danger ? 'text-danger-700 dark:text-danger-500' : undefined}
              onClick={() => onAction(b.kind)}
            >
              {b.icon}
              {b.label}
            </Button>
          )
          return b.disabledReason ? (
            <Tooltip key={b.id} label={b.disabledReason}>
              {btn}
            </Tooltip>
          ) : (
            btn
          )
        })
      )}
    </section>
  )
}

const ACTION_COPY: Record<ActionKind, { title: string; confirm: string; danger?: boolean; body: (name: string) => string }> = {
  change_plan: {
    title: 'Change plan',
    confirm: 'Change plan',
    body: (n) => `Moves ${n} to another plan now, without a charge (complimentary / manual billing). The subscription and its renewal date stay.`,
  },
  extend_trial: { title: 'Extend trial', confirm: 'Extend trial', body: (n) => `Adds days to ${n}’s trial. The card on file is charged at the new trial end.` },
  suspend: {
    title: 'Suspend company',
    confirm: 'Suspend',
    danger: true,
    body: (n) => `Locks ${n} completely: nobody can sign in or use the API until it’s reactivated. Billing is not changed.`,
  },
  reactivate: {
    title: 'Reactivate company',
    confirm: 'Reactivate',
    body: (n) => `Lifts the platform lock on ${n}. A suspended or cancelled subscription returns to active with a new period and no charge.`,
  },
  cancel: {
    title: 'Cancel subscription',
    confirm: 'Cancel subscription',
    danger: true,
    body: (n) => `Cancels ${n}’s subscription now. The workspace becomes read-only and the data-retention countdown starts.`,
  },
}

function ActionDialog({ detail, action, onClose }: { detail: PlatformCompanyDetail; action: ActionKind | null; onClose: () => void }) {
  const { company, subscription: sub } = detail
  const plans = usePlatformPlans(action === 'change_plan')
  const [planId, setPlanId] = useState('')
  const [days, setDays] = useState('7')
  const mutation = useCompanyWrite<CompanyAction>(company.id, (token, a) => companyAction(token, company.id, a), (a) => ({
    title: { change_plan: 'Plan changed', extend_trial: 'Trial extended', suspend: 'Company suspended', reactivate: 'Company reactivated', cancel: 'Subscription cancelled' }[a.action],
    body: company.name,
  }))

  const copy = action ? ACTION_COPY[action] : null
  const daysNum = Number(days)
  const daysOk = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90
  const choices = (plans.data ?? []).filter((p) => p.id !== sub.planId && p.active)
  const canConfirm = action === 'change_plan' ? !!planId : action === 'extend_trial' ? daysOk : true

  function close() {
    mutation.reset()
    setPlanId('')
    setDays('7')
    onClose()
  }

  return (
    <ConfirmReasonDialog
      open={!!action}
      onClose={close}
      title={copy?.title ?? ''}
      description={copy?.body(company.name)}
      confirmLabel={copy?.confirm ?? 'Confirm'}
      danger={copy?.danger}
      canConfirm={canConfirm}
      pending={mutation.isPending}
      error={mutation.isError ? mutation.error.message : null}
      onConfirm={(reason) => {
        if (!action) return
        const body: CompanyAction =
          action === 'change_plan'
            ? { action, planId, reason }
            : action === 'extend_trial'
              ? { action, days: daysNum, reason }
              : { action, reason }
        mutation.mutate(body, { onSuccess: close })
      }}
    >
      {action === 'change_plan' && (
        <Field id="action-plan" label="New plan" required>
          {plans.isError ? (
            <p className="text-xs text-danger-600">{plans.error.message}</p>
          ) : (
            <SelectInput id="action-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={plans.isPending}>
              <option value="" disabled>
                {plans.isPending ? 'Loading plans…' : 'Choose a plan…'}
              </option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.price === null ? (p.checkout === 'none' ? 'Free' : 'Custom') : fmtMoney(p.price, p.currency)}/{p.billingPeriod}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      )}
      {action === 'extend_trial' && (
        <Field id="action-days" label="Days to add" required hint={`Trial ends ${fmtDate(sub.trialEndsAt)} now. 1–90 days.`} error={days && !daysOk ? 'Enter 1–90 days.' : undefined}>
          <TextInput id="action-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-32" />
        </Field>
      )}
    </ConfirmReasonDialog>
  )
}

/* ---------------- Profile ---------------- */

function ProfileCard({ detail }: { detail: PlatformCompanyDetail }) {
  const c = detail.company
  return (
    <Card id="pc-profile">
      <CardHeader icon={<Building2 />} title="Profile" />
      <CardBody>
        <PropertyList>
          <Property label="Legal name">{c.legalName || '—'}</Property>
          <Property label="Trade name">{c.tradeName || '—'}</Property>
          <Property label="Email">{c.email || '—'}</Property>
          <Property label="Phone">{c.phone || '—'}</Property>
          <Property label="Website">{c.website || '—'}</Property>
          <Property label="City">{c.city || '—'}</Property>
          <Property label="Country">{COUNTRY_LABEL[c.country] ?? c.country}</Property>
          <Property label="Currency">{c.currency}</Property>
          <Property label="Time zone">{c.timezone}</Property>
          <Property label="Created">{fmtDate(c.createdAt)}</Property>
          <Property label="Last activity">{fmtRelative(c.lastActivityAt)}</Property>
          <Property label="Company id">
            <span className="font-mono text-xs">{c.id}</span>
          </Property>
        </PropertyList>
      </CardBody>
    </Card>
  )
}

/* ---------------- Subscription + billing history ---------------- */

const INVOICE_TONE: Record<string, Tone> = { paid: 'green', open: 'amber', failed: 'red', void: 'neutral' }

function SubscriptionCard({ detail, caps }: { detail: PlatformCompanyDetail; caps: CompanyCapabilities }) {
  const { subscription: sub, plan, invoices, company } = detail
  const pm = sub.paymentMethod
  const status = SUB_STATUS[sub.status]
  return (
    <Card id="pc-subscription" data-status={sub.status} data-plan-id={sub.planId}>
      <CardHeader icon={<CreditCard />} title="Subscription" description={`${plan.name} plan`} />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.8125rem] sm:grid-cols-4">
          <Item label="Status">
            <Badge tone={status.tone} variant="dot">
              {status.label}
            </Badge>
          </Item>
          <Item label="Started">{fmtDate(sub.startedAt)}</Item>
          {sub.status === 'trialing' ? <Item label="Trial ends">{fmtDate(sub.trialEndsAt)}</Item> : <Item label="Renews">{fmtDate(sub.currentPeriodEnd)}</Item>}
          <Item label="Period">
            {fmtDate(sub.currentPeriodStart)} – {fmtDate(sub.currentPeriodEnd)}
          </Item>
          {sub.graceEndsAt && <Item label="Grace ends">{fmtDate(sub.graceEndsAt)}</Item>}
          {sub.deleteAt && <Item label="Data deleted on">{fmtDate(sub.deleteAt)}</Item>}
          {company.mrr !== null && <Item label="MRR">{fmtMoney(company.mrr)}</Item>}
          {sub.customPrice !== null && <Item label="Custom price">{fmtMoney(sub.customPrice, plan.currency)}</Item>}
          <Item label="Card">
            {pm ? (
              <span id="pc-card" className="num">
                {pm.brand === 'visa' ? 'Visa' : 'Mastercard'} •••• {pm.last4} · {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
              </span>
            ) : (
              <span className="text-muted">None on file</span>
            )}
          </Item>
        </dl>
        {sub.scheduledChange && (
          <p className="rounded-lg border border-accent-100 bg-accent-50 px-3 py-2 text-[0.8125rem] text-accent-700 dark:border-accent-500/20 dark:bg-accent-500/10 dark:text-accent-300">
            Moves to {sub.scheduledChange.toPlan} on {fmtDate(sub.scheduledChange.effectiveAt)} (requested by {sub.scheduledChange.requestedBy}).
          </p>
        )}
        {sub.cancelAtPeriodEnd && <p className="text-[0.8125rem] text-danger-700 dark:text-danger-500">Cancels at the end of the period ({fmtDate(sub.currentPeriodEnd)}).</p>}

        <div id="pc-invoices">
          <p className="mb-1.5 text-xs font-medium text-muted">Billing history</p>
          {invoices === null || !caps.billingView ? (
            <p className="text-xs text-muted">Invoices need the billing:view permission.</p>
          ) : invoices.length === 0 ? (
            <p className="text-xs text-muted">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[32rem] text-[0.8125rem]">
                <thead className="bg-sunken/70 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">Invoice</th>
                    <th className="px-3 py-2 text-start font-medium">Date</th>
                    <th className="px-3 py-2 text-start font-medium">Description</th>
                    <th className="px-3 py-2 text-end font-medium">Amount</th>
                    <th className="px-3 py-2 text-start font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...invoices]
                    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
                    .map((inv) => (
                      <tr key={inv.id} data-invoice-status={inv.status}>
                        <td className="num px-3 py-2 font-medium whitespace-nowrap">{inv.number}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDate(inv.issuedAt)}</td>
                        <td className="px-3 py-2 text-ink-2">{inv.description}</td>
                        <td className="num px-3 py-2 text-end whitespace-nowrap">{fmtMoney(inv.amount, inv.currency)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={INVOICE_TONE[inv.status] ?? 'neutral'} variant="dot">
                            {inv.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  )
}

/* ---------------- Usage ---------------- */

function UsageCard({ detail }: { detail: PlatformCompanyDetail }) {
  return (
    <Card id="pc-usage">
      <CardHeader icon={<Gauge />} title="Usage vs limits" description={`Period ${fmtDate(detail.usage.periodStart)} – ${fmtDate(detail.usage.periodEnd)}`} />
      <CardBody className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {detail.usage.items.map((item) => (
          <UsageMeter key={item.key} item={item} resetsOn={detail.usage.periodEnd} />
        ))}
      </CardBody>
    </Card>
  )
}

/* ---------------- Modules ---------------- */

type ModuleChange = { module: PlanModule; enabled: boolean | null; label: string; state: CompanyModuleState }

function ModulesCard({ detail, canManage }: { detail: PlatformCompanyDetail; canManage: boolean }) {
  const [change, setChange] = useState<ModuleChange | null>(null)
  const id = detail.company.id
  const mutation = useCompanyWrite<{ module: PlanModule; enabled: boolean | null; reason: string }>(
    id,
    (token, v) => setModuleOverride(token, id, v),
    (v) => ({
      title: v.enabled === null ? 'Override removed' : v.enabled ? 'Module turned on' : 'Module turned off',
      body: PLAN_MODULE_LABEL[v.module] ?? v.module,
    }),
  )

  function close() {
    mutation.reset()
    setChange(null)
  }

  return (
    <Card id="pc-modules">
      <CardHeader icon={<Puzzle />} title="Modules" description="The plan decides; an override turns one module on or off for this company only." />
      <ul className="divide-y divide-line border-t border-line">
        {detail.modules.map((m) => {
          const label = PLAN_MODULE_LABEL[m.module] ?? m.module
          return (
            <li
              key={m.module}
              data-module={m.module}
              data-override={m.override ? 'true' : 'false'}
              data-enabled={String(m.enabled)}
              data-in-plan={String(m.inPlan)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5"
            >
              <span className="min-w-32 text-[0.8125rem] font-medium text-ink">{label}</span>
              <Badge tone={m.inPlan ? 'green' : 'neutral'} variant="outline">
                {m.inPlan ? 'In plan' : 'Not in plan'}
              </Badge>
              {m.override && (
                <Tooltip label={`${m.override.reason} — ${m.override.by}, ${fmtDate(m.override.at)}`}>
                  <span tabIndex={0} className="rounded-md outline-none focus-visible:shadow-[var(--shadow-focus)]" data-override-badge title={m.override.reason}>
                    <Badge tone="amber">Override</Badge>
                  </span>
                </Tooltip>
              )}
              <span className="ms-auto flex items-center gap-2">
                {m.override && canManage && (
                  <Button
                    size="xs"
                    variant="ghost"
                    data-remove-override={m.module}
                    onClick={() => setChange({ module: m.module, enabled: null, label, state: m })}
                  >
                    Remove override
                  </Button>
                )}
                <span className={cn('w-7 text-end text-xs', m.enabled ? 'text-success-700 dark:text-success-500' : 'text-muted')}>{m.enabled ? 'On' : 'Off'}</span>
                <Switch
                  id={`module-switch-${m.module}`}
                  checked={m.enabled}
                  disabled={!canManage}
                  label={`${label} for this company`}
                  onChange={(next) => setChange({ module: m.module, enabled: next === m.inPlan && m.override ? null : next, label, state: m })}
                />
              </span>
            </li>
          )
        })}
      </ul>
      <ConfirmReasonDialog
        open={!!change}
        onClose={close}
        title={
          change ? (change.enabled === null ? `Remove the ${change.label} override` : `Turn ${change.label} ${change.enabled ? 'on' : 'off'}`) : ''
        }
        description={
          change
            ? change.enabled === null
              ? `${change.label} goes back to what the plan says (${change.state.inPlan ? 'on' : 'off'}).`
              : `Overrides the plan for ${detail.company.name} only: ${change.label} is ${change.enabled ? 'on' : 'off'} until the override is removed, even if the plan changes.`
            : undefined
        }
        confirmLabel={change?.enabled === null ? 'Remove override' : 'Save override'}
        pending={mutation.isPending}
        error={mutation.isError ? mutation.error.message : null}
        onConfirm={(reason) => change && mutation.mutate({ module: change.module, enabled: change.enabled, reason }, { onSuccess: close })}
      />
    </Card>
  )
}

/* ---------------- Users + impersonation ---------------- */

function UsersCard({ detail, canImpersonate }: { detail: PlatformCompanyDetail; canImpersonate: boolean }) {
  const users = useCompanyUsers(detail.company.id)
  const [target, setTarget] = useState<PlatformCompanyUser | null>(null)
  const blocked = detail.company.companyStatus === 'suspended'
  return (
    <Card id="pc-users">
      <CardHeader
        icon={<Users />}
        title="Users"
        description={
          <span id="pc-users-count" data-active={detail.usersCount.active} data-total={detail.usersCount.total}>
            {detail.usersCount.active} active of {detail.usersCount.total}
          </span>
        }
      />
      {users.isPending ? (
        <CardBody>
          <Skeleton className="h-24 w-full" />
        </CardBody>
      ) : users.isError ? (
        <CardBody>
          <p className="text-xs text-danger-600">{users.error.message}</p>
        </CardBody>
      ) : (
        <ul className="max-h-[24rem] divide-y divide-line overflow-y-auto border-t border-line">
          {users.data.map((u) => (
            <li key={u.id} data-user-id={u.id} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar name={u.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted">
                  {u.role} · {u.email}
                  <> · last sign-in {fmtRelative(u.lastLoginAt)}</>
                </p>
              </div>
              {!u.active ? (
                <Badge tone="neutral">Deactivated</Badge>
              ) : canImpersonate ? (
                <Button
                  size="sm"
                  variant="secondary"
                  id={`impersonate-${u.id}`}
                  data-impersonate={u.id}
                  disabled={blocked}
                  title={blocked ? 'Reactivate the company first' : undefined}
                  onClick={() => setTarget(u)}
                >
                  <LifeBuoy />
                  Impersonate
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canImpersonate && <ImpersonateDialog user={target} companyName={detail.company.name} onClose={() => setTarget(null)} />}
    </Card>
  )
}

/* ---------------- Notes ---------------- */

function NotesCard({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const notes = useCompanyNotes(companyId)
  const { token } = usePlatform()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const add = useMutation({
    mutationFn: (text: string) => addCompanyNote(token, companyId, text),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: platformKeys.companyNotes(companyId) })
      void qc.invalidateQueries({ queryKey: platformKeys.companyTimeline(companyId) })
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (body.trim().length < 2 || add.isPending) return
    add.mutate(body.trim())
  }
  return (
    <Card id="pc-notes">
      <CardHeader icon={<StickyNote />} title="Internal notes" description="Visible to platform staff only, never to the company." />
      <CardBody className="space-y-3">
        {canWrite && (
          <form id="note-form" onSubmit={submit} className="space-y-2">
            <TextArea id="note-input" aria-label="New support note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the support team…" className="min-h-16" />
            {add.isError && <p className="text-xs text-danger-600">{add.error.message}</p>}
            <div className="flex justify-end">
              <Button id="note-submit" type="submit" size="sm" loading={add.isPending} disabled={body.trim().length < 2}>
                Add note
              </Button>
            </div>
          </form>
        )}
        {notes.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : notes.isError ? (
          <p className="text-xs text-danger-600">{notes.error.message}</p>
        ) : notes.data.length === 0 ? (
          <p className="text-xs text-muted">No notes yet.</p>
        ) : (
          <ul className="space-y-2" id="pc-notes-list">
            {[...notes.data]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((n) => (
                <li key={n.id} data-note-id={n.id} className="rounded-lg border border-line bg-canvas px-3 py-2">
                  <p className="text-[0.8125rem] whitespace-pre-wrap text-ink">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {n.authorName} · {fmtDateTime(n.at)}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/* ---------------- Timeline ---------------- */

const SOURCE: Record<TimelineEvent['source'], { label: string; tone: Tone }> = {
  company: { label: 'Company', tone: 'blue' },
  platform: { label: 'Platform', tone: 'brand' },
  billing: { label: 'Billing', tone: 'teal' },
}

function TimelineCard({ companyId }: { companyId: string }) {
  const timeline = useCompanyTimeline(companyId)
  return (
    <Card id="pc-timeline">
      <CardHeader icon={<Activity />} title="Activity" />
      <CardBody>
        {timeline.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : timeline.isError ? (
          <p className="text-xs text-danger-600">{timeline.error.message}</p>
        ) : timeline.data.length === 0 ? (
          <p className="text-xs text-muted">No activity yet.</p>
        ) : (
          <ol className="relative max-h-[28rem] space-y-3 overflow-y-auto border-s border-line ps-4">
            {[...timeline.data]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((ev) => (
                <li key={ev.id} data-source={ev.source} className="relative">
                  <span aria-hidden className="absolute -start-[1.3rem] top-1.5 size-2 rounded-full bg-line-strong" />
                  <p className="text-[0.8125rem] text-ink">{ev.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge tone={SOURCE[ev.source]?.tone ?? 'neutral'}>{SOURCE[ev.source]?.label ?? ev.source}</Badge>
                    {ev.actor} · <span title={ev.at}>{fmtDateTime(ev.at)}</span>
                  </p>
                </li>
              ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
