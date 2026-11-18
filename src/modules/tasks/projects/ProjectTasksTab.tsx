import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ListChecks, Paperclip, Plus, X } from 'lucide-react'
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus, type TaskView } from '@/modules/tasks/types'
import { quickTaskSchema, type QuickTaskValues } from '@/modules/tasks/projectSchemas'
import { useCreateTask } from '@/modules/tasks/hooks/useTasks'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useCurrentUser } from '@/store/hooks'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Can } from '@/shared/components/permissions/Can'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { fmtHours, PRIORITY_TONE, TASK_STATUS_COLOR, TaskStatusBadge, useOpenTask, type ProjectDetail } from './projectUi'

type View = 'status' | 'all'

/** Project › Tasks: grouped by status (or one list); a row opens the task drawer (`?task=`). */
export function ProjectTasksTab({ project: p }: { project: ProjectDetail }) {
  const [view, setView] = useState<View>('status')
  const [adding, setAdding] = useState(false)
  const openTask = useOpenTask()
  const groups = useMemo(() => TASK_STATUSES.map((s) => ({ status: s, tasks: p.tasks.filter((t) => t.status === s) })).filter((g) => g.tasks.length), [p.tasks])
  const closed = p.status === 'Completed' || p.status === 'Cancelled'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View>
          label="Group tasks"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'status', label: 'By status' },
            { value: 'all', label: 'All by due date' },
          ]}
        />
        <span className="num text-xs text-muted">
          {p.doneCount}/{p.taskCount} done{p.overdueCount ? ` · ${p.overdueCount} overdue` : ''}
        </span>
        {!closed && !adding && (
          <Can module="tasks" action="create">
            <Button write size="sm" variant="secondary" className="ms-auto" onClick={() => setAdding(true)}>
              <Plus />
              Add task
            </Button>
          </Can>
        )}
      </div>

      {adding && <QuickAdd project={p} onDone={() => setAdding(false)} />}

      {p.tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListChecks aria-hidden />}
            title="No tasks yet"
            body="Add the first delivery task, or create projects from a service with a template to get tasks automatically."
          />
        </Card>
      ) : view === 'all' ? (
        <TaskTable tasks={p.tasks} onOpen={openTask} />
      ) : (
        groups.map((g) => (
          <section key={g.status} aria-label={g.status} className="space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-ink-2">
              <span className="size-2 rounded-full" style={{ background: TASK_STATUS_COLOR[g.status as TaskStatus] }} aria-hidden />
              {g.status}
              <span className="num rounded bg-sunken px-1 text-[0.6875rem] font-normal text-muted">{g.tasks.length}</span>
            </h3>
            <TaskTable tasks={g.tasks} onOpen={openTask} hideStatus />
          </section>
        ))
      )}
    </div>
  )
}

function TaskTable({ tasks, onOpen, hideStatus }: { tasks: TaskView[]; onOpen: (id: string) => void; hideStatus?: boolean }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-[0.8125rem]">
        <thead>
          <tr className="border-b border-line text-start text-xs text-muted">
            <th className="px-4 py-2 text-start font-medium">Task</th>
            <th className="px-3 py-2 text-start font-medium">Owner</th>
            <th className="px-3 py-2 text-start font-medium">Due</th>
            {!hideStatus && <th className="px-3 py-2 text-start font-medium">Status</th>}
            <th className="px-3 py-2 text-start font-medium">Priority</th>
            <th className="px-4 py-2 text-end font-medium">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((t) => (
            <tr
              key={t.id}
              tabIndex={0}
              onClick={() => onOpen(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen(t.id)
              }}
              className="cursor-pointer hover:bg-hover/60 focus-visible:bg-hover focus-visible:outline-none"
            >
              <td className="max-w-[22rem] px-4 py-2.5">
                <p className={cn('truncate font-medium', t.status === 'Done' ? 'text-muted line-through decoration-subtle' : 'text-ink')}>{t.title}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                  <span className="font-mono">{t.id}</span>
                  {t.attachments.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Paperclip className="size-3" aria-hidden />
                      {t.attachments.length}
                    </span>
                  )}
                </p>
              </td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
                  <Avatar name={t.ownerName} size="xs" />
                  {t.ownerName}
                </span>
              </td>
              <td className={cn('num px-3 py-2.5 whitespace-nowrap', t.overdue ? 'font-medium text-danger-600' : 'text-ink-2')}>
                {t.dueDate ? fmtDate(t.dueDate, 'd MMM') : <span className="text-subtle">—</span>}
                {t.overdue && <span className="ms-1 text-xs">overdue</span>}
              </td>
              {!hideStatus && (
                <td className="px-3 py-2.5">
                  <TaskStatusBadge status={t.status} />
                </td>
              )}
              <td className="px-3 py-2.5">
                <Badge tone={PRIORITY_TONE[t.priority]} variant="dot">
                  {t.priority}
                </Badge>
              </td>
              <td className="num px-4 py-2.5 text-end text-xs whitespace-nowrap">
                <span className={t.estimatedHours && t.loggedHours > t.estimatedHours ? 'text-danger-600' : 'text-ink'}>{t.loggedHours}</span>
                <span className="text-muted"> / {fmtHours(t.estimatedHours)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Inline quick add: title, owner, due date, priority. Linked to the project. */
function QuickAdd({ project: p, onDone }: { project: ProjectDetail; onDone: () => void }) {
  const me = useCurrentUser()
  const toast = useToast()
  const create = useCreateTask()
  const people = useUsersQuery()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<QuickTaskValues>({
    resolver: zodResolver(quickTaskSchema),
    defaultValues: { title: '', ownerId: me?.id ?? p.managerId, dueDate: '', priority: 'Medium' },
  })

  const onSubmit = handleSubmit((v) => {
    create.mutate(
      { title: v.title.trim(), projectId: p.id, link: { type: 'project', id: p.id }, ownerId: v.ownerId, dueDate: v.dueDate || null, priority: v.priority },
      {
        onSuccess: (t) => {
          toast.success('Task added', t.title)
          reset({ title: '', ownerId: v.ownerId, dueDate: v.dueDate, priority: v.priority })
        },
      },
    )
  })

  return (
    <Card className="p-3">
      <form noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem_7.5rem_auto]">
        <div>
          <TextInput aria-label="Task title" placeholder="What needs doing?" autoFocus invalid={!!errors.title} {...register('title')} />
          {errors.title && <p className="mt-1 text-xs text-danger-600">{errors.title.message}</p>}
        </div>
        <SelectInput aria-label="Owner" invalid={!!errors.ownerId} disabled={people.isPending} {...register('ownerId')}>
          {people.isPending && <option value={me?.id ?? ''}>Loading…</option>}
          {(people.data ?? [])
            .filter((u) => u.active !== false)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </SelectInput>
        <div>
          <TextInput aria-label="Due date" type="date" min={p.startDate} invalid={!!errors.dueDate} {...register('dueDate')} />
          {errors.dueDate && <p className="mt-1 text-xs text-danger-600">{errors.dueDate.message}</p>}
        </div>
        <SelectInput aria-label="Priority" {...register('priority')}>
          {TASK_PRIORITIES.map((pr) => (
            <option key={pr} value={pr}>
              {pr}
            </option>
          ))}
        </SelectInput>
        <div className="flex items-center gap-1">
          <Button write type="submit" size="md" loading={create.isPending}>
            Add
          </Button>
          <Button variant="ghost" size="md" iconOnly aria-label="Close quick add" onClick={onDone}>
            <X />
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-xs text-danger-600 sm:col-span-5">
            {create.error.message}
          </p>
        )}
      </form>
    </Card>
  )
}
