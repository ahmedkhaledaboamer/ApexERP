import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { parseISO } from 'date-fns'
import { z } from 'zod'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileSignature,
  FileText,
  FolderKanban,
  Package,
  Trophy,
  UserCog,
  XCircle,
} from 'lucide-react'
import type { WonPreview, WonPreviewProject, WonResult } from '@/modules/won/types'
import { useWinLead, useWonPreview, type WonPreviewQuery } from '@/modules/won/api'
import { isWorkingDay } from '@/modules/won/plan'
import { getRegion } from '@/shared/lib/region'
import { workingWeekLabel } from '@/shared/lib/companyDay'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useProjectsQuery } from '@/modules/tasks/hooks/useTasks'
import { CategoryIcon, ServiceMultiSelect } from '@/modules/leads/components/ServiceFields'
import { customerPath, leadPath, projectPath, quotationPath } from '@/app/paths'
import { ApiError } from '@/shared/lib/apiError'
import { toBillingEvent, type BillingEvent } from '@/shared/lib/billingEvents'
import { LIMIT_LABEL, PLAN_MODULE_LABEL, formatLimitValue } from '@/modules/billing/gating'
import { useBillingAccess } from '@/modules/billing/hooks'
import { SETTINGS_PATHS } from '@/modules/settings/components/SettingsLayout'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { wonDialogClosed, type WonDialogTarget } from '@/store/wonSlice'
import { Can } from '@/shared/components/permissions'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { QUOTATION_STATUS_LABEL } from '@/shared/domain/enums'

/* ---------------- Host (mounted once in the app layout) ---------------- */

/** Renders the Won dialog for `state.won.open`. Only roles that may edit sales records see it. */
export function WonDialogHost() {
  const target = useAppSelector((s) => s.won.open)
  const dispatch = useAppDispatch()
  if (!target) return null
  return (
    <Can module="sales" action="edit">
      {/* Keyed by target: each open starts clean, with a fresh idempotency key. */}
      <WonDialog key={`${target.leadId}:${target.quotationId ?? ''}`} target={target} onClose={() => dispatch(wonDialogClosed())} />
    </Can>
  )
}

/* ---------------- Validation ---------------- */

const wonSchema = z.object({
  quotationId: z.string().nullable(),
  serviceIds: z.array(z.string().min(1)).min(1, 'Pick at least one purchased service.'),
  projectManagerId: z.string().min(1, 'Pick a project manager.'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a project start date.'),
})

type FieldErrors = Partial<Record<'serviceIds' | 'projectManagerId' | 'startDate', string>>

/** The failed step from a Won error body (`{ message, step }`), kept on ApiError as `details`. */
function failedStep(error: unknown): string | null {
  const details = (error as { details?: unknown } | null)?.details
  if (details && typeof details === 'object' && 'step' in details && typeof (details as { step: unknown }).step === 'string') {
    return (details as { step: string }).step
  }
  return null
}

const STEP_LABEL: Record<string, string> = {
  validate: 'validation',
  lead: 'lead status',
  customer: 'customer',
  contract: 'contract',
  projects: 'projects',
  notify: 'notifications',
  audit: 'audit log',
}

/* ---------------- Dialog ---------------- */

interface WonDialogProps {
  target: WonDialogTarget
  onClose: () => void
}

export function WonDialog({ target, onClose }: WonDialogProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const catalog = useCatalog()
  const users = useUsersQuery()

  // User overrides; `undefined` means "use the server's suggestion".
  const [quotationId, setQuotationId] = useState<string | null | undefined>(target.quotationId ?? undefined)
  const [serviceIds, setServiceIds] = useState<string[] | undefined>(undefined)
  const [projectManagerId, setProjectManagerId] = useState<string | undefined>(undefined)
  const [startDate, setStartDate] = useState<string | undefined>(undefined)
  const [errors, setErrors] = useState<FieldErrors>({})

  const query: WonPreviewQuery = { quotationId, serviceIds, projectManagerId, startDate }
  const previewQuery = useWonPreview(target.leadId, query)
  // Keep the last preview on screen while a changed input re-fetches (no flashing skeleton).
  const lastPreview = useRef<WonPreview | undefined>(undefined)
  if (previewQuery.data) lastPreview.current = previewQuery.data
  const preview = previewQuery.data ?? lastPreview.current

  const win = useWinLead(target.leadId)
  // One key per dialog open: a repeated click or a resubmitted request can't win twice.
  const [idempotencyKey] = useState(newKey)
  const submitting = useRef(false)

  const activeUsers = useMemo(() => (users.data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [users.data])

  const busy = win.isPending
  function close() {
    if (busy) return // Never abandon an in-flight transaction mid-way.
    onClose()
  }

  // Values shown in the form: the user's choice, else the preview's default.
  const values = preview
    ? {
        quotationId: quotationId === undefined ? (preview.quotation?.id ?? null) : quotationId,
        serviceIds: serviceIds ?? preview.serviceIds,
        projectManagerId: projectManagerId ?? preview.defaults.projectManagerId,
        startDate: startDate ?? preview.defaults.startDate,
      }
    : null

  function confirm() {
    if (!preview || !values || submitting.current || win.isPending) return
    const parsed = wonSchema.safeParse(values)
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    submitting.current = true
    win.mutate(
      { ...parsed.data, idempotencyKey },
      {
        onSuccess: (result: WonResult) => {
          // useWinLead refreshes every affected cache (WON_INVALIDATES: leads, CRM, quotations,
          // projects, tasks, alerts/notifications, dashboard, reports, audit).
          const p = result.projectIds.length
          const t = result.taskIds.length
          toast.success(`Won · ${p} project${p === 1 ? '' : 's'}, ${t} task${t === 1 ? '' : 's'} created`, preview.company)
          onClose()
          navigate(result.redirectTo)
        },
        onSettled: () => {
          submitting.current = false
        },
      },
    )
  }

  const problems = preview?.problems ?? []
  const stale = previewQuery.isFetching
  const canConfirm = !!preview && !preview.alreadyWon && problems.length === 0 && !stale && !previewQuery.isError
  const step = win.isError ? failedStep(win.error) : null
  const plan = win.isError ? planProblem(win.error) : null

  const title = preview?.alreadyWon ? `${preview.company} is already Won` : preview ? `Win ${preview.company}` : 'Win this deal'

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={
        <span className="flex items-center gap-2">
          <Trophy className="size-4 text-success-600" aria-hidden />
          {title}
        </span>
      }
      description={preview?.alreadyWon ? 'Nothing to do: this lead was converted before.' : 'Review what will happen. Nothing is saved until you confirm, and if any step fails nothing is saved at all.'}
      footer={
        preview?.alreadyWon ? (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button write onClick={confirm} loading={busy} disabled={!canConfirm || busy}>
              <Trophy />
              {busy ? 'Winning…' : win.isError ? 'Retry' : 'Confirm Won'}
            </Button>
          </>
        )
      }
    >
      {!preview && previewQuery.isPending ? (
        <PreviewSkeleton />
      ) : !preview && previewQuery.isError ? (
        <ErrorState message={previewQuery.error.message} onRetry={() => previewQuery.refetch()} />
      ) : !preview || !values ? (
        <EmptyState title="Nothing to preview" body="This lead couldn’t be loaded." />
      ) : preview.alreadyWon ? (
        <AlreadyWon preview={preview} onNavigate={close} />
      ) : (
        <div className="space-y-5" aria-busy={stale || undefined}>
          {win.isError && (
            <div role="alert" className="rounded-lg border border-danger-100 bg-danger-50 p-3.5 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
              <p className="flex items-center gap-2 font-semibold">
                <XCircle className="size-4 shrink-0" aria-hidden />
                {step ? `Failed at: ${STEP_LABEL[step] ?? step}. Nothing was saved.` : 'The Won flow failed. Nothing was saved.'}
              </p>
              {plan ? <PlanProblem event={plan} onUpgrade={close} /> : <p className="mt-1 ps-6">{win.error.message}</p>}
              {win.error instanceof ApiError && win.error.status === 409 && (
                <p className="mt-1 ps-6 text-xs">Refresh the lead to see its current state before trying again.</p>
              )}
            </div>
          )}

          {problems.length > 0 && (
            <div role="alert" className="rounded-lg border border-danger-100 bg-danger-50 p-3.5 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
              <p className="font-semibold">Fix these before winning:</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <Link to={leadPath(preview.leadId)} onClick={close} className="mt-2 inline-block text-xs font-medium underline">
                Open the lead
              </Link>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-warning-100 bg-warning-50 p-3.5 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500">
              <ul className="space-y-1">
                {preview.warnings.map((w) => (
                  <li key={w} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Section icon={<Trophy />} title="What will happen">
            <ul className="space-y-2 text-[0.8125rem]">
              <li className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{preview.company}</span>
                <Badge tone="neutral">{preview.status}</Badge>
                <ArrowRight className="size-3.5 text-subtle rtl:-scale-x-100" aria-hidden />
                <Badge tone="green">Won</Badge>
              </li>
              <li className="flex items-start gap-2">
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span>
                  {preview.customer.mode === 'create' ? (
                    <>
                      Creates the CRM customer <span className="font-medium">{preview.customer.name}</span>
                    </>
                  ) : (
                    <>
                      Links to the existing customer{' '}
                      {preview.customer.id ? (
                        <Link to={customerPath(preview.customer.id)} onClick={close} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                          {preview.customer.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{preview.customer.name}</span>
                      )}
                    </>
                  )}
                  , carrying over company, industry, services and{' '}
                  <span className="font-medium">
                    {plural(preview.contacts, 'contact')}, {plural(preview.notes, 'note')}, {plural(preview.activities, 'activity', 'activities')}
                  </span>
                  .
                </span>
              </li>
              <li className="flex items-start gap-2">
                <FolderKanban className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span>
                  Creates {plural(preview.projects.length, 'project')} with {plural(preview.projects.reduce((s, p) => s + p.tasks.length, 0), 'task')}
                  {preview.contract ? ' and a contract' : ''}, then notifies {plural(preview.notify.length, 'person', 'people')}.
                </span>
              </li>
            </ul>
          </Section>

          <Section icon={<FileText />} title="Quotation">
            <Field id="won-quotation" label="Accepted quotation" hint={preview.quotationOptions.length === 0 ? 'This lead has no accepted quotation; services come from the lead.' : 'Its services and recurring lines are used.'}>
              <SelectInput
                id="won-quotation"
                value={values.quotationId ?? ''}
                disabled={busy}
                onChange={(e) => {
                  setQuotationId(e.target.value || null)
                  setServiceIds(undefined) // re-suggest services from the new quotation
                }}
              >
                <option value="">None</option>
                {preview.quotation && !preview.quotationOptions.some((o) => o.id === preview.quotation!.id) && (
                  <option value={preview.quotation.id}>
                    {preview.quotation.number} · {(QUOTATION_STATUS_LABEL as Record<string, string>)[preview.quotation.status] ?? preview.quotation.status} · {fmtMoney(preview.quotation.total)}
                  </option>
                )}
                {preview.quotationOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.title} · {fmtMoney(o.total)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {preview.quotation && (
              <Link to={quotationPath(preview.quotation.id)} onClick={close} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
                View {preview.quotation.number}
              </Link>
            )}
          </Section>

          <Section icon={<Package />} title="Purchased services" aside={stale ? <span className="text-xs text-muted">Updating…</span> : null}>
            <ServiceMultiSelect
              id="won-services"
              catalog={catalog.all}
              loading={catalog.isPending}
              value={values.serviceIds}
              onChange={(ids) => {
                setServiceIds(ids)
                setErrors((e) => ({ ...e, serviceIds: undefined }))
              }}
            />
            {errors.serviceIds && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{errors.serviceIds}</p>}
            {catalog.isError && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">Couldn’t load the service catalog.</p>}
          </Section>

          <Section icon={<UserCog />} title="Delivery">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="won-pm" label="Project manager" required error={errors.projectManagerId} hint="Defaults to the lead owner’s manager. Gets tasks whose role has no matching person.">
                {users.isPending ? (
                  <Skeleton className="h-9 w-full rounded-lg" />
                ) : (
                  <SelectInput
                    id="won-pm"
                    value={values.projectManagerId}
                    disabled={busy}
                    invalid={!!errors.projectManagerId}
                    onChange={(e) => {
                      setProjectManagerId(e.target.value)
                      setErrors((x) => ({ ...x, projectManagerId: undefined }))
                    }}
                  >
                    <option value="">Choose a person…</option>
                    {activeUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.title}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field
                id="won-start"
                label="Project start"
                required
                error={errors.startDate}
                hint={
                  values.startDate && /^\d{4}-\d{2}-\d{2}$/.test(values.startDate) && !isWorkingDay(parseISO(values.startDate), getRegion().weekend)
                    ? 'That’s a weekend: work starts on the next working day.'
                    : `Task due dates count working days (${workingWeekLabel(getRegion().weekend)}) from this date.`
                }
              >
                <TextInput
                  id="won-start"
                  type="date"
                  value={values.startDate}
                  disabled={busy}
                  invalid={!!errors.startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    setErrors((x) => ({ ...x, startDate: undefined }))
                  }}
                />
              </Field>
            </div>
          </Section>

          {preview.contract && (
            <Section icon={<FileSignature />} title="Contract">
              <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-4">
                <Prop label="Title" className="sm:col-span-4">
                  {preview.contract.title}
                </Prop>
                <Prop label="Billing">{preview.contract.billing}</Prop>
                <Prop label="Value">{fmtMoney(preview.contract.value)}{preview.contract.billing === 'Monthly' ? ' / month' : ''}</Prop>
                <Prop label="Starts">{fmtDate(preview.contract.startDate)}</Prop>
                <Prop label="Renewal">{fmtDate(preview.contract.renewalDate)}</Prop>
              </dl>
            </Section>
          )}

          <Section icon={<FolderKanban />} title={`Projects (${preview.projects.length})`}>
            {preview.projects.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">Pick a purchased service to see its project.</p>
            ) : (
              <div className="space-y-3">
                {preview.projects.map((p) => (
                  <ProjectPreview key={p.serviceId} project={p} category={catalog.byId(p.serviceId)?.category} />
                ))}
              </div>
            )}
          </Section>

          <Section icon={<Bell />} title="People to notify">
            {preview.notify.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">No one.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {preview.notify.map((n) => (
                  <li key={n.id} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line ring-inset">
                    <span className="font-medium">{n.name}</span>
                    <span className="text-subtle">· {n.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Drawer>
  )
}

/* ---------------- Pieces ---------------- */

/** A plan error raised inside the flow (body keeps code + details), else null. */
function planProblem(error: unknown): BillingEvent | null {
  if (!(error instanceof ApiError)) return null
  return toBillingEvent(error.code, error.message, (error as { details?: unknown }).details)
}

/**
 * Plan limit / module / read-only inside the Won flow: which limit, current of max, and Upgrade for
 * those who manage billing. Everything was rolled back (the global upgrade prompt opens as well).
 */
function PlanProblem({ event, onUpgrade }: { event: BillingEvent; onUpgrade: () => void }) {
  const navigate = useNavigate()
  const { canManage } = useBillingAccess()
  let text: string
  if (event.kind === 'limit') {
    const d = event.details
    text = `Plan limit reached: ${LIMIT_LABEL[d.limit] ?? d.limit} (${formatLimitValue(d.limit, d.current)} of ${formatLimitValue(d.limit, d.max)} used). Everything was rolled back.`
  } else if (event.kind === 'module') {
    text = `${PLAN_MODULE_LABEL[event.details.module] ?? event.details.module} isn’t in your plan. Everything was rolled back.`
  } else {
    text = `${event.message} Everything was rolled back.`
  }
  return (
    <div className="mt-1 ps-6" id="won-plan-problem" data-kind={event.kind} data-limit={event.kind === 'limit' ? event.details.limit : undefined}>
      <p>{text}</p>
      {event.kind !== 'read_only' &&
        (canManage ? (
          <Button
            size="xs"
            className="mt-2"
            onClick={() => {
              onUpgrade()
              navigate(SETTINGS_PATHS.billing)
            }}
          >
            Upgrade
          </Button>
        ) : (
          <p className="mt-1 text-xs">Ask a Company Admin to upgrade the plan.</p>
        ))}
    </div>
  )
}

/** crypto.randomUUID needs a secure context (https/localhost); fall back elsewhere. */
function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `won-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function Section({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[0.8125rem] font-semibold [&_svg]:size-4 [&_svg]:text-muted">
        {icon}
        <span className="flex-1">{title}</span>
        {aside}
      </h3>
      {children}
    </section>
  )
}

function Prop({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}

function ProjectPreview({ project: p, category }: { project: WonPreviewProject; category?: string }) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2.5">
        <CategoryIcon category={category} />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{p.serviceName}</span>
        <span className="flex items-center gap-1 text-xs text-muted">
          <CalendarDays className="size-3.5" aria-hidden />
          {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
        </span>
        <span className="text-xs text-muted">{p.estimatedHours} h</span>
      </div>
      {!p.hasTemplate ? (
        <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-warning-700 dark:text-warning-500">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          No template: project starts with no tasks.
        </p>
      ) : p.tasks.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted">The template has no tasks.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-xs">
            <thead>
              <tr className="text-start text-subtle">
                <th className="px-3 py-1.5 text-start font-medium">Task</th>
                <th className="px-3 py-1.5 text-start font-medium">Owner</th>
                <th className="px-3 py-1.5 text-start font-medium">Due</th>
                <th className="px-3 py-1.5 text-end font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {p.tasks.map((t, i) => (
                <tr key={`${t.title}-${i}`} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <span className="text-ink">{t.title}</span>
                    <span className="block text-subtle">{t.role ?? 'No role'}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-ink-2">{t.ownerName}</span>
                    {t.fallbackOwner && (
                      <span
                        title={t.role ? `No one in the department has the “${t.role}” role, so this goes to the project manager.` : 'The template task has no role, so it goes to the project manager.'}
                        className="ms-1.5 inline-flex rounded bg-warning-50 px-1.5 text-[0.6875rem] font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-500"
                      >
                        → PM
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">{fmtDate(t.dueDate)}</td>
                  <td className="px-3 py-1.5 text-end text-ink-2">{t.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AlreadyWon({ preview, onNavigate }: { preview: WonPreview; onNavigate: () => void }) {
  const projects = useProjectsQuery()
  const mine = (projects.data ?? []).filter((p) => p.leadId === preview.leadId)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-success-100 bg-success-50 p-3.5 text-[0.8125rem] text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-500">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">Already Won.</span> {preview.company} was converted to a customer; winning it again would duplicate projects, so it’s blocked.
        </p>
      </div>
      <Section icon={<Building2 />} title="Customer">
        {preview.customer.id ? (
          <Link to={customerPath(preview.customer.id)} onClick={onNavigate} className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
            {preview.customer.name}
          </Link>
        ) : (
          <p className="text-[0.8125rem] text-muted">{preview.customer.name}</p>
        )}
      </Section>
      <Section icon={<FolderKanban />} title="Projects">
        {projects.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : projects.isError ? (
          <p className="text-[0.8125rem] text-danger-600">Couldn’t load projects: {projects.error.message}</p>
        ) : mine.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">No projects came from this lead.</p>
        ) : (
          <ul className="space-y-1.5">
            {mine.map((p) => (
              <li key={p.id}>
                <Link to={projectPath(p.id)} onClick={onNavigate} className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
                  {p.name}
                </Link>
                <span className="ms-2 text-xs text-muted">{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading preview">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  )
}
