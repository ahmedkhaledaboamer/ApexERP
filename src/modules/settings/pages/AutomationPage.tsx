import { useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, CalendarClock, ListTodo, RotateCcw, Users } from 'lucide-react'
import { DEFAULT_AUTOMATION_RULES, type AutomationRules } from '@/modules/settings/types'
import { useAutomationRules, useResetAutomationRules, useSaveAutomationRules } from '@/shared/hooks/useAutomationRules'
import { useLookups } from '@/shared/hooks/useLookups'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { JourneyTimeline } from '@/modules/settings/automation/JourneyTimeline'
import { NumberStepper } from '@/modules/settings/automation/NumberStepper'
import { automationSchema, RULE_GROUPS, RULE_LIMITS, type RuleDef, type RuleGroup } from '@/modules/settings/automation/rules'
import { InlineError, isValidationError, ReadOnlyNote, SaveBar, useSettingsAccess } from '@/modules/settings/lists/shared'

const GROUP_ICON: Record<RuleGroup['id'], ReactNode> = {
  journey: <CalendarClock />,
  customers: <Users />,
  tasks: <ListTodo />,
}

/** Settings > Automation: every number the lead-journey automation uses. Edits are audited by the server. */
export default function AutomationPage() {
  const query = useAutomationRules()

  if (query.isPending) return <AutomationSkeleton />
  if (query.isError) {
    return (
      <Card>
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </Card>
    )
  }
  return <AutomationForm saved={query.data} />
}

function AutomationForm({ saved }: { saved: AutomationRules }) {
  const { canEdit } = useSettingsAccess()
  const readOnly = !canEdit
  const toast = useToast()
  const lookups = useLookups()
  const save = useSaveAutomationRules()
  const reset = useResetAutomationRules()
  const [confirmReset, setConfirmReset] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<AutomationRules>({
    resolver: zodResolver(automationSchema),
    defaultValues: saved,
    mode: 'onChange',
  })
  const { control, handleSubmit, formState } = form
  const values = useWatch({ control }) as AutomationRules
  const dirty = formState.isDirty
  useLeaveGuard(dirty && canEdit, 'You have unsaved automation changes. Leave anyway?')

  const status = (key: string) => {
    const s = lookups.status(key)
    return { label: lookups.isLoading ? key : s.label, tone: s.tone }
  }
  const isDefault = (Object.keys(DEFAULT_AUTOMATION_RULES) as (keyof AutomationRules)[]).every((k) => saved[k] === DEFAULT_AUTOMATION_RULES[k])

  const onSave = handleSubmit(
    (data) => {
      setServerError(null)
      save.mutate(data, {
        onSuccess: (next) => {
          form.reset(next)
          toast.success('Automation rules saved', 'They apply from the next automation run. The change is in the audit log.')
        },
        onError: (err) => {
          if (isValidationError(err)) setServerError(err.message)
          else toast.error('Couldn’t save automation rules', err.message)
        },
      })
    },
    () => toast.error('Check the highlighted rules', 'Some numbers are outside the allowed range.'),
  )

  function doReset() {
    reset.mutate(undefined, {
      onSuccess: (next) => {
        form.reset(next)
        setServerError(null)
        setConfirmReset(false)
        toast.success('Automation rules reset', 'Every rule is back to its default.')
      },
      onError: (err) => toast.error('Couldn’t reset the rules', err.message),
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <Bot className="size-4 text-muted" aria-hidden />
            Automation rules
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">Reminders, automatic moves and alerts. Every change is recorded in the audit log.</p>
        </div>
        {canEdit && (
          <Button write variant="secondary" size="sm" onClick={() => setConfirmReset(true)} disabled={isDefault && !dirty}>
            <RotateCcw />
            Reset to defaults
          </Button>
        )}
      </div>

      {readOnly && <ReadOnlyNote>You can view the automation rules. Only a Company Admin can change them.</ReadOnlyNote>}
      {serverError && <InlineError>{serverError}</InlineError>}

      <JourneyTimeline rules={values} status={status} />

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (canEdit) void onSave()
        }}
        className="space-y-5"
      >
        {RULE_GROUPS.map((group) => (
          <Card key={group.id}>
            <CardHeader icon={GROUP_ICON[group.id]} title={group.title} description={group.description} />
            <ul className="divide-y divide-line border-t border-line">
              {group.rules.map((rule) => (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  control={control}
                  value={values[rule.key]}
                  savedValue={saved[rule.key]}
                  readOnly={readOnly}
                  statusLabel={(k) => status(k).label}
                  onRestore={() => form.setValue(rule.key, DEFAULT_AUTOMATION_RULES[rule.key], { shouldDirty: true, shouldValidate: true })}
                />
              ))}
            </ul>
          </Card>
        ))}
        {/* Enter in a stepper saves. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      <SaveBar
        visible={canEdit && dirty}
        saving={save.isPending}
        onSave={() => void onSave()}
        onDiscard={() => {
          form.reset(saved)
          setServerError(null)
        }}
      />

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset automation rules?"
        description="Every rule goes back to its default straight away. The change is recorded in the audit log."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button write variant="danger" onClick={doReset} loading={reset.isPending}>
              Reset to defaults
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-lg border border-line text-[0.8125rem]">
          {RULE_GROUPS.flatMap((g) => g.rules).map((r) => {
            const def = DEFAULT_AUTOMATION_RULES[r.key]
            const changes = saved[r.key] !== def
            return (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-ink-2">{r.label}</span>
                <span className="num whitespace-nowrap">
                  {changes && <span className="text-muted line-through">{saved[r.key]}</span>}
                  {changes && ' → '}
                  <span className={cn(changes ? 'font-semibold text-ink' : 'text-muted')}>
                    {def} {r.unit(def)}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </Modal>
    </div>
  )
}

interface RuleRowProps {
  rule: RuleDef
  control: ReturnType<typeof useForm<AutomationRules>>['control']
  value: number
  savedValue: number
  readOnly: boolean
  statusLabel: (key: string) => string
  onRestore: () => void
}

function RuleRow({ rule, control, value, savedValue, readOnly, statusLabel, onRestore }: RuleRowProps) {
  const [min, max] = RULE_LIMITS[rule.key]
  const def = DEFAULT_AUTOMATION_RULES[rule.key]
  const id = `rule-${rule.key}`
  const shown = Number.isFinite(value) ? value : savedValue
  const changed = Number.isFinite(value) && value !== savedValue

  return (
    <li className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-center gap-2 text-[0.875rem] font-medium text-ink">
          {rule.label}
          {changed && <span className="size-1.5 rounded-full bg-warning-500" aria-label="changed" />}
        </label>
        <p id={`${id}-explain`} className="mt-0.5 text-[0.8125rem] text-muted">
          {rule.explain(shown, statusLabel)}
        </p>
        <p className="mt-1 text-xs text-subtle">
          Default: <span className="num">{def}</span>
          <span className="mx-1.5">·</span>
          Allowed <span className="num">{min}</span>–<span className="num">{max}</span>
          {!readOnly && Number.isFinite(value) && value !== def && (
            <>
              <span className="mx-1.5">·</span>
              <button type="button" onClick={onRestore} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                Use default
              </button>
            </>
          )}
        </p>
      </div>
      <Controller
        control={control}
        name={rule.key}
        render={({ field, fieldState }) => (
          <div className="sm:justify-self-end">
            <NumberStepper
              id={id}
              label={rule.label}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              min={min}
              max={max}
              step={rule.step}
              unit={rule.unit(Number.isFinite(field.value) ? field.value : def)}
              disabled={readOnly}
              invalid={!!fieldState.error}
              describedBy={fieldState.error ? `${id}-error` : `${id}-explain`}
            />
            {fieldState.error && (
              <p id={`${id}-error`} className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />
    </li>
  )
}

function AutomationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading automation rules" className="space-y-5">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-44 rounded-card" />
      {[5, 1, 1].map((rows, i) => (
        <Card key={i} className="space-y-4 p-5">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: rows }, (_, j) => (
            <div key={j} className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-9 w-32" />
            </div>
          ))}
        </Card>
      ))}
    </div>
  )
}
