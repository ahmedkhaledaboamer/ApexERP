import { useState } from 'react'
import { Sparkles, Target } from 'lucide-react'
import { useSaveTargetDefaults, useTargetDefaults } from '@/modules/targets/hooks/useTargets'
import {
  MAX_TARGET,
  OPTIONAL_TARGET_KEYS,
  RECOMMENDED_TARGETS,
  TARGET_KEYS,
  TARGET_LABELS,
  TARGET_SOURCES,
  type TargetKey,
  type TargetValues,
} from '@/modules/targets/types'
import { isTracked } from '@/modules/targets/lib'
import { EVENTS_NA_NOTE } from '@/shared/lib/features'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { InlineError, isValidationError, SaveBar } from '@/modules/settings/lists/shared'

type Draft = Record<TargetKey, string>

const toDraft = (v: TargetValues): Draft =>
  Object.fromEntries(TARGET_KEYS.map((k) => [k, OPTIONAL_TARGET_KEYS.includes(k) && v[k] === 0 ? '' : String(v[k])])) as Draft

const fmt = (n: number) => n.toLocaleString('en-US')

function parse(draft: Draft): { values: TargetValues; errors: Partial<Record<TargetKey, string>> } {
  const values = {} as TargetValues
  const errors: Partial<Record<TargetKey, string>> = {}
  for (const k of TARGET_KEYS) {
    const raw = draft[k].trim()
    const optional = OPTIONAL_TARGET_KEYS.includes(k)
    if (raw === '' && optional) {
      values[k] = 0
      continue
    }
    const n = Number(raw)
    if (raw === '') errors[k] = 'Enter a number (0 for no target).'
    else if (!Number.isInteger(n) || n < 0 || n > MAX_TARGET) errors[k] = `Use a whole number from 0 to ${fmt(MAX_TARGET)}.`
    else values[k] = n
  }
  return { values, errors }
}

/** Company default monthly targets: used for every agent and month without targets of its own. */
export function DefaultTargetsCard({ canEdit }: { canEdit: boolean }) {
  const query = useTargetDefaults()

  return (
    <Card>
      <CardHeader
        icon={<Target />}
        title="Default monthly targets"
        description="Used for every agent and month without targets of their own. Changing them updates those months straight away."
      />
      {query.isPending ? (
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {TARGET_KEYS.map((k) => (
              <div key={k} className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </CardBody>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : (
        <DefaultsForm key={JSON.stringify(query.data.values)} saved={query.data.values} canEdit={canEdit && query.data.canEdit} />
      )}
    </Card>
  )
}

function DefaultsForm({ saved, canEdit }: { saved: TargetValues; canEdit: boolean }) {
  const toast = useToast()
  const save = useSaveTargetDefaults()
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved))
  const [showErrors, setShowErrors] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const base = toDraft(saved)
  const dirty = TARGET_KEYS.some((k) => draft[k].trim() !== base[k])
  const { values, errors } = parse(draft)
  const isRecommended = TARGET_KEYS.every((k) => saved[k] === RECOMMENDED_TARGETS[k])
  useLeaveGuard(dirty && canEdit, 'You have unsaved default targets. Leave anyway?')

  function submit() {
    if (Object.keys(errors).length) {
      setShowErrors(true)
      return
    }
    setServerError(null)
    save.mutate(values, {
      onSuccess: () => toast.success('Default targets saved', 'Months without per-agent targets use them now.'),
      onError: (err) => {
        if (isValidationError(err)) setServerError(err.message)
        else toast.error('Couldn’t save default targets', err.message)
      },
    })
  }

  return (
    <CardBody>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (canEdit && dirty) submit()
        }}
      >
        {serverError && <InlineError className="mb-4">{serverError}</InlineError>}
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
          {TARGET_KEYS.map((k) => {
            const id = `default-target-${k}`
            const optional = OPTIONAL_TARGET_KEYS.includes(k)
            const error = (showErrors || draft[k] !== base[k]) && errors[k]
            const changed = draft[k].trim() !== base[k]
            return (
              <div key={k}>
                <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-2" title={isTracked(k) ? TARGET_SOURCES[k] : EVENTS_NA_NOTE}>
                  {TARGET_LABELS[k]}
                  {changed && <span className="size-1.5 rounded-full bg-warning-500" aria-label="changed" />}
                </label>
                <div className="relative">
                  <input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    disabled={!canEdit}
                    value={draft[k]}
                    placeholder={optional ? 'No default' : '0'}
                    aria-invalid={!!error || undefined}
                    aria-describedby={`${id}-hint`}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, '') }))}
                    className={cn(
                      'num h-9 w-full rounded-lg border bg-surface ps-3 pe-16 text-[0.875rem] font-semibold text-ink shadow-xs transition-[border-color,box-shadow] outline-none placeholder:font-normal placeholder:text-subtle focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:bg-sunken',
                      error ? 'border-danger-500' : 'border-line-strong hover:border-subtle',
                    )}
                  />
                  <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-subtle">
                    / month
                  </span>
                </div>
                <p id={`${id}-hint`} className={cn('mt-1.5 text-xs', error ? 'text-danger-600 dark:text-danger-500' : 'text-muted')}>
                  {error ||
                    (!isTracked(k)
                      ? 'Can be set now. Shows n/a and isn’t counted until Events is enabled.'
                      : optional
                      ? 'No target unless set here or per agent.'
                      : draft[k].trim() === '0'
                        ? 'No target: left out of completion.'
                        : `Recommended ${fmt(RECOMMENDED_TARGETS[k])}`)}
                </p>
              </div>
            )
          })}
        </div>
        {canEdit && !isRecommended && (
          <div className="mt-5 flex justify-end">
            <Button write variant="ghost" size="sm" onClick={() => setDraft(toDraft(RECOMMENDED_TARGETS))}>
              <Sparkles />
              Use recommended defaults
            </Button>
          </div>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
      <SaveBar
        visible={canEdit && dirty}
        saving={save.isPending}
        onSave={submit}
        onDiscard={() => {
          setDraft(base)
          setShowErrors(false)
          setServerError(null)
        }}
        message={
          <>
            You have unsaved changes <span className="font-normal text-muted">· Default targets</span>
          </>
        }
      />
    </CardBody>
  )
}
