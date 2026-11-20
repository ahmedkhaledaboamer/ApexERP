import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import type { EventTemplate, EventTemplateInput, EventTemplateTask, TemplateTaskRole } from '@/modules/events/types'
import { EVENT_TYPES, EVENT_TYPE_LABEL, TEMPLATE_TASK_ROLES, templateRoleLabel } from '@/modules/events/types'
import { TASK_PRIORITIES } from '@/modules/tasks/enums'
import { useDeleteTemplate, useEventTemplatesQuery, useSaveTemplate } from '@/modules/events/hooks/useEventsAdvanced'
import { PATHS } from '@/app/paths'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

const offsetLabel = (n: number) => (n === 0 ? 'On the day' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} before` : `${n} day${n === 1 ? '' : 's'} after`)

/** `/events/templates`: event templates (per event type) with their prep task lists. Marketing full manages them. */
export default function EventTemplatesPage() {
  const user = useCurrentUser()
  const canManage = !!user && scopeOf(user.role, 'marketing') === 'full'
  const query = useEventTemplatesQuery()
  const remove = useDeleteTemplate()
  const toast = useToast()
  const [editing, setEditing] = useState<EventTemplate | 'new' | null>(null)

  return (
    <>
      <PageHeader
        icon={<IconTile><ClipboardList /></IconTile>}
        title="Event templates"
        description={
          <>
            Prep checklists per event type. Applying one to an event creates its tasks with due dates counted from the event’s start.{' '}
            <Link to={PATHS.events} className="font-medium text-brand-700 hover:underline dark:text-brand-300">Back to events</Link>
          </>
        }
        actions={
          canManage && (
            <Button write onClick={() => setEditing('new')}>
              <Plus />
              New template
            </Button>
          )
        }
      />
      <PageBody className="space-y-4">
        {query.isPending ? (
          <Skeleton className="h-40 rounded-card" />
        ) : query.error ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title="No templates yet" body="Create one for the events you run often: stand bookings, invitations, follow-ups." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {query.data.map((t) => (
              <Card key={t.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[0.9375rem] font-semibold">{t.name}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {EVENT_TYPE_LABEL[t.eventType]} · {t.defaultDurationDays} day{t.defaultDurationDays === 1 ? '' : 's'} · {t.tasks.length} task{t.tasks.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button write variant="ghost" size="sm" iconOnly aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                        <Pencil />
                      </Button>
                      <Button
                        write
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={`Delete ${t.name}`}
                        onClick={() => remove.mutate(t.id, { onSuccess: () => toast.success('Template deleted', 'Tasks it created stay on their events.'), onError: (err) => toast.error('Not deleted', err.message) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                <ol className="mt-3 space-y-1.5" aria-label={`${t.name} tasks`}>
                  {t.tasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-2 text-[0.8125rem]">
                      <span className="num w-28 shrink-0 text-xs text-muted">{offsetLabel(task.offsetDays)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{task.title}</span>
                      <Badge tone="neutral">{templateRoleLabel(task.role)}</Badge>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
      {editing && <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

type Row = Omit<EventTemplateTask, 'id'> & { id?: string; key: string }
let rowSeq = 0
const newRow = (): Row => ({ key: `r${++rowSeq}`, title: '', offsetDays: -7, role: 'owner', priority: 'medium' })

function TemplateEditor({ template, onClose }: { template: EventTemplate | null; onClose: () => void }) {
  const save = useSaveTemplate()
  const toast = useToast()
  const [name, setName] = useState(template?.name ?? '')
  const [eventType, setEventType] = useState(template?.eventType ?? 'exhibition')
  const [days, setDays] = useState(String(template?.defaultDurationDays ?? 1))
  const [rows, setRows] = useState<Row[]>(() => (template?.tasks.length ? template.tasks.map((t) => ({ ...t, key: t.id })) : [newRow()]))
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function submit() {
    const input: EventTemplateInput = {
      name,
      eventType,
      defaultDurationDays: Number(days),
      tasks: rows.filter((r) => r.title.trim()).map(({ key: _key, ...r }) => ({ ...r, offsetDays: Number(r.offsetDays) })),
    }
    save.mutate(
      { id: template?.id, input },
      { onSuccess: () => { toast.success(template ? 'Template saved' : 'Template created', name); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? `Edit ${template.name}` : 'New event template'}
      description="Days before (−) or after (+) the event’s start. Weekend dates move to a working day. A role goes to the event-team member with that role, else to the event owner."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{template ? 'Save template' : 'Create template'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
          <Field id="tpl-name" label="Name" required>
            <TextInput id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="tpl-type" label="Event type">
            <SelectInput id="tpl-type" value={eventType} onChange={(e) => setEventType(e.target.value as EventTemplate['eventType'])}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
            </SelectInput>
          </Field>
          <Field id="tpl-days" label="Duration (days)">
            <TextInput id="tpl-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium">Tasks</legend>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[minmax(0,1fr)_5rem_9rem_6.5rem_auto]">
              <TextInput aria-label={`Task ${i + 1} title`} placeholder="Task title" value={r.title} onChange={(e) => setRow(r.key, { title: e.target.value })} />
              <TextInput aria-label={`Task ${i + 1} days from start`} type="number" value={String(r.offsetDays)} onChange={(e) => setRow(r.key, { offsetDays: Number(e.target.value) })} />
              <SelectInput aria-label={`Task ${i + 1} role`} value={r.role} onChange={(e) => setRow(r.key, { role: e.target.value as TemplateTaskRole })}>
                {TEMPLATE_TASK_ROLES.map((role) => <option key={role} value={role}>{templateRoleLabel(role)}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Task ${i + 1} priority`} value={r.priority} onChange={(e) => setRow(r.key, { priority: e.target.value as Row['priority'] })}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </SelectInput>
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove task ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])}>
            <Plus />
            Add task
          </Button>
        </fieldset>
      </div>
    </Modal>
  )
}
