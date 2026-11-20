import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ClipboardList, Wand2 } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import { useApplyTemplate, useChecklistQuery, useEventTemplatesQuery } from '@/modules/events/hooks/useEventsAdvanced'
import { useUpdateTask } from '@/modules/tasks/hooks/useTasks'
import { PATHS } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput } from '@/shared/components/form/Field'

/** Checklist: the event's template tasks with progress; "Apply template" for the owner / marketing full. */
export function ChecklistTab({ event: e }: { event: EventDetail }) {
  const query = useChecklistQuery(e.id)
  const templates = useEventTemplatesQuery(e.canManage)
  const apply = useApplyTemplate()
  const updateTask = useUpdateTask()
  const toast = useToast()
  const qc = useQueryClient()
  const [pick, setPick] = useState('')
  const options = (templates.data ?? []).slice().sort((a, b) => Number(b.eventType === e.type) - Number(a.eventType === e.type))

  if (query.isPending) return <Skeleton className="h-48 rounded-card" />
  if (query.error) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
  const c = query.data
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0

  return (
    <div className="space-y-4">
      {e.canManage && e.status !== 'cancelled' && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <Wand2 className="size-4 text-muted" aria-hidden />
            <SelectInput aria-label="Event template" value={pick} onChange={(ev) => setPick(ev.target.value)} className="min-w-0 flex-1 sm:max-w-sm">
              <option value="">Pick a template…</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.tasks.length} tasks){c.appliedTemplateIds.includes(t.id) ? ' · applied' : ''}
                </option>
              ))}
            </SelectInput>
            <Button
              write
              size="sm"
              disabled={!pick}
              loading={apply.isPending}
              onClick={() =>
                apply.mutate(
                  { id: e.id, templateId: pick },
                  {
                    onSuccess: (r) => toast.success(r.created ? `${r.created} task${r.created === 1 ? '' : 's'} added` : 'Nothing new to add', r.skipped ? `${r.skipped} already on the checklist.` : undefined),
                    onError: (err) => toast.error('Template not applied', err.message),
                  },
                )
              }
            >
              Apply template
            </Button>
            <Link to={PATHS.eventTemplates} className="ms-auto text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              Manage templates
            </Link>
          </CardBody>
        </Card>
      )}
      {c.total === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No checklist yet" body="Apply an event template to create the prep tasks (due dates count from the event’s start)." />
      ) : (
        <Card>
          <CardHeader
            title="Prep checklist"
            icon={<ClipboardList />}
            description={`${c.done} of ${c.total} done`}
            action={<span className="num text-sm font-semibold" aria-label="Checklist progress">{pct}%</span>}
          />
          <div className="px-5 pb-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist done">
              <div className="h-full rounded-full bg-success-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ul className="divide-y divide-line" aria-label="Checklist">
            {c.items.map((i) => (
              <li key={i.taskId} className="flex items-center gap-3 px-5 py-2.5">
                <button
                  type="button"
                  className="text-muted hover:text-ink disabled:opacity-50"
                  aria-label={i.done ? `Reopen ${i.title}` : `Mark ${i.title} done`}
                  disabled={!e.canEdit || updateTask.isPending}
                  onClick={() => updateTask.mutate({ id: i.taskId, input: { status: i.done ? 'todo' : 'done' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['events'] }), onError: (err) => toast.error('Task not changed', err.message) })}
                >
                  {i.done ? <CheckCircle2 className="size-5 text-success-600" /> : <Circle className="size-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[0.8125rem] font-medium ${i.done ? 'text-muted line-through' : ''}`}>{i.title}</p>
                  <p className="truncate text-xs text-muted">
                    {i.ownerName} · {i.templateName}
                  </p>
                </div>
                {i.status === 'cancelled' && <Badge tone="neutral">Cancelled</Badge>}
                <span className="num text-xs whitespace-nowrap text-muted">{i.dueDate ? fmtDate(i.dueDate) : '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
