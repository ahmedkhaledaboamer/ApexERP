import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import type { PlanEditResult, PlanMigration, PlatformPlan } from '@/modules/platform/types'
import { GATEABLE_MODULES } from '@/modules/billing/types'
import { createPlatformPlan, updatePlatformPlan } from '@/modules/platform/api'
import { platformKeys, usePlatform } from '@/modules/platform/hooks'
import {
  CORE_MODULES,
  LIMIT_KEYS,
  MIGRATION_COPY,
  PLAN_MODULE_CHOICES,
  draftFromPlan,
  draftHighlights,
  draftLimits,
  draftPrice,
  planEditInput,
  validateDraft,
  versionedChange,
  type PlanDraft,
} from '@/modules/platform/planEdit'
import { MIN_REASON } from '@/modules/platform/format'
import { LIMIT_LABEL, PLAN_MODULE_LABEL } from '@/modules/billing/gating'
import { cn } from '@/shared/lib/utils'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const MIGRATIONS: PlanMigration[] = ['keep', 'at_renewal', 'now']

/** Edit or create a plan. Price / limits / modules changes need a migration choice and a reason. */
export function PlanEditDrawer({ target, onClose }: { target: PlatformPlan | 'new' | null; onClose: () => void }) {
  const { token } = usePlatform()
  const qc = useQueryClient()
  const toast = useToast()
  const plan = target && target !== 'new' ? target : null
  const isNew = target === 'new'
  const [draft, setDraft] = useState<PlanDraft>(() => draftFromPlan(plan))
  const [migration, setMigration] = useState<PlanMigration | null>(null)
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<PlanEditResult | null>(null)

  useEffect(() => {
    if (target) {
      setDraft(draftFromPlan(target === 'new' ? null : target))
      setMigration(null)
      setReason('')
      setSubmitted(false)
      setResult(null)
    }
  }, [target])

  const errors = validateDraft(draft, isNew)
  const change = plan ? versionedChange(plan, draft) : null
  const needsMigration = !!change?.any
  const reasonOk = reason.trim().length >= MIN_REASON

  const save = useMutation({
    mutationFn: async () => {
      if (plan) return updatePlatformPlan(token, plan.id, planEditInput(plan, draft, migration ?? 'keep', reason.trim()))
      const created = await createPlatformPlan(token, {
        id: draft.id,
        name: draft.name.trim(),
        price: draftPrice(draft),
        currency: draft.currency,
        billingPeriod: draft.billingPeriod,
        limits: draftLimits(draft),
        modules: draft.modules,
        highlights: draftHighlights(draft),
        checkout: draft.checkout,
        active: draft.active,
        reason: reason.trim(),
      })
      return { plan: created, newVersion: false, migrated: 0, scheduled: 0, skipped: [] } satisfies PlanEditResult
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: platformKeys.plans })
      void qc.invalidateQueries({ queryKey: platformKeys.companies })
      void qc.invalidateQueries({ queryKey: platformKeys.overview })
      toast.success(isNew ? 'Plan created' : 'Plan saved', r.plan.name)
      setResult(r)
    },
  })

  function submit() {
    setSubmitted(true)
    if (Object.keys(errors).length || !reasonOk || (needsMigration && !migration)) return
    save.mutate()
  }

  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const err = (k: string) => (submitted ? errors[k] : undefined)
  const toggleModule = (m: (typeof PLAN_MODULE_CHOICES)[number], on: boolean) =>
    setDraft((d) => ({ ...d, modules: on ? [...new Set([...d.modules, m])] : d.modules.filter((x) => x !== m) }))

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      width="lg"
      title={result ? 'Saved' : isNew ? 'New plan' : `Edit ${plan?.name ?? ''}`}
      description={plan && !result ? `Version ${plan.version} · ${plan.subscribers} ${plan.subscribers === 1 ? 'company' : 'companies'}` : undefined}
      footer={
        result ? (
          <Button id="plan-result-close" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button id="plan-save" loading={save.isPending} onClick={submit}>
              {isNew ? 'Create plan' : 'Save changes'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <PlanResult result={result} />
      ) : (
        <form
          id="plan-edit-form"
          data-plan-id={plan?.id ?? 'new'}
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isNew && (
              <Field id="plan-id" label="Plan id" required error={err('id')} hint="Permanent, used in URLs and data. e.g. pro-plus">
                <TextInput id="plan-id" value={draft.id} onChange={(e) => set('id', e.target.value.toLowerCase())} className="font-mono" />
              </Field>
            )}
            <Field id="plan-name" label="Name" required error={err('name')}>
              <TextInput id="plan-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field id="plan-price" label="Price" error={err('price')} hint="Empty = free or custom pricing.">
              <TextInput id="plan-price" type="number" min={0} step="0.01" value={draft.price} onChange={(e) => set('price', e.target.value)} />
            </Field>
            <Field id="plan-period" label="Billing period">
              <SelectInput id="plan-period" value={draft.billingPeriod} onChange={(e) => set('billingPeriod', e.target.value as PlanDraft['billingPeriod'])}>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </SelectInput>
            </Field>
            {isNew && (
              <>
                <Field id="plan-currency" label="Currency" error={err('currency')}>
                  <TextInput id="plan-currency" value={draft.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
                </Field>
                <Field id="plan-checkout" label="How it starts">
                  <SelectInput id="plan-checkout" value={draft.checkout} onChange={(e) => set('checkout', e.target.value as PlanDraft['checkout'])}>
                    <option value="payment">Card payment</option>
                    <option value="none">Free (no card)</option>
                    <option value="contact">Contact sales</option>
                  </SelectInput>
                </Field>
              </>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-[0.8125rem] font-medium text-ink-2">Limits</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LIMIT_KEYS.map((k) => (
                <Field key={k} id={`plan-limit-${k}`} label={LIMIT_LABEL[k] + (k === 'storageMb' ? ' (MB)' : '')} error={err(`limit-${k}`)}>
                  <TextInput
                    id={`plan-limit-${k}`}
                    type="number"
                    min={0}
                    placeholder="Unlimited"
                    value={draft.limits[k]}
                    onChange={(e) => setDraft((d) => ({ ...d, limits: { ...d.limits, [k]: e.target.value } }))}
                  />
                </Field>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[0.8125rem] font-medium text-ink-2">Modules</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PLAN_MODULE_CHOICES.map((m) => {
                const core = CORE_MODULES.includes(m)
                return (
                  <label key={m} className="flex items-center gap-2 text-[0.8125rem]">
                    <Checkbox
                      id={`plan-module-${m}`}
                      data-module={m}
                      checked={draft.modules.includes(m)}
                      onChange={(e) => toggleModule(m, e.target.checked)}
                    />
                    {PLAN_MODULE_LABEL[m] ?? m}
                    {core ? <span className="text-xs text-subtle">core</span> : GATEABLE_MODULES.includes(m) ? <span className="text-xs text-subtle">add-on</span> : null}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <Field id="plan-highlights" label="Highlights" hint="One per line; shown on the plan cards.">
            <TextArea id="plan-highlights" value={draft.highlights} onChange={(e) => set('highlights', e.target.value)} className="min-h-20" />
          </Field>

          <label className="flex items-center gap-2 text-[0.8125rem]">
            <Checkbox id="plan-active" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
            Active (offered to new sign-ups and plan changes)
          </label>

          {needsMigration && change && (
            <fieldset id="plan-migration" className="rounded-lg border border-warning-100 bg-warning-50/60 p-3 dark:border-warning-500/20 dark:bg-warning-500/10">
              <legend className="px-1 text-[0.8125rem] font-medium text-ink">Current subscribers</legend>
              <p className="mb-3 text-xs text-ink-2">
                You changed {[change.price && 'the price', change.limits && 'limits', change.modules && 'modules'].filter(Boolean).join(', ')}. This creates version{' '}
                {(plan?.version ?? 0) + 1}. What happens to the {plan?.subscribers ?? 0} companies on this plan?
              </p>
              <div role="radiogroup" aria-label="Migration" className="space-y-2">
                {MIGRATIONS.map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'flex cursor-pointer gap-2.5 rounded-lg border bg-surface p-2.5',
                      migration === m ? 'border-brand-500 shadow-[var(--shadow-focus)]' : 'border-line',
                    )}
                  >
                    <input
                      type="radio"
                      id={`migration-${m}`}
                      name="plan-migration"
                      value={m}
                      checked={migration === m}
                      onChange={() => setMigration(m)}
                      className="mt-0.5 accent-brand-600"
                    />
                    <span>
                      <span className="block text-[0.8125rem] font-medium text-ink">{MIGRATION_COPY[m].label}</span>
                      <span className="block text-xs text-muted">{MIGRATION_COPY[m].body}</span>
                    </span>
                  </label>
                ))}
              </div>
              {submitted && !migration && <p className="mt-2 text-xs text-danger-600">Choose what happens to current subscribers.</p>}
            </fieldset>
          )}

          <Field
            id="plan-reason"
            label="Reason"
            required
            error={submitted && !reasonOk ? `Enter a reason (at least ${MIN_REASON} characters).` : undefined}
            hint="Saved in the platform audit log."
          >
            <TextArea id="plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-16" />
          </Field>

          {save.isError && (
            <p role="alert" id="plan-error" className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
              {save.error.message}
            </p>
          )}
        </form>
      )}
    </Drawer>
  )
}

function PlanResult({ result }: { result: PlanEditResult }) {
  return (
    <div id="plan-edit-result" data-new-version={String(result.newVersion)} data-migrated={result.migrated} data-scheduled={result.scheduled} data-skipped={result.skipped.length} className="space-y-4">
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-ink">
        <CheckCircle2 className="size-5 text-success-600" aria-hidden />
        {result.plan.name} {result.newVersion ? `is now version ${result.plan.version}.` : 'saved.'}
      </p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Moved now" value={result.migrated} id="plan-result-migrated" />
        <Stat label="At renewal" value={result.scheduled} id="plan-result-scheduled" />
        <Stat label="Left on old version" value={result.skipped.length} id="plan-result-skipped" />
      </div>
      {result.skipped.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Not moved (usage above the new limits)</p>
          <ul id="plan-skipped" className="divide-y divide-line rounded-lg border border-line">
            {result.skipped.map((s) => (
              <li key={s.companyId} data-company-id={s.companyId} className="px-3 py-2 text-[0.8125rem]">
                <p className="font-medium text-ink">{s.name}</p>
                <ul className="mt-0.5 list-disc ps-4 text-xs text-muted">
                  {s.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!result.newVersion && <Badge tone="neutral">No price, limit or module change: no new version.</Badge>}
    </div>
  )
}

function Stat({ label, value, id }: { label: string; value: number; id: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <p id={id} className="num text-[1.25rem] font-semibold text-ink">
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
