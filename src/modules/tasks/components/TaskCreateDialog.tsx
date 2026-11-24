import { useEffect, useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { TaskInput, TaskLinkType, TaskView } from '@/modules/tasks/types'
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { useCreateTask, useProjectsQuery } from '@/modules/tasks/hooks/useTasks'
import { taskFormSchema, TASK_TITLE_MAX, type TaskFormValues } from '@/modules/tasks/schemas'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { LinkPicker } from './LinkPicker'
import { FollowersPicker } from './FollowersPicker'
import { useActiveUsers, useAssignableUsers, useTaskPermissions } from './useTaskActions'

const blank = (ownerId: string): TaskFormValues => ({
  title: '',
  description: '',
  ownerId,
  followerIds: [],
  priority: 'medium',
  status: 'todo',
  dueDate: '',
  linkType: '',
  linkId: '',
  projectId: '',
  estimatedHours: 0,
})

/** The POST /tasks body: only what was filled in (the server applies its defaults to the rest). */
function toInput(v: TaskFormValues): TaskInput {
  return {
    title: v.title.trim(),
    ...(v.description.trim() ? { description: v.description } : {}),
    ownerId: v.ownerId,
    ...(v.followerIds.length ? { followerIds: v.followerIds } : {}),
    priority: v.priority,
    status: v.status,
    dueDate: v.dueDate || null,
    link: v.linkType && v.linkId ? { type: v.linkType, id: v.linkId } : null,
    projectId: v.projectId || null,
    ...(v.estimatedHours ? { estimatedHours: v.estimatedHours } : {}),
  }
}

/**
 * New task with every detail (POST /tasks): title, description, status, priority, owner, due date,
 * followers, linked record (lead / customer / event), project and estimate. The quick-add line on
 * My tasks stays for one-liners; this popup opens from the page's "New task" button and from the
 * "+ New" menu / command palette (`/tasks/my?new=1`).
 */
export function TaskCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (task: TaskView) => void }) {
  const id = useId()
  const toast = useToast()
  const create = useCreateTask()
  const perms = useTaskPermissions()
  const me = perms.user?.id ?? ''
  const projects = useProjectsQuery()
  const { users: active, all } = useActiveUsers()
  const { users: assignable } = useAssignableUsers([me])

  const form = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: blank(me) })
  const { register, control, handleSubmit, reset, watch, setValue, formState } = form
  const errors = formState.errors

  useEffect(() => {
    if (!open) return
    reset(blank(me))
    create.reset()
    // After the dialog focused its panel (a child effect runs first): start in the title.
    document.getElementById(`${id}-title`)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const linkType = watch('linkType')
  const linkId = watch('linkId')
  const ownerId = watch('ownerId')

  const submit = handleSubmit(async (v) => {
    try {
      const t = await create.mutateAsync(toInput(v))
      toast.success('Task created', t.title)
      onClose()
      onCreated?.(t)
    } catch {
      // Shown in the form (create.error).
    }
  })

  return (
    <Drawer
      variant="dialog"
      open={open}
      onClose={onClose}
      width="lg"
      title="New task"
      description="Everything about the work: who owns it, when it’s due and what it relates to."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form={`${id}-form`} loading={create.isPending}>
            Create task
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} aria-label="New task" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${id}-title`} label="Title" required error={errors.title?.message} className="sm:col-span-2">
          <TextInput id={`${id}-title`} autoComplete="off" maxLength={TASK_TITLE_MAX + 20} invalid={!!errors.title} {...register('title')} />
        </Field>
        <Field id={`${id}-desc`} label="Description" error={errors.description?.message} className="sm:col-span-2">
          <TextArea id={`${id}-desc`} className="min-h-24" placeholder="Details, acceptance criteria, links…" invalid={!!errors.description} {...register('description')} />
        </Field>
        <Field id={`${id}-owner`} label="Assignee" error={errors.ownerId?.message} hint={perms.scope === 'own' ? 'You can assign tasks to yourself only.' : undefined}>
          {perms.scope === 'own' ? (
            <TextInput id={`${id}-owner`} value={perms.user?.name ?? 'Me'} readOnly />
          ) : (
            <SelectInput id={`${id}-owner`} invalid={!!errors.ownerId} {...register('ownerId')}>
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === me ? `Me (${u.name})` : u.name}
                </option>
              ))}
              {assignable.length === 0 && <option value={me}>Me</option>}
            </SelectInput>
          )}
        </Field>
        <Field id={`${id}-due`} label="Due date" error={errors.dueDate?.message}>
          <TextInput id={`${id}-due`} type="date" invalid={!!errors.dueDate} {...register('dueDate')} />
        </Field>
        <Field id={`${id}-priority`} label="Priority">
          <SelectInput id={`${id}-priority`} {...register('priority')}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id={`${id}-status`} label="Status">
          <SelectInput id={`${id}-status`} {...register('status')}>
            {TASK_STATUSES.filter((s) => s !== 'cancelled').map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          id={`${id}-link`}
          label="Related record"
          error={errors.linkId?.message}
          hint="Optional: one lead, customer or event. Events can be linked once the Events module is enabled."
          className="sm:col-span-2"
        >
          <LinkPicker
            idPrefix={`${id}-link`}
            value={linkType && linkId ? { type: linkType as TaskLinkType, id: linkId } : null}
            invalid={!!errors.linkId}
            onChange={(l) => {
              setValue('linkType', l?.type ?? '', { shouldDirty: true })
              setValue('linkId', l?.id ?? '', { shouldDirty: true })
            }}
          />
        </Field>
        <Field id={`${id}-project`} label="Project">
          <SelectInput id={`${id}-project`} disabled={projects.isPending} {...register('projectId')}>
            <option value="">{projects.isPending ? 'Loading projects…' : 'No project'}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id={`${id}-est`} label="Estimated hours" error={errors.estimatedHours?.message}>
          <TextInput
            id={`${id}-est`}
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            invalid={!!errors.estimatedHours}
            {...register('estimatedHours', { setValueAs: (v) => (v === '' || v == null ? 0 : Number(v)) })}
          />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Followers</p>
          <Controller
            control={control}
            name="followerIds"
            render={({ field }) => <FollowersPicker value={field.value} onChange={field.onChange} users={active} allUsers={all} excludeId={ownerId} />}
          />
        </div>

        {create.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 sm:col-span-2 dark:bg-danger-700/20 dark:text-danger-500">
            {create.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
