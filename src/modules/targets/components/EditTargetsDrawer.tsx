import { useState, type FormEvent } from 'react'
import { useUpdateTargets } from '@/modules/targets/hooks/useTargets'
import { isTracked, monthLabel } from '@/modules/targets/lib'
import { EVENTS_NA_LABEL } from '@/shared/lib/features'
import {
  MAX_TARGET,
  TARGET_KEYS,
  TARGET_LABELS,
  TARGET_SOURCES,
  type AgentTargetRow,
  type TargetKey,
  type TargetValues,
} from '@/modules/targets/types'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'


interface EditTargetsDrawerProps {
  open: boolean
  onClose: () => void
  month: string
  rows: AgentTargetRow[]
  /** Agent to start on; the drawer can switch between agents. */
  userId: string
  onUserChange: (userId: string) => void
}

/** Manager-only editor for one agent's monthly targets. Actuals stay read-only (they're calculated). */
export function EditTargetsDrawer({ open, onClose, month, rows, userId, onUserChange }: EditTargetsDrawerProps) {
  const update = useUpdateTargets(month)
  const row = rows.find((r) => r.userId === userId) ?? rows[0]
  if (!row) return null
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title="Edit targets"
      description={`Monthly targets for ${monthLabel(month)}. Actuals are counted from logged activity.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form={FORM_ID} loading={update.isPending}>
            Save targets
          </Button>
        </>
      }
    >
      {rows.length > 1 && (
        <Field id="targets-agent" label="Agent" className="mb-5">
          <SelectInput
            id="targets-agent"
            value={row.userId}
            onChange={(e) => {
              update.reset()
              onUserChange(e.target.value)
            }}
          >
            {rows.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      )}
      {/* Keyed so switching agent or month starts from that agent's saved values. */}
      <TargetsForm key={`${row.userId}:${month}`} row={row} month={month} update={update} onSaved={onClose} />
    </Drawer>
  )
}

const FORM_ID = 'edit-targets-form'

interface TargetsFormProps {
  row: AgentTargetRow
  month: string
  update: ReturnType<typeof useUpdateTargets>
  onSaved: () => void
}

function TargetsForm({ row, month, update, onSaved }: TargetsFormProps) {
  const toast = useToast()
  const [draft, setDraft] = useState<Record<TargetKey, string>>(
    () => Object.fromEntries(TARGET_KEYS.map((k) => [k, row.values[k] > 0 ? String(row.values[k]) : ''])) as Record<TargetKey, string>,
  )
  const [errors, setErrors] = useState<Partial<Record<TargetKey, string>>>({})

  function submit(e: FormEvent) {
    e.preventDefault()
    const next: Partial<Record<TargetKey, string>> = {}
    const values = {} as TargetValues
    for (const k of TARGET_KEYS) {
      // Empty means "no target": the kind is left out of completion.
      const raw = draft[k].trim()
      const n = raw === '' ? 0 : Number(raw)
      if (!Number.isInteger(n) || n < 0 || n > MAX_TARGET) next[k] = `Enter a whole number from 0 to ${MAX_TARGET.toLocaleString('en-US')}, or leave it empty.`
      else values[k] = n
    }
    setErrors(next)
    if (Object.keys(next).length) return
    update.mutate(
      { userId: row.userId, values },
      {
        onSuccess: () => {
          toast.success('Targets saved', `${row.name} · ${monthLabel(month)}`)
          onSaved()
        },
        onError: (err) => toast.error('Couldn’t save targets', err.message),
      },
    )
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={submit}>
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-sunken/50 px-3.5 py-3">
        <Avatar name={row.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-semibold">{row.name}</p>
          <p className="truncate text-[0.8125rem] text-muted">{row.title}</p>
        </div>
        {row.isDefault && <Badge tone="neutral">Using defaults</Badge>}
      </div>

      <p className="mb-4 text-xs text-muted">Leave a kind empty for no target; it’s then left out of completion.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TARGET_KEYS.map((k) => (
          <Field
            key={k}
            id={`target-${k}`}
            label={TARGET_LABELS[k]}
            error={errors[k]}
            hint={isTracked(k) ? `${row.actuals[k]} so far · ${TARGET_SOURCES[k]}` : `${EVENTS_NA_LABEL} · not counted in completion yet`}
          >
            <TextInput
              id={`target-${k}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_TARGET}
              step={1}
              className="num"
              placeholder="No target"
              value={draft[k]}
              invalid={!!errors[k]}
              aria-describedby={errors[k] ? `target-${k}-error` : `target-${k}-hint`}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>

      {update.isError && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
          {update.error.message}
        </p>
      )}
    </form>
  )
}
