import { useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'
import type { TaskView } from '@/modules/tasks/types'
import { TASK_STATUS_LABEL } from '@/modules/tasks/types'
import { useCreateTask, useMoveTask } from '@/modules/tasks/hooks/useTasks'
import { TASK_TITLE_MAX } from '@/modules/tasks/schemas'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { useToast } from '@/shared/components/ui/Toast'
import { TextInput } from '@/shared/components/form/Field'
import { ProgressBar } from '@/modules/tasks/projects/projectUi'
import { BlockedBadge, StatusIcon } from './TaskBadges'
import { dueLabel } from './taskMeta'
import { useOpenTask } from './useTaskActions'

/**
 * Drawer › Sub-tasks: progress (done / total, cancelled ones left out), toggle done, open, add.
 * One level only: a sub-task shows its parent instead of a list. New sub-tasks inherit the
 * parent's project and company (the server sets them).
 */
export function TaskSubtasks({ task, canEdit }: { task: TaskView; canEdit: boolean }) {
  const toast = useToast()
  const openTask = useOpenTask()
  const create = useCreateTask()
  const move = useMoveTask()
  const [title, setTitle] = useState('')

  if (task.parentTaskId) {
    return (
      <p className="flex items-center gap-2 text-[0.8125rem] text-muted" id="task-parent">
        <ListChecks className="size-4 text-subtle" aria-hidden />
        Sub-task of{' '}
        <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => openTask(task.parentTaskId!)}>
          {task.parentTitle ?? task.parentTaskId}
        </button>
      </p>
    )
  }

  const { done, total } = task.subtaskProgress
  const closed = task.status === 'done' || task.status === 'cancelled'

  async function add() {
    const t = title.trim()
    if (!t) return
    try {
      await create.mutateAsync({ title: t, parentTaskId: task.id, ownerId: task.ownerId })
      setTitle('')
    } catch (e) {
      toast.error('Couldn’t add the sub-task', (e as Error).message)
    }
  }

  async function toggle(s: TaskView['subtasks'][number]) {
    const next = s.status === 'done' ? 'todo' : 'done'
    try {
      await move.mutateAsync({ id: s.id, status: next })
    } catch (e) {
      toast.error(`“${s.title}” wasn’t updated`, (e as Error).message)
    }
  }

  return (
    <section aria-label="Sub-tasks" id="task-subtasks" className="space-y-2.5">
      <div className="flex items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink-2">
          <ListChecks className="size-4 text-subtle" aria-hidden />
          Sub-tasks
        </h3>
        {total > 0 && (
          <>
            <span className="num text-xs text-muted" id="task-subtask-progress">
              {done}/{total} done
            </span>
            <div className="w-28">
              <ProgressBar value={(done / total) * 100} />
            </div>
          </>
        )}
      </div>
      {task.subtasks.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {task.subtasks.map((s) => {
            const isDone = s.status === 'done'
            return (
              <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={isDone ? `Reopen “${s.title}”` : `Mark “${s.title}” done`}
                  disabled={!canEdit || s.status === 'cancelled' || move.isPending}
                  onClick={() => void toggle(s)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <StatusIcon status={s.status} />
                </button>
                <button
                  type="button"
                  onClick={() => openTask(s.id)}
                  className={cn('min-w-0 flex-1 truncate text-start text-[0.8125rem] hover:underline', isDone || s.status === 'cancelled' ? 'text-muted line-through' : 'text-ink')}
                  title={`${s.title} · ${TASK_STATUS_LABEL[s.status]}`}
                >
                  {s.title}
                </button>
                {s.blocked && <BlockedBadge compact />}
                <span className="shrink-0 text-xs text-muted">{s.ownerName}</span>
                <span className="num w-20 shrink-0 text-end text-xs text-muted">{dueLabel(s.dueDate)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && !closed && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <TextInput
            aria-label="New sub-task"
            id="task-subtask-new"
            value={title}
            maxLength={TASK_TITLE_MAX}
            placeholder="Add a sub-task and press Enter"
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-[0.8125rem]"
          />
          <Button write type="submit" variant="secondary" size="sm" loading={create.isPending} disabled={!title.trim()}>
            <Plus />
            Add
          </Button>
        </form>
      )}
      {total === 0 && !canEdit && <p className="text-xs text-muted">No sub-tasks.</p>}
    </section>
  )
}
