import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link2, Plus } from 'lucide-react'
import type { TaskLink, TaskLinkView, TaskView } from '@/modules/tasks/types'
import { useCreateTask } from '@/modules/tasks/hooks/useTasks'
import { quickAddSchema, TASK_TITLE_MAX, type QuickAddValues } from '@/modules/tasks/schemas'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { LinkChip } from './LinkChip'
import { LinkPicker } from './LinkPicker'
import { useAssignableUsers, useTaskPermissions } from './useTaskActions'

interface QuickAddTaskProps {
  /** Preset link (lead / customer page). Shown as a chip and always applied. */
  link?: TaskLinkView | null
  /** Allow picking a link (My tasks). Ignored when `link` is preset. */
  allowLink?: boolean
  onCreated?: (task: TaskView) => void
  placeholder?: string
  className?: string
}

/** One-line task capture: title + due + owner (+ link). Enter saves. */
export function QuickAddTask({ link, allowLink = true, onCreated, placeholder = 'Add a task and press Enter', className }: QuickAddTaskProps) {
  const id = useId()
  const toast = useToast()
  const create = useCreateTask()
  const { user, scope } = useTaskPermissions()
  const { users } = useAssignableUsers()
  const [pickedLink, setPickedLink] = useState<TaskLink | null>(null)
  const [showLink, setShowLink] = useState(false)

  const form = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { title: '', dueDate: '', ownerId: user?.id ?? '' },
  })
  const { register, handleSubmit, formState, reset, getValues } = form
  const titleError = formState.errors.title?.message

  const submit = handleSubmit(async (v) => {
    const finalLink: TaskLink | null = link ? { type: link.type, id: link.id } : pickedLink
    try {
      const t = await create.mutateAsync({
        title: v.title,
        dueDate: v.dueDate || null,
        ownerId: v.ownerId,
        link: finalLink,
      })
      toast.success('Task added', t.title)
      reset({ title: '', dueDate: getValues('dueDate'), ownerId: v.ownerId })
      setPickedLink(null)
      setShowLink(false)
      onCreated?.(t)
    } catch (e) {
      toast.error('Couldn’t add the task', (e as Error).message)
    }
  })

  return (
    <form
      onSubmit={submit}
      aria-label="Quick add task"
      className={cn('rounded-card border border-line bg-surface p-2 shadow-xs', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plus className="ms-1 size-4 shrink-0 text-subtle" aria-hidden />
        <label htmlFor={`${id}-title`} className="sr-only">
          Task title
        </label>
        <input
          id={`${id}-title`}
          {...register('title')}
          maxLength={TASK_TITLE_MAX + 20}
          placeholder={placeholder}
          aria-invalid={!!titleError || undefined}
          aria-describedby={titleError ? `${id}-err` : undefined}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 basis-48 bg-transparent px-1 text-sm text-ink placeholder:text-subtle focus-visible:outline-none"
        />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <TextInput
            type="date"
            aria-label="Due date"
            {...register('dueDate')}
            className="h-8 w-[9.5rem] text-xs"
          />
          {scope === 'own' ? (
            <span className="inline-flex h-8 items-center rounded-md border border-line px-2 text-xs text-muted" title="You can assign tasks to yourself only">
              Owner: me
            </span>
          ) : (
            <SelectInput aria-label="Owner" {...register('ownerId')} className="h-8 w-[10.5rem] text-xs">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user?.id ? `Me (${u.name})` : u.name}
                </option>
              ))}
              {users.length === 0 && user && <option value={user.id}>Me</option>}
            </SelectInput>
          )}
          {link ? (
            <LinkChip link={link} />
          ) : (
            allowLink && (
              <Button
                variant={pickedLink || showLink ? 'secondary' : 'ghost'}
                size="sm"
                aria-expanded={showLink}
                onClick={() => setShowLink((v) => !v)}
              >
                <Link2 />
                {pickedLink ? 'Linked' : 'Link'}
              </Button>
            )
          )}
          <Button write type="submit" size="sm" loading={create.isPending}>
            Add
          </Button>
        </div>
      </div>
      {!link && allowLink && showLink && (
        <div className="mt-2 border-t border-line px-1 pt-2">
          <LinkPicker value={pickedLink} onChange={setPickedLink} idPrefix={`${id}-link`} />
        </div>
      )}
      {titleError && (
        <p id={`${id}-err`} className="mt-1 px-7 text-xs text-danger-600 dark:text-danger-500">
          {titleError}
        </p>
      )}
    </form>
  )
}
