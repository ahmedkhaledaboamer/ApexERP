import { useEffect, useId, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, OctagonAlert, Unlock } from 'lucide-react'
import type { TaskLinkType, TaskUpdateInput, TaskView } from '@/modules/tasks/types'
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { useProjectsQuery, useTaskQuery, useUpdateTask } from '@/modules/tasks/hooks/useTasks'
import { taskFormSchema, TASK_TITLE_MAX, type TaskFormValues } from '@/modules/tasks/schemas'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { LinkChip } from './LinkChip'
import { LinkPicker } from './LinkPicker'
import { FollowersPicker } from './FollowersPicker'
import { TaskComments } from './TaskComments'
import { TaskAttachments } from './TaskAttachments'
import { TaskHistory } from './TaskHistory'
import { BlockedBadge, PriorityBadge, StatusIcon, TaskStatusBadge } from './TaskBadges'
import { TaskSubtasks } from './TaskSubtasks'
import { TaskTimeEntries } from './TaskTimeEntries'
import { useActiveUsers, useAssignableUsers, useTaskBlocking, useTaskPermissions } from './useTaskActions'

function toForm(t: TaskView): TaskFormValues {
  return {
    title: t.title,
    description: t.description,
    ownerId: t.ownerId,
    followerIds: t.followerIds,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate ?? '',
    linkType: t.link?.type ?? '',
    linkId: t.link?.id ?? '',
    projectId: t.projectId ?? '',
    estimatedHours: t.estimatedHours,
  }
}

/** Only the fields that changed. */
function diff(t: TaskView, v: TaskFormValues): TaskUpdateInput {
  const out: TaskUpdateInput = {}
  if (v.title.trim() !== t.title) out.title = v.title.trim()
  if (v.description !== t.description) out.description = v.description
  if (v.ownerId !== t.ownerId) out.ownerId = v.ownerId
  const f = [...v.followerIds].sort().join(',')
  if (f !== [...t.followerIds].sort().join(',')) out.followerIds = v.followerIds
  if (v.priority !== t.priority) out.priority = v.priority
  if (v.status !== t.status) out.status = v.status
  const due = v.dueDate || null
  if (due !== t.dueDate) out.dueDate = due
  const link = v.linkType && v.linkId ? { type: v.linkType, id: v.linkId } : null
  if ((link ? `${link.type}:${link.id}` : '') !== (t.link ? `${t.link.type}:${t.link.id}` : '')) out.link = link
  const projectId = v.projectId || null
  if (!t.parentTaskId && projectId !== t.projectId) out.projectId = projectId
  if (v.estimatedHours !== t.estimatedHours) out.estimatedHours = v.estimatedHours
  return out
}

type Section = 'comments' | 'time' | 'attachments' | 'activity'

/** Task drawer: every field, sub-tasks, comments with @mentions, time entries, attachments and the activity history. */
export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const query = useTaskQuery(taskId)
  const task = query.data
  const title = task ? (
    <span className="flex min-w-0 items-center gap-2">
      <StatusIcon status={task.status} />
      <span className="truncate">{task.title}</span>
    </span>
  ) : (
    'Task'
  )
  return (
    <Drawer
      open={!!taskId}
      onClose={onClose}
      width="xl"
      title={title}
      description={
        task ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs">{task.id}</span>
            <span aria-hidden>·</span>
            <span>Created {fmtDate(task.createdAt, 'd MMM yyyy')}</span>
            {task.completedAt && (
              <>
                <span aria-hidden>·</span>
                <span id="task-completed-at">Done {fmtDate(task.completedAt, 'd MMM')}</span>
              </>
            )}
          </span>
        ) : undefined
      }
    >
      {query.isPending ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : (
        <TaskEditor key={query.data.id} task={query.data} onClose={onClose} />
      )}
    </Drawer>
  )
}

function TaskEditor({ task, onClose }: { task: TaskView; onClose: () => void }) {
  const id = useId()
  const toast = useToast()
  const update = useUpdateTask()
  const perms = useTaskPermissions()
  // Page rule (role + writable workspace) and the server's per-task rule (TaskView.canEdit).
  const editBlock = perms.editBlock(task)
  const canEdit = editBlock === null
  const blocking = useTaskBlocking()
  const projects = useProjectsQuery()
  const { users: active, all } = useActiveUsers()
  const { users: assignable } = useAssignableUsers([task.ownerId])
  const [section, setSection] = useState<Section>('comments')

  const form = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: toForm(task) })
  const { register, control, handleSubmit, reset, formState, watch, setValue } = form
  const errors = formState.errors

  // A refetch (comment, attachment, someone else's change) refreshes the form unless it has edits.
  const seen = useRef(task.updatedAt)
  useEffect(() => {
    if (task.updatedAt !== seen.current) {
      seen.current = task.updatedAt
      if (!formState.isDirty) reset(toForm(task))
    }
  }, [task, formState.isDirty, reset])

  async function send(input: TaskUpdateInput) {
    try {
      const next = await update.mutateAsync({ id: task.id, input })
      seen.current = next.updatedAt
      reset(toForm(next))
      toast.success('Task saved', next.title)
    } catch (e) {
      toast.error('Couldn’t save the task', (e as Error).message)
    }
  }

  const save = handleSubmit(async (v) => {
    const input = diff(task, v)
    if (!Object.keys(input).length) {
      reset(toForm(task))
      return
    }
    await send(input)
  })

  const linkType = watch('linkType')
  const linkId = watch('linkId')
  const ownerId = watch('ownerId')
  const ro = !canEdit

  return (
    <div className="flex flex-col gap-6">
    <form onSubmit={save} className="flex flex-col gap-6" aria-label="Task details">
      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge status={task.status} />
        {task.blocked && <BlockedBadge reason={task.blockedReason} />}
        <PriorityBadge priority={task.priority} />
        {task.overdue && (
          <Badge tone="red" icon={<AlertTriangle />}>
            Overdue
          </Badge>
        )}
        <LinkChip link={task.linkView} maxWidthClass="max-w-64" />
        {task.projectId && task.projectName && (
          <LinkChip link={{ type: 'project', id: task.projectId, label: task.projectName, available: true }} maxWidthClass="max-w-64" />
        )}
        {canEdit && task.status !== 'done' && task.status !== 'cancelled' && (
          <span className="ms-auto">
            {task.blocked ? (
              <Button write variant="secondary" size="xs" id="task-unblock" loading={blocking.pending} onClick={() => blocking.unblock(task)}>
                <Unlock />
                Unblock
              </Button>
            ) : (
              <Button write variant="secondary" size="xs" id="task-block" onClick={() => blocking.block(task)}>
                <OctagonAlert />
                Block…
              </Button>
            )}
          </span>
        )}
      </div>
      {task.blocked && task.blockedReason && (
        <p id="task-blocked-reason" className="-mt-3 text-xs text-warning-700 dark:text-warning-500">
          Blocked{task.blockedAt ? ` since ${fmtDate(task.blockedAt, 'd MMM')}` : ''}: {task.blockedReason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${id}-title`} label="Title" required error={errors.title?.message} className="sm:col-span-2">
          <TextInput id={`${id}-title`} {...register('title')} readOnly={ro} invalid={!!errors.title} maxLength={TASK_TITLE_MAX + 20} />
        </Field>
        <Field id={`${id}-desc`} label="Description" error={errors.description?.message} className="sm:col-span-2">
          <TextArea id={`${id}-desc`} {...register('description')} readOnly={ro} placeholder="Details, acceptance criteria, links…" />
        </Field>
        <Field id={`${id}-status`} label="Status">
          <SelectInput id={`${id}-status`} {...register('status')} disabled={ro}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id={`${id}-priority`} label="Priority">
          <SelectInput id={`${id}-priority`} {...register('priority')} disabled={ro}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          id={`${id}-owner`}
          label="Owner"
          error={errors.ownerId?.message}
          hint={perms.scope === 'own' ? 'You can assign tasks to yourself only.' : undefined}
        >
          {ro || perms.scope === 'own' ? (
            <TextInput id={`${id}-owner`} value={task.ownerName} readOnly />
          ) : (
            <SelectInput id={`${id}-owner`} {...register('ownerId')}>
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.active === false ? ' (inactive)' : ''}
                </option>
              ))}
              {!assignable.some((u) => u.id === task.ownerId) && <option value={task.ownerId}>{task.ownerName}</option>}
            </SelectInput>
          )}
        </Field>
        <Field id={`${id}-due`} label="Due date" error={errors.dueDate?.message}>
          <TextInput id={`${id}-due`} type="date" {...register('dueDate')} readOnly={ro} invalid={!!errors.dueDate} />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Followers</p>
          <Controller
            control={control}
            name="followerIds"
            render={({ field }) => (
              <FollowersPicker value={field.value} onChange={field.onChange} users={active} allUsers={all} excludeId={ownerId} disabled={ro} />
            )}
          />
        </div>
        <Field
          id={`${id}-link`}
          label="Linked record"
          error={errors.linkId?.message}
          hint="One lead, customer or event (the project is its own field). Events can be linked once the Events module is enabled."
          className="sm:col-span-2"
        >
          <LinkPicker
            idPrefix={`${id}-link`}
            value={linkType && linkId ? { type: linkType as TaskLinkType, id: linkId } : null}
            currentLabel={task.linkView?.label}
            invalid={!!errors.linkId}
            disabled={ro}
            onChange={(l) => {
              setValue('linkType', l?.type ?? '', { shouldDirty: true })
              setValue('linkId', l?.id ?? '', { shouldDirty: true })
            }}
          />
        </Field>
        <Field id={`${id}-est`} label="Estimated hours" error={errors.estimatedHours?.message}>
          <TextInput
            id={`${id}-est`}
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            readOnly={ro}
            invalid={!!errors.estimatedHours}
            {...register('estimatedHours', { valueAsNumber: true })}
          />
        </Field>
        <Field
          id={`${id}-project`}
          label="Project"
          hint={task.parentTaskId ? 'A sub-task belongs to its parent’s project.' : task.subtaskProgress.total ? 'Its sub-tasks move with it.' : undefined}
        >
          <SelectInput id={`${id}-project`} {...register('projectId')} disabled={ro || !!task.parentTaskId}>
            <option value="">No project</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {task.projectId && !(projects.data ?? []).some((p) => p.id === task.projectId) && (
              <option value={task.projectId}>{task.projectName ?? task.projectId}</option>
            )}
          </SelectInput>
        </Field>
        <Field id={`${id}-logged`} label="Logged hours" hint="The sum of the task’s time entries (Time tab).">
          <TextInput id={`${id}-logged`} value={`${task.loggedHours} h`} readOnly />
        </Field>
      </div>

      {canEdit && (
        <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
          {formState.isDirty && <span className="me-auto text-xs text-muted">Unsaved changes</span>}
          <Button variant="secondary" size="sm" disabled={!formState.isDirty || update.isPending} onClick={() => reset(toForm(task))}>
            Discard
          </Button>
          <Button write type="submit" size="sm" loading={update.isPending} disabled={!formState.isDirty}>
            Save
          </Button>
        </div>
      )}
    </form>

      <TaskSubtasks task={task} canEdit={canEdit} />

      <section aria-label="Comments, time, attachments and activity">
        <Tabs<Section>
          label="Task sections"
          value={section}
          onChange={setSection}
          items={[
            { id: 'comments', label: 'Comments', count: task.comments.length },
            { id: 'time', label: 'Time', count: task.timeEntries.length },
            { id: 'attachments', label: 'Attachments', count: task.attachments.length },
            { id: 'activity', label: 'Activity', count: task.history.length },
          ]}
        />
        <div role="tabpanel" id={`tab-panel-${section}`} aria-labelledby={`tab-${section}`} className="pt-4">
          {section === 'comments' && <TaskComments taskId={task.id} comments={task.comments} users={active} allUsers={all} />}
          {section === 'time' && <TaskTimeEntries task={task} canEdit={canEdit} />}
          {section === 'attachments' && <TaskAttachments taskId={task.id} attachments={task.attachments} allUsers={all} canEdit={canEdit} />}
          {section === 'activity' && <TaskHistory events={task.history} allUsers={all} />}
        </div>
      </section>
      {blocking.dialog}
      {!canEdit && (
        <p id="task-drawer-readonly" className="text-xs text-muted">
          Read only: {editBlock}{' '}
          <button type="button" className="underline" onClick={onClose}>
            Close
          </button>
        </p>
      )}
    </div>
  )
}
