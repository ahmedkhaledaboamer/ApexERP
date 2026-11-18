import { useId, useState } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import type { TaskView } from '@/modules/tasks/types'
import { useAddTimeEntry, useRemoveTimeEntry } from '@/modules/tasks/hooks/useTasks'
import { TIME_ENTRY_DESCRIPTION_MAX, TIME_ENTRY_HOURS_MAX, timeEntrySchema } from '@/modules/tasks/schemas'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, TextInput } from '@/shared/components/form/Field'
import { fmtHours } from '@/modules/tasks/projects/projectUi'
import { todayIso } from './taskMeta'
import { useTaskPermissions } from './useTaskActions'

/**
 * Drawer › Time: the task's time entries (time_entries: entry_date, hours, description,
 * is_billable, user) and a form to log hours. The task's logged hours are their sum.
 */
export function TaskTimeEntries({ task, canEdit }: { task: TaskView; canEdit: boolean }) {
  const id = useId()
  const toast = useToast()
  const { user, scope } = useTaskPermissions()
  const add = useAddTimeEntry(task.id)
  const remove = useRemoveTimeEntry(task.id)
  const [entryDate, setEntryDate] = useState(todayIso())
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [isBillable, setIsBillable] = useState(!!task.projectId)
  const [error, setError] = useState<string | null>(null)
  const billable = task.timeEntries.filter((e) => e.isBillable).reduce((s, e) => s + e.hours, 0)

  async function submit() {
    const parsed = timeEntrySchema.safeParse({ entryDate, hours: hours === '' ? undefined : Number(hours), description: description || null, isBillable })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the hours.')
      return
    }
    setError(null)
    try {
      await add.mutateAsync(parsed.data)
      toast.success('Hours logged', `${fmtHours(parsed.data.hours)} on ${task.title}`)
      setHours('')
      setDescription('')
    } catch (e) {
      toast.error('Couldn’t log the hours', (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-ink-2" id="task-time-total">
        <span className="num font-medium text-ink">{fmtHours(task.loggedHours)}</span> logged
        {task.estimatedHours > 0 && <> of {fmtHours(task.estimatedHours)} estimated</>}
        {billable > 0 && <span className="text-muted"> · {fmtHours(billable)} billable</span>}
      </p>
      {task.timeEntries.length === 0 ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
          <Clock className="size-4 text-subtle" aria-hidden />
          No hours logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Time entries">
          {task.timeEntries.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 px-3 py-2">
              <span className="num w-14 shrink-0 text-[0.8125rem] font-medium text-ink">{fmtHours(e.hours)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] text-ink-2" title={e.description ?? undefined}>
                  {e.description || <span className="text-subtle">No description</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {e.userName} · {fmtDate(e.entryDate, 'd MMM yyyy')}
                </p>
              </div>
              {e.isBillable && <Badge tone="green">Billable</Badge>}
              {canEdit && (e.userId === user?.id || scope === 'full') && (
                <Button
                  write
                  variant="ghost"
                  size="xs"
                  iconOnly
                  aria-label={`Remove ${fmtHours(e.hours)} logged on ${e.entryDate}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(e.id, {
                      onSuccess: () => toast.success('Time entry removed'),
                      onError: (err) => toast.error('Couldn’t remove it', err.message),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          aria-label="Log hours"
          className="grid grid-cols-1 gap-2 rounded-lg border border-line p-3 sm:grid-cols-[9.5rem_6rem_minmax(0,1fr)]"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <TextInput id={`${id}-date`} aria-label="Date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <TextInput
            id={`${id}-hours`}
            aria-label="Hours"
            type="number"
            inputMode="decimal"
            min={0.25}
            max={TIME_ENTRY_HOURS_MAX}
            step={0.25}
            placeholder="Hours"
            value={hours}
            invalid={!!error}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextInput
            id={`${id}-desc`}
            aria-label="What was done"
            placeholder="What was done (optional)"
            maxLength={TIME_ENTRY_DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-ink-2 sm:col-span-2">
            <Checkbox id={`${id}-billable`} checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
            Billable
          </label>
          <div className="flex items-center justify-end gap-2">
            {error && (
              <span role="alert" className="me-auto text-xs text-danger-600">
                {error}
              </span>
            )}
            <Button write type="submit" size="sm" loading={add.isPending}>
              Log hours
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
