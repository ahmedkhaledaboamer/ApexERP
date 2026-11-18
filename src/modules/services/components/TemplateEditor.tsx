import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarRange, Clock, ListChecks, Plus, Trash2 } from 'lucide-react'
import { DELIVERY_ROLES, templateTotals, type DeliveryRole, type ProjectTemplate } from '@/modules/services/types'
import { templateTaskSchema } from '@/modules/services/schemas'
import { useQueryClient } from '@tanstack/react-query'
import { serviceKeys, useProjectTemplate, useSaveProjectTemplate } from '@/modules/services/hooks/useServices'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import { SortableList } from '@/modules/settings/lists/SortableList'
import { InlineError, SaveBar } from '@/modules/settings/lists/shared'
import { ApiError } from '@/shared/lib/apiError'
import { cn, fmtDate } from '@/shared/lib/utils'
import { DOT, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextInput } from '@/shared/components/form/Field'

/** One editable task row; numbers stay strings while typing. */
interface Row {
  _id: string
  id?: string
  title: string
  role: DeliveryRole
  dayOffset: string
  hours: string
}

export const ROLE_TONE: Record<DeliveryRole, Tone> = {
  'Project manager': 'brand',
  'Solutions consultant': 'blue',
  Developer: 'sky',
  'AI engineer': 'pink',
  'Data analyst': 'teal',
  Designer: 'amber',
  QA: 'green',
  Trainer: 'neutral',
}

let seq = 0
const tempId = () => `new-task-${++seq}`

function toRows(t: ProjectTemplate): Row[] {
  return t.tasks.map((x) => ({ _id: x.id, id: x.id, title: x.title, role: x.role, dayOffset: String(x.dayOffset), hours: String(x.hours) }))
}

const numeric = (r: Row) => ({ dayOffset: Number(r.dayOffset) || 0, hours: Number(r.hours) || 0 })
const signature = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.id ?? '', r.title.trim(), r.role, r.dayOffset.trim(), r.hours.trim()]))

interface TemplateEditorProps {
  serviceId: string
  serviceName: string
  canEdit: boolean
  /** Reports unsaved edits to the page (tab dot, guards). */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Project template for a service: ordered delivery tasks (title, default role, day offset, hours).
 * Drag or keyboard to reorder; totals and a small timeline update live. Saves the full list at once.
 */
export function TemplateEditor({ serviceId, serviceName, canEdit, onDirtyChange }: TemplateEditorProps) {
  const query = useProjectTemplate(serviceId)
  const save = useSaveProjectTemplate(serviceId)
  const toast = useToast()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Row[] | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const base = useMemo(() => (query.data ? toRows(query.data) : []), [query.data])
  const rows = draft ?? base
  const dirty = draft !== null && signature(draft) !== signature(base)

  useLeaveGuard(dirty && canEdit, `You have unsaved changes to the ${serviceName} project template. Leave anyway?`)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  useEffect(() => {
    if (!focusId) return
    inputs.current.get(focusId)?.focus()
    setFocusId(null)
  }, [focusId])

  const errors = useMemo(() => {
    const out: Record<string, Partial<Record<'title' | 'role' | 'dayOffset' | 'hours', string>>> = {}
    for (const r of rows) {
      const res = templateTaskSchema.safeParse(r)
      if (!res.success) {
        const e: Partial<Record<'title' | 'role' | 'dayOffset' | 'hours', string>> = {}
        for (const issue of res.error.issues) {
          const k = issue.path[0] as keyof typeof e
          e[k] ??= issue.message
        }
        out[r._id] = e
      }
    }
    return out
  }, [rows])
  const listError = rows.length > 60 ? 'Keep templates to 60 tasks or fewer.' : null

  const totals = templateTotals(rows.map(numeric))

  function set(rows: Row[]) {
    setDraft(rows)
    if (save.isError) save.reset()
  }
  function patch(id: string, p: Partial<Row>) {
    set(rows.map((r) => (r._id === id ? { ...r, ...p } : r)))
  }
  function add() {
    const last = rows[rows.length - 1]
    const start = last ? (Number(last.dayOffset) || 0) + Math.max(1, Math.ceil((Number(last.hours) || 0) / 8)) : 0
    const id = tempId()
    set([...rows, { _id: id, title: '', role: last?.role ?? 'Developer', dayOffset: String(Math.min(365, start)), hours: '8' }])
    setFocusId(id)
  }
  function remove(id: string) {
    set(rows.filter((r) => r._id !== id))
  }
  function discard() {
    setDraft(null)
    setShowErrors(false)
    save.reset()
  }
  function submit() {
    if (Object.keys(errors).length || listError) {
      setShowErrors(true)
      toast.error('Check the highlighted tasks', 'Fix them before saving.')
      return
    }
    save.mutate(
      {
        tasks: rows.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          title: r.title.trim(),
          role: r.role,
          dayOffset: Number(r.dayOffset),
          hours: Number(r.hours),
        })),
      },
      {
        onSuccess: (t) => {
          // Show the saved list straight away; the refetch the hook triggers confirms it.
          qc.setQueryData(serviceKeys.template(serviceId), t)
          setDraft(null)
          setShowErrors(false)
          toast.success('Project template saved', `${t.tasks.length} tasks · ${templateTotals(t.tasks).hours} h`)
        },
        onError: (e) => {
          if (!(e instanceof ApiError && e.status === 422)) toast.error('Couldn’t save the template', e.message)
        },
      },
    )
  }

  if (query.isPending) {
    return (
      <Card aria-busy="true" aria-label="Loading project template" className="space-y-3 p-5">
        <Skeleton className="h-16 rounded-lg" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Card>
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </Card>
    )
  }

  const rowErrors = showErrors || dirty ? errors : {}
  const serverError = save.error instanceof ApiError && save.error.status === 422 ? save.error.message : null

  return (
    <div className="space-y-5">
      <Summary rows={rows} hours={totals.hours} days={totals.days} />

      <Card>
        <CardHeader
          icon={<ListChecks />}
          title="Delivery tasks"
          description={
            query.data.updatedAt
              ? `Last saved ${fmtDate(query.data.updatedAt)}${query.data.updatedBy ? ` by ${query.data.updatedBy}` : ''}. A won deal creates its project from these tasks.`
              : 'A won deal creates its project from these tasks.'
          }
          action={
            canEdit &&
            rows.length > 0 && (
              <Button variant="secondary" size="sm" onClick={add} disabled={rows.length >= 60}>
                <Plus />
                Add task
              </Button>
            )
          }
        />

        {(serverError || listError) && (
          <div className="space-y-2 px-5 pb-3">
            {serverError && <InlineError>{serverError}</InlineError>}
            {listError && <InlineError>{listError}</InlineError>}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            className="border-t border-line"
            icon={<ListChecks />}
            title="No delivery tasks yet"
            body={
              canEdit
                ? 'Add the tasks it takes to deliver this service. Projects for won deals start from this list.'
                : 'Nobody has set up delivery tasks for this service yet.'
            }
            action={
              canEdit && (
                <Button size="sm" onClick={add}>
                  <Plus />
                  Add the first task
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_11rem_5.5rem_5.5rem_2rem] items-center gap-2 border-y border-line bg-sunken/50 px-5 py-2 text-xs font-medium text-muted md:grid">
              <span />
              <span>#</span>
              <span>Task</span>
              <span>Default role</span>
              <span className="text-end">Start day</span>
              <span className="text-end">Hours</span>
              <span />
            </div>
            <SortableList
              items={rows}
              onReorder={set}
              disabled={!canEdit}
              nameOf={(r) => r.title}
              label={`${serviceName} delivery tasks`}
              className="divide-y divide-line border-t border-line md:border-t-0"
              renderItem={(r, handle, index) => (
                <TaskRow
                  row={r}
                  index={index}
                  handle={handle}
                  readOnly={!canEdit}
                  errors={rowErrors[r._id]}
                  onPatch={(p) => patch(r._id, p)}
                  onRemove={() => remove(r._id)}
                  titleRef={(el) => {
                    if (el) inputs.current.set(r._id, el)
                    else inputs.current.delete(r._id)
                  }}
                />
              )}
            />
            {canEdit && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-2.5">
                <Button variant="ghost" size="sm" onClick={add} disabled={rows.length >= 60}>
                  <Plus />
                  Add task
                </Button>
                <p className="text-xs text-muted">Drag the grip to reorder, or focus it and press Space, then ↑ ↓.</p>
              </div>
            )}
          </>
        )}
      </Card>

      <SaveBar
        visible={canEdit && dirty}
        saving={save.isPending}
        onSave={submit}
        onDiscard={discard}
        saveLabel="Save template"
        message={
          <>
            Unsaved template changes{' '}
            <span className="num font-normal text-muted">
              · {rows.length} tasks, {totals.hours} h
            </span>
          </>
        }
      />
    </div>
  )
}

/* ---------------- Rows ---------------- */

interface TaskRowProps {
  row: Row
  index: number
  handle: ReactNode
  readOnly: boolean
  errors?: Partial<Record<'title' | 'role' | 'dayOffset' | 'hours', string>>
  onPatch: (p: Partial<Row>) => void
  onRemove: () => void
  titleRef: (el: HTMLInputElement | null) => void
}

function TaskRow({ row, index, handle, readOnly, errors, onPatch, onRemove, titleRef }: TaskRowProps) {
  const n = index + 1
  if (readOnly) {
    return (
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-5 py-2.5 md:grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_11rem_5.5rem_5.5rem_2rem]">
        <span className="hidden md:block" />
        <span className="num text-xs text-muted">{n}</span>
        <div className="min-w-0 md:contents">
          <p className="truncate text-[0.8125rem] font-medium text-ink">{row.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted md:text-[0.8125rem] md:text-ink-2">
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[ROLE_TONE[row.role]])} />
            {row.role}
          </p>
        </div>
        <span className="num text-end text-xs text-muted md:text-[0.8125rem] md:text-ink-2">
          <span className="md:hidden">Day </span>
          {row.dayOffset}
        </span>
        <span className="num hidden text-end text-[0.8125rem] text-ink-2 md:block">{row.hours} h</span>
        <span className="hidden md:block" />
      </div>
    )
  }
  const err = errors ?? {}
  const label = row.title.trim() || `task ${n}`
  return (
    <div className="px-5 py-2.5 md:py-2">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-start gap-2 md:grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_11rem_5.5rem_5.5rem_2rem]">
        <span className="row-span-2 pt-0.5 md:row-span-1">{handle}</span>
        <span className="num hidden pt-2 text-xs text-muted md:block">{n}</span>
        <div className="min-w-0">
          <TextInput
            ref={titleRef}
            aria-label={`Task ${n} title`}
            placeholder="e.g. Kickoff workshop"
            value={row.title}
            maxLength={120}
            invalid={!!err.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
        </div>
        <div className="col-start-2 row-start-2 grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 md:contents">
          <label className="block min-w-0">
            <span className="mb-0.5 block text-[0.6875rem] text-muted md:sr-only">Default role</span>
            <SelectInput aria-label={`Default role for ${label}`} value={row.role} invalid={!!err.role} onChange={(e) => onPatch({ role: e.target.value as DeliveryRole })}>
              {DELIVERY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[0.6875rem] text-muted md:sr-only">Start day</span>
            <TextInput
              aria-label={`Start day for ${label}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              step={1}
              className="num text-end"
              value={row.dayOffset}
              invalid={!!err.dayOffset}
              onChange={(e) => onPatch({ dayOffset: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[0.6875rem] text-muted md:sr-only">Hours</span>
            <TextInput
              aria-label={`Hours for ${label}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step="any"
              className="num text-end"
              value={row.hours}
              invalid={!!err.hours}
              onChange={(e) => onPatch({ hours: e.target.value })}
            />
          </label>
        </div>
        <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${label}`} onClick={onRemove} className="col-start-3 row-start-1 hover:text-danger-600 md:col-start-auto md:row-start-auto">
          <Trash2 />
        </Button>
      </div>
      {Object.keys(err).length > 0 && (
        <p className="mt-1 ps-8 text-xs text-danger-600 md:ps-14 dark:text-danger-500">
          {[err.title, err.role, err.dayOffset && `Start day: ${err.dayOffset}`, err.hours && `Hours: ${err.hours}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

/* ---------------- Summary + timeline ---------------- */

function Summary({ rows, hours, days }: { rows: Row[]; hours: number; days: number }) {
  const roles = [...new Set(rows.map((r) => r.role))]
  return (
    <Card className="p-5">
      <div className="grid grid-cols-3 gap-4">
        <Figure icon={<ListChecks />} label="Tasks" value={rows.length} />
        <Figure icon={<Clock />} label="Total hours" value={`${Math.round(hours * 10) / 10} h`} hint={hours ? `≈ ${Math.ceil(hours / 8)} person-days` : undefined} />
        <Figure icon={<CalendarRange />} label="Duration" value={`${days} d`} hint="working days" />
      </div>
      {rows.length > 0 && days > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[0.6875rem] text-muted">
            <span>Day 0</span>
            <span className="num">Day {days}</span>
          </div>
          <ol aria-label="Timeline" className="space-y-1">
            {rows.map((r, i) => {
              const { dayOffset, hours: h } = numeric(r)
              const len = Math.max(1, Math.ceil(h / 8))
              const left = Math.min(100, (dayOffset / days) * 100)
              const width = Math.max(1.5, Math.min(100 - left, (len / days) * 100))
              return (
                <li key={r._id} className="relative h-2.5 rounded-full bg-sunken" title={`${r.title || `Task ${i + 1}`} · ${r.role} · day ${dayOffset}, ${h} h`}>
                  <span
                    className={cn('absolute inset-y-0 rounded-full', DOT[ROLE_TONE[r.role]])}
                    style={{ insetInlineStart: `${left}%`, width: `${width}%` }}
                  />
                  <span className="sr-only">
                    {r.title || `Task ${i + 1}`}: {r.role}, starts day {dayOffset}, {h} hours
                  </span>
                </li>
              )
            })}
          </ol>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Roles">
            {roles.map((role) => (
              <li key={role} className="flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden className={cn('size-2 rounded-full', DOT[ROLE_TONE[role]])} />
                {role}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function Figure({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className="num mt-1 text-xl font-semibold tracking-[-0.01em] text-ink">{value}</p>
      {hint && <p className="truncate text-xs text-muted">{hint}</p>}
    </div>
  )
}
