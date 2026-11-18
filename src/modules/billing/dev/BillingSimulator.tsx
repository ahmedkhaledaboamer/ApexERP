import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, FlaskConical, RotateCcw } from 'lucide-react'
import type { DevBillingStateDetails, DevUsageInput, LimitKey, SubscriptionStatus } from '@/modules/billing/types'
import { billingKeys, useBillingOverview, useBillingAccess, useEntitlements } from '@/modules/billing/hooks'
import { LIMIT_LABEL } from '@/modules/billing/gating'
import { alertKeys } from '@/modules/alerts/hooks/useAlerts'
import { http } from '@/shared/lib/axios'
import { userStorage } from '@/shared/lib/storage'
import { cn } from '@/shared/lib/utils'
import { useAppSelector } from '@/store/hooks'

/**
 * DEV ONLY. Floating "Billing simulator" over the mock API's /dev/billing/* endpoints: move the
 * simulated clock, force a status, fail the next renewal, set usage per limit, reset. Loaded with a
 * dynamic import behind `import.meta.env.DEV` (AppLayout), so it never reaches a production build.
 */

const STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'suspended', 'cancelled', 'deleted']
const LIMITS: LimitKey[] = ['users', 'leadsContacts', 'storageMb', 'emailsPerMonth', 'aiCredits']
const OPEN_KEY = 'dev.billing-simulator.open'

const dev = {
  state: async () => (await http.get<DevBillingStateDetails>('/dev/billing/state')).data,
  advance: async (days: number) => (await http.post('/dev/billing/advance', { days })).data,
  status: async (status: SubscriptionStatus) => (await http.post('/dev/billing/status', { status })).data,
  failNext: async (fail: boolean) => (await http.post('/dev/billing/fail-next-payment', { fail })).data,
  usage: async (input: DevUsageInput) => (await http.post('/dev/billing/usage', input)).data,
  reset: async () => (await http.post('/dev/billing/reset', {})).data,
}

const fmt = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function BillingSimulator() {
  const signedIn = useAppSelector((s) => s.auth.session !== null)
  const [open, setOpen] = useState(() => userStorage.pref.get(OPEN_KEY) === '1')
  const toggle = () => {
    setOpen((o) => {
      userStorage.pref.set(OPEN_KEY, o ? '0' : '1')
      return !o
    })
  }
  if (!signedIn) return null

  return (
    <div
      id="billing-simulator"
      data-open={open || undefined}
      className="fixed start-4 bottom-4 z-[45] w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-dashed border-warning-500/60 bg-surface text-ink shadow-pop"
    >
      <button
        id="billing-simulator-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="billing-simulator-body"
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-xs font-semibold"
      >
        <FlaskConical className="size-3.5 text-warning-600" aria-hidden />
        <span className="flex-1">Billing simulator</span>
        <span className="rounded bg-warning-100 px-1 text-[0.625rem] font-semibold text-warning-700 uppercase dark:bg-warning-500/20 dark:text-warning-500">
          dev
        </span>
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
      </button>
      {open && <Body />}
    </div>
  )
}

function Body() {
  const qc = useQueryClient()
  const ent = useEntitlements()
  const { canView } = useBillingAccess()
  const overview = useBillingOverview(canView)
  const state = useQuery({ queryKey: billingKeys.dev, queryFn: dev.state, retry: false })
  const [customDays, setCustomDays] = useState('3')
  const [usage, setUsage] = useState<Partial<Record<LimitKey, number>>>({})

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: billingKeys.all })
    void qc.invalidateQueries({ queryKey: alertKeys.all })
  }
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSettled: refresh })
  const busy = run.isPending

  const currentPercent = (key: LimitKey) =>
    usage[key] ?? overview.data?.usage.items.find((i) => i.key === key)?.percent ?? 0

  return (
    <div id="billing-simulator-body" className="space-y-3 border-t border-line px-3 pt-2.5 pb-3 text-xs">
      {state.isError ? (
        <p className="text-danger-700 dark:text-danger-500">Simulator endpoints unavailable: {state.error.message}</p>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted">Simulated date</dt>
          <dd id="dev-sim-date" className="num truncate font-medium">
            {state.data ? fmt.format(new Date(state.data.now)) : '…'}
            {state.data && state.data.offsetDays !== 0 && <span className="ms-1 text-muted">(+{state.data.offsetDays}d)</span>}
          </dd>
          <dt className="text-muted">Status</dt>
          <dd id="dev-sim-status" className="font-medium">
            {state.data?.subscription.status ?? ent.status ?? '…'}
            {ent.planName && <span className="ms-1 text-muted">· {ent.planName}</span>}
          </dd>
        </dl>
      )}

      <Row label="Advance">
        {[1, 7, 30].map((d) => (
          <SimButton key={d} id={`dev-advance-${d}`} disabled={busy} onClick={() => run.mutate(() => dev.advance(d))}>
            +{d}d
          </SimButton>
        ))}
        <input
          id="dev-advance-custom"
          aria-label="Days to advance"
          type="number"
          min={1}
          max={400}
          value={customDays}
          onChange={(e) => setCustomDays(e.target.value)}
          className="num h-7 w-12 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
        />
        <SimButton
          id="dev-advance-custom-go"
          disabled={busy || !(Number(customDays) > 0)}
          onClick={() => run.mutate(() => dev.advance(Math.round(Number(customDays))))}
        >
          Go
        </SimButton>
      </Row>

      <Row label="Status">
        <select
          id="dev-status"
          aria-label="Set subscription status"
          disabled={busy}
          value=""
          onChange={(e) => {
            const v = e.target.value as SubscriptionStatus
            if (v) run.mutate(() => dev.status(v))
          }}
          className="h-7 flex-1 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
        >
          <option value="">Set status…</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>

      <label className="flex items-center gap-2">
        <input
          id="dev-fail-next"
          type="checkbox"
          checked={!!state.data?.failNextPayment}
          disabled={busy || !state.data}
          onChange={(e) => {
            const fail = e.target.checked
            run.mutate(() => dev.failNext(fail))
          }}
        />
        Fail next payment
      </label>

      <fieldset className="min-w-0 space-y-1.5">
        <legend className="mb-1 text-muted">Usage (% of limit)</legend>
        {LIMITS.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <label htmlFor={`dev-usage-${key}`} className="w-20 shrink-0 truncate">
              {LIMIT_LABEL[key]}
            </label>
            <input
              id={`dev-usage-${key}`}
              type="range"
              min={0}
              max={120}
              step={5}
              value={currentPercent(key)}
              onChange={(e) => setUsage((u) => ({ ...u, [key]: Number(e.target.value) }))}
              className="min-w-0 flex-1 accent-brand-600"
            />
            <span className="num w-9 shrink-0 text-end">{currentPercent(key)}%</span>
            <SimButton
              id={`dev-usage-${key}-apply`}
              disabled={busy}
              onClick={() => run.mutate(() => dev.usage({ key, percent: currentPercent(key) }))}
            >
              Set
            </SimButton>
          </div>
        ))}
      </fieldset>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {run.isError ? (
          <span role="alert" className="truncate text-danger-700 dark:text-danger-500">
            {run.error.message}
          </span>
        ) : (
          <span className="text-muted">{busy ? 'Applying…' : 'Refreshes billing + alerts.'}</span>
        )}
        <SimButton
          id="dev-reset"
          disabled={busy}
          onClick={() => {
            setUsage({})
            run.mutate(() => dev.reset())
          }}
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset
        </SimButton>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

function SimButton({ id, onClick, disabled, children }: { id: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-xs font-medium hover:bg-hover',
        'disabled:opacity-50',
      )}
    >
      {children}
    </button>
  )
}
